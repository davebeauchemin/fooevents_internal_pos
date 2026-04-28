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

export function hourRangeTitle( hour: number ) {
	return `${ String( hour ).padStart( 2, '0' ) }:00 – ${ String( hour ).padStart( 2, '0' ) }:59`;
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
