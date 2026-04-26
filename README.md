# FooEvents Internal POS (MVP 1)

WordPress plugin: WooCommerce > **Internal POS** → full-screen React + REST (`internalpos/v1`).

## Requirements

- WooCommerce, FooEvents, FooEvents Bookings
- **Deploy:** `app/public/dist` is the Vite build output and must be present (run `npm run build` in `app/`). Git Updater pulls the repo; it does not run `npm` on the server.

## Local development

1. Symlink or copy `fooevents_internal_pos` into `wp-content/plugins/`.
2. `cd app && npm install && npm run build` then reload the Internal POS page.
3. For Vite dev (optional): set `VITE_WORDPRESS_URL` and `VITE_WP_REST_NONCE` in `app/.env` and open Vite; most workflows use a local WP + rebuild instead.

## Release (Git Updater)

1. `npm run build` in `app/`
2. Bump `Version` in `fooevents-internal-pos.php` and this readme
3. Commit and push; Git Updater shows an update in **Dashboard > Updates**

## REST

- `GET /wp-json/internalpos/v1/events`
- `GET /wp-json/internalpos/v1/events/{id}`
- `POST /wp-json/internalpos/v1/availability` — JSON: `{ "eventId", "slotId", "dateId", "qty" }`
- Auth: logged-in user with `manage_woocommerce` and `X-WP-Nonce` (set by the page template)
