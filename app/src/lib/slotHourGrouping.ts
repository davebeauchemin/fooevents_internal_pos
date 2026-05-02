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

export function formatSlotTime( slot: Pick<SlotLike, 'label' | 'time' | 'stock' > ) {
	if ( slot.time && /^\d{1,2}:\d{2}$/.test( slot.time.trim() ) ) {
		return slot.time.trim();
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
 * When the calendar is on “today” (`viewYmd === siteTodayYmd`), remove hour buckets that
 * fall before the browser’s current clock hour (whole hours 0–23). Other days unchanged.
 */
export function hidePastHourBucketsForToday(
	groups: HourSlotGroup[],
	viewYmd: string,
	siteTodayYmd: string,
): HourSlotGroup[] {
	if ( viewYmd !== siteTodayYmd || groups.length === 0 ) {
		return groups;
	}
	const currentHour = new Date().getHours();
	return groups.filter( ( g ) => g.hour >= currentHour );
}

export function hourBucketIsPastForToday(
	group: Pick<HourSlotGroup, 'hour'>,
	viewYmd: string,
	siteTodayYmd: string,
): boolean {
	return viewYmd === siteTodayYmd && group.hour < new Date().getHours();
}

/**
 * Hour bucket (`g.key`) to open first: viewing “today” uses the browser’s local hour,
 * then next bucket ≥ that hour; other days opens the earliest hour group.
 */
export function defaultAccordionHourKey(
	groups: HourSlotGroup[],
	viewYmd: string,
	siteTodayYmd: string,
) {
	if ( groups.length === 0 ) {
		return undefined;
	}
	if ( viewYmd !== siteTodayYmd ) {
		return groups[ 0 ].key;
	}
	const nowHour = new Date().getHours();
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
