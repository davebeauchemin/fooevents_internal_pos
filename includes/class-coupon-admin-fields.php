<?php
/**
 * WooCommerce coupon edit screen: FooEvents Internal POS / storefront options.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Registers coupon meta fields for auto-apply, channel, and bundle tiers.
 */
class Coupon_Admin_Fields {

	public function init() {
		add_action( 'woocommerce_coupon_options', array( $this, 'render_panel' ), 15, 2 );
		add_action( 'woocommerce_coupon_options_save', array( $this, 'save' ), 10, 2 );
		add_action( 'admin_head', array( $this, 'print_coupon_styles' ), 20 );
	}

	/**
	 * Spacing for bundle tier checkbox + description row (coupon data meta box).
	 */
	public function print_coupon_styles() {
		if ( ! function_exists( 'get_current_screen' ) ) {
			return;
		}
		$screen = get_current_screen();
		if ( ! $screen || 'shop_coupon' !== $screen->post_type ) {
			return;
		}
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static CSS rules only.
		echo '<style id="fipos-coupon-rules-spacing">' .
			'#woocommerce-coupon-data .fipos-coupon-rules .fipos_is_bundle_tier_field{padding-bottom:14px;margin-bottom:4px;} ' .
			'#woocommerce-coupon-data .fipos-coupon-rules .fipos_is_bundle_tier_field span.description{display:block;margin-top:10px;line-height:1.5;max-width:36rem;} ' .
			'#woocommerce-coupon-data .fipos-coupon-rules .fipos_is_bundle_tier_field label{margin-right:.5em;} ' .
			'#woocommerce-coupon-data .fipos-coupon-rules .fipos_is_bundle_tier_field input[type="checkbox"]{margin-inline-end:.5em;} ' .
			'</style>';
	}

	/**
	 * @param int       $coupon_id Coupon post ID.
	 * @param \WC_Coupon $coupon    Coupon instance.
	 */
	public function render_panel( $coupon_id, $coupon ) {
		unset( $coupon_id );
		if ( ! $coupon instanceof \WC_Coupon ) {
			return;
		}

		$scope     = (string) $coupon->get_meta( Coupon_Rules::META_AUTO_APPLY_SCOPE );
		if ( '' === $scope ) {
			$scope = 'none';
		}
		$channel   = (string) $coupon->get_meta( Coupon_Rules::META_CHANNEL_RESTRICTION );
		if ( '' === $channel ) {
			$channel = 'both';
		}
		$is_tier   = 'yes' === (string) $coupon->get_meta( Coupon_Rules::META_IS_BUNDLE_TIER );
		$bundle_qty = (int) $coupon->get_meta( Coupon_Rules::META_BUNDLE_QTY );
		if ( $bundle_qty < 1 ) {
			$bundle_qty = 2;
		}

		echo '<div class="options_group fipos-coupon-rules">';
		echo '<h3>' . esc_html__( 'FooEvents POS / storefront', 'fooevents-internal-pos' ) . '</h3>';
		echo '<p class="form-field form-field-wide"><span class="description">';
		echo esc_html__( 'Control whether this coupon is applied automatically during Internal POS checkout, the WP storefront checkout, or both; restrict where it may be redeemed; and optionally treat it as a stackable bundle tier (applied as multiple discount lines via fees when qty allows). Bundle tiers must use \"Fixed cart discount\" and amounts are read from the coupon.', 'fooevents-internal-pos' );
		echo '</span></p>';

		woocommerce_wp_select(
			array(
				'id'      => 'fipos_auto_apply_scope',
				'label'   => __( 'Auto-apply', 'fooevents-internal-pos' ),
				'options' => array(
					'none'        => __( 'Off (manual code entry only)', 'fooevents-internal-pos' ),
					'pos'         => __( 'Internal POS checkout', 'fooevents-internal-pos' ),
					'storefront'  => __( 'Storefront checkout', 'fooevents-internal-pos' ),
					'both'        => __( 'POS + storefront', 'fooevents-internal-pos' ),
				),
				'value'   => $scope,
				'description' => __( 'When enabled, this code is attempted automatically alongside other eligible coupons.', 'fooevents-internal-pos' ),
				'desc_tip'    => true,
			)
		);

		woocommerce_wp_select(
			array(
				'id'      => 'fipos_channel_restriction',
				'label'   => __( 'Channel restriction', 'fooevents-internal-pos' ),
				'options' => array(
					'both'             => __( 'Both POS and storefront', 'fooevents-internal-pos' ),
					'pos_only'         => __( 'POS only', 'fooevents-internal-pos' ),
					'storefront_only'  => __( 'Storefront only', 'fooevents-internal-pos' ),
				),
				'value'   => $channel,
				'description' => __( 'Block redeeming this coupon on the excluded channel.', 'fooevents-internal-pos' ),
				'desc_tip'    => true,
			)
		);

		if ( function_exists( 'woocommerce_wp_checkbox' ) ) {
			woocommerce_wp_checkbox(
				array(
					'id'            => 'fipos_is_bundle_tier',
					'label'         => __( 'Bundle tier', 'fooevents-internal-pos' ),
					'name'          => 'fipos_is_bundle_tier',
					'value'         => $is_tier ? 'yes' : 'no',
					'cbvalue'       => 'yes',
					'checked_value' => 'yes',
					'description'   => __( 'When checked, stacking uses this coupon’s Fixed cart discount amount per bundle of the size below.', 'fooevents-internal-pos' ),
					'desc_tip'      => false,
					'wrapper_class' => 'fipos-bundle-tier-field',
				)
			);
		} else {
			echo '<p class="form-field fipos_is_bundle_tier_field fipos-bundle-tier-field"><label for="fipos_is_bundle_tier">' . esc_html__( 'Bundle tier', 'fooevents-internal-pos' ) . '</label>';
			echo '<input type="checkbox" class="checkbox" name="fipos_is_bundle_tier" id="fipos_is_bundle_tier" value="1" ' . checked( $is_tier, true, false ) . ' /> ';
			echo '<span class="description">' . esc_html__( 'When checked, stacking uses this coupon’s Fixed cart discount amount per bundle of the size below.', 'fooevents-internal-pos' ) . '</span></p>';
		}

		woocommerce_wp_text_input(
			array(
				'id'                => 'fipos_bundle_qty',
				'label'             => __( 'Tickets per bundle', 'fooevents-internal-pos' ),
				'type'              => 'number',
				'custom_attributes' => array(
					'min'  => '1',
					'step' => '1',
				),
				'value'             => $bundle_qty,
				'description'       => __( 'Greedy stacking uses largest tiers first across all FooEvents booking products in the cart.', 'fooevents-internal-pos' ),
				'desc_tip'          => true,
			)
		);

		echo '</div>';
	}

