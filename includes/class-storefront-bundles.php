<?php
/**
 * Storefront: auto bundle fees, auto non-tier coupons, coupon channel enforcement.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Cart;
use WC_Coupon;

defined( 'ABSPATH' ) || exit;

/**
 * Front-of-house coupon + bundle wiring.
 */
class Storefront_Bundles {

	public function init() {
		add_action( 'woocommerce_before_calculate_totals', array( $this, 'maybe_apply_storefront_auto_coupons' ), 15, 1 );
		add_action( 'woocommerce_cart_calculate_fees', array( $this, 'add_bundle_fees' ), 20, 1 );
		add_filter( 'woocommerce_coupon_is_valid', array( $this, 'filter_coupon_is_valid' ), 10, 3 );
		add_filter( 'woocommerce_coupon_error', array( $this, 'filter_coupon_error' ), 20, 3 );
	}

	/**
	 * @param WC_Cart $cart Cart.
	 */
	public function maybe_apply_storefront_auto_coupons( $cart ) {
		if ( Coupon_Rules::is_pos_internal_session() ) {
			return;
		}
		if ( ! $cart instanceof WC_Cart || ! function_exists( 'WC' ) || ! WC()->cart ) {
			return;
		}
		if ( is_admin() && ! wp_doing_ajax() ) {
			return;
		}
		static $depth = 0;
		if ( $depth > 0 ) {
			return;
		}
		++$depth;
		try {
			foreach ( Coupon_Rules::get_auto_apply_coupon_objects( 'storefront' ) as $c ) {
				if ( Coupon_Rules::coupon_is_bundle_tier( $c ) ) {
					continue;
				}
				$code = $c->get_code();
				if ( '' === $code ) {
					continue;
				}
				if ( method_exists( $cart, 'has_discount' ) && $cart->has_discount( $code ) ) {
					continue;
				}
				if ( method_exists( $cart, 'apply_coupon' ) ) {
					$cart->apply_coupon( $code );
				}
			}
		} finally {
			--$depth;
		}
	}

	/**
	 * @param WC_Cart $cart Cart.
	 */
	public function add_bundle_fees( $cart ) {
		if ( Coupon_Rules::is_pos_internal_session() ) {
			return;
		}
		if ( ! $cart instanceof WC_Cart ) {
			return;
		}
		if ( is_admin() && ! wp_doing_ajax() ) {
			return;
		}
		if ( $cart->is_empty() ) {
			return;
		}
		$qty = Coupon_Rules::total_booking_ticket_qty_in_cart( $cart );
		if ( $qty < 1 ) {
			return;
		}

		foreach ( Coupon_Rules::compute_bundle_fee_lines( $qty, 'storefront', $cart ) as $line ) {
			$cart->add_fee(
				(string) $line['name'],
				-1 * (float) $line['amount'],
				(bool) $line['taxable'],
				(string) $line['tax_class']
			);
		}
	}

	/**
	 * @param bool            $valid     Valid.
	 * @param \WC_Coupon      $coupon    Coupon object.
	 * @param \WC_Discounts   $discounts Discounts calculator.
	 * @return bool
	 */
	public function filter_coupon_is_valid( $valid, $coupon, $discounts ) {
		unset( $discounts );
		if ( ! $valid || ! $coupon instanceof WC_Coupon ) {
			return $valid;
		}
		$ch = Coupon_Rules::current_public_channel();
		if ( ! Coupon_Rules::coupon_allowed_for_channel( $coupon, $ch ) ) {
			return false;
		}
		return true;
	}

	/**
	 * @param string     $msg    Message.
	 * @param mixed      $err_code Woo error code.
	 * @param WC_Coupon  $coupon  Coupon instance.
	 * @return string
	 */
	public function filter_coupon_error( $msg, $err_code, $coupon ) {
		unset( $err_code );
		if ( ! $coupon instanceof WC_Coupon ) {
			return $msg;
		}
		// Avoid fighting POS localized messages (REST validates separately).
		if ( Coupon_Rules::is_pos_internal_session() ) {
			return $msg;
		}
		$ch = Coupon_Rules::current_public_channel();
		if ( ! Coupon_Rules::coupon_allowed_for_channel( $coupon, $ch ) ) {
			if ( 'storefront' === $ch ) {
				return __( 'This coupon can only be used at the Internal POS checkout.', 'fooevents-internal-pos' );
			}
			return __( 'This coupon can only be used at the storefront checkout.', 'fooevents-internal-pos' );
		}
		return $msg;
	}
}
