<?php
/**
 * WooCommerce submenu: redirect to full-screen Internal POS page.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Register admin menu.
 */
class Admin_Menu {

	/**
	 * Hooks.
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_menu' ), 100 );
	}

	/**
	 * Add submenu under WooCommerce.
	 */
	public function register_menu() {
		add_submenu_page(
			'woocommerce',
			__( 'Internal POS', 'fooevents-internal-pos' ),
			__( 'Internal POS', 'fooevents-internal-pos' ),
			'manage_woocommerce',
			'fooevents-internal-pos',
			array( $this, 'redirect_to_pos' )
		);
	}

	/**
	 * Redirect to the frontend app page.
	 */
	public function redirect_to_pos() {
		wp_safe_redirect( esc_url( home_url( '/' . FOOEVENTS_INTERNAL_POS_PAGE_SLUG . '/' ) ) );
		exit;
	}
}
