=== FooEvents Internal POS ===
Contributors: TBD
Tags: fooevents, woocommerce, pos, bookings
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.1.1.20
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Internal point-of-sale for FooEvents Bookings, embedded in WooCommerce admin. Shop managers can take bookings, validate and check in tickets, and generate slot schedules from a single React-powered dashboard. Built on FooEvents, FooEvents Bookings, and WooCommerce.

== Description ==

Internal point-of-sale for FooEvents Bookings, embedded in WooCommerce admin. Shop managers can take bookings, validate and check in tickets, and generate slot schedules from a single React-powered dashboard. Built on FooEvents, FooEvents Bookings, and WooCommerce.

== Installation ==

1. Install WooCommerce, FooEvents, and FooEvents Bookings.
2. Upload the plugin or clone into wp-content/plugins/fooevents_internal_pos
3. Activate. A published page is created with slug "internal-pos".
4. For Git Updater: set the GitHub Plugin URI in the main plugin file header, push public repo, install Git Updater on the site, bump Version on each release.

== Changelog ==

= 0.1.1.20 =
* Validate search: rewrite REST search to a direct SQL query against `event_magic_tickets` (`publish`), aligning behavior with `get_single_ticket()`. Fixes empty results for email, numeric ticket ID, and `{productId}-{formatted}` lookups.
* Cleanup: streamline `get_validate_search` SQL builder, replace `WP_Query` row count in the booking-repair helper with `SELECT COUNT(*)`, refresh plugin description.

= 0.1.1.17 =
* Validate: search ticket posts by attendee first/last name, formatted ticket number fragment, productId-formatted number (FooEvents scanner format), and richer ticket ID matching.
* Bookings (Internal POS): if an order completes with FooEvents blueprint meta but zero `event_magic_tickets` posts, retry `FooEvents_Woo_Helper::create_tickets()` once after clearing stale `WooCommerceEventsTicketsGenerated` (addresses empty Validate search/detail for affected orders).

= 0.1.1.8 =
* Single product: time-slot custom pill grid is on by default again. Pills use the raw FooEvents option text (no client-side reformat). Use `add_filter( 'fipos_enable_custom_time_slot_picker', '__return_false' )` to use the native slot dropdown.

= 0.1.1.7 =
* Single product: custom time-slot pill UI is disabled by default; native FooEvents slot select is shown. Use filter fipos_enable_custom_time_slot_picker to re-enable the grid.

= 0.1.1.6 =
* Storefront date-slot picker: show full display text (schedule name + time) on each pill; escape via .text(). Schedule generator: restore optional block "name" as slot label (with correct hour/minute/period key order) so native options include formatted time.
* Re-save the product schedule in Internal POS after upgrade.

= 0.1.1.5 =
* Schedule generator: use time (HH:MM) as the FooEvents slot label only; removed schedule "name" / category labels until the storefront flow is stable. Re-generate the schedule after upgrade.

= 0.1.1.4 =
* Slot generator: emit booking slot fields in the order FooEvents expects (hour/minute/period before add_time) so `formatted_time` is built and the storefront shows schedule name + time. After upgrade, re-save the schedule in Internal POS for each product that was generated with the old ordering.

= 0.1.1.0 =
* Initial MVP: event list, event detail, check availability, Tailwind + Vite + TanStack Query.
