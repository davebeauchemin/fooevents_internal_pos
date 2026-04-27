# FooEvents Internal POS (MVP 1)

WordPress plugin: WooCommerce > **Internal POS** → full-screen React + REST (`internalpos/v1`).

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

- **Production** (WordPress page `/internal-pos/`): `localStorage.WORDPRESS_URL` + `X-WP-Nonce` from the PHP template; no App Password.
- **Local Vite**: `VITE_WORDPRESS_URL=/wp-json/` + proxy + App Password; `X-WP-Nonce` is omitted when unset.

### Validate the Application Password (bypass the proxy)

From your machine, with the same user and app password you put in `.env.local`:

```bash
# Replace USER, PASS (spaces OK), and SITE (https, no trailing slash).
curl -i -u "USER:PASS" "https://SITE/wp-json/internalpos/v1/events"
```

- **200** and JSON — credentials and route are fine. If the browser still shows 400, the Vite proxy was forwarding headers; the dev server strips `Cookie` / `Origin` / `Referer` to reduce WAF blocks — check the terminal for `[proxy →]` and `[proxy ←]` lines.
- **401** — wrong user/password or invalid Application Password. Create a new app password in WP and update `.env.local`.
- **403** — user lacks `manage_woocommerce`.
- **400** on curl too — host/CDN (try from another network, or check Cloudflare / security plugin rules for REST).

### Plugin-in-`wp-content` workflow (optional)

You can still symlink `fooevents_internal_pos` into `wp-content/plugins/` and run `npm run build` to test the embedded build on a local WP site.

## Release (Git Updater)

1. `npm run build` in `app/`
2. Bump `Version` in `fooevents-internal-pos.php` and `readme.txt`
3. Commit and push; Git Updater shows an update in **Dashboard → Updates**

## REST

- `GET /wp-json/internalpos/v1/events`
- `GET /wp-json/internalpos/v1/events/{id}`
- `POST /wp-json/internalpos/v1/availability` — JSON: `{ "eventId", "slotId", "dateId", "qty" }`
- **Production** auth: logged-in user with `manage_woocommerce` + `X-WP-Nonce` (set by the page template)
- **Local dev** auth: same capability via Application Password (Basic auth on the proxied request)
