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
					'customTimeSlots' => (bool) apply_filters( 'fipos_enable_custom_time_slot_picker', false ),
				)
			);
		}
	}
}
