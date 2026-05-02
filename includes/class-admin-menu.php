<?php
/**
 * Top-level wp-admin menu: open full-screen Internal POS at /internal-pos/.
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
	 * Main menu entry (cashiers + shop managers via Access_Helper::CAP_ACCESS_MENU).
	 */
	public function register_menu() {
		add_menu_page(
			__( 'Internal POS', 'fooevents-internal-pos' ),
			__( 'Internal POS', 'fooevents-internal-pos' ),
			Access_Helper::CAP_ACCESS_MENU,
			'fooevents-internal-pos',
			array( $this, 'redirect_to_pos' ),
			'dashicons-cart',
			56
		);
	}

	/**
	 * Redirect to the frontend app (virtual route).
	 */
	public function redirect_to_pos() {
		wp_safe_redirect( esc_url( Access_Helper::get_pos_front_url() ) );
		exit;
	}
}
