<?php
/**
 * Next-purchase promotional coupons tied to FooEvents bookings orders.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Coupon;
use WC_Order;
use WC_Order_Item_Product;
use WC_Product;

defined( 'ABSPATH' ) || exit;

/**
 * Generates a unique $5 fixed-cart coupon per qualifying order with email restriction
 * and exact FooEvents booking product/qty entitlement validation.
 */
class Next_Purchase_Coupon_Service {

	public const META_ORDER_COUPON_CODE      = '_fipos_next_purchase_coupon_code';

	public const META_ORDER_COUPON_ID        = '_fipos_next_purchase_coupon_id';

	public const META_COUPON_FLAG            = '_fipos_next_purchase_coupon';

	public const META_COUPON_EARNED_ORDER    = '_fipos_earned_order_id';

	public const META_COUPON_REQUIRED_QTY_JSON = '_fipos_required_product_qty';

	public const FIXED_AMOUNT = 5.0;

	public const CODE_PREFIX = 'NEXT-';

	/** @var int|null */
	private static $shape_validation_fail_coupon_id = null;

	/** @var string|null */
	private static $shape_validation_fail_message = null;

	public function init() {
		add_action( 'woocommerce_order_status_processing', array( $this, 'maybe_create_coupon_for_order' ), 20, 2 );
		add_action( 'woocommerce_order_status_completed', array( $this, 'maybe_create_coupon_for_order' ), 20, 2 );
		add_action( 'woocommerce_email_after_order_table', array( $this, 'email_after_order_table' ), 25, 4 );
		add_filter( 'woocommerce_coupon_is_valid', array( $this, 'filter_coupon_is_valid' ), 25, 3 );
		add_filter( 'woocommerce_coupon_error', array( $this, 'filter_coupon_error' ), 25, 3 );
	}

	/**
	 * @param int            $order_id Order ID (WC passes this first).
	 * @param WC_Order|false $order    Order instance (may be missing on older callers).
	 */
	public function maybe_create_coupon_for_order( $order_id, $order = null ) {
		if ( ! $order instanceof WC_Order ) {
			$order = wc_get_order( $order_id );
		}
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		self::ensure_next_purchase_coupon_for_order( $order );
	}

	/**
	 * @param WC_Order $order Order.
	 * @param bool     $sent_to_admin Sent to admin.
	 * @param bool     $plain_text Plain text mail.
	 * @param object   $email WC_Email.
	 */
	public function email_after_order_table( $order, $sent_to_admin, $plain_text, $email ) {
		unset( $email );
		if ( $sent_to_admin || ! $order instanceof WC_Order ) {
			return;
		}

		$data = self::ensure_next_purchase_coupon_for_order( $order );
		if ( null === $data || '' === (string) $data['code'] ) {
			return;
		}

		/* translators: 1: coupon code, 2: discount amount formatted */
		$msg = __( 'Thank you for your order! Use coupon code %1$s for %2$s off your next eligible purchase.', 'fooevents-internal-pos' );
		if ( function_exists( 'wc_price' ) ) {
			$amt = wc_price( self::FIXED_AMOUNT );
		} else {
			$amt = wc_format_decimal( self::FIXED_AMOUNT, wc_get_price_decimals() );
		}
		$sprintf_txt = sprintf( $msg, sanitize_text_field( (string) $data['code'] ), wp_strip_all_tags( html_entity_decode( (string) $amt, ENT_QUOTES, get_bloginfo( 'charset' ) ) ) );

		if ( ! empty( $plain_text ) ) {
			echo "\n\n=====================================================\n";
			echo esc_html( wp_strip_all_tags( $sprintf_txt ) ) . "\n\n";
			return;
		}

		echo '<p style="margin:16px 0;">' . esc_html( wp_strip_all_tags( $sprintf_txt ) ) . '</p>';
	}

	/**
	 * @param bool            $valid     Valid.
	 * @param WC_Coupon       $coupon    Coupon instance.
	 * @param \WC_Discounts   $discounts Discounts calculator.
	 * @return bool
	 */
	public function filter_coupon_is_valid( $valid, $coupon, $discounts ) {
		if ( ! $coupon instanceof WC_Coupon ) {
			return $valid;
		}
		if ( ! self::is_next_purchase_coupon( $coupon ) ) {
			return $valid;
		}
		if ( ! $valid ) {
			self::clear_shape_fail_state();
			return $valid;
		}

		$cart = self::cart_from_discounts( $discounts );
		if ( null === $cart || ! method_exists( $cart, 'get_cart' ) ) {
			return $valid;
		}

		$cart_map         = self::booking_product_qty_map_from_cart( $cart );
		$coupon_expected  = self::required_qty_map_from_coupon_meta( $coupon );

		if ( self::arrays_equal_normalized( $cart_map, $coupon_expected ) ) {
			self::clear_shape_fail_state();
			return $valid;
		}

		self::$shape_validation_fail_coupon_id = $coupon->get_id();
		self::$shape_validation_fail_message   = __( 'This coupon is valid only when your cart matches the same ticket quantities from the order where you earned it.', 'fooevents-internal-pos' );

		return false;
	}

