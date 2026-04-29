<?php
/**
 * Capability helpers — aligns POS SPA routing with FooEvents POS and WooCommerce roles.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Uses FooEvents POS cap `publish_fooeventspos` plus WooCommerce shop management.
 */
final class Access_Helper {

	public static function can_use_pos(): bool {
		return is_user_logged_in()
			&& (
				current_user_can( 'publish_fooeventspos' )
				|| current_user_can( 'manage_woocommerce' )
			);
	}

	public static function can_manage_shop_events(): bool {
		return is_user_logged_in() && current_user_can( 'manage_woocommerce' );
	}

	/**
	 * FooEvents ticket-app style caps (not required for calendar checkout; optional UI later).
	 */
	public static function can_validate_fooevents_tickets(): bool {
		return is_user_logged_in()
			&& (
				current_user_can( 'publish_event_magic_tickets' )
				|| current_user_can( 'app_event_magic_tickets' )
			);
	}

	/**
	 * SPA bootstrap for the React app (capabilities, user, URLs).
	 *
	 * @return array<string, mixed>
	 */
	public static function pos_access_flags(): array {
		$out = array(
			'canUsePos'          => self::can_use_pos(),
			'canManageEvents'    => self::can_manage_shop_events(),
			'canValidateTickets' => self::can_validate_fooevents_tickets(),
		);

		if ( is_user_logged_in() ) {
			$user          = wp_get_current_user();
			$internal_page = (int) get_option( FOOEVENTS_INTERNAL_POS_PAGE_OPTION, 0 );
			$pos_url       = $internal_page > 0
				? get_permalink( $internal_page )
				: home_url( '/' . FOOEVENTS_INTERNAL_POS_PAGE_SLUG . '/' );
			$redirect      = is_string( $pos_url ) ? $pos_url : home_url( '/' );

			$out['currentUser'] = array(
				'name'      => $user->display_name,
				'email'     => $user->user_email,
				'avatarUrl' => get_avatar_url( $user->ID, array( 'size' => 64 ) ),
			);
			$out['site']       = array(
				'name' => get_bloginfo( 'name' ),
			);
			$out['logoutUrl']  = html_entity_decode( wp_logout_url( $redirect ), ENT_QUOTES, 'UTF-8' );
			$out['profileUrl'] = admin_url( 'profile.php' );
		}

		return $out;
	}
}
