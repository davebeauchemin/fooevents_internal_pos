<?php
/**
 * Frontend page: virtual /internal-pos/ route, template, assets, access control.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Frontend page handler.
 */
class Frontend_Page {

	/**
	 * Hooks.
	 */
	public function init() {
		add_action( 'init', array( $this, 'on_init_register_rewrites' ), 0 );
		add_action( 'init', array( $this, 'maybe_flush_rewrites_after_upgrade' ), 20 );
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
		add_filter( 'pre_handle_404', array( $this, 'pre_handle_404' ), 10, 2 );
		add_action( 'wp', array( $this, 'normalize_internal_pos_query' ) );

		add_filter( 'template_include', array( $this, 'template_include' ), 1001 );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_scripts' ), 5 );
		add_action( 'wp_enqueue_scripts', array( $this, 'isolate_internal_pos_frontend_assets' ), PHP_INT_MAX );
		add_action( 'wp_print_styles', array( $this, 'isolate_internal_pos_frontend_assets' ), 1 );
		add_action( 'wp_print_scripts', array( $this, 'isolate_internal_pos_frontend_assets' ), 1 );
		add_filter( 'show_admin_bar', array( $this, 'hide_admin_bar' ), 100 );
		add_filter( 'script_loader_tag', array( $this, 'script_loader_tag' ), 10, 3 );
	}

	/**
	 * Register rewrite rules (activation + every init).
	 */
	public static function register_rewrite_rules(): void {
		$slug = preg_quote( FOOEVENTS_INTERNAL_POS_PAGE_SLUG, '/' );
		add_rewrite_rule(
			'^' . $slug . '(/.*)?/?$',
			'index.php?' . FOOEVENTS_INTERNAL_POS_QUERY_VAR . '=1',
			'top'
		);
	}

	/**
	 * @return void
	 */
	public function on_init_register_rewrites(): void {
		self::register_rewrite_rules();
	}

	/**
	 * One-time flush when FOOEVENTS_INTERNAL_POS_REWRITE_VERSION changes.
	 *
	 * @return void
	 */
	public function maybe_flush_rewrites_after_upgrade(): void {
		$stored = (string) get_option( FOOEVENTS_INTERNAL_POS_REWRITE_VERSION_OPTION, '' );
		if ( $stored === FOOEVENTS_INTERNAL_POS_REWRITE_VERSION ) {
			return;
		}
		flush_rewrite_rules( false );
		update_option( FOOEVENTS_INTERNAL_POS_REWRITE_VERSION_OPTION, FOOEVENTS_INTERNAL_POS_REWRITE_VERSION );
	}

	/**
	 * @param string[] $vars Query vars.
	 * @return string[]
	 */
	public function add_query_vars( array $vars ): array {
		$vars[] = FOOEVENTS_INTERNAL_POS_QUERY_VAR;
		return $vars;
	}

	/**
	 * Avoid theme 404 for the virtual POS route.
	 *
	 * @param bool|false $preempt  Whether to short-circuit 404 handling.
	 * @param \WP_Query  $wp_query Query instance.
	 * @return bool|false
	 */
	public function pre_handle_404( $preempt, $wp_query ) {
		if ( $wp_query instanceof \WP_Query && $this->is_internal_pos_query( $wp_query ) ) {
			return true;
		}
		return $preempt;
	}

	/**
	 * Normalize main query flags for themes and core.
	 *
	 * @return void
	 */
	public function normalize_internal_pos_query(): void {
		if ( ! $this->is_internal_pos_query() ) {
			return;
		}
		global $wp_query;
		$wp_query->is_404          = false;
		$wp_query->is_page         = true;
		$wp_query->is_singular     = true;
		$wp_query->is_home         = false;
		$wp_query->is_archive      = false;
		$wp_query->is_post_type_archive = false;
	}

	/**
	 * @param \WP_Query|null $query Optional query.
	 */
	private function is_internal_pos_query( $query = null ): bool {
		if ( null === $query ) {
			global $wp_query;
			$query = $wp_query;
		}
		if ( ! $query instanceof \WP_Query ) {
			return false;
		}
		return '1' === (string) $query->get( FOOEVENTS_INTERNAL_POS_QUERY_VAR );
	}

