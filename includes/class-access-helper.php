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

	/**
	 * Synthetic capability for wp-admin menu visibility (granted via user_has_cap bridge).
	 */
	public const CAP_ACCESS_MENU = 'fooevents_internal_pos_access';

	/**
	 * Register capability bridge for admin menus.
	 */
	public static function init(): void {
		add_filter( 'user_has_cap', array( self::class, 'grant_menu_cap' ), 10, 4 );
	}

	/**
	 * @param array<string, bool> $allcaps All capabilities the user has.
	 * @param string[]              $caps    Capabilities being checked.
	 * @param array                 $args    Additional arguments.
	 * @param \WP_User              $user    User object.
	 * @return array<string, bool>
	 */
	public static function grant_menu_cap( array $allcaps, $caps, $args, $user ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter
		if ( ! is_array( $caps ) || ! in_array( self::CAP_ACCESS_MENU, $caps, true ) ) {
			return $allcaps;
		}
		if ( ! $user instanceof \WP_User ) {
			return $allcaps;
		}
		$pos = ! empty( $user->allcaps['publish_fooeventspos'] );
		$woo = ! empty( $user->allcaps['manage_woocommerce'] );
		if ( $pos || $woo || self::user_has_validate_ticket_caps( $user ) ) {
			$allcaps[ self::CAP_ACCESS_MENU ] = true;
		}
		return $allcaps;
	}

	/**
	 * FooEvents assigns both singular and plural ticket caps on some roles; read from allcaps to avoid recursion.
	 *
	 * @param \WP_User $user User.
	 */
	private static function user_has_validate_ticket_caps( \WP_User $user ): bool {
		return ! empty( $user->allcaps['publish_event_magic_ticket'] )
			|| ! empty( $user->allcaps['publish_event_magic_tickets'] )
			|| ! empty( $user->allcaps['app_event_magic_tickets'] );
	}

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
				current_user_can( 'publish_event_magic_ticket' )
				|| current_user_can( 'publish_event_magic_tickets' )
				|| current_user_can( 'app_event_magic_tickets' )
			);
	}

	/**
	 * Load /internal-pos/ shell: full POS users or check-in validators.
	 */
	public static function can_access_internal_pos_app(): bool {
		return self::can_use_pos() || self::can_validate_fooevents_tickets();
	}

	/**
	 * Canonical front URL for the POS app (virtual route, pretty permalinks).
	 *
	 * @return string
	 */
	public static function get_pos_front_url(): string {
		return home_url( '/' . FOOEVENTS_INTERNAL_POS_PAGE_SLUG . '/' );
	}

	/**
	 * Path for Router basename (leading slash, no trailing slash except root).
	 *
	 * @return string
	 */
	public static function get_pos_basename_path(): string {
		$path = (string) wp_parse_url( self::get_pos_front_url(), PHP_URL_PATH );
		$path = untrailingslashit( $path );
		// Never use site root as Router basename — React Router would treat "/" routes as the real domain root.
		if ( '' === $path || '/' === $path ) {
			$path = '/' . FOOEVENTS_INTERNAL_POS_PAGE_SLUG;
		}
		return $path;
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
			$user     = wp_get_current_user();
			$pos_url  = self::get_pos_front_url();
			$redirect = $pos_url;

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
