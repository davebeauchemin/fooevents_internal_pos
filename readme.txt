=== FooEvents Internal POS ===
Contributors: TBD
Tags: fooevents, woocommerce, pos, bookings
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.1.2.9
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Internal point-of-sale for FooEvents Bookings at /internal-pos/. Cashiers and shop managers can take bookings, validate and check in tickets, and generate slot schedules from a single React-powered dashboard. Built on FooEvents, FooEvents Bookings, and WooCommerce.

== Description ==

Internal point-of-sale for FooEvents Bookings at /internal-pos/. Cashiers and shop managers can take bookings, validate and check in tickets, and generate slot schedules from a single React-powered dashboard. Built on FooEvents, FooEvents Bookings, and WooCommerce.

Regional reporting (postal codes): checkout captures a billing postal/ZIP code for each POS booking. WooCommerce stores this in the native billing_postcode field (postmeta key _billing_postcode), so POS and storefront orders can be analyzed together. Internal POS orders also set order meta _fooevents_internal_pos_postal_code (same value) and _fooevents_internal_pos_postal_code_source = manual_pos to identify cashier-entered values. Values are trimmed and sanitized only (no enforced format).

Coupons (WooCommerce): each coupon lists a **FooEvents POS / storefront** panel in WooCommerce > Marketing > Coupons: **Auto-apply** (`Off`, `Internal POS checkout`, `Storefront checkout`, or `both`), **Channel restriction** (`both`, **POS only**, **Storefront only**), optional **Bundle tier** with **Tickets per bundle**. Bundle tiers stack as multiple WooCommerce cart/order fees (one line per grouped pack across total FooEvents booking ticket qty—largest tiers first—so e.g. 8 tickets applies two× four-packs). Tier amounts must use **Fixed cart discount** in WooCommerce.

Checkout preview (`POST checkout/preview`) and bookings accept `couponCodes` for cashier-entered codes. Tier codes entered manually are skipped (tier fees still apply).

Advanced fallback: legacy auto codes for POS-only `apply_coupon` flow may still merge via PHP filter:

`add_filter( 'fooevents_internal_pos_auto_coupon_codes', function ( $codes ) { return array_merge( (array) $codes, array( 'SUMMER10' ) ); } );`

Alter bundle tier rows programmatically via `fooevents_internal_pos_bundle_tiers`.

Single product: enable **Show dynamic bundle pricing** under **Product data → General** on a FooEvents booking product to list package prices from storefront bundle-tier coupons (`[fipos_dynamic_bundle_pricing]` or appended after the WooCommerce price on the main product). Changing the product price or a coupon’s fixed cart discount updates the display. Full-page caches may need a purge after coupon edits.

== Installation ==

1. Install WooCommerce, FooEvents, and FooEvents Bookings.
2. Upload the plugin or clone into wp-content/plugins/fooevents_internal_pos
3. Activate. The POS app is served at the virtual URL `/internal-pos/` (rewrite rules are registered on activation).
4. For Git Updater: set the GitHub Plugin URI in the main plugin file header, push public repo, install Git Updater on the site, bump Version on each release.

== Changelog ==

= 0.1.2.9 =
* Storefront: dynamic bundle pricing outputs separate elements per tier (`.fipos-dynamic-bundle-pricing__badge`), pill styling via `css/bundle-pricing.css` on single product.

= 0.1.2.8 =
* Storefront: product-level **Show dynamic bundle pricing** (General tab); shortcode `[fipos_dynamic_bundle_pricing]` and optional append after native single-product price from storefront bundle-tier coupons.

= 0.1.2.1 =
* Admin: top-level **Internal POS** menu (visible to shop managers and FooEvents POS cashiers).
* Front: POS is a virtual `/internal-pos/` route (no WordPress Page required); deep links under `/internal-pos/*` load the SPA.

= 0.1.1.20 =
* POS checkout: WooCommerce coupons—auto-apply codes via `fooevents_internal_pos_auto_coupon_codes` filter; manual `couponCodes` on checkout preview and bookings; validated amounts and coupon lines persisted on POS orders via `$order->apply_coupon()` / WooCommerce totals.
* POS checkout: require billing postal code; REST accepts billing.postalCode; orders save WooCommerce billing_postcode plus _fooevents_internal_pos_postal_code and _fooevents_internal_pos_postal_code_source for reporting.
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