	/**
	 * Load Vite output as type="module".
	 *
	 * @param string $tag    The script tag.
	 * @param string $handle The handle.
	 * @param string $src    Source.
	 * @return string
	 */
	public function script_loader_tag( $tag, $handle, $src ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter
		if ( 0 === strpos( $handle, 'fooevents-internal-pos-app-' ) ) {
			$tag = str_replace( '<script ', '<script type="module" ', $tag );
		}
		return $tag;
	}

	/**
	 * Is this the Internal POS route?
	 */
	private function is_internal_pos_page(): bool {
		return $this->is_internal_pos_query();
	}

	/**
	 * Swap to minimal template for the SPA.
	 *
	 * @param string $template Default template path.
	 * @return string
	 */
	public function template_include( $template ) {
		if ( ! $this->is_internal_pos_page() ) {
			return $template;
		}
		// Cashiers (`publish_fooeventspos`) and shop managers (`manage_woocommerce`).
		if ( ! Access_Helper::can_use_pos() ) {
			$redirect = Access_Helper::get_pos_front_url();
			if ( ! is_user_logged_in() ) {
				wp_safe_redirect( wp_login_url( $redirect ) );
			} else {
				wp_safe_redirect( home_url( '/' ) );
			}
			exit;
		}
		$file = FOOEVENTS_INTERNAL_POS_DIR . 'public/template-internal-pos-page.php';
		if ( is_readable( $file ) ) {
			return $file;
		}
		return $template;
	}

	/**
	 * Enqueue Vite build assets.
	 */
	public function enqueue_scripts() {
		if ( ! $this->is_internal_pos_page() || is_admin() ) {
			return;
		}
		if ( ! Access_Helper::can_use_pos() ) {
			return;
		}

		$ver = FOOEVENTS_INTERNAL_POS_VERSION;
		$dir = FOOEVENTS_INTERNAL_POS_DIR . 'public/dist/assets/';
		$uri = FOOEVENTS_INTERNAL_POS_URL . 'public/dist/assets/';

		if ( is_dir( $dir ) ) {
			$js_files = glob( $dir . 'index-*.js' );
			$css_files = glob( $dir . 'index-*.css' );
			$i = 0;
			if ( is_array( $js_files ) ) {
				foreach ( $js_files as $path ) {
					$name = basename( $path );
					wp_enqueue_script(
						'fooevents-internal-pos-app-' . $i,
						$uri . $name,
						array(),
						$ver,
						true
					);
					wp_script_add_data( 'fooevents-internal-pos-app-' . $i, 'type', 'module' );
					++$i;
				}
			}
			$j = 0;
			if ( is_array( $css_files ) ) {
				foreach ( $css_files as $path ) {
					$name = basename( $path );
					wp_enqueue_style(
						'fooevents-internal-pos-style-' . $j,
						$uri . $name,
						array(),
						$ver
					);
					++$j;
				}
			}
		}
	}

	/**
	 * Strip theme/plugin CSS and JS on the Internal POS page so only this plugin's Vite assets load.
	 *
	 * Run late on `wp_enqueue_scripts` and early on `wp_print_*` so late-queued handles are removed too.
	 */
	public function isolate_internal_pos_frontend_assets() {
		if ( ! $this->is_internal_pos_page() || is_admin() ) {
			return;
		}
		if ( ! Access_Helper::can_use_pos() ) {
			return;
		}

		global $wp_styles, $wp_scripts;

		if ( $wp_styles instanceof \WP_Styles ) {
			$style_queue = is_array( $wp_styles->queue ) ? $wp_styles->queue : array();
			foreach ( $style_queue as $handle ) {
				if ( ! is_string( $handle ) ) {
					continue;
				}
				if ( 0 !== strpos( $handle, 'fooevents-internal-pos-style-' ) ) {
					wp_dequeue_style( $handle );
				}
			}
		}

		if ( $wp_scripts instanceof \WP_Scripts ) {
			$script_queue = is_array( $wp_scripts->queue ) ? $wp_scripts->queue : array();
			foreach ( $script_queue as $handle ) {
				if ( ! is_string( $handle ) ) {
					continue;
				}
				if ( 0 !== strpos( $handle, 'fooevents-internal-pos-app-' ) ) {
					wp_dequeue_script( $handle );
				}
			}
		}
	}

	/**
	 * @param bool $show Whether to show the admin bar.
	 * @return bool
	 */
	public function hide_admin_bar( $show ) {
		if ( $this->is_internal_pos_page() ) {
			return false;
		}
		return $show;
	}
}