	/**
	 * @param int        $coupon_id Coupon post ID.
	 * @param \WC_Coupon $coupon    Coupon.
	 */
	public function save( $coupon_id, $coupon ) {
		if ( ! $coupon instanceof \WC_Coupon ) {
			$coupon = new \WC_Coupon( (int) $coupon_id );
		}

		$scope = isset( $_POST['fipos_auto_apply_scope'] )
			? sanitize_text_field( wp_unslash( (string) $_POST['fipos_auto_apply_scope'] ) )
			: 'none';
		$allowed_scopes = array( 'none', 'pos', 'storefront', 'both' );
		if ( ! in_array( $scope, $allowed_scopes, true ) ) {
			$scope = 'none';
		}
		$coupon->update_meta_data( Coupon_Rules::META_AUTO_APPLY_SCOPE, $scope );

		$restriction = isset( $_POST['fipos_channel_restriction'] )
			? sanitize_text_field( wp_unslash( (string) $_POST['fipos_channel_restriction'] ) )
			: 'both';
		$allowed_ch = array( 'both', 'pos_only', 'storefront_only' );
		if ( ! in_array( $restriction, $allowed_ch, true ) ) {
			$restriction = 'both';
		}
		$coupon->update_meta_data( Coupon_Rules::META_CHANNEL_RESTRICTION, $restriction );

		$is_tier = ! empty( $_POST['fipos_is_bundle_tier'] ) ? 'yes' : 'no';
		$coupon->update_meta_data( Coupon_Rules::META_IS_BUNDLE_TIER, $is_tier );

		$bq = isset( $_POST['fipos_bundle_qty'] ) ? (int) wp_unslash( $_POST['fipos_bundle_qty'] ) : 2;
		$coupon->update_meta_data( Coupon_Rules::META_BUNDLE_QTY, max( 1, $bq ) );

		$coupon->save();
	}
}
