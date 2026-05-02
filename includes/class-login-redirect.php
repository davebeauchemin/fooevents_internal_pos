<?php
/**
 * Send FooEvents POS cashier and check-in staff to Internal POS instead of FooEvents POS.
 *
 * FooEvents POS uses priority 9999 on {@see 'woocommerce_login_redirect'} and 20 on
 * {@see 'woocommerce_prevent_admin_access'}; we override after login and before admin redirect.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Login / wp-admin entry redirects.
 */
class Login_Redirect {

	/**
	 * Hooks.
	 */
	public function init(): void {
		add_filter( 'woocommerce_login_redirect', array( $this, 'filter_woocommerce_login_redirect' ), 10000, 2 );
		add_filter( 'login_redirect', array( $this, 'filter_wp_login_redirect' ), 10000, 3 );
		add_filter( 'woocommerce_prevent_admin_access', array( $this, 'filter_prevent_admin_access' ), 19, 1 );
	}

	/**
	 * Ordered rules: first matching role set wins. Path is appended to /internal-pos/ (empty = app home).
	 *
	 * Filter: `fooevents_internal_pos_login_redirect_rules`
	 *
	 * @return array<int, array{roles: string[], path: string}>
	 */
	private function get_rules(): array {
		$defaults = array(
			array(
				'roles' => array( 'fooeventspos_cashier' ),
				'path'  => '',
			),
			array(
				'roles' => array( 'checked_in_validator', 'checked-in-validator' ),
				'path'  => 'validate',
			),
		);

		$rules = apply_filters( 'fooevents_internal_pos_login_redirect_rules', $defaults );
		return is_array( $rules ) ? $rules : $defaults;
	}

	/**
	 * @param \WP_User $user User.
	 * @return string|null Internal POS URL or null if no rule applies.
	 */
	private function destination_for_user( \WP_User $user ): ?string {
		if ( ! apply_filters( 'fooevents_internal_pos_redirect_staff_to_internal_pos', true, $user ) ) {
			return null;
		}

		foreach ( $this->get_rules() as $rule ) {
			if ( ! is_array( $rule ) || empty( $rule['roles'] ) || ! is_array( $rule['roles'] ) ) {
				continue;
			}
			$path = isset( $rule['path'] ) ? (string) $rule['path'] : '';
			foreach ( $rule['roles'] as $role ) {
				if ( ! is_string( $role ) || '' === $role ) {
					continue;
				}
				if ( self::user_has_role( $user, $role ) ) {
					return '' === $path
						? Access_Helper::get_pos_front_url()
						: Access_Helper::get_pos_subpath_url( $path );
				}
			}
		}

		return null;
	}

	/**
	 * @param \WP_User $user User.
	 * @param string   $role  Role slug.
	 */
	private static function user_has_role( \WP_User $user, string $role ): bool {
		if ( function_exists( 'wc_user_has_role' ) ) {
			return wc_user_has_role( $user, $role );
		}
		return in_array( $role, (array) $user->roles, true );
	}

	/**
	 * @param string    $redirect_to URL.
	 * @param \WP_User  $user        User.
	 * @return string
	 */
	public function filter_woocommerce_login_redirect( $redirect_to, $user ) {
		if ( ! $user instanceof \WP_User ) {
			return $redirect_to;
		}
		$dest = $this->destination_for_user( $user );
		return $dest ?? $redirect_to;
	}

	/**
	 * @param string           $redirect_to           URL.
	 * @param string           $requested_redirect_to Requested.
	 * @param \WP_User|\WP_Error $user              User.
	 * @return string
	 */
	public function filter_wp_login_redirect( $redirect_to, $requested_redirect_to, $user ) {
		unset( $requested_redirect_to );
		if ( ! $user instanceof \WP_User ) {
			return $redirect_to;
		}
		$dest = $this->destination_for_user( $user );
		return $dest ?? $redirect_to;
	}

	/**
	 * Run before FooEvents POS (priority 20) so cashiers land on Internal POS, not fooeventspos slug.
	 *
	 * @param bool $prevent_access WooCommerce admin gate flag.
	 * @return bool
	 */
	public function filter_prevent_admin_access( $prevent_access ) {
		if ( ! is_user_logged_in() ) {
			return $prevent_access;
		}
		if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) {
			return $prevent_access;
		}
		if ( defined( 'DOING_CRON' ) && DOING_CRON ) {
			return $prevent_access;
		}
		if ( function_exists( 'wp_is_json_request' ) && wp_is_json_request() ) {
			return $prevent_access;
		}
		if ( is_multisite() && is_super_admin() ) {
			return $prevent_access;
		}

		$user = wp_get_current_user();
		if ( ! $user instanceof \WP_User || 0 === (int) $user->ID ) {
			return $prevent_access;
		}

		$dest = $this->destination_for_user( $user );
		if ( null === $dest ) {
			return $prevent_access;
		}

		wp_safe_redirect( esc_url( $dest ) );
		exit;
	}
}
