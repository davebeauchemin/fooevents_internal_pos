/**
 * Helpers for payloads where WordPress emits `siteNowLocal` as ISO-8601 in the site TZ.
 */

/** Y-m-d from `siteNowLocal` — substring before `T` matches WP’s calendar day for that stamp. */
export function siteYmdPrefixFromWpNowLocal( isoRaw: unknown ): string | null {
	const iso = typeof isoRaw === 'string' ? isoRaw.trim() : '';
	const m = iso.match( /^(\d{4}-\d{2}-\d{2})T/ );
	const y = m?.[ 1 ];
	return y && /^\d{4}-\d{2}-\d{2}$/.test( y ) ? y : null;
}

export function siteUnixMsFromWpNowLocal( isoRaw: unknown ): number | undefined {
	const iso = typeof isoRaw === 'string' ? isoRaw.trim() : '';
	if ( ! iso ) {
		return undefined;
	}
	const ms = Date.parse( iso );
	return Number.isFinite( ms ) ? ms : undefined;
}
