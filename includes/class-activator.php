<?php
/**
 * Activation: register virtual /internal-pos/ rewrite and flush rules.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Activator class.
 */
class Activator {

	/**
	 * Legacy option from versions that created a WordPress Page for POS.
	 */
	const LEGACY_PAGE_OPTION = 'fooevents_internal_pos_page';

	/**
	 * Run on plugin activation.
	 */
	public static function activate() {
		Frontend_Page::register_rewrite_rules();
		flush_rewrite_rules( false );
		update_option( FOOEVENTS_INTERNAL_POS_REWRITE_VERSION_OPTION, FOOEVENTS_INTERNAL_POS_REWRITE_VERSION );
		delete_option( self::LEGACY_PAGE_OPTION );
	}
}
