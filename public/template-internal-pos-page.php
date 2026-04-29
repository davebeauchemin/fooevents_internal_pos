<?php
/**
 * Full-screen template for Internal POS (React app).
 *
 * @package FooEventsInternalPOS
 */

defined( 'ABSPATH' ) || exit;

?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>" />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
	<title><?php echo esc_html( get_bloginfo( 'name' ) . ' — ' . __( 'Internal POS', 'fooevents-internal-pos' ) ); ?></title>
	<style id="fooevents-internal-pos-critical-reset">
		html,
		body.fooevents-internal-pos-body {
			margin: 0;
			padding: 0;
			min-height: 100%;
			width: 100%;
			height: 100%;
			background: #f8fafc;
			color: #0f172a;
			font-family: 'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			line-height: 1.5;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		body.fooevents-internal-pos-body {
			display: block;
		}
		#root {
			min-height: 100vh;
			min-height: 100dvh;
			width: 100%;
		}
		#root *,
		#root *::before,
		#root *::after {
			box-sizing: border-box;
		}
	</style>
	<?php wp_head(); ?>
	<script>
	(function() {
		localStorage.setItem("WORDPRESS_URL", <?php echo wp_json_encode( get_rest_url() ); ?>);
		localStorage.setItem("WORDPRESS_SITE_URL", <?php echo wp_json_encode( get_site_url() ); ?>);
		localStorage.setItem("X-WP-Nonce", <?php echo wp_json_encode( wp_create_nonce( 'wp_rest' ) ); ?>);
		<?php
		$internal_page = (int) get_option( FOOEVENTS_INTERNAL_POS_PAGE_OPTION, 0 );
		$page_url      = $internal_page > 0 ? get_permalink( $internal_page ) : home_url( '/' . FOOEVENTS_INTERNAL_POS_PAGE_SLUG . '/' );
		$page_path     = $page_url ? (string) wp_parse_url( $page_url, PHP_URL_PATH ) : '/' . FOOEVENTS_INTERNAL_POS_PAGE_SLUG . '/';
		$page_path     = untrailingslashit( $page_path ) ?: '/';
		?>
		localStorage.setItem("INTERNAL_POS_BASENAME", <?php echo wp_json_encode( $page_path ); ?>);
		localStorage.setItem("INTERNAL_POS_APP_URL", <?php echo wp_json_encode( is_string( $page_url ) ? $page_url : home_url( '/' ) ); ?>);

		window.FooEventsInternalPOS = <?php
		echo wp_json_encode( FooEvents_Internal_POS\Access_Helper::pos_access_flags() );
		?>;
	})();
	</script>
</head>
<body class="fooevents-internal-pos-body m-0 min-h-screen antialiased text-slate-800 bg-slate-50">
	<div id="root"></div>
	<?php wp_footer(); ?>
</body>
</html>
