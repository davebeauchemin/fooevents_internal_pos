/**
 * Group booking slots by clock hour (0–23) for schedule UIs (dashboard, event day).
 */

export type SlotLike = {
	id: string;
	label: string;
	/** 24h HH:MM or empty — depends on API */
	time?: string;
	stock: number | null;
	dateId?: string;
};

/** Clock time to 24h HH:MM (handles optional seconds as from <input type="time"> or APIs). */
function normHhmm( hhmm: string ): string | null {
	const m = hhmm.trim().match( /^(\d{1,2}):(\d{2})(?::\d{1,2})?$/ );
	if ( ! m ) {
		return null;
	}
	const h = parseInt( m[ 1 ], 10 );
	const min = parseInt( m[ 2 ], 10 );
	if ( h < 0 || h > 23 || min < 0 || min > 59 ) {
		return null;
	}
	return `${ String( h ).padStart( 2, '0' ) }:${ String( min ).padStart( 2, '0' ) }`;
}

/** Exported for form submit — ensures REST receives strict HH:MM. */
export function normalizeTimeInputToHhmm( raw: string ): string | null {
	return normHhmm( raw );
}

export function formatSlotTime( slot: Pick<SlotLike, 'label' | 'time' | 'stock' > ) {
	if ( slot.time ) {
		const fromTime = normHhmm( slot.time.trim() );
		if ( fromTime ) {
			return fromTime;
		}
	}
	/** 12h with optional a.m. / p.m. */
	const m = slot.label.match(
		/(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m|AM|PM|am|pm|a\.m\.|p\.m\.)?)/i,
	);
	if ( m ) {
		return m[ 1 ].replace( /\s+/g, ' ' ).trim();
	}
	return '—';
}

/** Start time as minutes since midnight (0–1439), or null if not parseable. */
export function slotStartMinutesSinceMidnight(
	slot: Pick<SlotLike, 'label' | 'time'>,
): number | null {
	const hhmm = slotNormHhmm( slot as Pick<SlotLike, 'label' | 'time' | 'stock'> );
	if ( ! hhmm ) {
		return null;
	}
	const [ hs, ms ] = hhmm.split( ':' );
	const h = parseInt( hs, 10 );
	const m = parseInt( ms, 10 );
	if ( h < 0 || h > 23 || m < 0 || m > 59 ) {
		return null;
	}
	return h * 60 + m;
}

function slotNormHhmm( slot: Pick< SlotLike, 'label' | 'time' | 'stock' > ): string | null {
	const fromTime = normHhmm( ( slot.time ?? '' ).trim() );
	if ( fromTime ) {
		return fromTime;
	}
	const ft = formatSlotTime( slot );
	if ( ft && ft !== '—' ) {
		const n = normHhmm( ft );
		if ( n ) {
			return n;
		}
		const m12 = ft.match( /^(\d{1,2}):(\d{2})\s*([ap])(?:\.\s*m|m\.?)?\.?/i );
		if ( m12 ) {
			let h = parseInt( m12[ 1 ], 10 );
			const min = parseInt( m12[ 2 ], 10 );
			const ap = m12[ 3 ].toLowerCase();
			if ( ap === 'p' && h !== 12 ) {
				h += 12;
			}
			if ( ap === 'a' && h === 12 ) {
				h = 0;
			}
			return normHhmm( `${ h }:${ min }` );
		}
	}
	return null;
}

function primaryHhmmFromSlotLabel( label: string ): string | null {
	const m = label.trim().match( /^(\d{1,2}):(\d{2})\b/ );
	return m ? normHhmm( `${ m[ 1 ] }:${ m[ 2 ] }` ) : null;
}

/**
 * Whether a manual add for this calendar day would duplicate an existing slot–date cell.
 * With an empty schedule label, any session at the same start time counts as duplicate (one row per time).
 * With a label set, overlaps server-ish semantics (same time + same / compatible name).
 */
export function manualSlotWouldDuplicateExisting(
	existingSlots: SlotLike[],
	manualTimeHhmm: string,
	manualLabel: string,
): boolean {
	const mh = normHhmm( manualTimeHhmm.trim() );
	if ( ! mh ) {
		return false;
	}
	const manualName = manualLabel.trim().toLowerCase();
	const manualEff = manualName || mh.toLowerCase();

	for ( const s of existingSlots ) {
		const sh = slotNormHhmm( s );
		if ( ! sh || sh !== mh ) {
			continue;
		}
		if ( manualName === '' ) {
			return true;
		}
		const sLab = ( s.label ?? '' ).trim();
		if ( ! sLab ) {
			if ( manualEff === mh.toLowerCase() ) {
				return true;
			}
			continue;
		}
		const sEff = sLab.toLowerCase();
		if ( manualEff === sEff ) {
			return true;
		}
		if ( manualEff === mh.toLowerCase() ) {
			if ( sEff.startsWith( mh.toLowerCase() ) ) {
				return true;
			}
			const lead = primaryHhmmFromSlotLabel( sLab );
			if ( lead === mh ) {
				return true;
			}
		}
	}
	return false;
}

