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

	public const OPTION_NEXT_PURCHASE_DISCOUNT_TYPE = 'fooevents_internal_pos_next_purchase_discount_type';

	public const OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT = 'fooevents_internal_pos_next_purchase_discount_amount';

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
		$tabs['fooevents_internal_pos'] = __( 'Module Rouge POS', 'fooevents-internal-pos' );
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
		self::normalize_next_purchase_discount_options();
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
					'title' => __( 'How generated next-purchase promos behave', 'fooevents-internal-pos' ),
					'type'  => 'title',
					'desc'  => __( 'Each promo is restricted to the same FooEvents booking tickets the customer ordered before (same products / variations). The cart ticket quantities must stay within what they purchased on that order—same mix with equal or fewer tickets per item. Larger quantities or ticket types they did not buy will not qualify.', 'fooevents-internal-pos' ),
					'id'    => 'fooevents_internal_pos_coupons_behavior_title',
				),
				array(
					'title'   => __( 'Generated next-purchase coupons', 'fooevents-internal-pos' ),
					'desc'    => __( 'When enabled, a unique promotional coupon may be generated after qualifying booking orders reach processing/completed status, emailed to customers, and returned after POS bookings. When disabled, use manual coupons marked “Show on POS” instead.', 'fooevents-internal-pos' ),
					'id'      => self::OPTION_ENABLE_GENERATED_NEXT_PURCHASE,
					'default' => 'no',
					'type'    => 'checkbox',
				),
				array(
					'title'   => __( 'Next-purchase discount type', 'fooevents-internal-pos' ),
					'desc'    => __( 'Percentage applies to qualifying cart totals. Fixed cart subtracts this flat amount once from the eligible cart.', 'fooevents-internal-pos' ),
					'id'      => self::OPTION_NEXT_PURCHASE_DISCOUNT_TYPE,
					'type'    => 'select',
					'options' => array(
						'percent'    => __( 'Percentage discount', 'fooevents-internal-pos' ),
						'fixed_cart' => __( 'Fixed cart discount', 'fooevents-internal-pos' ),
					),
					'default' => 'percent',
					'desc_tip' => true,
				),
				array(
					'title'       => __( 'Next-purchase discount amount', 'fooevents-internal-pos' ),
					'id'          => self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT,
					'type'        => 'text',
					'placeholder' => '50',
					'desc'        => __( 'For percentages use 1–100. For fixed cart discounts use your store currency amount.', 'fooevents-internal-pos' ),
					'default'     => '50',
					'css'         => 'width: 120px;',
					'autoload'    => false,
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

	/**
	 * Stored discount type for newly generated coupons: percent | fixed_cart.
	 *
	 * @return string
	 */
	public static function next_purchase_discount_type() {
		$t = (string) get_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_TYPE, 'percent' );

		return in_array( $t, array( 'percent', 'fixed_cart' ), true ) ? $t : 'percent';
	}

	/**
	 * Decimal string for WooCommerce coupon amount stored on new coupons (read path; clamps invalid saved values logically).
	 *
	 * @return string
	 */
	public static function next_purchase_discount_amount_decimal() {
		$type           = self::next_purchase_discount_type();
		$price_decimals = wc_get_price_decimals();

		$stored = trim( (string) get_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT, '' ) );

		if ( '' === $stored ) {
			$stored = 'percent' === $type ? '50' : wc_format_decimal( '10', $price_decimals );
		}

		if ( 'percent' === $type ) {
			$n = wc_format_decimal( $stored, 8 );

			if ( (float) $n <= 0 ) {
				return wc_format_decimal( '50', 4 );
			}

			if ( (float) $n > 100 ) {
				return wc_format_decimal( '100', 4 );
			}

			return wc_format_decimal( $n, 4 );
		}

		$n = wc_format_decimal( $stored, max( $price_decimals, 6 ) );

		if ( (float) $n <= 0 ) {
			return wc_format_decimal( '10', $price_decimals );
		}

		return wc_format_decimal( $n, $price_decimals );
	}

	/**
	 * @return float
	 */
	public static function next_purchase_discount_amount_float() {
		return (float) self::next_purchase_discount_amount_decimal();
	}

	/**
	 * Clamp discounted options saved on this WooCommerce Settings tab after WC writes POST to the database.
	 *
	 * @return void
	 */
	public static function normalize_next_purchase_discount_options() {
		$type = (string) get_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_TYPE, 'percent' );

		if ( ! in_array( $type, array( 'percent', 'fixed_cart' ), true ) ) {
			update_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_TYPE, 'percent', false );
			$type = 'percent';
		}

		$price_decimals = wc_get_price_decimals();
		$raw            = trim( (string) get_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT, '' ) );

		if ( '' === $raw ) {
			update_option(
				self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT,
				'percent' === $type ? '50' : wc_format_decimal( '10', $price_decimals ),
				false
			);

			return;
		}

		$decimals = max( $price_decimals, 6 );

		if ( 'percent' === $type ) {
			$n = wc_format_decimal( $raw, $decimals );

			if ( (float) $n <= 0 ) {
				update_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT, '50', false );

				return;
			}

			if ( (float) $n > 100 ) {
				update_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT, '100', false );

				return;
			}

			update_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT, wc_format_decimal( $n, 4 ), false );

			return;
		}

		$n = wc_format_decimal( $raw, $decimals );

		if ( (float) $n <= 0 ) {
			update_option(
				self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT,
				wc_format_decimal( '10', $price_decimals ),
				false
			);

			return;
		}

		update_option( self::OPTION_NEXT_PURCHASE_DISCOUNT_AMOUNT, wc_format_decimal( $n, $price_decimals ), false );
	}
}
