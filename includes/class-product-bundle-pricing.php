<?php
/**
 * Product admin + storefront: optional dynamic bundle price line from bundle-tier coupons.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Product;

defined( 'ABSPATH' ) || exit;

/**
 * Checkbox on simple/variable products + shortcode / price HTML append for FooEvents booking products.
 */
class Product_Bundle_Pricing {

	public const META_SHOW_DYNAMIC = '_fipos_show_dynamic_bundle_pricing';

	/**
	 * Hooks.
	 */
	public function init() {
		add_action( 'woocommerce_product_options_general_product_data', array( $this, 'render_product_option' ), 15 );
		add_action( 'woocommerce_admin_process_product_object', array( $this, 'save_product_option' ), 10, 1 );

		add_shortcode( 'fipos_dynamic_bundle_pricing', array( $this, 'shortcode_dynamic_bundle_pricing' ) );

		add_filter( 'woocommerce_get_price_html', array( $this, 'maybe_append_bundle_pricing_to_price_html' ), 20, 2 );
	}

	/**
	 * @param WC_Product|null $product Product.
	 * @return bool
	 */
	public static function is_dynamic_enabled_for_product( $product ) {
		if ( ! $product instanceof WC_Product || $product->get_id() <= 0 ) {
			return false;
		}
		return 'yes' === (string) $product->get_meta( self::META_SHOW_DYNAMIC, true );
	}

	/**
	 * Product edit: General tab checkbox.
	 */
	public function render_product_option() {
		global $post;

		if ( ! $post || ! isset( $post->ID ) ) {
			return;
		}

		$product = wc_get_product( (int) $post->ID );
		if ( ! $product instanceof WC_Product ) {
			return;
		}

		$checked = self::is_dynamic_enabled_for_product( $product );

		echo '<div class="options_group">';
		woocommerce_wp_checkbox(
			array(
				'id'          => 'fipos_show_dynamic_bundle_pricing',
				'label'       => __( 'Show dynamic bundle pricing', 'fooevents-internal-pos' ),
				'description' => __(
					'On the single product page, show package prices calculated from active storefront bundle-tier coupons. The WooCommerce product price and each coupon\'s fixed cart discount amount are the source of truth.',
					'fooevents-internal-pos'
				),
				'value'       => $checked ? 'yes' : 'no',
				'cbvalue'     => 'yes',
				'desc_tip'    => false,
			)
		);
		echo '</div>';
	}

