<?php
/**
 * Activation: create the Internal POS page.
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
	 * Run on plugin activation.
	 */
	public static function activate() {
		$slug  = FOOEVENTS_INTERNAL_POS_PAGE_SLUG;
		$title = __( 'Internal POS', 'fooevents-internal-pos' );

		$existing = get_page_by_path( $slug, OBJECT, 'page' );
		$page_id  = 0;
		if ( $existing ) {
			$page_id = (int) $existing->ID;
		} else {
			$page_id = (int) wp_insert_post(
				array(
					'post_title'   => $title,
					'post_name'    => $slug,
					'post_status'  => 'publish',
					'post_type'    => 'page',
					'post_content' => '',
				)
			);
		}

		if ( $page_id > 0 && ! is_wp_error( $page_id ) ) {
			update_option( FOOEVENTS_INTERNAL_POS_PAGE_OPTION, $page_id );
		}
		flush_rewrite_rules( false );
	}
}
