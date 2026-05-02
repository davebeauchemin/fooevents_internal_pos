/**
 * Gate session selection + compare ticket booking vs selected session (Validate page).
 */

import { formatSlotTime } from '@/lib/slotHourGrouping';

export const VALIDATE_SESSION_STORAGE_KEY =
	'fooevents-internal-pos:validate-session-v1';

export type BookingSessionPayload = {
	eventId: number;
	slotId: string;
	dateId: string;
	dateYmd: string | null;
	time: string;
	dateLabel: string;
	slotLabel: string;
	startsAtLocal: string | null;
	source: string;
};

export type ValidateSessionPick = {
	viewDateYmd: string;
	eventId: number;
	eventTitle: string;
	slotId: string;
	dateId: string;
	slotLabel: string;
	slotTime: string;
	startsAtLocal: string | null;
};

export type DashboardSlotRow = {
	id: string;
	dateId: string;
	label: string;
	time: string;
	stock: number | null;
	startsAtLocal?: string | null;
};

export type DashboardDayResponse = {
	date: string;
	events: Array<{
		eventId: number;
		eventTitle: string;
		slots: DashboardSlotRow[];
	}>;
};

export type ValidateSessionDelta = {
	kind:
		| 'idle'
		| 'match'
		| 'earlier_session'
		| 'later_session'
		| 'wrong_event'
		| 'no_selection'
		| 'non_booking'
		| 'unresolved';
	offSession: boolean;
	detailLine: string;
	subtitleExtra: string;
	autoCheckInToast: string;
};

/** Visual cue on the scanned ticket card (maps to Tailwind in the UI layer). */
export type SessionTimingCueTone =
	| 'match'
	| 'future'
	| 'past'
	| 'wrong'
	| 'warn'
	| 'unknown'
	| 'neutral';

export type SessionTimingCue = {
	/** When false, hide the large ticket timing panel (e.g. non-booking ticket). */
	show: boolean;
	tone: SessionTimingCueTone;
	/** Short headline, e.g. “Past session”. */
	label: string;
	/** Supporting copy (often includes ~Xh Ym). */
	detail: string;
};

/**
 * Copy and tone for the prominent timing block on the ticket card.
 *
 * @param delta Output of `computeValidateSessionDelta`.
 */
export function getSessionTimingCue( delta: ValidateSessionDelta ): SessionTimingCue {
	if ( delta.kind === 'idle' || delta.kind === 'non_booking' ) {
		return {
			show: false,
			tone: 'neutral',
			label: '',
			detail: '',
		};
	}
	switch ( delta.kind ) {
		case 'match':
			return {
				show: true,
				tone: 'match',
				label: 'Current session',
				detail:
					delta.detailLine
					|| 'This ticket matches the selected gate session.',
			};
		case 'earlier_session':
			return {
				show: true,
				tone: 'past',
				label: 'Past session',
				detail:
					delta.detailLine
					|| delta.subtitleExtra
					|| 'Earlier than the selected gate — wrong line or old ticket.',
			};
		case 'later_session':
			return {
				show: true,
				tone: 'future',
				label: 'Future session',
				detail:
					delta.detailLine
					|| delta.subtitleExtra
					|| 'Later than the selected gate — too early to admit.',
			};
		case 'wrong_event':
			return {
				show: true,
				tone: 'wrong',
				label: 'Wrong event',
				detail:
					delta.detailLine
					|| 'This ticket is not for the event/session you selected at the gate.',
			};
		case 'no_selection':
			return {
				show: true,
				tone: 'warn',
				label: 'Select gate session',
				detail:
					delta.detailLine
					|| delta.subtitleExtra
					|| 'Choose the gate session above to compare this ticket.',
			};
		case 'unresolved':
			return {
				show: true,
				tone: 'unknown',
				label: 'Timing unclear',
				detail:
					delta.detailLine
					|| 'Could not compare start times — verify date and slot labels manually.',
			};
		default:
			return {
				show: false,
				tone: 'neutral',
				label: '',
				detail: '',
			};
	}
}

type TicketLike = {
	WooCommerceEventsProductID?: string;
	WooCommerceEventsBookingSlotID?: string | number;
	WooCommerceEventsBookingDateID?: string | number;
	eventDisplayName?: string;
	bookingSession?: BookingSessionPayload;
};

