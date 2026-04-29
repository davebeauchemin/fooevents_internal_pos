<?php
/**
 * Create WooCommerce orders for FooEvents Bookings (Internal POS) following the FooEvents POS path.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use Throwable;
use WC_Order;
use WC_Product;
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

	const MAX_BOOKING_LINES = 40;

	/**
	 * Plain formatted money for JSON REST consumers (wc_price outputs HTML markup).
	 *
	 * @param float|string $amount Amount.
	 * @return string
	 */
	private static function format_price_plain_for_rest( $amount ) {
		return wp_strip_all_tags(
			html_entity_decode(
				wc_price( $amount ),
				ENT_QUOTES | ENT_HTML5,
				'UTF-8'
			)
		);
	}

	/**
	 * Preview WooCommerce-calculated totals from booking lines without creating an order.
	 *
	 * @param array<int, array{event_id:int,slot_id:string,date_id:string,qty:int}> $lines Booking lines.
	 * @return array|WP_Error
	 */
	public function preview_checkout_lines( array $lines ) {
		if ( ! class_exists( 'WooCommerce' ) || ! function_exists( 'wc_load_cart' ) ) {
			return new WP_Error( 'fooevents_wc', __( 'WooCommerce is not available.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}

		$parsed = $this->normalize_booking_lines_array( $lines );
		if ( is_wp_error( $parsed ) ) {
			return $parsed;
		}
		$lines = $parsed;

		$session_ok = $this->ensure_wc_cart_session();
		if ( ! $session_ok ) {
			return new WP_Error( 'no_cart', __( 'Could not initialize WooCommerce cart session.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}

		try {
			if ( WC()->cart ) {
				WC()->cart->empty_cart();
			}

			foreach ( $lines as $ln ) {
				$event_id = (int) $ln['event_id'];
				$slot_id  = (string) $ln['slot_id'];
				$date_id  = (string) $ln['date_id'];
				$qty      = (int) $ln['qty'];

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

				$product = wc_get_product( $event_id );
				if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
					return new WP_Error( 'not_found', __( 'Event not found or not a booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
				}

				$norm = $this->bookings->normalize_booking_ids_for_cart( $event_id, $slot_id, $date_id );
				if ( null === $norm ) {
					return new WP_Error(
						'booking_resolve',
						__( 'Could not resolve booking slot and date for cart.', 'fooevents-internal-pos' ),
						array( 'status' => 400 )
					);
				}

				$cart_item_data = $this->build_cart_item_data(
					(string) $norm['method'],
					$event_id,
					(string) $norm['slot_id'],
					(string) $norm['internal_date_id'],
					isset( $norm['dateslot_date_bucket'] ) ? (string) $norm['dateslot_date_bucket'] : ''
				);

				$add = WC()->cart->add_to_cart( $event_id, $qty, 0, array(), $cart_item_data );
				if ( ! $add ) {
					return new WP_Error( 'cart_refused', __( 'Could not add the booking to cart (availability or validation).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
				}
			}

			WC()->cart->calculate_totals();

			$cart       = WC()->cart;
			$tax_totals = $cart->get_tax_totals();
			$tax_rows   = array();
			foreach ( (array) $tax_totals as $code => $tax ) {
				if ( ! is_object( $tax ) ) {
					continue;
				}
				$amt = isset( $tax->amount ) ? (float) $tax->amount : 0.0;
				$tax_rows[] = array(
					'id'              => (string) $code,
					'label'           => isset( $tax->label ) ? wp_strip_all_tags( (string) $tax->label ) : '',
					'amount'          => wc_format_decimal( $amt, wc_get_price_decimals() ),
					'amountFormatted' => self::format_price_plain_for_rest( $amt ),
				);
			}

			$line_rows = array();
			foreach ( $cart->get_cart() as $cart_item_key => $cart_item ) {
				$_product = isset( $cart_item['data'] ) ? $cart_item['data'] : null;
				if ( ! $_product || ! is_a( $_product, WC_Product::class ) ) {
					continue;
				}
				$cqty             = isset( $cart_item['quantity'] ) ? (int) $cart_item['quantity'] : 1;
				$pid              = isset( $cart_item['product_id'] ) ? (int) $cart_item['product_id'] : 0;
				$line_subtotal_ex = isset( $cart_item['line_subtotal'] ) ? (float) $cart_item['line_subtotal'] : 0.0;
				$line_tax_amt     = isset( $cart_item['line_subtotal_tax'] ) ? (float) $cart_item['line_subtotal_tax'] : 0.0;
				$unit_ex          = $cqty > 0 ? $line_subtotal_ex / (float) $cqty : 0.0;

				// Line list in POS shows amounts before tax; taxes appear in the breakdown below.
				$line_rows[] = array(
					'eventId'           => $pid,
					'name'              => wp_strip_all_tags( (string) $_product->get_name() ),
					'qty'               => $cqty,
					'unitPriceExclTax'  => wc_format_decimal( $unit_ex, wc_get_price_decimals() ),
					'unitPriceFormatted'=> self::format_price_plain_for_rest( $unit_ex ),
					'lineSubtotalExclTax'=> wc_format_decimal( $line_subtotal_ex, wc_get_price_decimals() ),
					'lineTax'           => wc_format_decimal( $line_tax_amt, wc_get_price_decimals() ),
					'lineTotalInclTax' => wc_format_decimal( $line_subtotal_ex + $line_tax_amt, wc_get_price_decimals() ),
					'lineTotalFormatted'=> self::format_price_plain_for_rest( $line_subtotal_ex ),
				);
			}

			$availability = array();
			foreach ( $lines as $ln ) {
				$chk          = $this->bookings->check_availability( (int) $ln['event_id'], (string) $ln['slot_id'], (string) $ln['date_id'], 1 );
				$availability[] = array(
					'eventId'   => (int) $ln['event_id'],
					'slotId'    => (string) $ln['slot_id'],
					'dateId'    => (string) $ln['date_id'],
					'remaining' => $chk['remaining'],
					'available' => (bool) $chk['available'],
				);
			}

			return array(
				'currency'           => (string) get_woocommerce_currency(),
				'currencySymbol'     => html_entity_decode( (string) get_woocommerce_currency_symbol(), ENT_QUOTES, 'UTF-8' ),
				'subtotal'           => wc_format_decimal( (float) $cart->get_subtotal(), wc_get_price_decimals() ),
				'subtotalFormatted'  => self::format_price_plain_for_rest( (float) $cart->get_subtotal() ),
				'subtotalTax'        => wc_format_decimal( (float) $cart->get_subtotal_tax(), wc_get_price_decimals() ),
				'subtotalTaxFormatted'=> self::format_price_plain_for_rest( (float) $cart->get_subtotal_tax() ),
				'taxTotal'           => wc_format_decimal( (float) $cart->get_total_tax(), wc_get_price_decimals() ),
				'taxTotalFormatted'  => self::format_price_plain_for_rest( (float) $cart->get_total_tax() ),
				'total'              => wc_format_decimal( (float) $cart->get_total( 'edit' ), wc_get_price_decimals() ),
				'totalFormatted'     => self::format_price_plain_for_rest( (float) $cart->get_total( 'edit' ) ),
				'taxes'              => $tax_rows,
				'lines'              => $line_rows,
				'availability'       => $availability,
			);
		} finally {
			$this->reset_cart_safely();
		}
	}

	/**
	 * Create a booking: prime cart, run FooEvents order ticket builder, complete order, native tickets + email.
	 *
	 * Supports legacy single-slot args or multi-line `lines` array (same keys as REST preview).
	 *
	 * @param array $args Arguments including attendee fields and either legacy slot keys or `lines`.
	 * @return array|WP_Error
	 */
	public function create_booking( array $args ) {
		$pm_raw = isset( $args['payment_method_key'] ) ? trim( (string) $args['payment_method_key'] ) : '';
		$af     = isset( $args['attendee_first'] ) ? sanitize_text_field( (string) $args['attendee_first'] ) : '';
		$al     = isset( $args['attendee_last'] ) ? sanitize_text_field( (string) $args['attendee_last'] ) : '';
		$em     = isset( $args['attendee_email'] ) ? sanitize_email( (string) $args['attendee_email'] ) : '';
		$note   = isset( $args['note'] ) ? sanitize_text_field( (string) $args['note'] ) : '';
		if ( isset( $args['check_in_now'] ) ) {
			$b               = filter_var( $args['check_in_now'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE );
			$check_in_now = null === $b ? (bool) $args['check_in_now'] : (bool) $b;
		} else {
			$check_in_now = false;
		}

		if ( ! is_email( $em ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'Invalid booking parameters.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		if ( isset( $args['lines'] ) && is_array( $args['lines'] ) && count( $args['lines'] ) > 0 ) {
			$parsed = $this->normalize_booking_lines_array( $args['lines'] );
		} else {
			$parsed = $this->normalize_booking_lines_array(
				array(
					array(
						'event_id' => isset( $args['event_id'] ) ? (int) $args['event_id'] : 0,
						'slot_id'  => isset( $args['slot_id'] ) ? (string) $args['slot_id'] : '',
						'date_id'  => isset( $args['date_id'] ) ? (string) $args['date_id'] : '',
						'qty'      => isset( $args['qty'] ) ? (int) $args['qty'] : 1,
					),
				)
			);
		}

		if ( is_wp_error( $parsed ) ) {
			return $parsed;
		}

		return $this->create_booking_from_lines( $parsed, $pm_raw, $af, $al, $em, $note, $check_in_now );
	}

	/**
	 * Normalize incoming REST booking lines (snake_case keys expected).
	 *
	 * @param array $lines Raw lines.
	 * @return array<int, array{event_id:int,slot_id:string,date_id:string,qty:int}>|WP_Error
	 */
	private function normalize_booking_lines_array( array $lines ) {
		if ( empty( $lines ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'At least one booking line is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( count( $lines ) > self::MAX_BOOKING_LINES ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %d max booking lines */
					__( 'Too many booking lines (max %d).', 'fooevents-internal-pos' ),
					self::MAX_BOOKING_LINES
				),
				array( 'status' => 400 )
			);
		}

		$out = array();
		foreach ( $lines as $ln ) {
			if ( ! is_array( $ln ) ) {
				return new WP_Error( 'rest_invalid_param', __( 'Invalid booking line.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			$event_id = isset( $ln['event_id'] ) ? (int) $ln['event_id'] : 0;
			$slot_id  = isset( $ln['slot_id'] ) ? trim( (string) $ln['slot_id'] ) : '';
			$date_id  = isset( $ln['date_id'] ) ? trim( (string) $ln['date_id'] ) : '';
			$qty      = isset( $ln['qty'] ) ? (int) $ln['qty'] : 1;
			$qty      = max( 1, min( 20, $qty ) );

			if ( $event_id <= 0 || '' === $slot_id || '' === $date_id ) {
				return new WP_Error( 'rest_invalid_param', __( 'Each line needs event_id, slot_id, and date_id.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}

			$out[] = array(
				'event_id' => $event_id,
				'slot_id'  => $slot_id,
				'date_id'  => $date_id,
				'qty'      => $qty,
			);
		}

		return $out;
	}

	/**
	 * Create WooCommerce order from validated booking lines.
	 *
	 * @param array<int, array{event_id:int,slot_id:string,date_id:string,qty:int}> $lines Lines.
	 * @param string                                                                   $pm_raw Payment method key.
	 * @param string                                                                   $af First name.
	 * @param string                                                                   $al Last name.
	 * @param string                                                                   $em Email.
	 * @param string                                                                     $note Customer note.
	 * @param bool                                                                       $check_in_now Mark emitted tickets Checked In immediately.
	 * @return array|WP_Error
	 */
	private function create_booking_from_lines( array $lines, $pm_raw, $af, $al, $em, $note, $check_in_now = false ) {
		if ( ! class_exists( 'WooCommerce' ) || ! function_exists( 'wc_load_cart' ) || ! class_exists( 'FooEvents_Config' ) ) {
			return new WP_Error( 'fooevents_wc', __( 'WooCommerce or FooEvents is not available.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}

		foreach ( $lines as $ln ) {
			$pre = $this->bookings->check_availability( (int) $ln['event_id'], (string) $ln['slot_id'], (string) $ln['date_id'], (int) $ln['qty'] );
			if ( 'not_found' === $pre['reason'] ) {
				return new WP_Error( 'not_found', __( 'Slot or date not found for this event.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
			}
			if ( 'past_date' === $pre['reason'] ) {
				return new WP_Error( 'past_date', __( 'That date is in the past.', 'fooevents-internal-pos' ), array( 'status' => 422 ) );
			}
			if ( 'insufficient' === $pre['reason'] || ! $pre['available'] ) {
				return new WP_Error( 'insufficient', __( 'Not enough capacity for this slot.', 'fooevents-internal-pos' ), array( 'status' => 409 ) );
			}

			$product = wc_get_product( (int) $ln['event_id'] );
			if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
				return new WP_Error( 'not_found', __( 'Event not found or not a booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
			}
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
			if ( WC()->cart ) {
				WC()->cart->empty_cart();
			}

			$slot_pairs           = array();
			$norm_slots_for_remain = array();

			foreach ( $lines as $ln ) {
				$event_id = (int) $ln['event_id'];
				$slot_id  = (string) $ln['slot_id'];
				$date_id  = (string) $ln['date_id'];
				$qty      = (int) $ln['qty'];

				$norm = $this->bookings->normalize_booking_ids_for_cart( $event_id, $slot_id, $date_id );
				if ( null === $norm ) {
					return new WP_Error(
						'booking_resolve',
						__( 'Could not resolve booking slot and date for cart.', 'fooevents-internal-pos' ),
						array( 'status' => 400 )
					);
				}

				$cart_item_data = $this->build_cart_item_data(
					(string) $norm['method'],
					$event_id,
					(string) $norm['slot_id'],
					(string) $norm['internal_date_id'],
					isset( $norm['dateslot_date_bucket'] ) ? (string) $norm['dateslot_date_bucket'] : ''
				);

				$add = WC()->cart->add_to_cart( $event_id, $qty, 0, array(), $cart_item_data );
				if ( ! $add ) {
					return new WP_Error( 'cart_refused', __( 'Could not add the booking to cart (availability or validation).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
				}

				$slot_pairs[] = (string) $norm['slot_id'] . '|' . (string) $norm['internal_date_id'];
				$norm_slots_for_remain[] = array(
					'event_id' => $event_id,
					'slot_id'  => (string) $norm['slot_id'],
					'date_id'  => $date_id,
				);
			}

			$order = wc_create_order(
				array(
					'created_via' => 'fooevents_internal_pos',
					'customer_id' => get_current_user_id(),
					'status'      => 'pending',
				)
			);
			if ( is_wp_error( $order ) ) {
				return new WP_Error( 'order', $order->get_error_message(), array( 'status' => 500 ) );
			}

			$order_id = $order->get_id();
			$order->set_billing_first_name( $af );
			$order->set_billing_last_name( $al );
			$order->set_billing_email( $em );
			$order->set_billing_phone( '' );
			if ( '' !== $note ) {
				$order->set_customer_note( $note );
			}
			$order->update_meta_data( 'fooeventspos_internal_booking', 'yes' );
			$order->update_meta_data( '_fooeventspos_internal_slot', wp_json_encode( $slot_pairs ) );
			$this->apply_fooeventspos_pos_meta( $order, $pm_key, $pm_label );

			foreach ( WC()->cart->get_cart() as $cart_item ) {
				$_product = isset( $cart_item['data'] ) ? $cart_item['data'] : null;
				if ( ! $_product || ! is_a( $_product, WC_Product::class ) ) {
					continue;
				}
				$cqty = isset( $cart_item['quantity'] ) ? (int) $cart_item['quantity'] : 1;

				$line_excl = (float) wc_get_price_excluding_tax( $_product, array( 'qty' => $cqty ) );
				$per_excl  = $cqty > 0 ? $line_excl / (float) $cqty : 0.0;

				if ( $cqty > 1 ) {
					for ( $i = 0; $i < $cqty; $i++ ) {
						$order->add_product(
							$_product,
							1,
							array(
								'subtotal' => $per_excl,
								'total'    => $per_excl,
							)
						);
					}
				} else {
					$order->add_product(
						$_product,
						1,
						array(
							'subtotal' => $per_excl,
							'total'    => $per_excl,
						)
					);
				}
			}

			$order->calculate_totals();
			$this->create_fooeventspos_payment_record( $order, $pm_key );
			$order->save();

			$qty_by_event = array();
			foreach ( WC()->cart->get_cart() as $cart_item ) {
				$eid = isset( $cart_item['product_id'] ) ? (int) $cart_item['product_id'] : 0;
				$cq  = isset( $cart_item['quantity'] ) ? (int) $cart_item['quantity'] : 0;
				if ( $eid <= 0 ) {
					continue;
				}
				$qty_by_event[ $eid ] = isset( $qty_by_event[ $eid ] ) ? $qty_by_event[ $eid ] + $cq : $cq;
			}

			$posts = array();
			foreach ( $qty_by_event as $eid => $qtot ) {
				$posts = array_merge(
					$posts,
					$this->build_fooevents_attendee_post( (int) $eid, $af, $al, $em, (int) $qtot )
				);
			}

			$_POST = self::array_merge_recurse( (array) $_POST, (array) $posts );

			$fooevents_config = new \FooEvents_Config();
			if ( ! class_exists( 'FooEvents_Checkout_Helper', false ) ) {
				// phpcs:ignore WordPressVIPMinimum.Files.IncludingFile.UsingVariable
				require_once $fooevents_config->class_path . 'class-fooevents-checkout-helper.php';
			}
			$helper = new \FooEvents_Checkout_Helper( $fooevents_config );
			$helper->woocommerce_events_process( $order_id );

			$order = wc_get_order( $order_id );
			if ( $order instanceof WC_Order ) {
				foreach ( array_keys( $qty_by_event ) as $eid ) {
					$this->patch_order_tickets_attendee( $order, (int) $eid, $af, $al, $em );
				}
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

			// Tickets are created when the order moves to completed (FooEvents `create_tickets()` on status change).
			// Hook ticket creation so "check in now" runs as each `event_magic_tickets` post is created.
			$checked_in_ticket_ids   = array();
			$immediate_check_in_cb     = null;
			$current_order_id_for_hook = (int) $order_id;
			if ( $check_in_now ) {
				$immediate_check_in_cb = function ( $ticket_post_id ) use ( $current_order_id_for_hook, &$checked_in_ticket_ids ) {
					$tid = absint( $ticket_post_id );
					if ( $tid <= 0 ) {
						return;
					}
					$oid = (int) get_post_meta( $tid, 'WooCommerceEventsOrderID', true );
					if ( $oid !== $current_order_id_for_hook ) {
						return;
					}
					$more = $this->check_in_ticket_posts_native( array( $tid ) );
					$checked_in_ticket_ids = array_values( array_unique( array_merge( $checked_in_ticket_ids, $more ) ) );
				};
				add_action( 'fooevents_create_ticket', $immediate_check_in_cb, 10, 1 );
			}
			try {
				$order->update_status( 'completed', __( 'Booked via Internal POS', 'fooevents-internal-pos' ), true );
			} finally {
				if ( null !== $immediate_check_in_cb ) {
					remove_action( 'fooevents_create_ticket', $immediate_check_in_cb, 10 );
				}
			}

			$this->repair_missing_fooevents_ticket_posts_if_needed( $order_id );

			if ( $check_in_now ) {
				$ticket_ids_after = $this->get_order_ticket_ids( $order_id );
				$missing          = array_diff( $ticket_ids_after, $checked_in_ticket_ids );
				if ( ! empty( $missing ) ) {
					$more = $this->check_in_ticket_posts_native( array_values( array_map( 'intval', $missing ) ) );
					$checked_in_ticket_ids = array_values( array_unique( array_merge( $checked_in_ticket_ids, $more ) ) );
				}
			}

			$total_qty = 0;
			foreach ( $lines as $ln ) {
				$total_qty += (int) $ln['qty'];
			}

			$remaining_by_line = array();
			$last_remain       = null;
			foreach ( $norm_slots_for_remain as $ns ) {
				$after             = $this->bookings->check_availability( (int) $ns['event_id'], (string) $ns['slot_id'], (string) $ns['date_id'], 1 );
				$last_remain       = $after['remaining'];
				$remaining_by_line[] = array(
					'eventId'   => (int) $ns['event_id'],
					'slotId'    => (string) $ns['slot_id'],
					'dateId'    => (string) $ns['date_id'],
					'remaining' => $after['remaining'],
				);
			}

			$ids             = $this->get_order_ticket_ids( $order_id );
			$completed_order = wc_get_order( $order_id );
			$order_total     = $completed_order instanceof WC_Order ? (float) $completed_order->get_total() : 0.0;

			return array(
				'orderId'             => (int) $order_id,
				'ticketIds'           => $ids,
				'checkedInTicketIds' => $checked_in_ticket_ids,
				'checkedInCount'      => count( $checked_in_ticket_ids ),
				'remaining'           => $last_remain,
				'remainingByLine'     => $remaining_by_line,
				'qty'                 => $total_qty,
				'totalQty'            => $total_qty,
				'paymentMethodKey'    => $pm_key,
				'paymentMethodLabel'  => $pm_label,
				'cashierId'           => (int) get_current_user_id(),
				'total'               => wc_format_decimal( $order_total, wc_get_price_decimals() ),
				'totalFormatted'      => self::format_price_plain_for_rest( $order_total ),
			);
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
	 * FooEvents `FooEvents_Woo_Helper::create_tickets()` can mark `WooCommerceEventsTicketsGenerated` while inserting
	 * zero `event_magic_tickets` rows (e.g. empty `WooCommerceEventsOrderID` loops). WooHelper then skips subsequent
	 * regeneration while order meta looks "complete". Restore ticket CPT posts once when there are zero rows.
	 *
	 * @param int $order_id WooCommerce order ID.
	 * @return void
	 */
	private function repair_missing_fooevents_ticket_posts_if_needed( $order_id ) {
		$order_id = absint( $order_id );
		if ( $order_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			return;
		}

		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		$blueprint = $order->get_meta( 'WooCommerceEventsOrderTickets', true );
		if ( empty( $blueprint ) || ! is_array( $blueprint ) ) {
			return;
		}

		$existing = $this->count_event_magic_ticket_posts_for_order( $order_id );

		if ( $existing > 0 ) {
			return;
		}

		if ( ! class_exists( '\\FooEvents_Config' ) || ! class_exists( '\\FooEvents_Woo_Helper' ) ) {
			return;
		}

		$order->delete_meta_data( 'WooCommerceEventsTicketsGenerated' );
		$order->save();

		$config = new \FooEvents_Config();
		$woo    = new \FooEvents_Woo_Helper( $config );
		$woo->create_tickets( $order_id );
	}

	/**
	 * @param int $order_id WooCommerce order id.
	 * @return int
	 */
	private function count_event_magic_ticket_posts_for_order( $order_id ) {
		global $wpdb;

		$order_id = absint( $order_id );
		if ( $order_id <= 0 ) {
			return 0;
		}

		$sql = "SELECT COUNT(*) FROM {$wpdb->posts} p"
			. " INNER JOIN {$wpdb->postmeta} m ON ( m.post_id = p.ID )"
			. " WHERE p.post_type = %s"
			. " AND m.meta_key = %s AND m.meta_value = %s";

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- Prepared from fixed table names and %s placeholders below.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				$sql,
				'event_magic_tickets',
				'WooCommerceEventsOrderID',
				(string) $order_id
			)
		);
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
	 * FooEvents-native cart keys so WooCommerceEvents_Checkout_Helper and FooEvents_Bookings capture slot/date/stock.
	 *
	 * @param string $method            slotdate|dateslot.
	 * @param int    $event_id          Product id.
	 * @param string $slot_id           Slot id.
	 * @param string $internal_date_id  FooEvents add_date key (slotdate) or internal date id (dateslot row).
	 * @param string $dateslot_bucket   Human-readable date bucket key for dateslot (optional).
	 * @return array
	 */
	private function build_cart_item_data( $method, $event_id, $slot_id, $internal_date_id, $dateslot_bucket = '' ) {
		$data = array( 'fooevents_bookings_method' => $method );
		$eid  = (string) (int) $event_id;
		if ( 'dateslot' === $method ) {
			// Product page uses slotId_dateId_productId — see fooevents_bookings ~4731, capture ~2549.
			$data['fooevents_bookings_slot_val'] = (string) $slot_id . '_' . (string) $internal_date_id . '_' . $eid;
			$data['fooevents_bookings_date_val'] = '' !== $dateslot_bucket ? $dateslot_bucket : (string) $internal_date_id;
		} else {
			// First segment of slot_val is slot id (see fooevents_bookings ~6057); suffix event id matches standard checkout.
			$data['fooevents_bookings_slot_val'] = (string) $slot_id . '_' . $eid;
			$data['fooevents_bookings_date_val'] = (string) $internal_date_id;
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
	 * Mark FooEvents ticket posts as checked in — mirrors FooEvents `update_ticket_status()` behavior.
	 *
	 * @param int[] $ticket_post_ids `event_magic_tickets` post IDs.
	 * @return int[]
	 */
	private function check_in_ticket_posts_native( array $ticket_post_ids ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fooevents_check_in';
		$status      = 'Checked In';
		$done_ids    = array();

		if ( ! function_exists( 'is_plugin_active' ) || ! function_exists( 'is_plugin_active_for_network' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		foreach ( $ticket_post_ids as $tid_raw ) {
			$tid = (int) $tid_raw;
			if ( $tid <= 0 ) {
				continue;
			}
			if ( 'event_magic_tickets' !== get_post_type( $tid ) ) {
				continue;
			}

			$existing = get_post_meta( $tid, 'WooCommerceEventsStatus', true );
			if ( 'Checked In' === $existing ) {
				$done_ids[] = $tid;
				continue;
			}

			update_post_meta( $tid, 'WooCommerceEventsStatus', wp_strip_all_tags( $status ) );

			$event_id = (int) get_post_meta( $tid, 'WooCommerceEventsProductID', true );
			$timestamp = current_time( 'timestamp' ); // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp.Requested

			if (
				is_plugin_active( 'fooevents_multi_day/fooevents-multi-day.php' )
				|| is_plugin_active_for_network( 'fooevents_multi_day/fooevents-multi-day.php' )
			) {

				$woocommerce_events_num_days = (int) get_post_meta( $event_id, 'WooCommerceEventsNumDays', true );

				if ( $woocommerce_events_num_days > 1 ) {

					$woocommerce_events_multiday_status = array();
					for ( $day = 1; $day <= $woocommerce_events_num_days; $day++ ) {
						$woocommerce_events_multiday_status[ $day ] = wp_strip_all_tags( $status );
						$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
							$table_name,
							array(
								'tid'     => $tid,
								'eid'     => $event_id,
								'day'     => $day,
								'uid'     => get_current_user_id(),
								'status'  => $status,
								'checkin' => $timestamp,
							)
						);
					}
					update_post_meta( $tid, 'WooCommerceEventsMultidayStatus', wp_strip_all_tags( wp_json_encode( $woocommerce_events_multiday_status ) ) );
				} else {
					$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
						$table_name,
						array(
							'tid'     => $tid,
							'eid'     => $event_id,
							'day'     => 1,
							'uid'     => get_current_user_id(),
							'status'  => $status,
							'checkin' => $timestamp,
						)
					);
				}
			} else {
				$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
					$table_name,
					array(
						'tid'     => $tid,
						'eid'     => $event_id,
						'day'     => 1,
						'uid'     => get_current_user_id(),
						'status'  => $status,
						'checkin' => $timestamp,
					)
				);
			}

			do_action( 'fooevents_check_in_ticket', array( $tid, $status, time() ) );
			$done_ids[] = $tid;
		}

		return array_values( array_unique( array_map( 'intval', $done_ids ) ) );
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
