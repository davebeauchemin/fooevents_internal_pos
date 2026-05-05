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

/**
 * Minutes since midnight for the site’s civil time encoded in `siteNowLocal` (the `T…` segment
 * before the offset), not the browser’s timezone.
 */
export function siteMinutesSinceMidnightFromWpNowLocal( isoRaw: unknown ): number | null {
	const iso = typeof isoRaw === 'string' ? isoRaw.trim() : '';
	const m = iso.match( /T(\d{1,2}):(\d{2}):(\d{2})/ );
	if ( ! m ) {
		return null;
	}
	const h = parseInt( m[ 1 ], 10 );
	const min = parseInt( m[ 2 ], 10 );
	if ( h < 0 || h > 23 || min < 0 || min > 59 ) {
		return null;
	}
	return h * 60 + min;
}