/** @param {unknown} v */
function normalizedBookingMetaId( v: unknown ): string {
	if ( v == null ) {
		return '';
	}
	return String( v ).trim();
}

export function ticketHasBookingSlotIds( ticket: TicketLike ): boolean {
	return (
		normalizedBookingMetaId( ticket.WooCommerceEventsBookingSlotID ) !== ''
		&& normalizedBookingMetaId( ticket.WooCommerceEventsBookingDateID ) !== ''
	);
}

export function formatMinutesAsDuration( mins: number ): string {
	const n = Math.max( 0, Math.round( mins ) );
	const h = Math.floor( n / 60 );
	const m = n % 60;
	if ( h === 0 ) {
		return `${ m }m`;
	}
	if ( m === 0 ) {
		return `${ h }h`;
	}
	return `${ h }h ${ m }m`;
}

export function validateSessionOptionKey( p: ValidateSessionPick ): string {
	return `${ p.viewDateYmd }::${ p.eventId }::${ p.slotId }::${ p.dateId }`;
}

export function flattenDashboardToSessionPicks(
	data: DashboardDayResponse | undefined,
): ValidateSessionPick[] {
	if ( ! data?.events?.length ) {
		return [];
	}
	const out: ValidateSessionPick[] = [];
	for ( const ev of data.events ) {
		for ( const s of ev.slots ) {
			out.push( {
				viewDateYmd: data.date,
				eventId: ev.eventId,
				eventTitle: ev.eventTitle,
				slotId: s.id,
				dateId: s.dateId,
				slotLabel: s.label,
				slotTime: formatSlotTime( s ),
				startsAtLocal: s.startsAtLocal ?? null,
			} );
		}
	}
	return out;
}

export function pickDefaultValidateSession(
	data: DashboardDayResponse,
	siteTodayYmd: string,
): ValidateSessionPick | null {
	const rows = flattenDashboardToSessionPicks( data );
	if ( ! rows.length ) {
		return null;
	}
	const sorted = [ ...rows ].sort( ( a, b ) => {
		const ta = a.startsAtLocal
			? new Date( a.startsAtLocal ).getTime()
			: Number.MAX_SAFE_INTEGER;
		const tb = b.startsAtLocal
			? new Date( b.startsAtLocal ).getTime()
			: Number.MAX_SAFE_INTEGER;
		return ta - tb;
	} );
	const now = Date.now();
	if ( data.date === siteTodayYmd ) {
		const upcoming = sorted.filter(
			( r ) =>
				r.startsAtLocal
				&& new Date( r.startsAtLocal ).getTime() >= now - 60_000,
		);
		return ( upcoming[ 0 ] ?? sorted[ 0 ] ) ?? null;
	}
	return sorted[ 0 ] ?? null;
}

export function readStoredValidateSessionPick(
	dayYmd: string,
	flat: ValidateSessionPick[],
): ValidateSessionPick | null {
	if ( typeof localStorage === 'undefined' || ! dayYmd ) {
		return null;
	}
	try {
		const raw = localStorage.getItem( VALIDATE_SESSION_STORAGE_KEY );
		if ( ! raw ) {
			return null;
		}
		const o = JSON.parse( raw ) as {
			viewDateYmd?: string;
			eventId?: number;
			slotId?: string;
			dateId?: string;
		};
		if ( o.viewDateYmd !== dayYmd || ! o.eventId || ! o.slotId || ! o.dateId ) {
			return null;
		}
		return (
			flat.find(
				( p ) =>
					p.viewDateYmd === o.viewDateYmd
					&& p.eventId === o.eventId
					&& p.slotId === o.slotId
					&& p.dateId === o.dateId,
			) ?? null
		);
	} catch {
		return null;
	}
}

export function writeStoredValidateSessionPick( p: ValidateSessionPick | null ) {
	if ( typeof localStorage === 'undefined' ) {
		return;
	}
	if ( ! p ) {
		localStorage.removeItem( VALIDATE_SESSION_STORAGE_KEY );
		return;
	}
	localStorage.setItem(
		VALIDATE_SESSION_STORAGE_KEY,
		JSON.stringify( {
			viewDateYmd: p.viewDateYmd,
			eventId: p.eventId,
			slotId: p.slotId,
			dateId: p.dateId,
		} ),
	);
}

