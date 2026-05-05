<?php
/**
 * Enqueue storefront assets: date/slot picker (single product), cart formatter, Woo CSS.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Front-of-house assets (migrated from theme child).
 */
class Storefront_Assets {

	/**
	 * Hooks.
	 */
	public function init() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ), 20 );
	}

	/**
	 * Register scripts and styles.
	 */
	public function enqueue() {
		$url = FOOEVENTS_INTERNAL_POS_URL . 'public/frontend/';
		$ver = FOOEVENTS_INTERNAL_POS_VERSION;

		if ( function_exists( 'is_cart' ) && function_exists( 'is_checkout' ) && ( is_cart() || is_checkout() ) ) {
			wp_enqueue_style(
				'fipos-woocommerce',
				$url . 'css/woocommerce.css',
				array(),
				$ver
			);
			wp_enqueue_script(
				'fipos-cart-format',
				$url . 'js/cart-format.js',
				array(),
				$ver,
				true
			);
		}

		if ( function_exists( 'is_product' ) && is_product() ) {
			$site_time = ( new Bookings_Service() )->get_site_time_for_rest();
			$now_ts    = isset( $site_time['siteNowLocal'] ) ? strtotime( (string) $site_time['siteNowLocal'] ) : false;
			$minutes   = false === $now_ts ? null : (int) wp_date( 'G', $now_ts ) * 60 + (int) wp_date( 'i', $now_ts );

			wp_enqueue_style(
				'fipos-bundle-pricing',
				$url . 'css/bundle-pricing.css',
				array(),
				$ver
			);
			wp_enqueue_style(
				'fipos-date-slot-picker',
				$url . 'css/date-slot-picker.css',
				array(),
				$ver
			);
			wp_enqueue_script(
				'fipos-date-slot-picker',
				$url . 'js/date-slot-picker.js',
				array( 'jquery' ),
				$ver,
				true
			);
			wp_localize_script(
				'fipos-date-slot-picker',
				'fiposDateSlotPicker',
				array(
					'customTimeSlots' => (bool) apply_filters( 'fipos_enable_custom_time_slot_picker', true ),
					'siteTodayYmd'    => isset( $site_time['siteTodayYmd'] ) ? (string) $site_time['siteTodayYmd'] : '',
					'siteTodayLabel'  => wp_date( (string) get_option( 'date_format' ), false === $now_ts ? time() : $now_ts ),
					'siteNowLocal'    => isset( $site_time['siteNowLocal'] ) ? (string) $site_time['siteNowLocal'] : '',
					'siteTimezone'    => isset( $site_time['siteTimezone'] ) ? (string) $site_time['siteTimezone'] : '',
					'siteNowMinutes'  => $minutes,
				)
			);
		}
	}
}
