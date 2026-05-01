<?php
/**
 * POS + storefront coupon rules: auto-apply scope, channel restriction, bundle tiers, fee-line packing.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Cart;
use WC_Coupon;
use WC_Product;

defined( 'ABSPATH' ) || exit;

/**
 * Coupon meta and bundle packing for Internal POS and storefront.
 */
class Coupon_Rules {

	public const META_AUTO_APPLY_SCOPE = '_fooevents_auto_apply_scope';

	public const META_CHANNEL_RESTRICTION = '_fooevents_channel_restriction';

	public const META_IS_BUNDLE_TIER = '_fooevents_is_bundle_tier';

	public const META_BUNDLE_QTY = '_fooevents_bundle_qty';

	public const MAX_COUPONS_PER_REQUEST = 20;

	/** @var bool */
	private static $pos_internal_session = false;

	/**
	 * True while POS preview/booking is applying discounts to the WC cart (blocks storefront auto fees).
	 */
	public static function set_pos_internal_session( $active ) {
		self::$pos_internal_session = (bool) $active;
	}

	/**
	 * @return bool
	 */
	public static function is_pos_internal_session() {
		return self::$pos_internal_session;
	}

	/**
	 * @return string pos|storefront
	 */
	public static function current_public_channel() {
		return self::$pos_internal_session ? 'pos' : 'storefront';
	}

	/**
	 * @param WC_Coupon $coupon Coupon.
	 * @param string    $channel pos|storefront.
	 * @return bool
	 */
	public static function coupon_allowed_for_channel( WC_Coupon $coupon, $channel ) {
		$rest = (string) $coupon->get_meta( self::META_CHANNEL_RESTRICTION );
		if ( '' === $rest || 'both' === $rest ) {
			return true;
		}
		if ( 'pos_only' === $rest ) {
			return 'pos' === $channel;
		}
		if ( 'storefront_only' === $rest ) {
			return 'storefront' === $channel;
		}
		return true;
	}

	/**
	 * @param WC_Coupon $coupon Coupon.
	 * @return bool
	 */
	public static function coupon_is_bundle_tier( WC_Coupon $coupon ) {
		return 'yes' === (string) $coupon->get_meta( self::META_IS_BUNDLE_TIER );
	}

	/**
	 * @param string $formatted_code Woo-formatted code.
	 * @return bool
	 */
	public static function coupon_code_is_bundle_tier( $formatted_code ) {
		$formatted_code = function_exists( 'wc_format_coupon_code' )
			? wc_format_coupon_code( sanitize_text_field( (string) $formatted_code ) )
			: strtoupper( trim( (string) $formatted_code ) );
		if ( '' === $formatted_code ) {
			return false;
		}
		$id = function_exists( 'wc_get_coupon_id_by_code' ) ? (int) wc_get_coupon_id_by_code( $formatted_code ) : 0;
		if ( $id <= 0 ) {
			return false;
		}
		$c = new WC_Coupon( $id );
		return $c->get_id() > 0 && self::coupon_is_bundle_tier( $c );
	}

	/**
	 * @param WC_Product|null $product Product.
	 * @return bool
	 */
	public static function is_fooevents_booking_product( $product ) {
		if ( ! $product instanceof WC_Product ) {
			return false;
		}
		return 'Event' === (string) $product->get_meta( 'WooCommerceEventsEvent', true )
			&& 'bookings' === (string) $product->get_meta( 'WooCommerceEventsType', true );
	}

	/**
	 * Sum quantities for FooEvents booking products only.
	 *
	 * @param WC_Cart|null $cart Cart.
	 * @return int
	 */
	public static function total_booking_ticket_qty_in_cart( $cart ) {
		if ( ! $cart instanceof WC_Cart || ! method_exists( $cart, 'get_cart' ) ) {
			return 0;
		}
		$sum = 0;
		foreach ( (array) $cart->get_cart() as $item ) {
			$_product = isset( $item['data'] ) ? $item['data'] : null;
			if ( ! self::is_fooevents_booking_product( $_product ) ) {
				continue;
			}
			$sum += isset( $item['quantity'] ) ? (int) $item['quantity'] : 0;
		}
		return max( 0, $sum );
	}