	/**
	 * @param string       $msg     Message from WooCommerce.
	 * @param int|string   $err_code Woo error identifier.
	 * @param WC_Coupon    $coupon   Coupon instance.
	 * @return string
	 */
	public function filter_coupon_error( $msg, $err_code, $coupon ) {
		unset( $err_code );
		if ( ! $coupon instanceof WC_Coupon ) {
			return $msg;
		}
		if ( null !== self::$shape_validation_fail_coupon_id && (int) $coupon->get_id() === (int) self::$shape_validation_fail_coupon_id ) {
			$m = self::$shape_validation_fail_message;
			self::clear_shape_fail_state();
			if ( '' !== (string) $m ) {
				return (string) $m;
			}
		}
		return $msg;
	}

	/**
	 * @return array{code:string,coupon_id:int}|null Null if no qualifying booking items.
	 */
	public static function ensure_next_purchase_coupon_for_order( WC_Order $order ) {
		if ( method_exists( $order, 'get_meta' ) && '' !== (string) $order->get_meta( self::META_ORDER_COUPON_CODE ) ) {
			return array(
				'code'      => (string) $order->get_meta( self::META_ORDER_COUPON_CODE ),
				'coupon_id' => (int) $order->get_meta( self::META_ORDER_COUPON_ID ),
			);
		}

		$email = self::sanitize_order_email_for_coupon( $order );
		if ( '' === $email ) {
			return null;
		}

		$required_map = self::booking_product_qty_map_from_order( $order );
		if ( empty( $required_map ) ) {
			return null;
		}

		$attempts = 0;
		do {
			++$attempts;
			$code_candidate = self::generate_code_for_order_id( $order->get_id() );
			if ( function_exists( 'wc_format_coupon_code' ) ) {
				$code_candidate = wc_format_coupon_code( $code_candidate );
			}
			$duplicate = function_exists( 'wc_get_coupon_id_by_code' ) ? (int) wc_get_coupon_id_by_code( $code_candidate ) : 0;
			if ( $duplicate > 0 ) {
				continue;
			}
			$new_id = self::persist_new_coupon( $order->get_id(), $code_candidate, $email, $required_map );
			if ( $new_id > 0 ) {
				return array(
					'code'      => $code_candidate,
					'coupon_id' => $new_id,
				);
			}
		} while ( $attempts < 20 );

		return null;
	}

	/**
	 * @param WC_Coupon $coupon Coupon.
	 */
	public static function is_next_purchase_coupon( WC_Coupon $coupon ) {
		return 'yes' === (string) $coupon->get_meta( self::META_COUPON_FLAG );
	}

	private static function clear_shape_fail_state() {
		self::$shape_validation_fail_coupon_id = null;
		self::$shape_validation_fail_message   = null;
	}

	private static function cart_from_discounts( $discounts ) {
		if ( ! is_object( $discounts ) ) {
			return null;
		}
		if ( method_exists( $discounts, 'get_cart' ) ) {
			$obj = $discounts->get_cart();
			if ( $obj instanceof \WC_Cart ) {
				return $obj;
			}
		}
		if ( method_exists( $discounts, 'get_object' ) ) {
			$obj = $discounts->get_object();
			if ( $obj instanceof \WC_Cart ) {
				return $obj;
			}
		}
		return null;
	}

	/**
	 * @param WC_Order $order Order instance.
	 * @return string Lowercase sanitized email or empty string.
	 */
	private static function sanitize_order_email_for_coupon( WC_Order $order ) {
		if ( ! method_exists( $order, 'get_billing_email' ) ) {
			return '';
		}
		$raw = trim( (string) $order->get_billing_email() );
		if ( '' === $raw ) {
			return '';
		}
		$sane = sanitize_email( $raw );
		if ( ! is_email( $sane ) ) {
			return '';
		}
		return strtolower( $sane );
	}