	/**
	 * @param WC_Product $product Product.
	 */
	public function save_product_option( $product ) {
		if ( ! $product instanceof WC_Product ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- WooCommerce product screen nonce.
		$on = isset( $_POST['fipos_show_dynamic_bundle_pricing'] ) && 'yes' === sanitize_text_field( wp_unslash( (string) $_POST['fipos_show_dynamic_bundle_pricing'] ) );

		if ( $on ) {
			$product->update_meta_data( self::META_SHOW_DYNAMIC, 'yes' );
		} else {
			$product->delete_meta_data( self::META_SHOW_DYNAMIC );
		}
	}

	/**
	 * Bundle tiers for display: ticket count + label (plain text).
	 *
	 * @param WC_Product $product Product.
	 * @return array<int, array{qty:int, text:string}>
	 */
	public static function get_bundle_tier_rows( $product ) {
		if ( ! $product instanceof WC_Product || ! Coupon_Rules::is_fooevents_booking_product( $product ) ) {
			return array();
		}

		$unit = (float) $product->get_price();
		if ( $unit <= 0 ) {
			return array();
		}

		$tiers = Coupon_Rules::get_bundle_tiers_sorted( 'storefront', null );
		if ( empty( $tiers ) ) {
			return array();
		}

		usort(
			$tiers,
			static function ( $a, $b ) {
				return (int) $a['qty'] <=> (int) $b['qty'];
			}
		);

		$out = array();
		foreach ( $tiers as $tier ) {
			$qty = isset( $tier['qty'] ) ? (int) $tier['qty'] : 0;
			$amt = isset( $tier['amount'] ) ? (float) $tier['amount'] : 0.0;
			if ( $qty < 2 || $amt < 0 ) {
				continue;
			}

			$subtotal = $unit * $qty;
			$final    = $subtotal - $amt;
			if ( $final <= 0 ) {
				continue;
			}

			$out[] = array(
				'qty'  => $qty,
				/* translators: 1: ticket count, 2: formatted price */
				'text' => sprintf( __( '%1$d tickets for %2$s', 'fooevents-internal-pos' ), $qty, wp_strip_all_tags( wc_price( $final ) ) ),
			);
		}

		return $out;
	}

	/**
	 * Plain segments for bundle lines only (backward compatibility).
	 *
	 * @param WC_Product $product Product.
	 * @return string[]
	 * @deprecated 0.1.2.9 Prefer get_bundle_tier_rows() or get_bundle_pricing_markup().
	 */
	public static function get_bundle_line_segments( $product ) {
		$rows = self::get_bundle_tier_rows( $product );
		$out  = array();
		foreach ( $rows as $row ) {
			$out[] = isset( $row['text'] ) ? (string) $row['text'] : '';
		}
		return array_filter( $out );
	}

	/**
	 * Markup: wrapper + separate spans (base + one badge per tier).
	 *
	 * @param WC_Product $product Product.
	 * @return string HTML (wp_kses-allowed spans).
	 */
	public static function get_bundle_pricing_markup( $product ) {
		if ( ! $product instanceof WC_Product || ! self::is_dynamic_enabled_for_product( $product ) ) {
			return '';
		}

		if ( ! Coupon_Rules::is_fooevents_booking_product( $product ) ) {
			return '';
		}

		$unit = (float) $product->get_price();
		if ( $unit <= 0 ) {
			return '';
		}

		$rows = self::get_bundle_tier_rows( $product );
		if ( empty( $rows ) ) {
			return '';
		}

		/**
		 * Show the per-person line before bundle badges.
		 *
		 * @param bool       $show    Whether to show.
		 * @param WC_Product $product Product.
		 */
		$show_base = (bool) apply_filters( 'fipos_dynamic_bundle_pricing_show_base', true, $product );

		$base_text = sprintf(
			/* translators: %s: formatted unit price */
			__( '%s / person', 'fooevents-internal-pos' ),
			wp_strip_all_tags( wc_price( $unit ) )
		);

		$inner = '';
		if ( $show_base ) {
			$inner .= '<span class="fipos-dynamic-bundle-pricing__base">' . esc_html( $base_text ) . '</span>';
		}

		foreach ( $rows as $row ) {
			$qty  = isset( $row['qty'] ) ? (int) $row['qty'] : 0;
			$text = isset( $row['text'] ) ? (string) $row['text'] : '';
			if ( $qty < 1 || '' === $text ) {
				continue;
			}
			$inner .= '<span class="fipos-dynamic-bundle-pricing__badge" data-fipos-bundle-qty="' . esc_attr( (string) $qty ) . '">' . esc_html( $text ) . '</span>';
		}

		if ( '' === $inner ) {
			return '';
		}

		$group_label = __( 'Bundle pricing options', 'fooevents-internal-pos' );
		$html        = '<span class="fipos-dynamic-bundle-pricing" role="group" aria-label="' . esc_attr( $group_label ) . '">' . $inner . '</span>';

		return wp_kses(
			$html,
			array(
				'span' => array(
					'class'                 => true,
					'data-fipos-bundle-qty' => true,
					'role'                  => true,
					'aria-label'            => true,
				),
			)
		);
	}

	/**
	 * Full marketing line HTML (wrapper + parts).
	 *
	 * @param WC_Product $product Product.
	 * @return string
	 */
	public static function get_formatted_html( $product ) {
		return self::get_bundle_pricing_markup( $product );
	}

	/**
	 * Shortcode [fipos_dynamic_bundle_pricing product_id="123"] — product_id optional on singular product.
	 *
	 * @param array<string, string>|string $atts Atts.
	 * @return string
	 */
	public function shortcode_dynamic_bundle_pricing( $atts ) {
		$atts = shortcode_atts(
			array(
				'product_id' => '0',
			),
			is_array( $atts ) ? $atts : array(),
			'fipos_dynamic_bundle_pricing'
		);

		$pid = max( 0, (int) $atts['product_id'] );
		if ( $pid <= 0 ) {
			$qid = get_queried_object_id();
			$pid = $qid > 0 && 'product' === get_post_type( $qid ) ? $qid : 0;
		}
		if ( $pid <= 0 ) {
			return '';
		}

		$product = wc_get_product( $pid );
		if ( ! $product instanceof WC_Product ) {
			return '';
		}

		$html = self::get_bundle_pricing_markup( $product );
		return '' === $html ? '' : $html;
	}

	/**
	 * Append bundle line after native WooCommerce price on the main single product only.
	 *
	 * @param string     $price   Price HTML.
	 * @param WC_Product $product Product.
	 * @return string
	 */
	public function maybe_append_bundle_pricing_to_price_html( $price, $product ) {
		if ( ! $product instanceof WC_Product || '' === (string) $price ) {
			return $price;
		}

		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return $price;
		}

		$main_id = (int) get_queried_object_id();
		if ( $main_id <= 0 || $main_id !== (int) $product->get_id() ) {
			return $price;
		}

		if ( ! self::is_dynamic_enabled_for_product( $product ) ) {
			return $price;
		}

		/**
		 * Append computed bundle pricing after WooCommerce’s price HTML on the main single product.
		 * Return false to show pricing only via `[fipos_dynamic_bundle_pricing]` (avoid duplicate lines).
		 *
		 * @param bool       $append  Whether to append.
		 * @param WC_Product $product Product.
		 */
		if ( ! apply_filters( 'fipos_dynamic_bundle_pricing_append_to_price_html', true, $product ) ) {
			return $price;
		}

		$extra = self::get_bundle_pricing_markup( $product );
		if ( '' === $extra ) {
			return $price;
		}

		$sep = apply_filters( 'fipos_dynamic_bundle_pricing_html_append_separator', ' ' );

		return $price . wp_kses_post( $sep ) . $extra;
	}
}