	/**
	 * @param WC_Coupon $coupon Coupon.
	 * @return bool
	 */
	private static function coupon_is_usable_for_auto( WC_Coupon $coupon ) {
		if ( $coupon->get_id() <= 0 ) {
			return false;
		}
		if ( 'publish' !== $coupon->get_status() ) {
			return false;
		}
		$expires = $coupon->get_date_expires();
		if ( $expires && method_exists( $expires, 'getTimestamp' ) ) {
			if ( $expires->getTimestamp() < time() ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Auto-apply coupons for a channel (DB meta), excluding unusable.
	 *
	 * @param string $channel pos|storefront.
	 * @return WC_Coupon[]
	 */
	public static function get_auto_apply_coupon_objects( $channel ) {
		static $cache = array();
		$key = (string) $channel;
		if ( isset( $cache[ $key ] ) ) {
			return $cache[ $key ];
		}

		$scopes = array( 'both' );
		if ( 'pos' === $channel ) {
			$scopes[] = 'pos';
		} elseif ( 'storefront' === $channel ) {
			$scopes[] = 'storefront';
		}

		$ids = get_posts(
			array(
				'post_type'      => 'shop_coupon',
				'post_status'    => 'publish',
				'posts_per_page' => 200,
				'fields'         => 'ids',
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => self::META_AUTO_APPLY_SCOPE,
						'value'   => $scopes,
						'compare' => 'IN',
					),
				),
			)
		);

		$out = array();
		if ( is_array( $ids ) ) {
			foreach ( $ids as $pid ) {
				$c = new WC_Coupon( (int) $pid );
				if ( ! self::coupon_is_usable_for_auto( $c ) ) {
					continue;
				}
				if ( ! self::coupon_allowed_for_channel( $c, $channel ) ) {
					continue;
				}
				$out[] = $c;
			}
		}

		$cache[ $key ] = $out;
		return $out;
	}

	/**
	 * Bundle tier rows for greedy packing, largest qty first.
	 *
	 * @param string        $channel pos|storefront.
	 * @param WC_Cart|null  $cart    Optional cart for tax class guess.
	 * @return array<int, array{code:string,qty:int,amount:float,tax_class:string,coupon_id:int}>
	 */
	public static function get_bundle_tiers_sorted( $channel, $cart = null ) {
		$tiers = array();
		foreach ( self::get_auto_apply_coupon_objects( $channel ) as $c ) {
			if ( ! self::coupon_is_bundle_tier( $c ) ) {
				continue;
			}
			$qty = (int) $c->get_meta( self::META_BUNDLE_QTY );
			if ( $qty < 1 ) {
				continue;
			}
			$amount = self::tier_flat_amount( $c, $cart );
			if ( $amount <= 0 ) {
				continue;
			}
			$code = $c->get_code();
			if ( '' === $code ) {
				continue;
			}
			$tiers[] = array(
				'code'      => function_exists( 'wc_format_coupon_code' ) ? wc_format_coupon_code( $code ) : strtoupper( $code ),
				'qty'       => $qty,
				'amount'    => $amount,
				'tax_class' => self::default_product_tax_class_from_cart( $cart ),
				'coupon_id' => (int) $c->get_id(),
			);
		}

		usort(
			$tiers,
			static function ( $a, $b ) {
				return (int) $b['qty'] <=> (int) $a['qty'];
			}
		);

		/**
		 * Filter bundle tier definitions after DB resolution.
		 *
		 * @param array<int, array<string, mixed>> $tiers   Tier rows.
		 * @param string                           $channel pos|storefront.
		 * @param WC_Cart|null                     $cart    Cart context.
		 */
		$tiers = apply_filters( 'fooevents_internal_pos_bundle_tiers', $tiers, $channel, $cart );
		if ( ! is_array( $tiers ) ) {
			return array();
		}

		$resolved = array();
		foreach ( $tiers as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$code = isset( $row['code'] ) ? (string) $row['code'] : '';
			$code = function_exists( 'wc_format_coupon_code' ) ? wc_format_coupon_code( trim( $code ) ) : strtoupper( trim( $code ) );
			$qty  = isset( $row['qty'] ) ? (int) $row['qty'] : 0;
			if ( '' === $code || $qty < 1 ) {
				continue;
			}
			$amount = isset( $row['amount'] ) ? (float) $row['amount'] : 0.0;
			if ( $amount <= 0 && function_exists( 'wc_get_coupon_id_by_code' ) ) {
				$id = (int) wc_get_coupon_id_by_code( $code );
				if ( $id > 0 ) {
					$c = new WC_Coupon( $id );
					$amount = self::tier_flat_amount( $c, $cart );
				}
			}
			if ( $amount <= 0 ) {
				continue;
			}
			$tax_class = isset( $row['tax_class'] ) ? (string) $row['tax_class'] : self::default_product_tax_class_from_cart( $cart );
			$coupon_id = isset( $row['coupon_id'] ) ? (int) $row['coupon_id'] : 0;
			$resolved[] = array(
				'code'      => $code,
				'qty'       => $qty,
				'amount'    => $amount,
				'tax_class' => $tax_class,
				'coupon_id' => $coupon_id,
			);
		}

		usort(
			$resolved,
			static function ( $a, $b ) {
				return (int) $b['qty'] <=> (int) $a['qty'];
			}
		);

		return $resolved;
	}

	/**
	 * @param WC_Coupon    $coupon Coupon.
	 * @param WC_Cart|null $cart   Cart (unused for v1 fixed_cart).
	 * @return float
	 */
	private static function tier_flat_amount( WC_Coupon $coupon, $cart = null ) {
		unset( $cart );
		$type = (string) $coupon->get_discount_type();
		if ( 'fixed_cart' === $type ) {
			return (float) $coupon->get_amount();
		}
		// v1: only fixed_cart supported for bundle tiers; percent would need proration — skip.
		return 0.0;
	}

	/**
	 * @param WC_Cart|null $cart Cart.
	 * @return string
	 */
	public static function default_product_tax_class_from_cart( $cart ) {
		if ( ! $cart instanceof WC_Cart || ! method_exists( $cart, 'get_cart' ) ) {
			return '';
		}
		foreach ( (array) $cart->get_cart() as $item ) {
			$_product = isset( $item['data'] ) ? $item['data'] : null;
			if ( $_product instanceof WC_Product && self::is_fooevents_booking_product( $_product ) ) {
				return (string) $_product->get_tax_class();
			}
		}
		return '';
	}

	/**
	 * Greedy pack total ticket qty into fee lines.
	 *
	 * @param int          $total_qty Total FooEvents booking ticket qty.
	 * @param string       $channel   pos|storefront.
	 * @param WC_Cart|null $cart      Cart for tax class.
	 * @return array<int, array{code:string,name:string,qtyCovered:int,amount:float,taxable:bool,tax_class:string}>
	 */
	public static function compute_bundle_fee_lines( $total_qty, $channel, $cart = null ) {
		$tiers   = self::get_bundle_tiers_sorted( $channel, $cart );
		$remain  = max( 0, (int) $total_qty );
		$lines   = array();
		$default = self::default_product_tax_class_from_cart( $cart );

		foreach ( $tiers as $tier ) {
			$tq = (int) $tier['qty'];
			if ( $tq < 1 ) {
				continue;
			}
			$amt = (float) $tier['amount'];
			if ( $amt <= 0 ) {
				continue;
			}
			$n = intdiv( $remain, $tq );
			for ( $i = 0; $i < $n; $i++ ) {
				$code = (string) $tier['code'];
				$lines[] = array(
					'code'       => $code,
					'name'       => sprintf(
						/* translators: 1: coupon code, 2: tickets per bundle */
						__( '%1$s (%2$d tickets)', 'fooevents-internal-pos' ),
						$code,
						$tq
					),
					'qtyCovered' => $tq,
					'amount'     => $amt,
					'taxable'    => true,
					'tax_class'  => '' !== (string) $tier['tax_class'] ? (string) $tier['tax_class'] : $default,
				);
			}
			$remain -= $n * $tq;
		}

		return $lines;
	}

	/**
	 * Add one bundle discount as a cart fee. Uses fees_api with a unique id so stacked identical tiers
	 * (e.g. two BUNDLE4 lines) are not collapsed — WC_Cart::add_fee() derives id from the fee name otherwise.
	 *
	 * @param WC_Cart $cart         Cart.
	 * @param array   $bundle_line  Line from compute_bundle_fee_lines.
	 * @param int     $line_index   Stable index for this application (0, 1, …) to build a unique fee id.
	 */
	public static function add_bundle_discount_fee_to_cart( WC_Cart $cart, array $bundle_line, $line_index ) {
		if ( ! $cart instanceof WC_Cart ) {
			return;
		}
		$name    = isset( $bundle_line['name'] ) ? (string) $bundle_line['name'] : '';
		$amount  = isset( $bundle_line['amount'] ) ? (float) $bundle_line['amount'] : 0.0;
		$taxable = isset( $bundle_line['taxable'] ) ? (bool) $bundle_line['taxable'] : false;
		$class   = isset( $bundle_line['tax_class'] ) ? (string) $bundle_line['tax_class'] : '';
		if ( '' === $name || $amount <= 0 ) {
			return;
		}

		$negative  = -1 * $amount;
		$code_slug = isset( $bundle_line['code'] ) ? sanitize_title( (string) $bundle_line['code'] ) : 'tier';
		$fee_id    = 'fipos-bundle-' . $code_slug . '-' . (int) $line_index;

		if ( method_exists( $cart, 'fees_api' ) ) {
			$api = $cart->fees_api();
			if ( $api && method_exists( $api, 'add_fee' ) ) {
				$result = $api->add_fee(
					array(
						'id'        => $fee_id,
						'name'      => $name,
						'amount'    => $negative,
						'taxable'   => $taxable,
						'tax_class' => $class,
					)
				);
				if ( ! ( function_exists( 'is_wp_error' ) && is_wp_error( $result ) ) ) {
					return;
				}
			}
		}

		$cart->add_fee( $name . ' (' . ( (int) $line_index + 1 ) . ')', $negative, $taxable, $class );
	}

	/**
	 * POS apply_coupon queue: DB auto (non-tier) + legacy filter (non-tier) + manual. Excludes bundle tier codes.
	 *
	 * @param array<int, string> $manual_sanitized Manual codes.
	 * @return array<int, string>
	 */
	public static function build_pos_coupon_apply_queue( array $manual_sanitized ) {
		$seen = array();
		$out  = array();

		foreach ( self::get_auto_apply_coupon_objects( 'pos' ) as $c ) {
			if ( self::coupon_is_bundle_tier( $c ) ) {
				continue;
			}
			$code = $c->get_code();
			if ( '' === $code ) {
				continue;
			}
			$code = function_exists( 'wc_format_coupon_code' ) ? wc_format_coupon_code( $code ) : strtoupper( $code );
			$key  = strtolower( $code );
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$out[]        = $code;
		}

		$legacy = apply_filters( 'fooevents_internal_pos_auto_coupon_codes', array() );
		if ( is_array( $legacy ) ) {
			foreach ( $legacy as $raw ) {
				if ( ! is_string( $raw ) ) {
					continue;
				}
				$code = function_exists( 'wc_format_coupon_code' )
					? wc_format_coupon_code( sanitize_text_field( trim( $raw ) ) )
					: strtoupper( trim( $raw ) );
				if ( '' === $code || self::coupon_code_is_bundle_tier( $code ) ) {
					continue;
				}
				$key = strtolower( $code );
				if ( isset( $seen[ $key ] ) ) {
					continue;
				}
				$seen[ $key ] = true;
				$out[]        = $code;
			}
		}

		foreach ( $manual_sanitized as $m ) {
			$code = is_string( $m )
				? ( function_exists( 'wc_format_coupon_code' ) ? wc_format_coupon_code( $m ) : strtoupper( $m ) )
				: '';
			if ( '' === $code ) {
				continue;
			}
			$key = strtolower( $code );
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$out[]        = $code;
		}

		if ( count( $out ) <= self::MAX_COUPONS_PER_REQUEST ) {
			return $out;
		}
		return array_slice( $out, 0, self::MAX_COUPONS_PER_REQUEST );
	}
}