	/**
	 * Booking product qty map keyed by WooCommerce product id (variation-aware).
	 *
	 * @param WC_Order $order Order instance.
	 * @return array<string,int>
	 */
	private static function booking_product_qty_map_from_order( WC_Order $order ) {
		$map = array();
		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof WC_Order_Item_Product ) {
				continue;
			}
			$product = $item->get_product();
			if ( ! $product instanceof WC_Product || ! Coupon_Rules::is_fooevents_booking_product( $product ) ) {
				continue;
			}
			$pid = $product->get_id();
			$qty = (int) $item->get_quantity();
			if ( $pid <= 0 || $qty < 1 ) {
				continue;
			}
			$key          = (string) $pid;
			$map[ $key ] = isset( $map[ $key ] ) ? $map[ $key ] + $qty : $qty;
		}

		return self::normalize_qty_map_keys( $map );
	}

	/**
	 * @param \WC_Cart $cart Cart instance.
	 * @return array<string,int>
	 */
	private static function booking_product_qty_map_from_cart( $cart ) {
		if ( null === $cart || ! method_exists( $cart, 'get_cart' ) ) {
			return array();
		}
		$map = array();
		foreach ( (array) $cart->get_cart() as $row ) {
			$product = isset( $row['data'] ) ? $row['data'] : null;
			if ( ! $product instanceof WC_Product || ! Coupon_Rules::is_fooevents_booking_product( $product ) ) {
				continue;
			}
			$qty = isset( $row['quantity'] ) ? (int) $row['quantity'] : 0;
			if ( $qty < 1 ) {
				continue;
			}
			$pid         = $product->get_id();
			$key         = (string) $pid;
			$map[ $key ] = isset( $map[ $key ] ) ? $map[ $key ] + $qty : $qty;
		}

		return self::normalize_qty_map_keys( $map );
	}

	/**
	 * @param array<string,int> $map Incoming map keyed by product id strings.
	 * @return array<string,int>
	 */
	private static function normalize_qty_map_keys( array $map ) {
		$out = array();
		foreach ( $map as $k => $qty ) {
			$out[ (string) (int) $k ] = max( 1, min( PHP_INT_MAX, (int) $qty ) );
		}
		ksort( $out, SORT_NUMERIC );

		return $out;
	}

	/**
	 * @param WC_Coupon $coupon Coupon instance.
	 * @return array<string,int>
	 */
	private static function required_qty_map_from_coupon_meta( WC_Coupon $coupon ) {
		$raw = (string) $coupon->get_meta( self::META_COUPON_REQUIRED_QTY_JSON );
		if ( '' === $raw ) {
			return array();
		}
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			return array();
		}
		$map = array();
		foreach ( $decoded as $k => $qty ) {
			$map[ (string) (int) $k ] = (int) $qty;
		}

		return self::normalize_qty_map_keys( $map );
	}

	/**
	 * @param array<string,int> $cart_map Cart-derived map for booking SKUs-only.
	 * @param array<string,int> $expected Expected map from coupon.
	 */
	private static function arrays_equal_normalized( array $cart_map, array $expected ) {
		if ( empty( $expected ) ) {
			return false;
		}
		$cart_map = self::normalize_qty_map_keys( $cart_map );
		$expected = self::normalize_qty_map_keys( $expected );

		return $cart_map === $expected;
	}

	private static function generate_code_for_order_id( $order_id ) {
		$id          = absint( $order_id );
		$rand_suffix = strtolower( wp_generate_password( 4, false, false ) );

		return self::CODE_PREFIX . $id . '-' . $rand_suffix;
	}

	/**
	 * @param int                          $order_id Order id.
	 * @param string                       $code     Coupon code.
	 * @param string                       $email    Restricted lowercase email address.
	 * @param array<string,int|string,int> $required_map Normalized qty map keyed by numeric string id.
	 */
	private static function persist_new_coupon( $order_id, $code, $email, array $required_map ) {
		$order_id = absint( $order_id );

		try {
			$coupon = new WC_Coupon();
			$coupon->set_status( 'publish' );
			$coupon->set_code( $code );
			$coupon->set_discount_type( 'fixed_cart' );
			$coupon->set_amount( (string) self::FIXED_AMOUNT );
			if ( method_exists( $coupon, 'set_usage_limit' ) ) {
				$coupon->set_usage_limit( 1 );
			}
			if ( method_exists( $coupon, 'set_usage_limit_per_user' ) ) {
				$coupon->set_usage_limit_per_user( 1 );
			}
			if ( method_exists( $coupon, 'set_individual_use' ) ) {
				$coupon->set_individual_use( false );
			}
			if ( method_exists( $coupon, 'set_date_expires' ) ) {
				$coupon->set_date_expires( null );
			}
			if ( method_exists( $coupon, 'set_email_restrictions' ) ) {
				$coupon->set_email_restrictions( array( $email ) );
			}

			$coupon->update_meta_data( self::META_COUPON_FLAG, 'yes' );
			$coupon->update_meta_data( self::META_COUPON_EARNED_ORDER, (string) $order_id );
			$coupon->update_meta_data( self::META_COUPON_REQUIRED_QTY_JSON, wp_json_encode( $required_map ) );

			$coupon->save();

			$coupon_id = (int) $coupon->get_id();
			if ( $coupon_id <= 0 ) {
				return 0;
			}

			$fresh = wc_get_order( $order_id );
			if ( $fresh instanceof WC_Order ) {
				$fresh->update_meta_data( self::META_ORDER_COUPON_CODE, $code );
				$fresh->update_meta_data( self::META_ORDER_COUPON_ID, (string) absint( $coupon_id ) );
				$fresh->save();
			}

			return (int) $coupon_id;
		} catch ( \Throwable $e ) {
			return 0;
		}
	}
}
