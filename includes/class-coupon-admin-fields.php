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
		add_filter( 'woocommerce_coupon_data_tabs', array( $this, 'register_coupon_data_tab' ), 99 );
		add_action( 'woocommerce_coupon_data_panels', array( $this, 'render_coupon_data_panel' ), 99 );
		add_action( 'woocommerce_coupon_options_save', array( $this, 'save' ), 10, 2 );
		add_action( 'admin_head', array( $this, 'print_coupon_styles' ), 20 );
	}

	/**
	 * Sidebar tab on the WooCommerce Coupon data metabox (next to General, Usage restriction, Usage limits).
	 *
	 * @param array<string, array<string, string|array<int, string>>> $tabs Tabs.
	 * @return array<string, array<string, string|array<int, string>>>
	 */
	public function register_coupon_data_tab( $tabs ) {
		if ( ! is_array( $tabs ) ) {
			$tabs = array();
		}

		$tabs['module_rouge_pos'] = array(
			'label'  => __( 'Module Rouge POS', 'fooevents-internal-pos' ),
			'target' => 'module_rouge_pos_coupon_panel',
			'class'  => array(),
		);

		return $tabs;
	}

	/**
	 * Tab panel body (coupon edit screen — right pane when tab is selected).
	 */
	public function render_coupon_data_panel() {
		global $post;

		if ( ! $post instanceof \WP_Post || 'shop_coupon' !== $post->post_type ) {
			return;
		}

		$coupon = new \WC_Coupon( (int) $post->ID );
		echo '<div id="module_rouge_pos_coupon_panel" class="panel woocommerce_options_panel">';
		$this->render_fields_for_coupon( $coupon );
		echo '</div>';
	}

	/**
	 * Coupon data meta box layout: section intro alignment + bundle tier row spacing.
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
			'#woocommerce-coupon-data .options_group.fipos-coupon-rules{box-sizing:border-box;padding-block:14px 10px;padding-inline:20px;margin-block-start:4px;} ' .
			'#woocommerce-coupon-data .options_group.fipos-coupon-rules>h3{margin:0 0 10px;line-height:1.3;} ' .
			'#woocommerce-coupon-data .options_group.fipos-coupon-rules>p.fipos-coupon-rules-intro{margin:0 0 14px;padding:0;float:none;clear:left;line-height:1.55;max-width:none;} ' .
			/* Bundle tier: WC uses p.form-field padding-left 162px + label float/-150px; keep that + stack helper text under checkbox. */
			'#woocommerce-coupon-data .options_group.fipos-coupon-rules .fipos_is_bundle_tier_field{padding-bottom:14px;margin-bottom:4px;} ' .
			'#woocommerce-coupon-data .options_group.fipos-coupon-rules .fipos_is_bundle_tier_field .fipos-bundle-tier-control-col{display:flex;flex-direction:column;align-items:flex-start;gap:8px;float:left;max-width:calc(100% - 24px);} ' .
			'#woocommerce-coupon-data .options_group.fipos-coupon-rules .fipos_is_bundle_tier_field .fipos-bundle-tier-control-col input.checkbox{float:none!important;margin:4px 0 0!important;} ' .
			'#woocommerce-coupon-data .options_group.fipos-coupon-rules .fipos_is_bundle_tier_field .fipos-bundle-tier-control-col input.checkbox+.description{display:block!important;margin:0!important;padding:0!important;clear:none;line-height:1.5;max-width:36rem;} ' .
			'#module_rouge_pos_coupon_panel{padding-block:14px;} ' .
			'</style>';
	}

	/**
	 * POS / storefront fields for the standalone Coupon data sidebar tab.
	 *
	 * @param \WC_Coupon $coupon Coupon instance.
	 */
	private function render_fields_for_coupon( \WC_Coupon $coupon ) {
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
		echo '<h3>' . esc_html__( 'Module Rouge POS/Storefront', 'fooevents-internal-pos' ) . '</h3>';
		echo '<p class="fipos-coupon-rules-intro description">';
		echo esc_html__( 'Control whether this coupon is applied automatically during Internal POS checkout, the WP storefront checkout, or both; restrict where it may be redeemed; and optionally treat it as a stackable bundle tier (applied as multiple discount lines via fees when qty allows). Bundle tiers must use \"Fixed cart discount\" and amounts are read from the coupon.', 'fooevents-internal-pos' );
		echo '</p>';

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

		$show_on_pos = 'yes' === (string) $coupon->get_meta( Coupon_Rules::META_SHOW_ON_POS );
		echo '<p class="form-field fipos_show_on_pos_field">';
		echo '<label for="fipos_show_on_pos">' . esc_html__( 'Show on POS', 'fooevents-internal-pos' ) . '</label>';
		echo '<span class="fipos-show-on-pos-wrap" style="float:left;margin-top:6px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin-left:-10px">';
		echo '<input type="checkbox" name="fipos_show_on_pos" id="fipos_show_on_pos" class="checkbox" value="yes" ' . checked( $show_on_pos, true, false ) . ' />';
		echo '<span class="description" style="max-width:36rem;display:block;line-height:1.5;margin:0;">';
		echo esc_html__( 'When checked, POS checkout shows this coupon as a one-click apply button (only if redeemable on the POS channel above). Orders may still manually type the code.', 'fooevents-internal-pos' );
		echo '</span>';
		echo '</span></p>';

		echo '<p class="form-field fipos_is_bundle_tier_field fipos-bundle-tier-field">';
		echo '<label for="fipos_is_bundle_tier">' . esc_html__( 'Bundle tier', 'fooevents-internal-pos' ) . '</label>';
		echo '<span class="fipos-bundle-tier-control-col">';
		echo '<input type="checkbox" name="fipos_is_bundle_tier" id="fipos_is_bundle_tier" class="checkbox" value="yes" ' . checked( $is_tier, true, false ) . ' />';
		echo '<span class="description">';
		echo esc_html__( 'When checked, stacking uses this coupon’s Fixed cart discount amount per bundle of the size below.', 'fooevents-internal-pos' );
		echo '</span></span></p>';

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

		echo '<div class="clear"></div>';
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

		$show_on_pos = ! empty( $_POST['fipos_show_on_pos'] ) ? 'yes' : 'no';
		$coupon->update_meta_data( Coupon_Rules::META_SHOW_ON_POS, $show_on_pos );

		$is_tier = ! empty( $_POST['fipos_is_bundle_tier'] ) ? 'yes' : 'no';
		$coupon->update_meta_data( Coupon_Rules::META_IS_BUNDLE_TIER, $is_tier );

		$bq = isset( $_POST['fipos_bundle_qty'] ) ? (int) wp_unslash( $_POST['fipos_bundle_qty'] ) : 2;
		$coupon->update_meta_data( Coupon_Rules::META_BUNDLE_QTY, max( 1, $bq ) );

		$coupon->save();
	}
}
