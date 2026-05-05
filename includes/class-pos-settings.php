<?php
/**
 * WooCommerce settings: FooEvents Internal POS options.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Registers Internal POS WooCommerce Settings tab fields.
 */
class Pos_Settings {

	public const OPTION_ENABLE_GENERATED_NEXT_PURCHASE = 'fooevents_internal_pos_enable_generated_next_purchase_coupons';

	public function init() {
		add_filter( 'woocommerce_settings_tabs_array', array( $this, 'add_settings_tab' ), 60 );
		add_action( 'woocommerce_settings_tabs_fooevents_internal_pos', array( $this, 'render_settings_tab' ) );
		add_action( 'woocommerce_update_options_fooevents_internal_pos', array( $this, 'save_settings_tab' ) );
	}

	/**
	 * @param array<string, string> $tabs Existing WC settings tabs (slug => label).
	 * @return array<string, string>
	 */
	public function add_settings_tab( $tabs ) {
		if ( ! is_array( $tabs ) ) {
			$tabs = array();
		}
		$tabs['fooevents_internal_pos'] = __( 'FooEvents POS', 'fooevents-internal-pos' );
		return $tabs;
	}

	/**
	 * Output WooCommerce settings fields on this tab.
	 */
	public function render_settings_tab() {
		if ( ! class_exists( '\WC_Admin_Settings', false ) ) {
			return;
		}

		\WC_Admin_Settings::output_fields( $this->get_settings_definition() );
	}

	/**
	 * Persist settings submitted on this tab.
	 */
	public function save_settings_tab() {
		if ( ! class_exists( '\WC_Admin_Settings', false ) ) {
			return;
		}

		\WC_Admin_Settings::save_fields( $this->get_settings_definition() );
	}

	/**
	 * Field definitions for the Internal POS WooCommerce Settings tab.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	private function get_settings_definition() {
		return apply_filters(
			'fooevents_internal_pos_woocommerce_settings',
			array(
				array(
					'title' => __( 'Internal POS coupons', 'fooevents-internal-pos' ),
					'type'  => 'title',
					'desc'  => __( 'Control FooEvents automated next-purchase coupons created after WooCommerce booking orders.', 'fooevents-internal-pos' ),
					'id'    => 'fooevents_internal_pos_coupons_title',
				),
				array(
					'title'   => __( 'Generated next-purchase coupons', 'fooevents-internal-pos' ),
					'desc'    => __( 'When enabled, a unique promotional coupon may be generated after qualifying booking orders reach processing/completed status, emailed to customers, and returned after POS bookings. When disabled, use manual coupons marked “Show on POS” instead.', 'fooevents-internal-pos' ),
					'id'      => self::OPTION_ENABLE_GENERATED_NEXT_PURCHASE,
					'default' => 'no',
					'type'    => 'checkbox',
				),
				array(
					'type' => 'sectionend',
					'id'   => 'fooevents_internal_pos_coupons_sectionend',
				),
			)
		);
	}

	/**
	 * Whether automated next-purchase coupon generation/email/REST exposure is enabled.
	 *
	 * @return bool
	 */
	public static function generated_next_purchase_coupons_enabled() {
		return 'yes' === (string) get_option( self::OPTION_ENABLE_GENERATED_NEXT_PURCHASE, 'no' );
	}
}
