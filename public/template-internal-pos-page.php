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
	})();
	</script>
</head>
<body class="fooevents-internal-pos-body m-0 min-h-screen antialiased text-slate-800 bg-slate-50">
	<div id="root"></div>
	<?php wp_footer(); ?>
</body>
</html>
