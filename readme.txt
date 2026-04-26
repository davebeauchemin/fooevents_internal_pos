=== FooEvents Internal POS ===
Contributors: TBD
Tags: fooevents, woocommerce, pos, bookings
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Internal read-only booking dashboard for shop managers. Uses FooEvents Bookings and WooCommerce.

== Description ==

Adds WooCommerce > Internal POS, opening a full-screen React app. REST API namespace `internalpos/v1` lists upcoming bookable events (past dates filtered server-side). MVP: read-only; no order creation.

== Installation ==

1. Install WooCommerce, FooEvents, and FooEvents Bookings.
2. Upload the plugin or clone into wp-content/plugins/fooevents_internal_pos
3. Activate. A published page is created with slug "internal-pos".
4. For Git Updater: set the GitHub Plugin URI in the main plugin file header, push public repo, install Git Updater on the site, bump Version on each release.

== Changelog ==

= 0.1.0 =
* Initial MVP: event list, event detail, check availability, Tailwind + Vite + TanStack Query.
