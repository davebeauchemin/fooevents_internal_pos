<?php
/**
 * Plugin Name:       FooEvents Internal POS
 * Plugin URI:         https://github.com/TBD/fooevents-internal-pos
 * Description:        Internal read-only booking dashboard for shop managers. FooEvents + WooCommerce.
 * Version:            0.1.1.18
 * Requires at least:  6.0
 * Requires PHP:       7.4
 * Author:             Module Rouge
 * License:            GPL-2.0-or-later
 * Text Domain:        fooevents-internal-pos
 * Domain Path:        /languages
 * Requires Plugins:   woocommerce, fooevents, fooevents_bookings
 *
 * GitHub Plugin URI:  https://github.com/davebeauchemin/fooevents_internal_pos
 * Primary Branch:     main
 * Release Asset:       false
 *
 * @package FooEventsInternalPOS
 */

defined( 'ABSPATH' ) || exit;

define( 'FOOEVENTS_INTERNAL_POS_VERSION', '0.1.1.17' );
define( 'FOOEVENTS_INTERNAL_POS_FILE', __FILE__ );
define( 'FOOEVENTS_INTERNAL_POS_DIR', plugin_dir_path( __FILE__ ) );
define( 'FOOEVENTS_INTERNAL_POS_URL', plugin_dir_url( __FILE__ ) );
define( 'FOOEVENTS_INTERNAL_POS_PAGE_SLUG', 'internal-pos' );
define( 'FOOEVENTS_INTERNAL_POS_PAGE_OPTION', 'fooevents_internal_pos_page' );

// Autoload includes.
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-activator.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-admin-menu.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-access-helper.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-frontend-page.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-bookings-service.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-bookings-checkout-service.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-slot-generator-service.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-rest-api.php';
require_once FOOEVENTS_INTERNAL_POS_DIR . 'includes/class-storefront-assets.php';

/**
 * Init plugin.
 */
function fooevents_internal_pos_init() {
	if ( ! class_exists( 'WooCommerce' ) || ! class_exists( 'FooEvents_Bookings' ) ) {
		return;
	}

	( new \FooEvents_Internal_POS\Admin_Menu() )->init();
	( new \FooEvents_Internal_POS\Frontend_Page() )->init();
	( new \FooEvents_Internal_POS\Rest_API() )->init();
	( new \FooEvents_Internal_POS\Storefront_Assets() )->init();
}
add_action( 'plugins_loaded', 'fooevents_internal_pos_init', 20 );

/**
 * Admin-only notice if deps missing.
 */
function fooevents_internal_pos_admin_notices() {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	if ( ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	if ( ! class_exists( 'WooCommerce' ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'FooEvents Internal POS requires WooCommerce.', 'fooevents-internal-pos' ) . '</p></div>';
	}
	if ( ! is_plugin_active( 'fooevents/fooevents.php' ) && ! ( function_exists( 'is_plugin_active_for_network' ) && is_plugin_active_for_network( 'fooevents/fooevents.php' ) ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'FooEvents Internal POS requires the FooEvents plugin.', 'fooevents-internal-pos' ) . '</p></div>';
	}
	if ( ! is_plugin_active( 'fooevents_bookings/fooevents-bookings.php' ) && ! ( function_exists( 'is_plugin_active_for_network' ) && is_plugin_active_for_network( 'fooevents_bookings/fooevents-bookings.php' ) ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'FooEvents Internal POS requires FooEvents Bookings.', 'fooevents-internal-pos' ) . '</p></div>';
	}
}
add_action( 'admin_notices', 'fooevents_internal_pos_admin_notices' );

register_activation_hook( FOOEVENTS_INTERNAL_POS_FILE, array( 'FooEvents_Internal_POS\Activator', 'activate' ) );
