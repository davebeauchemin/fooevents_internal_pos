<?php
/**
 * Create WooCommerce orders for FooEvents Bookings (Internal POS) following the FooEvents POS path.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use Throwable;
use WC_Order;
use WC_Order_Item_Fee;
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

	/** Max stored length for POS billing postcode (sanitized string, no format validation). */
	const MAX_BOOKING_POSTAL_CODE_LENGTH = 50;

	/**
	 * Coupon codes POS tries automatically (create those coupons in WooCommerce). Extend via
	 * `fooevents_internal_pos_auto_coupon_codes` filter — default empty.
	 *
	 * @return array<int, string>
	 */
	public static function get_auto_coupon_codes() {
		$filtered = apply_filters( 'fooevents_internal_pos_auto_coupon_codes', array() );
		return self::sanitize_coupon_code_list( is_array( $filtered ) ? $filtered : array() );
	}

	/** @deprecated Prefer Coupon_Rules::MAX_COUPONS_PER_REQUEST. */
	const MAX_BOOKING_COUPONS = 20;

	/**
	 * @param mixed $maybe_arr REST JSON `couponCodes` array or null/absent.
	 * @return array<int,string>|WP_Error|null Sanitized codes, WP_Error when invalid shape, empty array acceptable.
	 */
	public static function parse_coupon_codes_from_rest_payload( $maybe_arr ) {
		if ( null === $maybe_arr || false === $maybe_arr ) {
			return array();
		}
		if ( ! is_array( $maybe_arr ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'couponCodes must be an array of strings.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$list = array();
		foreach ( $maybe_arr as $row ) {
			if ( ! is_string( $row ) ) {
				return new WP_Error( 'rest_invalid_param', __( 'Each couponCodes entry must be a string.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			$list[] = $row;
		}
		$sanitized = self::sanitize_coupon_code_list( $list );
		if ( count( $sanitized ) > Coupon_Rules::MAX_COUPONS_PER_REQUEST ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %d max coupons */
					__( 'Too many coupons (maximum %d).', 'fooevents-internal-pos' ),
					Coupon_Rules::MAX_COUPONS_PER_REQUEST
				),
				array( 'status' => 400 )
			);
		}

		return $sanitized;
	}

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
	 * @param array<int, mixed> $codes Raw coupon strings.
	 * @return array<int, string> Woo-formatted coupon codes, unique order preserved (max Woo length).
	 */
	private static function sanitize_coupon_code_list( array $codes ) {
		$seen = array();
		$out  = array();
		foreach ( $codes as $c ) {
			if ( ! is_string( $c ) ) {
				continue;
			}
			$trim = sanitize_text_field( trim( $c ) );
			if ( '' === $trim ) {
				continue;
			}
			$formatted = function_exists( 'wc_format_coupon_code' )
				? wc_format_coupon_code( $trim )
				: strtoupper( $trim );

			if ( '' === $formatted || mb_strlen( $formatted ) > 200 ) {
				continue;
			}
			$key = strtolower( $formatted );
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$out[]        = $formatted;
		}

		return $out;
	}

	/**
	 * REST payload for stacked bundle tiers (applied as WC cart/order fees).
	 *
	 * @param array<int, array{code:string,code_display?:string,name:string,qtyCovered:int,amount:float,taxable:bool,tax_class:string}> $bundle_lines Lines from Coupon_Rules::compute_bundle_fee_lines.
	 * @return array{bundleDiscounts:array<int,array<string,mixed>>,feesTotal:string,feesTotalFormatted:string}
	 */
	private static function build_bundle_discount_rest_payload( array $bundle_lines ) {
		$rows   = array();
		$sum_ex = 0.0;
		foreach ( $bundle_lines as $line ) {
			$a = isset( $line['amount'] ) ? (float) $line['amount'] : 0.0;
			$sum_ex += $a;
			$code_out = '';
			if ( isset( $line['code_display'] ) && '' !== trim( (string) $line['code_display'] ) ) {
				$code_out = trim( (string) $line['code_display'] );
			} elseif ( isset( $line['code'] ) ) {
				$code_out = (string) $line['code'];
			}
			if ( '' !== $code_out ) {
				$code_out = Coupon_Rules::format_bundle_coupon_code_for_display( $code_out );
			}
			$rows[] = array(
				'code'             => $code_out,
				'name'             => isset( $line['name'] ) ? (string) $line['name'] : '',
				'qtyCovered'       => isset( $line['qtyCovered'] ) ? (int) $line['qtyCovered'] : 0,
				'amount'           => wc_format_decimal( $a, wc_get_price_decimals() ),
				'amountFormatted'  => self::format_price_plain_for_rest( $a ),
			);
		}

		return array(
			'bundleDiscounts'    => $rows,
			'feesTotal'          => wc_format_decimal( -1 * $sum_ex, wc_get_price_decimals() ),
			'feesTotalFormatted' => self::format_price_plain_for_rest( -1 * $sum_ex ),
		);
	}

	/**
	 * Negative cart fees transferred as order fee items before calculate_totals.
	 *
	 * @param \WC_Order $order Order instance.
	 * @param \WC_Cart  $cart  Cart instance.
	 * @return void
	 */
	private static function cart_fees_into_order_items( $order, $cart ) {
		if ( ! $order instanceof WC_Order || ! $cart instanceof \WC_Cart || ! method_exists( $cart, 'get_fees' ) ) {
			return;
		}

		foreach ( (array) $cart->get_fees() as $fee ) {
			if ( ! is_object( $fee ) || '' === trim( (string) ( $fee->name ?? '' ) ) ) {
				continue;
			}

			if ( isset( $fee->amount ) && (float) $fee->amount === 0.0 ) {
				continue;
			}

			$item = new WC_Order_Item_Fee();
			$item->set_name( (string) $fee->name );
			if ( isset( $fee->amount ) ) {
				$item->set_amount( (float) $fee->amount );
				$item->set_total( (float) $fee->amount );
			}
			if ( isset( $fee->tax_class ) ) {
				$item->set_tax_class( (string) $fee->tax_class );
			}
			$tax_status = 'none';
			if ( isset( $fee->tax_status ) ) {
				$tax_status = (string) $fee->tax_status;
			} elseif ( ! empty( $fee->taxable ) ) {
				$tax_status = 'taxable';
			}
			$item->set_tax_status( $tax_status );
			$order->add_item( $item );
		}
	}

	/**
	 * Try apply one coupon via WooCommerce cart validation; clears notices so REST stays clean.
	 *
	 * @param \WC_Cart $cart          Cart session.
	 * @param string   $coupon_code Woo-formatted code.
	 * @return array{applied:bool, message:string}
	 */
	private static function try_cart_apply_coupon_notice_clean( $cart, $coupon_code ) {
		if ( ! $cart instanceof \WC_Cart || '' === $coupon_code ) {
			return array(
				'applied' => false,
				'message' => __( 'Invalid coupon.', 'fooevents-internal-pos' ),
			);
		}

		if ( $coupon_id > 0 ) {
			$coupon_obj = new \WC_Coupon( $coupon_id );
			if ( $coupon_obj->get_id() > 0 && ! Coupon_Rules::coupon_allowed_for_channel( $coupon_obj, 'pos' ) ) {
				return array(
					'applied' => false,
					'message' => __( 'This coupon is only valid on the storefront checkout.', 'fooevents-internal-pos' ),
				);
			}
		}

		wc_clear_notices();
		$ok = false;
		if ( method_exists( $cart, 'apply_coupon' ) ) {
			$maybe = $cart->apply_coupon( $coupon_code );
			if ( true === $maybe ) {
				$ok = true;
			} elseif ( is_wp_error( $maybe ) ) {
				return array(
					'applied' => false,
					'message' => wp_strip_all_tags( $maybe->get_error_message() ),
				);
			}
		}

		if ( ! $ok || ! method_exists( $cart, 'has_discount' ) || ! $cart->has_discount( $coupon_code ) ) {
			$errs = wc_get_notices( 'error' );
			wc_clear_notices();
			$msg = '';
			if ( is_array( $errs ) && isset( $errs[0]['notice'] ) ) {
				$msg = wp_strip_all_tags( (string) $errs[0]['notice'] );
			}
			if ( '' === $msg ) {
				$msg = __( 'This coupon cannot be applied to this basket.', 'fooevents-internal-pos' );
			}

			return array(
				'applied' => false,
				'message' => $msg,
			);
		}

		wc_clear_notices();

		return array(
			'applied' => true,
			'message' => '',
		);
	}

	/**
	 * Set session customer billing email for POS coupon validation (e.g. email-restricted coupons).
	 *
	 * @param string $billing_email Email from POS checkout; empty or invalid values are ignored.
	 */
	private function apply_pos_checkout_billing_email_to_wc_session( $billing_email ) {
		$billing_email = sanitize_email( strtolower( trim( (string) $billing_email ) ) );
		if ( '' === $billing_email || ! is_email( $billing_email ) ) {
			return;
		}

		if ( function_exists( 'WC' ) && WC()->customer instanceof \WC_Customer ) {
			WC()->customer->set_billing_email( $billing_email );
			if ( method_exists( WC()->customer, 'save' ) ) {
				WC()->customer->save();
			}
		}
	}

	/**
	 * Apply configured auto coupons + cashier manual coupons to the hydrated cart session.
	 *
	 * @param \WC_Cart $cart Cart.
	 * @param array    $cashier_manual_sanitized Sanitized cashier coupon codes only.
	 * @param string   $billing_email POS checkout attendee/billing email for coupon email checks (optional).
	 * @return array{coupon_errors:array<int,array{code:string,manual:bool,message:string}>}
	 */
	private function attempt_pos_cart_discounts_for_session( $cart, array $cashier_manual_sanitized, $billing_email = '' ) {
		Coupon_Rules::set_pos_internal_session( true );
		try {
			$coupon_errors = array();
			$manual_map    = array();
			foreach ( $cashier_manual_sanitized as $m ) {
				$manual_map[ strtolower( (string) $m ) ] = true;
			}

			if ( ! $cart instanceof \WC_Cart ) {
				return array( 'coupon_errors' => $coupon_errors );
			}

			$this->apply_pos_checkout_billing_email_to_wc_session( $billing_email );

			/**
			 * Pre-bundle totals populate line item prices/taxes before fee tier packing.
			 */
			if ( method_exists( $cart, 'calculate_totals' ) ) {
				$cart->calculate_totals();
			}

			$booking_qty = Coupon_Rules::total_booking_ticket_qty_in_cart( $cart );

			$bi = 0;
			foreach ( Coupon_Rules::compute_bundle_fee_lines( $booking_qty, 'pos', $cart ) as $bundle_line ) {
				Coupon_Rules::add_bundle_discount_fee_to_cart( $cart, $bundle_line, $bi );
				++$bi;
			}

			if ( method_exists( $cart, 'calculate_totals' ) ) {
				$cart->calculate_totals();
			}

			foreach ( Coupon_Rules::build_pos_coupon_apply_queue( $cashier_manual_sanitized ) as $code ) {
				$res = self::try_cart_apply_coupon_notice_clean( $cart, $code );
				if ( $res['applied'] ) {
					continue;
				}
				$is_manual = isset( $manual_map[ strtolower( (string) $code ) ] );
				if ( $is_manual && Coupon_Rules::coupon_code_is_bundle_tier( $code ) ) {
					continue;
				}

				if ( ! $is_manual ) {
					$low = strtolower( (string) $res['message'] );
					if ( false !== strpos( $low, 'already' ) && ( false !== strpos( $low, 'applied' ) || false !== strpos( $low, 'entered' ) ) ) {
						continue;
					}
				}

				$coupon_errors[] = array(
					'code'    => (string) $code,
					'manual'  => $is_manual,
					'message' => (string) $res['message'],
				);
			}

			if ( method_exists( $cart, 'calculate_totals' ) ) {
				$cart->calculate_totals();
			}

			return array( 'coupon_errors' => $coupon_errors );
		} finally {
			Coupon_Rules::set_pos_internal_session( false );
		}
	}

	/**
	 * Build booking lines into WooCommerce cart.
	 *
	 * @param array<int, array{event_id:int,slot_id:string,date_id:string,qty:int}> $lines Parsed lines.
	 * @param bool                                                                   $enforce_availability When false, skips `check_availability` (booking already gated).
	 * @return WP_Error|null Null on OK.
	 */
	private function hydrate_booking_cart( array $lines, $enforce_availability = true ) {
		if ( null === WC()->cart ) {
			return new WP_Error( 'cart', __( 'Cart is unavailable.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}

		foreach ( $lines as $ln ) {
			$event_id = (int) $ln['event_id'];
			$slot_id  = (string) $ln['slot_id'];
			$date_id  = (string) $ln['date_id'];
			$qty      = (int) $ln['qty'];

			if ( $enforce_availability ) {
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

			if ( null === WC()->cart ) {
				return new WP_Error( 'cart', __( 'Cart is unavailable.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
			}

			$add = WC()->cart->add_to_cart( $event_id, $qty, 0, array(), $cart_item_data );
			if ( ! $add ) {
				return new WP_Error( 'cart_refused', __( 'Could not add the booking to cart (availability or validation).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
		}

		return null;
	}

	/**
	 * Build REST snippets for WooCommerce coupons on the hydrated cart session.
	 *
	 * @param \WC_Cart                                                                           $cart          Cart session.
	 * @param array<int, array{code:string,manual:bool,message:string}> $coupon_errors Rejected attempts.
	 * @return array{couponErrors:array,appliedCoupons:array,discountTotal:string,discountTotalFormatted:string,discountTax:string,discountTaxFormatted:string,discountIncludingTax:string,discountIncludingTaxFormatted:string}
	 */
	private function build_rest_coupon_payload_from_cart( $cart, array $coupon_errors ) {
		$applied_coupons = array();

		if ( $cart instanceof \WC_Cart && method_exists( $cart, 'get_applied_coupons' ) && method_exists( $cart, 'get_coupon_discount_totals' ) ) {
			$disc_map = (array) $cart->get_coupon_discount_totals();
			$tax_map  = method_exists( $cart, 'get_coupon_discount_tax_totals' ) ? (array) $cart->get_coupon_discount_tax_totals() : array();

			foreach ( $cart->get_applied_coupons() as $raw_code ) {
				$key    = strtolower( wc_format_coupon_code( $raw_code ) );
				$d_ex   = isset( $disc_map[ $key ] ) ? (float) $disc_map[ $key ] : 0.0;
				if ( isset( $disc_map[ $raw_code ] ) ) {
					$d_ex = (float) $disc_map[ $raw_code ];
				}

				if ( isset( $tax_map[ $key ] ) ) {
					$d_tax = (float) $tax_map[ $key ];
				} elseif ( isset( $tax_map[ $raw_code ] ) ) {
					$d_tax = (float) $tax_map[ $raw_code ];
				} else {
					$d_tax = 0.0;
				}

				$applied_coupons[] = array(
					'code'                   => wc_format_coupon_code( $raw_code ),
					'discountExTax'          => wc_format_decimal( $d_ex, wc_get_price_decimals() ),
					'discountExTaxFormatted' => self::format_price_plain_for_rest( $d_ex ),
					'discountTax'            => wc_format_decimal( $d_tax, wc_get_price_decimals() ),
					'discountTaxFormatted'   => self::format_price_plain_for_rest( $d_tax ),
				);
			}
		}

		$coupon_messages = array();
		foreach ( $coupon_errors as $row ) {
			$coupon_messages[] = array(
				'code'       => isset( $row['code'] ) ? (string) $row['code'] : '',
				'manualEntry' => ! empty( $row['manual'] ),
				'message'    => isset( $row['message'] ) ? (string) $row['message'] : '',
			);
		}

		$disc_tot      = $cart instanceof \WC_Cart && method_exists( $cart, 'get_discount_total' ) ? (float) $cart->get_discount_total() : 0.0;
		$disc_tax      = $cart instanceof \WC_Cart && method_exists( $cart, 'get_discount_tax' ) ? (float) $cart->get_discount_tax() : 0.0;
		$disc_incl_tax = $disc_tot + $disc_tax;

		return array(
			'couponErrors'                   => $coupon_messages,
			'appliedCoupons'                 => $applied_coupons,
			'discountTotal'                  => wc_format_decimal( $disc_tot, wc_get_price_decimals() ),
			'discountTotalFormatted'          => self::format_price_plain_for_rest( $disc_tot ),
			'discountTax'                     => wc_format_decimal( $disc_tax, wc_get_price_decimals() ),
			'discountTaxFormatted'            => self::format_price_plain_for_rest( $disc_tax ),
			'discountIncludingTax'            => wc_format_decimal( $disc_incl_tax, wc_get_price_decimals() ),
			'discountIncludingTaxFormatted'   => self::format_price_plain_for_rest( $disc_incl_tax ),
		);
	}

	/**
	 * Preview WooCommerce-calculated totals from booking lines without creating an order.
	 *
	 * @param array<int, array{event_id:int,slot_id:string,date_id:string,qty:int}> $lines Booking lines.
	 * @param array<int, string|mixed>                                                $coupon_codes_manual Cashier coupons (in addition to auto coupons from filter).
	 * @param string                                                                  $billing_email POS checkout email for WooCommerce coupon email restrictions (optional).
	 * @return array|WP_Error
	 */
	public function preview_checkout_lines( array $lines, array $coupon_codes_manual = array(), $billing_email = '' ) {
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

		$manual_sanitized = self::sanitize_coupon_code_list( array_map( 'strval', array_values( $coupon_codes_manual ) ) );

		try {
			if ( WC()->cart ) {
				WC()->cart->empty_cart();
			}

			$hydrate_err = $this->hydrate_booking_cart( $lines, true );
			if ( is_wp_error( $hydrate_err ) ) {
				return $hydrate_err;
			}

			$coupon_apply = $this->attempt_pos_cart_discounts_for_session( WC()->cart, $manual_sanitized, $billing_email );
			$coupon_extra = $this->build_rest_coupon_payload_from_cart( WC()->cart, $coupon_apply['coupon_errors'] );
			$bundle_lines_rest = Coupon_Rules::compute_bundle_fee_lines(
				Coupon_Rules::total_booking_ticket_qty_in_cart( WC()->cart ),
				'pos',
				WC()->cart
			);
			$coupon_extra = array_merge(
				$coupon_extra,
				self::build_bundle_discount_rest_payload( $bundle_lines_rest )
			);

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
			foreach ( $cart->get_cart() as $cart_item ) {
				$_product = isset( $cart_item['data'] ) ? $cart_item['data'] : null;
				if ( ! $_product || ! is_a( $_product, WC_Product::class ) ) {
					continue;
				}
				$cqty = isset( $cart_item['quantity'] ) ? (int) $cart_item['quantity'] : 1;
				$pid  = isset( $cart_item['product_id'] ) ? (int) $cart_item['product_id'] : 0;

				$line_ex_excl = isset( $cart_item['line_total'] ) ? (float) $cart_item['line_total'] : ( isset( $cart_item['line_subtotal'] ) ? (float) $cart_item['line_subtotal'] : 0.0 );
				$line_tax_amt = isset( $cart_item['line_tax'] ) ? (float) $cart_item['line_tax'] : ( isset( $cart_item['line_subtotal_tax'] ) ? (float) $cart_item['line_subtotal_tax'] : 0.0 );
				$unit_ex      = $cqty > 0 ? $line_ex_excl / (float) $cqty : 0.0;

				$line_rows[] = array(
					'eventId'             => $pid,
					'name'                => wp_strip_all_tags( (string) $_product->get_name() ),
					'qty'                 => $cqty,
					'unitPriceExclTax'    => wc_format_decimal( $unit_ex, wc_get_price_decimals() ),
					'unitPriceFormatted'  => self::format_price_plain_for_rest( $unit_ex ),
					'lineSubtotalExclTax' => wc_format_decimal( $line_ex_excl, wc_get_price_decimals() ),
					'lineTax'             => wc_format_decimal( $line_tax_amt, wc_get_price_decimals() ),
					'lineTotalInclTax'    => wc_format_decimal( $line_ex_excl + $line_tax_amt, wc_get_price_decimals() ),
					'lineTotalFormatted'  => self::format_price_plain_for_rest( $line_ex_excl ),
				);
			}

			$availability = array();
			foreach ( $lines as $ln ) {
				$chk            = $this->bookings->check_availability( (int) $ln['event_id'], (string) $ln['slot_id'], (string) $ln['date_id'], 1 );
				$availability[] = array(
					'eventId'   => (int) $ln['event_id'],
					'slotId'    => (string) $ln['slot_id'],
					'dateId'    => (string) $ln['date_id'],
					'remaining' => $chk['remaining'],
					'available' => (bool) $chk['available'],
				);
			}

			return array_merge(
				array(
					'currency'             => (string) get_woocommerce_currency(),
					'currencySymbol'       => html_entity_decode( (string) get_woocommerce_currency_symbol(), ENT_QUOTES, 'UTF-8' ),
					'subtotal'             => wc_format_decimal( (float) $cart->get_subtotal(), wc_get_price_decimals() ),
					'subtotalFormatted'    => self::format_price_plain_for_rest( (float) $cart->get_subtotal() ),
					'subtotalTax'          => wc_format_decimal( (float) $cart->get_subtotal_tax(), wc_get_price_decimals() ),
					'subtotalTaxFormatted' => self::format_price_plain_for_rest( (float) $cart->get_subtotal_tax() ),
					'taxTotal'             => wc_format_decimal( (float) $cart->get_total_tax(), wc_get_price_decimals() ),
					'taxTotalFormatted'    => self::format_price_plain_for_rest( (float) $cart->get_total_tax() ),
					'total'                => wc_format_decimal( (float) $cart->get_total( 'edit' ), wc_get_price_decimals() ),
					'totalFormatted'       => self::format_price_plain_for_rest( (float) $cart->get_total( 'edit' ) ),
					'taxes'                => $tax_rows,
					'lines'                => $line_rows,
					'availability'         => $availability,
				),
				$coupon_extra
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
		$postal_pc = isset( $args['billing_postal_code'] ) ? sanitize_text_field( trim( (string) $args['billing_postal_code'] ) ) : '';
		if ( isset( $args['check_in_now'] ) ) {
			$b               = filter_var( $args['check_in_now'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE );
			$check_in_now = null === $b ? (bool) $args['check_in_now'] : (bool) $b;
		} else {
			$check_in_now = false;
		}

		if ( ! is_email( $em ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'Invalid booking parameters.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( '' === $postal_pc ) {
			return new WP_Error( 'rest_invalid_param', __( 'A billing postal code is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( mb_strlen( $postal_pc ) > self::MAX_BOOKING_POSTAL_CODE_LENGTH ) {
			return new WP_Error( 'rest_invalid_param', __( 'Billing postal code is too long.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$coupon_manual = array();
		if ( isset( $args['coupon_codes'] ) ) {
			if ( ! is_array( $args['coupon_codes'] ) ) {
				return new WP_Error( 'rest_invalid_param', __( 'coupon_codes must be an array of coupon code strings.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			$coupon_manual = self::sanitize_coupon_code_list( array_map( 'strval', $args['coupon_codes'] ) );
			if ( count( $coupon_manual ) > Coupon_Rules::MAX_COUPONS_PER_REQUEST ) {
				return new WP_Error(
					'rest_invalid_param',
					sprintf(
						/* translators: %d max coupons */
						__( 'Too many coupons (maximum %d).', 'fooevents-internal-pos' ),
						Coupon_Rules::MAX_COUPONS_PER_REQUEST
					),
					array( 'status' => 400 )
				);
			}
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

		return $this->create_booking_from_lines( $parsed, $pm_raw, $af, $al, $em, $note, $check_in_now, $postal_pc, $coupon_manual );
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
	 * @param string                                                                     $billing_postal_code Postal/ZIP captured at POS (trimmed, sanitized, max length enforced earlier).
	 * @param array<int, string>                                                       $coupon_codes_manual Cashier coupon codes sanitised upstream.
	 * @return array|WP_Error
	 */
	private function create_booking_from_lines( array $lines, $pm_raw, $af, $al, $em, $note, $check_in_now, $billing_postal_code, array $coupon_codes_manual = array() ) {
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

			$hydrate_err = $this->hydrate_booking_cart( $lines, false );
			if ( is_wp_error( $hydrate_err ) ) {
				return $hydrate_err;
			}

			$slot_pairs            = array();
			$norm_slots_for_remain = array();
			foreach ( $lines as $ln ) {
				$event_id = (int) $ln['event_id'];
				$slot_id  = (string) $ln['slot_id'];
				$date_id  = (string) $ln['date_id'];

				$norm = $this->bookings->normalize_booking_ids_for_cart( $event_id, $slot_id, $date_id );
				if ( null === $norm ) {
					return new WP_Error(
						'booking_resolve',
						__( 'Could not resolve booking slot and date for cart.', 'fooevents-internal-pos' ),
						array( 'status' => 400 )
					);
				}

				$slot_pairs[] = (string) $norm['slot_id'] . '|' . (string) $norm['internal_date_id'];
				$norm_slots_for_remain[] = array(
					'event_id' => $event_id,
					'slot_id'  => (string) $norm['slot_id'],
					'date_id'  => $date_id,
				);
			}

			$coupon_apply = $this->attempt_pos_cart_discounts_for_session( WC()->cart, $coupon_codes_manual, $em );
			foreach ( $coupon_apply['coupon_errors'] as $row ) {
				if ( ! empty( $row['manual'] ) ) {
					return new WP_Error(
						'invalid_coupon',
						isset( $row['message'] ) ? (string) $row['message'] : __( 'Invalid coupon.', 'fooevents-internal-pos' ),
						array( 'status' => 400 )
					);
				}
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
			$order->set_billing_postcode( $billing_postal_code );
			$order->update_meta_data( '_fooevents_internal_pos_postal_code', $billing_postal_code );
			$order->update_meta_data( '_fooevents_internal_pos_postal_code_source', 'manual_pos' );
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

				$line_pre_discount = isset( $cart_item['line_subtotal'] ) ? (float) $cart_item['line_subtotal'] : (float) wc_get_price_excluding_tax( $_product, array( 'qty' => $cqty ) );
				$per_excl          = $cqty > 0 ? $line_pre_discount / (float) $cqty : 0.0;

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

			foreach ( WC()->cart->get_applied_coupons() as $coupon_code_apply ) {
				$coupon_code_apply = (string) $coupon_code_apply;
				if ( '' === $coupon_code_apply ) {
					continue;
				}
				$applied_order = $order->apply_coupon( $coupon_code_apply );
				if ( is_wp_error( $applied_order ) ) {
					throw new \Exception( wp_strip_all_tags( $applied_order->get_error_message() ) );
				}
			}

			self::cart_fees_into_order_items( $order, WC()->cart );

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

			$applied_coupon_codes = array();
			$discount_order       = 0.0;
			if ( $completed_order instanceof WC_Order ) {
				if ( method_exists( $completed_order, 'get_coupon_codes' ) ) {
					$applied_coupon_codes = array_values( array_map( 'strval', (array) $completed_order->get_coupon_codes() ) );
				}
				if ( method_exists( $completed_order, 'get_discount_total' ) ) {
					$discount_order = (float) $completed_order->get_discount_total();
				}
			}

			$next_purchase_code    = '';
			$next_purchase_amount = '';
			$next_purchase_label  = '';
			$next_purchase_dt     = '';

			if ( $completed_order instanceof WC_Order && Pos_Settings::generated_next_purchase_coupons_enabled() ) {
				$next_purchase = Next_Purchase_Coupon_Service::ensure_next_purchase_coupon_for_order( $completed_order );
				if ( is_array( $next_purchase ) && '' !== (string) ( $next_purchase['code'] ?? '' ) ) {
					$next_purchase_code = (string) $next_purchase['code'];

					$np_id = isset( $next_purchase['coupon_id'] ) ? (int) $next_purchase['coupon_id'] : 0;
					$npc   = $np_id > 0 ? new \WC_Coupon( $np_id ) : null;
					if ( $npc instanceof \WC_Coupon && $npc->get_id() > 0 && Next_Purchase_Coupon_Service::is_next_purchase_coupon( $npc ) ) {
						$ctype               = (string) $npc->get_discount_type();
						$next_purchase_amount = ( 'percent' === $ctype )
							? wc_format_decimal( (string) $npc->get_amount(), 6 )
							: wc_format_decimal( (string) $npc->get_amount(), wc_get_price_decimals() );
						$next_purchase_label  = Next_Purchase_Coupon_Service::discount_label_from_coupon( $npc );
						$next_purchase_dt     = $ctype;
					} else {
						$ctype               = Pos_Settings::next_purchase_discount_type();
						$ddec                = Pos_Settings::next_purchase_discount_amount_decimal();
						$next_purchase_amount = ( 'percent' === $ctype )
							? wc_format_decimal( $ddec, 6 )
							: wc_format_decimal( $ddec, wc_get_price_decimals() );
						$next_purchase_label  = Next_Purchase_Coupon_Service::discount_label_from_settings();
						$next_purchase_dt     = $ctype;
					}
				}
			}

			return array(
				'orderId'              => (int) $order_id,
				'ticketIds'            => $ids,
				'checkedInTicketIds'   => $checked_in_ticket_ids,
				'checkedInCount'       => count( $checked_in_ticket_ids ),
				'remaining'            => $last_remain,
				'remainingByLine'      => $remaining_by_line,
				'qty'                  => $total_qty,
				'totalQty'             => $total_qty,
				'paymentMethodKey'     => $pm_key,
				'paymentMethodLabel'   => $pm_label,
				'cashierId'            => (int) get_current_user_id(),
				'total'                => wc_format_decimal( $order_total, wc_get_price_decimals() ),
				'totalFormatted'       => self::format_price_plain_for_rest( $order_total ),
				'appliedCouponCodes'   => $applied_coupon_codes,
				'discountTotal'        => wc_format_decimal( $discount_order, wc_get_price_decimals() ),
				'discountTotalFormatted' => self::format_price_plain_for_rest( $discount_order ),
				'nextPurchaseCoupon'    => '' === $next_purchase_code ? null : array(
					'code'            => $next_purchase_code,
					'amount'          => $next_purchase_amount,
					'amountFormatted' => $next_purchase_label,
					'discountType'    => '' !== $next_purchase_dt ? $next_purchase_dt : 'percent',
				),
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
		Coupon_Rules::set_pos_internal_session( false );
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
			// Use storefront-available gateways only (WooCommerce enabled + gateway is_available), not payment_gateways().
			$methods = fooeventspos_do_get_all_payment_methods( false );
			if ( is_array( $methods ) && ! empty( $methods ) ) {
				$keys = array();
				foreach ( $methods as $row ) {
					if ( is_array( $row ) && ! empty( $row['pmk'] ) ) {
						$keys[] = (string) $row['pmk'];
					}
				}
				if ( ! empty( $keys ) ) {
					return $keys;
				}
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
			// false => get_available_payment_gateways() so disabled WC methods are omitted.
			$methods = fooeventspos_do_get_all_payment_methods( false );
			if ( is_array( $methods ) ) {
				foreach ( $methods as $row ) {
					if ( ! is_array( $row ) || empty( $row['pmk'] ) ) {
						continue;
					}
					$out[] = array(
						'key'   => (string) $row['pmk'],
						'label' => (string) ( $row['pmt'] ?? '' ),
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
