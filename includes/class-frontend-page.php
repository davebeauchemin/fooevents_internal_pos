<?php
/**
 * Frontend page: template, assets, access control.
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
		add_filter( 'template_include', array( $this, 'template_include' ), 1001 );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_scripts' ), 5 );
		add_action( 'wp_enqueue_scripts', array( $this, 'isolate_internal_pos_frontend_assets' ), PHP_INT_MAX );
		add_action( 'wp_print_styles', array( $this, 'isolate_internal_pos_frontend_assets' ), 1 );
		add_action( 'wp_print_scripts', array( $this, 'isolate_internal_pos_frontend_assets' ), 1 );
		add_filter( 'show_admin_bar', array( $this, 'hide_admin_bar' ), 100 );
		add_filter( 'script_loader_tag', array( $this, 'script_loader_tag' ), 10, 3 );
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
	 * Is this the Internal POS page?
	 */
	private function is_internal_pos_page() {
		$slug  = FOOEVENTS_INTERNAL_POS_PAGE_SLUG;
		$opt   = (int) get_option( FOOEVENTS_INTERNAL_POS_PAGE_OPTION, 0 );
		if ( is_page( $opt ) && $opt > 0 ) {
			return true;
		}
		return is_page( $slug );
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
			if ( ! is_user_logged_in() ) {
				wp_safe_redirect( wp_login_url( get_permalink() ) );
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