/** Stable Select value for a slot + date cell (manual stock UI). */
export function encodeManualSlotDateRef( slot: Pick< SlotLike, 'id' > & { dateId?: string } ): string {
	return JSON.stringify( [
		String( slot.id ?? '' ).trim(),
		String( slot.dateId ?? '' ).trim(),
	] );
}

export function decodeManualSlotDateRef( v: string ): { slotId: string; dateId: string } | null {
	try {
		const a = JSON.parse( v ) as unknown;
		if ( ! Array.isArray( a ) || a.length < 2 ) {
			return null;
		}
		const slotId = String( a[ 0 ] ?? '' ).trim();
		const dateId = String( a[ 1 ] ?? '' ).trim();
		if ( ! slotId || ! dateId ) {
			return null;
		}
		return { slotId, dateId };
	} catch {
		return null;
	}
}

/**
 * 24h hour 0–23, or null.
 */
function parseTimeHour( raw: string ): number | null {
	const t = raw.replace( /\s+/g, ' ' ).trim();
	if ( ! t || t === '—' ) {
		return null;
	}
	const m24 = t.match( /^(\d{1,2}):(\d{2})$/ );
	if ( m24 ) {
		const h = parseInt( m24[ 1 ], 10 );
		if ( h >= 0 && h < 24 ) {
			return h;
		}
	}
	const m12 = t.match(
		/^(\d{1,2}):(\d{2})\s*([ap])(?:\.\s*m|m\.?)?\.?/i,
	);
	if ( m12 ) {
		let h = parseInt( m12[ 1 ], 10 );
		const ap = m12[ 3 ].toLowerCase();
		if ( ap === 'p' && h !== 12 ) {
			h += 12;
		}
		if ( ap === 'a' && h === 12 ) {
			h = 0;
		}
		if ( h >= 0 && h < 24 ) {
			return h;
		}
	}
	return null;
}

function parseTimeHourLoose( blob: string ): number | null {
	const s = blob.replace( /\s+/g, ' ' );
	const m = s.match(
		/\b(\d{1,2}:\d{2}\s*(?:[ap](?:\.\s*m|m)\.?|AM|PM|am|pm)?)/i,
	);
	if ( m ) {
		return parseTimeHour( m[ 1 ].trim() );
	}
	return null;
}

function hourBucketForSlot( slot: SlotLike ): { hour: number; key: string } {
	if ( slot.time && /^\d{1,2}:\d{2}$/.test( slot.time.trim() ) ) {
		const p = parseTimeHour( slot.time.trim() );
		if ( p !== null ) {
			return { hour: p, key: String( p ).padStart( 2, '0' ) };
		}
	}
	const t = formatSlotTime( slot );
	let h = parseTimeHour( t );
	if ( h !== null ) {
		return { hour: h, key: String( h ).padStart( 2, '0' ) };
	}
	const combined = [ slot.time, slot.label ].filter( Boolean ).join( ' ' );
	h = parseTimeHourLoose( combined );
	if ( h !== null ) {
		return { hour: h, key: String( h ).padStart( 2, '0' ) };
	}
	const m = combined.match( /\b(\d{1,2}):(\d{2})\b/ );
	if ( m ) {
		const hh = parseInt( m[ 1 ], 10 );
		if ( hh >= 0 && hh < 24 ) {
			return { hour: hh, key: String( hh ).padStart( 2, '0' ) };
		}
	}
	return { hour: 0, key: '00' };
}

export type HourSlotGroup = {
	hour: number;
	key: string;
	slots: SlotLike[];
};

export function groupSlotsByHour( slots: SlotLike[] ): HourSlotGroup[] {
	const sorted = [ ...slots ].sort( ( a, b ) =>
		formatSlotTime( a ).localeCompare( formatSlotTime( b ) ),
	);
	const map = new Map<string, HourSlotGroup>();
	for ( const s of sorted ) {
		const { hour, key } = hourBucketForSlot( s );
		const prev = map.get( key );
		if ( prev ) {
			prev.slots.push( s );
		} else {
			map.set( key, { hour, key, slots: [ s ] } );
		}
	}
	return [ ...map.values() ].sort( ( a, b ) => a.hour - b.hour );
}

/**
 * Resolved site clock hour 0–23 from backend, or null if unknown / invalid.
 */
