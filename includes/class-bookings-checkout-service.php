<?php
/**
 * Create WooCommerce orders for FooEvents Bookings (Internal POS) following the FooEvents POS path.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use Throwable;
use WC_Order;
use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Booking checkout via cart + checkout helper.
 */
class Bookings_Checkout_Service {

	/**
	 * @var Bookings_Service
	 */
	private $bookings;

	/**
	 * @param Bookings_Service $bookings Bookings service.
	 */
	public function __construct( Bookings_Service $bookings ) {
		$this->bookings = $bookings;
	}

	/**
	 * Create a booking: prime cart, run FooEvents order ticket builder, complete order, native tickets + email.
	 *
	 * @param array $args Arguments (event_id, slot_id, date_id, qty, payment_method_key, attendee_*, note optional).
	 * @return array|WP_Error
	 */
	public function create_booking( array $args ) {
		$event_id = isset( $args['event_id'] ) ? (int) $args['event_id'] : 0;
		$slot_id  = isset( $args['slot_id'] ) ? (string) $args['slot_id'] : '';
		$date_id  = isset( $args['date_id'] ) ? (string) $args['date_id'] : '';
		$qty      = isset( $args['qty'] ) ? (int) $args['qty'] : 1;
		$qty      = max( 1, min( 20, $qty ) );
		$pm_raw   = isset( $args['payment_method_key'] ) ? trim( (string) $args['payment_method_key'] ) : '';
		$af       = isset( $args['attendee_first'] ) ? sanitize_text_field( (string) $args['attendee_first'] ) : '';
		$al       = isset( $args['attendee_last'] ) ? sanitize_text_field( (string) $args['attendee_last'] ) : '';
		$em       = isset( $args['attendee_email'] ) ? sanitize_email( (string) $args['attendee_email'] ) : '';

		if ( $event_id <= 0 || '' === $slot_id || '' === $date_id || ! is_email( $em ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'Invalid booking parameters.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		if ( ! class_exists( 'WooCommerce' ) || ! function_exists( 'wc_load_cart' ) || ! class_exists( 'FooEvents_Config' ) ) {
			return new WP_Error( 'fooevents_wc', __( 'WooCommerce or FooEvents is not available.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}

		$pre = $this->bookings->check_availability( $event_id, $slot_id, $date_id, $qty );
		if ( 'not_found' === $pre['reason'] ) {
			return new WP_Error( 'not_found', __( 'Slot or date not found for this event.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}
		if ( 'past_date' === $pre['reason'] ) {
			return new WP_Error( 'past_date', __( 'That date is in the past.', 'fooevents-internal-pos' ), array( 'status' => 422 ) );
		}
		if ( 'insufficient' === $pre['reason'] || ! $pre['available'] ) {
			return new WP_Error( 'insufficient', __( 'Not enough capacity for this slot.', 'fooevents-internal-pos' ), array( 'status' => 409 ) );
		}

		$ctx     = $this->bookings->get_processed_options( $event_id );
		$method  = (string) $ctx['method'];
		$product = wc_get_product( $event_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error( 'not_found', __( 'Event not found or not a booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$session_ok = $this->ensure_wc_cart_session();
		if ( ! $session_ok ) {
			return new WP_Error( 'no_cart', __( 'Could not initialize WooCommerce cart session.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}

		self::load_fooeventspos_api_helpers();
		$valid_pm = self::get_valid_payment_method_keys();
		$pm_key   = '' !== $pm_raw ? $pm_raw : 'fooeventspos_card';
		if ( ! in_array( $pm_key, $valid_pm, true ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'Invalid or unsupported payment method.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$pm_label = $this->resolve_payment_method_label( $pm_key );

		$order_id  = 0;
		$post_copy = $this->stash_post();
		$result    = null;

		try {
			$cart_item_data = $this->build_cart_item_data( $method, $slot_id, $date_id );
			$add            = WC()->cart->add_to_cart( $event_id, $qty, 0, array(), $cart_item_data );
			if ( ! $add ) {
				$result = new WP_Error( 'cart_refused', __( 'Could not add the booking to cart (availability or validation).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
				return $result;
			}

			$order = wc_create_order(
				array(
					'created_via'   => 'fooevents_internal_pos',
					'customer_id'   => get_current_user_id(),
					'status'        => 'pending',
				)
			);
			if ( is_wp_error( $order ) ) {
				$result = new WP_Error( 'order', $order->get_error_message(), array( 'status' => 500 ) );
				return $result;
			}
			$order_id = $order->get_id();
			$order->set_billing_first_name( $af );
			$order->set_billing_last_name( $al );
			$order->set_billing_email( $em );
			$order->set_billing_phone( '' );
			if ( ! empty( $args['note'] ) ) {
				$order->set_customer_note( (string) $args['note'] );
			}
			$order->update_meta_data( 'fooeventspos_internal_booking', 'yes' );
			$order->update_meta_data( '_fooeventspos_internal_slot', (string) $slot_id . '|' . (string) $date_id );
			$this->apply_fooeventspos_pos_meta( $order, $pm_key, $pm_label );
			// Mirror FooEvents POS: split event line items into qty=1 rows for admin / refunds; cart still has qty for ticket count.
			$line_excl = (float) wc_get_price_excluding_tax( $product, array( 'qty' => $qty ) );
			$per_excl  = $qty > 0 ? $line_excl / (float) $qty : 0.0;
			if ( $qty > 1 ) {
				for ( $i = 0; $i < $qty; $i++ ) {
					$order->add_product(
						$product,
						1,
						array(
							'subtotal' => $per_excl,
							'total'    => $per_excl,
						)
					);
				}
			} else {
				$order->add_product( $product, 1, array( 'subtotal' => $per_excl, 'total' => $per_excl ) );
			}
			$order->calculate_totals();
			$this->create_fooeventspos_payment_record( $order, $pm_key );
			$order->save();

			$posts  = $this->build_fooevents_attendee_post( $event_id, $af, $al, $em, $qty );
			$_POST  = self::array_merge_recurse( (array) $_POST, (array) $posts );
			$fooevents_config = new \FooEvents_Config();
			if ( ! class_exists( 'FooEvents_Checkout_Helper', false ) ) {
				// phpcs:ignore WordPressVIPMinimum.Files.IncludingFile.UsingVariable
				require_once $fooevents_config->class_path . 'class-fooevents-checkout-helper.php';
			}
			$helper = new \FooEvents_Checkout_Helper( $fooevents_config );
			$helper->woocommerce_events_process( $order_id );

			$order = wc_get_order( $order_id );
			if ( $order instanceof WC_Order ) {
				$this->patch_order_tickets_attendee( $order, (int) $event_id, $af, $al, $em );
			}

			if ( WC()->cart ) {
				WC()->cart->empty_cart();
			}
			if ( WC()->session ) {
				WC()->session->destroy_session();
			}

			$order = wc_get_order( $order_id );
			if ( ! $order instanceof WC_Order ) {
				throw new \Exception( 'Order could not be reloaded for completion.' );
			}
			$order->update_status( 'completed', __( 'Booked via Internal POS', 'fooevents-internal-pos' ), true );

			$after  = $this->bookings->check_availability( $event_id, $slot_id, $date_id, 1 );
			$remain = $after['remaining'];
			$ids    = $this->get_order_ticket_ids( $order_id );

			$result = array(
				'orderId'            => (int) $order_id,
				'ticketIds'          => $ids,
				'remaining'          => $remain,
				'qty'                => $qty,
				'paymentMethodKey'   => $pm_key,
				'paymentMethodLabel' => $pm_label,
				'cashierId'          => (int) get_current_user_id(),
			);
			return $result;
		} catch ( Throwable $e ) {
			$result = new WP_Error(
				'booking_failed',
				$e->getMessage(),
				array( 'status' => 500 )
			);
			if ( $order_id > 0 ) {
				$failed_order = wc_get_order( $order_id );
				if ( $failed_order instanceof WC_Order ) {
					$failed_order->delete( true );
				} else {
					wp_delete_post( $order_id, true );
				}
			}
			return $result;
		} finally {
			$this->unstash_post( $post_copy );
			$this->reset_cart_safely();
		}
	}

	/**
	 * @return void
	 */
	public function reset_cart_safely() {
		$this->ensure_wc_cart_session();
		if ( WC()->cart ) {
			WC()->cart->empty_cart();
		}
		if ( WC()->session ) {
			WC()->session->destroy_session();
		}
	}

	/**
	 * @param string $method  slotdate|dateslot.
	 * @param string $slot_id As from API.
	 * @param string $date_id As from API.
	 * @return array
	 */
	private function build_cart_item_data( $method, $slot_id, $date_id ) {
		$data = array( 'fooevents_bookings_method' => $method );
		if ( 'dateslot' === $method ) {
			$data['fooevents_bookings_date_val'] = $date_id;
			// Internal FooEvents format for this flow — see class-fooevents-bookings.php ~2545.
			$data['fooevents_bookings_slot_val'] = (string) $slot_id . '_' . (string) $date_id;
		} else {
			$data['fooevents_bookings_slot_val'] = $slot_id;
			$data['fooevents_bookings_date_val'] = $date_id;
		}
		return $data;
	}

	/**
	 * @param int    $event_id         Product.
	 * @param string $first            First.
	 * @param string $last             Last.
	 * @param string $email            Email.
	 * @param int    $quantity_lines   Ticket count.
	 * @return array
	 */
	private function build_fooevents_attendee_post( $event_id, $first, $last, $email, $quantity_lines ) {
		$out = array();
		$eid = (string) (int) $event_id;
		for ( $y = 1; $y <= (int) $quantity_lines; $y++ ) {
			$out[ $eid . '_attendee_1__' . $y ]         = $first;
			$out[ $eid . '_attendeelastname_1__' . $y ] = $last;
			$out[ $eid . '_attendeeemail_1__' . $y ]   = $email;
		}
		return $out;
	}

	/**
	 * Force attendee fields on the serialized order ticket array so create_tickets() and emails get correct data.
	 *
	 * @param WC_Order $order      Order.
	 * @param int      $event_id  Product.
	 * @param string   $first     First.
	 * @param string   $last      Last.
	 * @param string   $email     Email.
	 */
	private function patch_order_tickets_attendee( $order, $event_id, $first, $last, $email ) {
		$tickets = $order->get_meta( 'WooCommerceEventsOrderTickets', true );
		if ( ! is_array( $tickets ) ) {
			$order->save();
			return;
		}
		$event_id = (int) $event_id;
		foreach ( $tickets as $xi => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			foreach ( $row as $yi => $t ) {
				if ( ! is_array( $t ) ) {
					continue;
				}
				if ( (int) ( $t['WooCommerceEventsProductID'] ?? 0 ) !== $event_id ) {
					continue;
				}
				$t['WooCommerceEventsAttendeeName']     = $first;
				$t['WooCommerceEventsAttendeeLastName'] = $last;
				$t['WooCommerceEventsAttendeeEmail']     = $email;
				$tickets[ $xi ][ $yi ]                   = $t;
			}
		}
		$order->update_meta_data( 'WooCommerceEventsOrderTickets', $tickets );
		$order->save();
	}

	/**
	 * @param int  $order_id Order.
	 * @param bool $ids_only Ids.
	 * @return int[]
	 */
	private function get_order_ticket_ids( $order_id, $ids_only = true ) {
		$q = new \WP_Query(
			array(
				'post_type'      => 'event_magic_tickets',
				'post_status'    => 'any',
				'posts_per_page' => 100,
				'fields'         => $ids_only ? 'ids' : 'all',
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'   => 'WooCommerceEventsOrderID',
						'value' => (string) (int) $order_id,
					),
				),
			)
		);
		return is_array( $q->posts ) ? array_map( 'intval', $q->posts ) : array();
	}

	/**
	 * @return bool
	 */
	private function ensure_wc_cart_session() {
		if ( ! function_exists( 'wc_load_cart' ) ) {
			return false;
		}
		wc_load_cart();
		return (bool) ( WC()->cart && WC()->session );
	}

	/**
	 * @return array{post: array}
	 */
	private function stash_post() {
		return array( 'post' => $_POST );
	}

	/**
	 * @param array{post: array} $stash Stash.
	 */
	private function unstash_post( $stash ) {
		$_POST = $stash['post'];
	}

	/**
	 * @param array $a A.
	 * @param array $b B.
	 * @return array
	 */
	private static function array_merge_recurse( array $a, array $b ) {
		foreach ( $b as $k => $v ) {
			if ( is_int( $k ) ) {
				$a[] = $v;
			} else {
				$a[ $k ] = $v;
			}
		}
		return $a;
	}

	/**
	 * Load FooEvents POS API helper functions (payment gateways, labels).
	 *
	 * @return void
	 */
	private static function load_fooeventspos_api_helpers() {
		if ( function_exists( 'fooeventspos_do_get_all_payment_methods' ) ) {
			return;
		}
		$path = WP_PLUGIN_DIR . '/fooevents_pos/admin/helpers/fooeventspos-api-helper.php';
		if ( file_exists( $path ) ) {
			require_once $path; // phpcs:ignore WordPressVIPMinimum.Files.IncludingFile.UsingCustomFunction, WordPress.WP.I18n
		}
	}

	/**
	 * @return string[]
	 */
	private static function get_valid_payment_method_keys() {
		if ( function_exists( 'fooeventspos_do_get_all_payment_methods' ) && \WC() && \WC()->payment_gateways ) {
			$methods = fooeventspos_do_get_all_payment_methods( true );
			if ( is_array( $methods ) && ! empty( $methods ) ) {
				return array_keys( $methods );
			}
		}
		return array( 'fooeventspos_card' );
	}

	/**
	 * REST: [{ key, label }, ...] for the payment method selector.
	 *
	 * @return array<int, array{key: string, label: string}>
	 */
	public static function get_payment_methods_for_rest() {
		if ( function_exists( 'wc_load_cart' ) ) {
			wc_load_cart();
		}
		self::load_fooeventspos_api_helpers();
		$out = array();
		if ( function_exists( 'fooeventspos_do_get_all_payment_methods' ) && \WC() && \WC()->payment_gateways ) {
			$methods = fooeventspos_do_get_all_payment_methods( true );
			if ( is_array( $methods ) ) {
				foreach ( $methods as $key => $label ) {
					$out[] = array(
						'key'   => (string) $key,
						'label' => (string) $label,
					);
				}
			}
		}
		if ( empty( $out ) ) {
			$out[] = array(
				'key'   => 'fooeventspos_card',
				'label' => 'Card Payment',
			);
		}
		return $out;
	}

	/**
	 * @param string $pm_key POS payment key.
	 * @return string
	 */
	private function resolve_payment_method_label( $pm_key ) {
		if ( function_exists( 'fooeventspos_get_payment_method_from_key' ) ) {
			return (string) fooeventspos_get_payment_method_from_key( $pm_key );
		}
		$map = self::get_payment_method_fallback_labels();
		return isset( $map[ $pm_key ] ) ? $map[ $pm_key ] : (string) $pm_key;
	}

	/**
	 * @return array<string, string>
	 */
	private static function get_payment_method_fallback_labels() {
		return array(
			'fooeventspos_card' => 'Card Payment',
		);
	}

	/**
	 * Meta key used for the duplicate "Order Payment Method" row (phrases or English default).
	 *
	 * @return string
	 */
	private function get_order_payment_method_meta_key() {
		$path = WP_PLUGIN_DIR . '/fooevents_pos/admin/helpers/fooeventspos-phrases-helper.php';
		if ( file_exists( $path ) ) {
			require_once $path; // phpcs:ignore WordPressVIPMinimum.Files.IncludingFile.UsingCustomFunction, WordPress.WP.I18n
			global $fooeventspos_phrases;
			if ( is_array( $fooeventspos_phrases ) && ! empty( $fooeventspos_phrases['meta_key_order_payment_method'] ) ) {
				return (string) $fooeventspos_phrases['meta_key_order_payment_method'];
			}
		}
		return 'Order Payment Method';
	}

	/**
	 * @param WC_Order $order   Order.
	 * @param string   $pm_key  FooEvents POS method key.
	 * @param string   $pm_label Resolved label.
	 * @return void
	 */
	private function apply_fooeventspos_pos_meta( $order, $pm_key, $pm_label ) {
		$order->update_meta_data( '_fooeventspos_order_source', 'fooeventspos_app' );
		$uid = (int) get_current_user_id();
		if ( $uid > 0 ) {
			$order->update_meta_data( '_fooeventspos_user_id', (string) $uid );
		}
		$order->update_meta_data( '_fooeventspos_payment_method', $pm_key );
		if ( function_exists( 'fooeventspos_get_wc_payment_method_from_fooeventspos_key' ) ) {
			$wc_id = (string) fooeventspos_get_wc_payment_method_from_fooeventspos_key( $pm_key );
			if ( '' !== $wc_id ) {
				$order->set_payment_method( $wc_id );
			}
		}
		$title = function_exists( 'fooeventspos_get_payment_method_from_key' )
			? (string) fooeventspos_get_payment_method_from_key( $pm_key )
			: $pm_label;
		$order->set_payment_method_title( $title );
		$order->update_meta_data( $this->get_order_payment_method_meta_key(), $title );
	}

	/**
	 * @param WC_Order $order  Order (totals calculated).
	 * @param string   $pm_key Payment method key.
	 * @return void
	 */
	private function create_fooeventspos_payment_record( $order, $pm_key ) {
		if ( ! is_a( $order, 'WC_Order' ) ) {
			return;
		}
		if ( ! class_exists( 'FooEventsPOS_Payments' ) ) {
			$path = WP_PLUGIN_DIR . '/fooevents_pos/admin/class-fooeventspos-payments.php';
			if ( file_exists( $path ) ) {
				require_once $path; // phpcs:ignore WordPressVIPMinimum.Files.IncludingFile.UsingCustomFunction
			}
		}
		if ( ! class_exists( 'FooEventsPOS_Payments' ) ) {
			return;
		}
		$ts = $order->get_date_created() ? $order->get_date_created()->getTimestamp() : time();
		$payment_args = array(
			'pd'   => (string) $ts,
			'oid'  => (string) $order->get_id(),
			'opmk' => $pm_key,
			'oud'  => (string) ( (int) get_current_user_id() ),
			'tid'  => '',
			'pa'   => $order->get_total(),
			'np'   => '1',
			'pn'   => '1',
			'pap'  => '1',
			'par'  => '0',
		);
		$payment_post = \FooEventsPOS_Payments::fooeventspos_create_update_payment( $payment_args );
		if ( is_wp_error( $payment_post ) || empty( $payment_post['ID'] ) ) {
			return;
		}
		$pid = (int) $payment_post['ID'];
		$payment_args['fspid'] = (string) $pid;
		$payment_args['pe']    = get_post_meta( $pid, '_payment_extra', true );
		$payment_args['soar']  = get_post_meta( $pid, '_fooeventspos_square_order_auto_refund', true );
		$payment_args['sfa']   = get_post_meta( $pid, '_fooeventspos_square_fee_amount', true );
		$order->update_meta_data( '_fooeventspos_payments', \wp_json_encode( array( $payment_args ) ) );
	}
}
