# FooEvents Internal POS (MVP 1)

WordPress plugin: wp-admin top-level **Internal POS** → full-screen React at **`/internal-pos/`** (virtual route) + REST (`internalpos/v1`).

## Requirements

- WooCommerce, FooEvents, FooEvents Bookings
- **Deploy:** `public/dist` is the Vite build output and must be present (run `npm run build` in `app/`). Git Updater pulls the repo; it does not run `npm` on the server.

## Local development against a remote WordPress (no local WP)

Use a [WordPress Application Password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration/) and the Vite dev proxy so the browser stays on `localhost` (no CORS, no secrets in the bundle).

1. On the live site: **Users → Profile → Application Passwords** (or your profile on `kaboommontreal.com`) → create e.g. `Internal POS Local Dev` and copy the password once.
2. In `app/`, copy the example env and fill in values:

   ```bash
   cp .env.local.example .env.local
   ```

   Set `VITE_WP_REMOTE` to your site origin (no trailing slash), `VITE_WP_APP_USER` and `VITE_WP_APP_PASS` (spaces in the password are fine). Keep `VITE_WORDPRESS_URL=/wp-json/` and `VITE_APP_BASENAME=/`.
3. **The user must have** `manage_woocommerce` (e.g. Administrator or Shop Manager).
4. Run the app:

   ```bash
   cd app && npm install && npm run dev
   ```

5. Open the URL Vite prints (default `http://localhost:5173/`). Dev mode uses Vite `base: /` so it matches `VITE_APP_BASENAME=/` in `.env.local`. API calls go to `http://localhost:5173/wp-json/...`; Vite forwards them to `VITE_WP_REMOTE` and adds `Authorization: Basic ...` on the server side.

`.env.local` is gitignored. Never commit it.

### How it works

- **Production** (virtual route `/internal-pos/`): path-based client URLs (`/internal-pos/`, `/internal-pos/calendar`, `/internal-pos/checkout`, `/internal-pos/validate`, etc.). `localStorage.WORDPRESS_URL` + `X-WP-Nonce` from the PHP template; no App Password.
- **Local Vite**: `VITE_WORDPRESS_URL=/wp-json/` + proxy + App Password; `X-WP-Nonce` is omitted when unset.

### Validate the Application Password (bypass the proxy)

From your machine, with the same user and app password you put in `.env.local`:

```bash
# Replace USER, PASS (spaces OK), and SITE (https, no trailing slash).
curl -i -u "USER:PASS" "https://SITE/wp-json/internalpos/v1/events"
```

- **200** and JSON — credentials and route are fine. If the browser still shows 400, the Vite proxy was forwarding headers; the dev server strips `Cookie` / `Origin` / `Referer` to reduce WAF blocks — check the terminal for `[proxy →]` and `[proxy ←]` lines.
- **401** — wrong user/password or invalid Application Password. Create a new app password in WP and update `.env.local`.
- **403** — user lacks `manage_woocommerce` and `publish_fooeventspos` (POS cashier), or REST route is blocked.
- **400** on curl too — host/CDN (try from another network, or check Cloudflare / security plugin rules for REST).

### Plugin-in-`wp-content` workflow (optional)

You can still symlink `fooevents_internal_pos` into `wp-content/plugins/` and run `npm run build` to test the embedded build on a local WP site.

## Storefront (single product + cart)

The plugin enqueues `public/frontend/css|js` on single product and on cart/checkout (slot line formatting + Woo button styling). On the product page, the **custom time-slot pill grid is on by default** (same text as the native FooEvents slot options, without reformatting). To use the native slot `<select>` only: `add_filter( 'fipos_enable_custom_time_slot_picker', '__return_false' );`. If you still enqueue the same files from a child theme, remove the duplicate enqueues to avoid double-loading.

**Dynamic bundle pricing:** On **WooCommerce → Products → [product] → Product data → General**, enable **Show dynamic bundle pricing** for a FooEvents booking product. Tier chip text (e.g. 2 tickets for $X) is computed from the product price and active storefront **bundle tier** coupons (fixed cart discount = discount per bundle). Each tier renders as its own chip with classes `fipos-dynamic-bundle-pricing__badge btn btn--primary` (Automatic.css). Clicking a chip sets the native WooCommerce quantity input to that tier size, clamps to the input min/max/step, and syncs `is-selected` / `aria-pressed` with manual quantity changes. Override chip classes via `add_filter( 'fipos_dynamic_bundle_pricing_badge_classes', … )`. The bundle group uses `fipos-dynamic-bundle-pricing--below-price` and is laid out on a full-width row under the WooCommerce price. Use shortcode `[fipos_dynamic_bundle_pricing]` in the page builder, or rely on the default append after the WooCommerce price on the main single product. When appended, the extra “$X / person” line is omitted so the price is not duplicated; the shortcode still shows it by default. To show only the shortcode line: `add_filter( 'fipos_dynamic_bundle_pricing_append_to_price_html', '__return_false' );`. To force the per-person line after the main price too: `add_filter( 'fipos_dynamic_bundle_pricing_show_base', function ( $show, $product, $context ) { return 'append' === $context ? true : $show; }, 10, 3 );`. Shortcode: `[fipos_dynamic_bundle_pricing show_base="no"]` hides the base in the shortcode output. Full-page caches may need purging after coupon amount changes.

## Release (Git Updater)

1. `npm run build` in `app/`
2. Bump `Version` in `fooevents-internal-pos.php` and `Stable tag` / changelog in `readme.txt`
3. Commit and push; Git Updater shows an update in **Dashboard → Updates**

After upgrading to **0.1.1.4+**, if you used the schedule generator before that release, open **Internal POS → Schedule** for each affected product and **Save schedule** once so serialized slot meta is rewritten with the correct key order. **0.1.1.5+** addressed time-only slot labels; **0.1.1.6+** restores optional schedule block names and improves the storefront pill text. Re-save the schedule after upgrade.

## REST

- `GET /wp-json/internalpos/v1/events`
- `GET /wp-json/internalpos/v1/events/{id}`
- `POST /wp-json/internalpos/v1/availability` — JSON: `{ "eventId", "slotId", "dateId", "qty" }`
- **Production** auth: logged-in user with `publish_fooeventspos` or `manage_woocommerce` + `X-WP-Nonce` (set by the page template)
- **Local dev** auth: same capability via Application Password (Basic auth on the proxied request)

## Staff login redirect (FooEvents POS cashier → Internal POS)

WooCommerce / core login redirects for **FooEvents POS cashier** (`fooeventspos_cashier`), **WooCommerce shop manager** (`shop_manager`), and **Check-in Validator** (default slug guesses `check_in_validator` or `check-in-validator`) go to Internal POS instead of the default WooCommerce/account or FooEvents POS URL.

- Cashiers → `/internal-pos/`
- Shop managers → `/internal-pos/` after login only (they still have full **wp-admin**; `block_admin: false` on that rule)
- Check-in Validator → `/internal-pos/validate/`

If your check-in role slug differs, override the third rule (index `2`), e.g.:

```php
add_filter( 'fooevents_internal_pos_login_redirect_rules', function ( $rules ) {
	$rules[2]['roles'] = array( 'your_actual_role_slug' );
	return $rules;
} );
```

To **also** block shop managers from wp-admin and always send them to Internal POS (usually a bad idea), set `$rules[1]['block_admin'] = true` on the shop manager rule.

Disable all such redirects:

```php
add_filter( 'fooevents_internal_pos_redirect_staff_to_internal_pos', '__return_false' );
```