function resolvedSiteHour(
	siteCurrentHour: number | null | undefined,
): number | null {
	if (
		siteCurrentHour === null ||
		siteCurrentHour === undefined ||
		siteCurrentHour !== siteCurrentHour
	) {
		return null;
	}
	const n = Number( siteCurrentHour );
	if ( Number.isFinite( n ) && n >= 0 && n <= 23 ) {
		return Math.trunc( n );
	}
	return null;
}

/**
 * When the calendar is on “today” (`viewYmd === siteTodayYmd`), remove hour buckets that
 * fall before the site clock hour (`siteCurrentHour`). If unknown, buckets are unchanged.
 */
export function hidePastHourBucketsForToday(
	groups: HourSlotGroup[],
	viewYmd: string,
	siteTodayYmd: string,
	siteCurrentHour?: number | null,
): HourSlotGroup[] {
	if ( viewYmd !== siteTodayYmd || groups.length === 0 ) {
		return groups;
	}
	const h = resolvedSiteHour( siteCurrentHour );
	if ( h === null ) {
		return groups;
	}
	return groups.filter( ( g ) => g.hour >= h );
}

export function hourBucketIsPastForToday(
	group: Pick<HourSlotGroup, 'hour'>,
	viewYmd: string,
	siteTodayYmd: string,
	siteCurrentHour?: number | null,
): boolean {
	if ( viewYmd !== siteTodayYmd ) {
		return false;
	}
	const h = resolvedSiteHour( siteCurrentHour );
	if ( h === null ) {
		return false;
	}
	return group.hour < h;
}

/**
 * Hour bucket (`g.key`) to open first: viewing “today” uses the site clock hour,
 * then next bucket ≥ that hour; other days opens the earliest hour group.
 */
export function defaultAccordionHourKey(
	groups: HourSlotGroup[],
	viewYmd: string,
	siteTodayYmd: string,
	siteCurrentHour?: number | null,
) {
	if ( groups.length === 0 ) {
		return undefined;
	}
	if ( viewYmd !== siteTodayYmd ) {
		return groups[ 0 ].key;
	}
	const h = resolvedSiteHour( siteCurrentHour );
	if ( h === null ) {
		return groups[ 0 ].key;
	}
	const nowHour = h;
	const exact = groups.find( ( g ) => g.hour === nowHour );
	if ( exact ) {
		return exact.key;
	}
	const next = groups.find( ( g ) => g.hour >= nowHour );
	if ( next ) {
		return next.key;
	}
	return undefined;
}

export function hourRangeTitle( hour: number ) {
	return `${ String( hour ).padStart( 2, '0' ) }:00 – ${ String( hour ).padStart( 2, '0' ) }:59`;
}

/** Past days and zero-stock slots are not selectable for booking. */
export function slotSelectable(
	viewDateYmd: string,
	remaining: number | null,
	siteTodayYmd: string,
) {
	if ( viewDateYmd < siteTodayYmd ) {
		return false;
	}
	if ( remaining !== null && remaining !== undefined && remaining <= 0 ) {
		return false;
	}
	return true;
}

/**
 * Slot is bookable for the viewed day and has enough remaining tickets for the requested qty.
 * Unlimited stock (`null`) always satisfies any positive qty when otherwise selectable.
 */
export function slotMeetsTicketQuantity(
	viewDateYmd: string,
	stock: number | null,
	siteTodayYmd: string,
	ticketQty: number,
) {
	if ( ! slotSelectable( viewDateYmd, stock, siteTodayYmd ) ) {
		return false;
	}
	if ( ticketQty < 1 ) {
		return false;
	}
	if ( stock === null || stock === undefined ) {
		return true;
	}
	return stock >= ticketQty;
}

/** Total remaining stock for a set of slots; "Unlimited" if any slot is unlimited. */
export function capacityLabelForSlots( slots: Pick<SlotLike, 'stock' >[] ) {
	if ( ! slots.length ) {
		return '—';
	}
	if ( slots.some( ( s ) => s.stock === null || s.stock === undefined ) ) {
		return 'Unlimited';
	}
	return String( slots.reduce( ( a, s ) => a + ( s.stock as number ), 0 ) );
}

/**
 * Phrase for UI badges: "60 left", "Unlimited", "0 left".
 */
export function hourRemainingSpotsLabel( slots: Pick<SlotLike, 'stock' >[] ) {
	if ( ! slots.length ) {
		return '—';
	}
	if ( slots.some( ( s ) => s.stock === null || s.stock === undefined ) ) {
		return 'Unlimited';
	}
	const total = slots.reduce( ( a, s ) => a + ( s.stock as number ), 0 );
	return `${ total } left`;
}