export function computeValidateSessionDelta(
	ticket: TicketLike | undefined,
	selected: ValidateSessionPick | null,
): ValidateSessionDelta {
	const idle: ValidateSessionDelta = {
		kind: 'idle',
		offSession: false,
		detailLine: '',
		subtitleExtra: '',
		autoCheckInToast: '',
	};
	if ( ! ticket ) {
		return idle;
	}

	const productId = Number( ticket.WooCommerceEventsProductID ?? 0 );
	const hasBookingMeta = ticketHasBookingSlotIds( ticket );
	const bs = ticket.bookingSession;

	if ( ! hasBookingMeta && ( ! bs || bs.source === 'none' ) ) {
		return {
			kind: 'non_booking',
			offSession: false,
			detailLine: '',
			subtitleExtra: '',
			autoCheckInToast: '',
		};
	}

	if ( ! selected ) {
		return {
			kind: 'no_selection',
			offSession: true,
			detailLine:
				'Select the current gate session above to compare this ticket’s booking time.',
			subtitleExtra: 'Choose the gate session above to verify timing.',
			autoCheckInToast:
				'Select the current gate session, then try check-in scan again.',
		};
	}

	if ( productId > 0 && productId !== selected.eventId ) {
		return {
			kind: 'wrong_event',
			offSession: true,
			detailLine: `This ticket is for another event (${
				ticket.eventDisplayName ?? `product ${ productId }`
			}). Selected gate session is for a different product.`,
			subtitleExtra:
				'Wrong event for this gate — confirm manually before admitting.',
			autoCheckInToast:
				'Ticket is for another event — auto check-in paused.',
		};
	}

	const sid = normalizedBookingMetaId( ticket.WooCommerceEventsBookingSlotID );
	const did = normalizedBookingMetaId( ticket.WooCommerceEventsBookingDateID );
	if ( sid && did && sid === selected.slotId && did === selected.dateId ) {
		return {
			kind: 'match',
			offSession: false,
			detailLine: 'Booking matches the selected gate session.',
			subtitleExtra: '',
			autoCheckInToast: '',
		};
	}

	const tMs = bs?.startsAtLocal
		? new Date( bs.startsAtLocal ).getTime()
		: NaN;
	const sMs = selected.startsAtLocal
		? new Date( selected.startsAtLocal ).getTime()
		: NaN;

	if ( ! Number.isNaN( tMs ) && ! Number.isNaN( sMs ) ) {
		const diffMin = Math.round( ( tMs - sMs ) / 60_000 );
		if ( diffMin === 0 ) {
			return {
				kind: 'match',
				offSession: false,
				detailLine: 'Booking matches the selected gate session (same start time).',
				subtitleExtra: '',
				autoCheckInToast: '',
			};
		}
		if ( diffMin < 0 ) {
			const human = formatMinutesAsDuration( -diffMin );
			return {
				kind: 'earlier_session',
				offSession: true,
				detailLine: `Ticket is for an earlier session (${ human } before this gate time).`,
				subtitleExtra: `Earlier session by ~${ human } — wrong line or expired ticket.`,
				autoCheckInToast:
					'Ticket is for an earlier session — auto check-in paused.',
			};
		}
		const human = formatMinutesAsDuration( diffMin );
		return {
			kind: 'later_session',
			offSession: true,
			detailLine: `Ticket starts in ~${ human } (later than this gate session).`,
			subtitleExtra: `Do not admit early unless approved (~${ human } to go).`,
			autoCheckInToast:
				'Ticket is not for this session yet — auto check-in paused.',
		};
	}

	const ty = bs?.dateYmd ?? null;
	const sy = selected.viewDateYmd;
	if ( ty && sy && ty !== sy ) {
		return {
			kind: 'unresolved',
			offSession: false,
			detailLine: `Ticket day (${ ty }) differs from gate day (${ sy }).`,
			subtitleExtra: 'Different day — confirm booking manually.',
			autoCheckInToast: '',
		};
	}

	return {
		kind: 'unresolved',
		offSession: false,
		detailLine:
			'Could not compare exact session times — use booking labels and IDs.',
		subtitleExtra: '',
		autoCheckInToast: '',
	};
}
