import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
	useAddManualSlot,
	useAddSlotStock,
	useEvent,
	useGenerateSlots,
	invalidateInternalPosAfterSlotWrites,
	subtractSlotStockViaRest,
} from '@/api/queries.js';
import { restFetch } from '@/api/client.js';
import {
	decodeManualSlotDateRef,
	encodeManualSlotDateRef,
	formatSlotTime,
	manualSlotWouldDuplicateExisting,
	normalizeTimeInputToHhmm,
	slotMatchesBulkRemoveTimeOnly,
	type SlotLike,
	planTargetTotalCapacityRemoval,
} from '@/lib/slotHourGrouping';
import { siteYmdPrefixFromWpNowLocal } from '@/lib/wpSiteClock';

/** Y-m-d in the browser's local calendar (never use toISOString().slice — that is UTC). */
function dateToLocalYmd( d: Date ): string {
	return (
		d.getFullYear()
		+ '-'
		+ String( d.getMonth() + 1 ).padStart( 2, '0' )
		+ '-'
		+ String( d.getDate() ).padStart( 2, '0' )
	);
}

export type ScheduleBlock = {
	id: string;
	name: string;
	startDate: string;
	endDate: string;
	weekdays: number[];
	openTime: string;
	closeTime: string;
};

/** One slot–date cell identified for bulk removal. */
export type BulkRemoveTarget = {
	slotId: string;
	dateId: string;
	ymd: string;
};

/** One slot–date cell with per-cell stock reduction for bulk reduce. */
export type BulkReduceStockTarget = {
	slotId: string;
	dateId: string;
	ymd: string;
	currentStock: number;
	removeSpots: number;
	bookedCount?: number;
	currentTotal?: number;
	bookedOverTarget?: boolean;
	targetTotalCapacity?: number;
};

export type BulkReduceStockPreview = {
	targets: BulkReduceStockTarget[];
	skippedUnlimited: number;
	skippedZero: number;
	skippedAtOrBelowTarget: number;
	skippedMissingBookedData: number;
	bookedOverTargetSessions: number;
	totalSpotsRemoved: number;
};

export type BulkReduceComputationMode =
	| { kind: 'fixedRemove'; requestedRemovePerCell: number }
	| { kind: 'targetTotal'; targetTotal: number };

function newId() {
	return typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: String( Date.now() ) + Math.random().toString( 16 ).slice( 2 );
}

function emptyBlock( blockIndex: number ): ScheduleBlock {
	return {
		id: newId(),
		name: blockIndex === 0 ? 'Regular' : 'Late',
		startDate: dateToLocalYmd( new Date() ),
		endDate: dateToLocalYmd( new Date() ),
		weekdays: [ 1, 2, 3, 4, 5 ],
		openTime: '09:00',
		closeTime: '17:00',
	};
}

function bumperPresetBlocks(): ScheduleBlock[] {
	return [
		{
			id: newId(),
			name: 'Regular',
			startDate: '2026-05-07',
			endDate: '2026-06-23',
			weekdays: [ 1, 2, 3, 4 ],
			openTime: '11:00',
			closeTime: '19:00',
		},
		{
			id: newId(),
			name: 'Late',
			startDate: '2026-05-07',
			endDate: '2026-06-23',
			weekdays: [ 5, 6, 7 ],
			openTime: '11:00',
			closeTime: '20:00',
		},
	];
}

function parseHHMM( s: string ) {
	const m = String( s ).trim().match( /^(\d{1,2}):(\d{2})$/ );
	if ( ! m ) {
		return null;
	}
	const h = parseInt( m[ 1 ], 10 );
	const mm = parseInt( m[ 2 ], 10 );
	if ( h < 0 || h > 23 || mm < 0 || mm > 59 ) {
		return null;
	}
	return h * 60 + mm;
}

function toHHMM( minutes: number ) {
	const h = Math.floor( minutes / 60 );
	const mm = minutes % 60;
	return String( h ).padStart( 2, '0' ) + ':' + String( mm ).padStart( 2, '0' );
}

function parseLocalYmd( ymd: string ): Date | undefined {
	const m = ymd.trim().match( /^(\d{4})-(\d{2})-(\d{2})$/ );
	if ( ! m ) {
		return undefined;
	}
	return new Date( Number( m[ 1 ] ), Number( m[ 2 ] ) - 1, Number( m[ 3 ] ), 12, 0, 0, 0 );
}

function listDates( start: string, end: string, weekdays: number[] ) {
	const wset = new Set( weekdays );
	const out: string[] = [];
	const d0 = parseLocalYmd( start );
	const endD = parseLocalYmd( end );
	if ( ! d0 || ! endD ) {
		return [];
	}
	for ( let d = d0, i = 0; i < 2000 && d <= endD; i++ ) {
		const n = d.getDay() === 0 ? 7 : d.getDay();
		if ( wset.has( n ) ) {
			out.push( dateToLocalYmd( d ) );
		}
		const next = new Date( d );
		next.setDate( next.getDate() + 1 );
		d = next;
	}
	return out;
}

function countInclusiveCalendarDays( startYmd: string, endYmd: string ): number {
	const s = startYmd.trim();
	const e = endYmd.trim();
	if (
		! /^\d{4}-\d{2}-\d{2}$/.test( s )
		|| ! /^\d{4}-\d{2}-\d{2}$/.test( e )
		|| s > e
	) {
		return 0;
	}
	const d0 = parseLocalYmd( s );
	const endD = parseLocalYmd( e );
	if ( ! d0 || ! endD ) {
		return 0;
	}
	let n = 0;
	for ( let d = d0, i = 0; i < 2000 && d <= endD; i++ ) {
		n++;
		const next = new Date( d );
		next.setDate( next.getDate() + 1 );
		d = next;
	}
	return n;
}

function sessionStarts( openM: number, closeM: number, session: number ) {
	const out: number[] = [];
	for ( let t = openM; t + session <= closeM; t += session ) {
		out.push( t );
	}
	return out;
}

type CategoryPreview = {
	displayName: string;
	sessionTimeCount: number;
	uniqueDates: number;
	slotDateCells: number;
};

function previewStats( blocks: ScheduleBlock[], sessionM: number ) {
	const byNameTime = new Map<string, { name: string; time: string; dates: Set<string> }>();
	for ( const b of blocks ) {
		const openM = parseHHMM( b.openTime );
		const closeM = parseHHMM( b.closeTime );
		if ( openM === null || closeM === null || openM + sessionM > closeM ) {
			continue;
		}
		const name = ( b.name || '' ).trim();
		const dates = listDates( b.startDate, b.endDate, b.weekdays );
		const starts = sessionStarts( openM, closeM, sessionM );
		for ( const st of starts ) {
			const timeKey = toHHMM( st );
			const key = `${ name }\t${ timeKey }`;
			if ( ! byNameTime.has( key ) ) {
				byNameTime.set( key, { name, time: timeKey, dates: new Set() } );
			}
			const row = byNameTime.get( key )!;
			for ( const ymd of dates ) {
				row.dates.add( ymd );
			}
		}
	}
	let totalEntries = 0;
	const allDates = new Set<string>();
	for ( const row of byNameTime.values() ) {
		totalEntries += row.dates.size;
		row.dates.forEach( ( d ) => allDates.add( d ) );
	}

	const byCategory = new Map<string, { times: Set<string>; allDates: Set<string>; cells: number }>();
	for ( const row of byNameTime.values() ) {
		const displayName = row.name === '' ? 'Time as label' : row.name;
		if ( ! byCategory.has( displayName ) ) {
			byCategory.set( displayName, { times: new Set(), allDates: new Set(), cells: 0 } );
		}
		const cat = byCategory.get( displayName )!;
		cat.times.add( row.time );
		cat.cells += row.dates.size;
		row.dates.forEach( ( d ) => cat.allDates.add( d ) );
	}
	const categories: CategoryPreview[] = Array.from( byCategory.entries() ).map(
		( [ displayName, v ] ) => ( {
			displayName,
			sessionTimeCount: v.times.size,
			uniqueDates: v.allDates.size,
			slotDateCells: v.cells,
		} ),
	);
	categories.sort( ( a, c ) => a.displayName.localeCompare( c.displayName ) );

	return {
		slotCount: byNameTime.size,
		dateCount: allDates.size,
		totalEntries,
		categories,
	};
}

function ymdMin( a: string, b: string ): string {
	const x = a.trim();
	const y = b.trim();
	return x <= y ? x : y;
}

function ymdMax( a: string, b: string ): string {
	const x = a.trim();
	const y = b.trim();
	return x >= y ? x : y;
}

function isCanonicalYmd( raw: string ): boolean {
	const s = raw.trim();
	return /^\d{4}-\d{2}-\d{2}$/.test( s );
}

/**
 * Merge window for fillEmpty: spans all blocks' calendar ranges, clipped so nothing precedes site today.
 * Matches server behaviour when omitting manual fill-from / fill-to in the UI.
 */
function computedFillEnvelopeForBlocks(
	blocks: ScheduleBlock[],
	siteTodayYmd: string,
): { fillFrom: string; fillTo: string; invalid: boolean } {
	if ( ! isCanonicalYmd( siteTodayYmd ) ) {
		return { fillFrom: '', fillTo: '', invalid: true };
	}
	if ( blocks.length === 0 ) {
		return { fillFrom: siteTodayYmd, fillTo: siteTodayYmd, invalid: true };
	}
	let minStart = '';
	let maxEnd = '';
	for ( const b of blocks ) {
		const sd = b.startDate.trim();
		const ed = b.endDate.trim();
		if ( ! isCanonicalYmd( sd ) || ! isCanonicalYmd( ed ) || sd > ed ) {
			return { fillFrom: siteTodayYmd, fillTo: siteTodayYmd, invalid: true };
		}
		if ( minStart === '' || sd < minStart ) {
			minStart = sd;
		}
		if ( maxEnd === '' || ed > maxEnd ) {
			maxEnd = ed;
		}
	}
	let fillFrom = minStart < siteTodayYmd ? siteTodayYmd : minStart;
	let fillTo = maxEnd;
	if ( fillFrom > fillTo ) {
		fillTo = fillFrom;
	}
	return { fillFrom, fillTo, invalid: false };
}

/**
 * Union of all block calendars (canonical Y-m-d bounds). Unlike {@link computedFillEnvelopeForBlocks},
 * start is NOT lifted to site today — needed so bulk-remove can target historical dates.
 */
function computedBulkRemoveEnvelopeForBlocks(
	blocks: ScheduleBlock[],
): { removeFrom: string; removeTo: string; invalid: boolean } {
	if ( blocks.length === 0 ) {
		return { removeFrom: '', removeTo: '', invalid: true };
	}
	let minStart = '';
	let maxEnd = '';
	for ( const b of blocks ) {
		const sd = b.startDate.trim();
		const ed = b.endDate.trim();
		if ( ! isCanonicalYmd( sd ) || ! isCanonicalYmd( ed ) || sd > ed ) {
			return { removeFrom: '', removeTo: '', invalid: true };
		}
		if ( minStart === '' || sd < minStart ) {
			minStart = sd;
		}
		if ( maxEnd === '' || ed > maxEnd ) {
			maxEnd = ed;
		}
	}
	return { removeFrom: minStart, removeTo: maxEnd, invalid: false };
}

function previewStatsFillEmpty(
	blocks: ScheduleBlock[],
	sessionM: number,
	fillFrom: string,
	fillTo: string,
	todayYmd: string,
	opts?: {
		/** Default true: enumeration never starts before site today (safe for Fill empty). */
		enumerateFromSiteToday?: boolean;
	},
) {
	const enumerateFromSiteToday = opts?.enumerateFromSiteToday !== false;
	const ff = fillFrom.trim();
	const ft = fillTo.trim();
	const byNameTime = new Map<string, { name: string; time: string; dates: Set<string> }>();
	for ( const b of blocks ) {
		const openM = parseHHMM( b.openTime );
		const closeM = parseHHMM( b.closeTime );
		if ( openM === null || closeM === null || openM + sessionM > closeM ) {
			continue;
		}
		const name = ( b.name || '' ).trim();
		const rawEffStart = ymdMin( b.startDate, ff );
		const rawEffEnd = ymdMax( b.endDate, ft );
		const enumerStart = enumerateFromSiteToday
			? ymdMax( todayYmd, rawEffStart )
			: rawEffStart;
		const enumerEnd = rawEffEnd;
		if ( enumerStart > enumerEnd ) {
			continue;
		}
		const dates = listDates( enumerStart, enumerEnd, b.weekdays );
		const starts = sessionStarts( openM, closeM, sessionM );
		for ( const st of starts ) {
			const timeKey = toHHMM( st );
			const key = `${ name }\t${ timeKey }`;
			if ( ! byNameTime.has( key ) ) {
				byNameTime.set( key, { name, time: timeKey, dates: new Set() } );
			}
			const row = byNameTime.get( key )!;
			for ( const ymd of dates ) {
				if ( ymd < ff || ymd > ft ) {
					continue;
				}
				row.dates.add( ymd );
			}
		}
	}
	let totalEntries = 0;
	const allDates = new Set<string>();
	for ( const row of byNameTime.values() ) {
		totalEntries += row.dates.size;
		row.dates.forEach( ( d ) => allDates.add( d ) );
	}
	const byCategory = new Map<string, { times: Set<string>; allDates: Set<string>; cells: number }>();
	for ( const row of byNameTime.values() ) {
		const displayName = row.name === '' ? 'Time as label' : row.name;
		if ( ! byCategory.has( displayName ) ) {
			byCategory.set( displayName, { times: new Set(), allDates: new Set(), cells: 0 } );
		}
		const cat = byCategory.get( displayName )!;
		cat.times.add( row.time );
		cat.cells += row.dates.size;
		row.dates.forEach( ( d ) => cat.allDates.add( d ) );
	}
	const categories: CategoryPreview[] = Array.from( byCategory.entries() ).map(
		( [ displayName, v ] ) => ( {
			displayName,
			sessionTimeCount: v.times.size,
			uniqueDates: v.allDates.size,
			slotDateCells: v.cells,
		} ),
	);
	categories.sort( ( a, c ) => a.displayName.localeCompare( c.displayName ) );
	return {
		slotCount: byNameTime.size,
		dateCount: allDates.size,
		fillRangeInclusiveDays: countInclusiveCalendarDays( ff, ft ),
		totalEntries,
		categories,
	};
}

function isWpSlotHasBookingsError( e: unknown ): boolean {
	const err = e as { status?: number; wp?: { code?: string } };
	if ( typeof err.status === 'number' && err.status === 409 ) {
		return true;
	}
	return err.wp?.code === 'slot_has_bookings';
}

function buildEventDaySlotsLookup(
	eventDatesUnknown: unknown,
): Map<string, SlotLike[]> {
	const out = new Map<string, SlotLike[]>();
	const raw = eventDatesUnknown as
	| Array<{ date?: string; slots?: SlotLike[] }>
	| undefined;
	if ( ! Array.isArray( raw ) ) {
		return out;
	}
	for ( const d of raw ) {
		const y = String( d?.date ?? '' ).trim();
		if ( ! /^\d{4}-\d{2}-\d{2}$/.test( y ) ) {
			continue;
		}
		const slotsRaw = d?.slots;
		const slots: SlotLike[] = Array.isArray( slotsRaw )
			? slotsRaw.map( ( s ) => ( {
				id: String( ( s as SlotLike )?.id ?? '' ),
				label: String( ( s as SlotLike )?.label ?? '' ),
				time: ( s as SlotLike )?.time,
				stock: ( s as SlotLike )?.stock ?? null,
				dateId: ( s as SlotLike )?.dateId,
				bookedCount: ( s as SlotLike )?.bookedCount,
				totalCapacity: ( s as SlotLike )?.totalCapacity,
			} ) )
			: [];
		out.set( y, slots );
	}
	return out;
}

/**
 * Resolve slot–date rows on this product that match configured blocks + session stepping (Fill-empty shape).
 */
function computeBulkRemoveTargets(
	eventDatesUnknown: unknown,
	blocks: ScheduleBlock[],
	sessionM: number,
	fillFrom: string,
	fillTo: string,
): BulkRemoveTarget[] {
	const ff = fillFrom.trim();
	const ft = fillTo.trim();
	const dayMap = buildEventDaySlotsLookup( eventDatesUnknown );
	const dedupe = new Set<string>();
	const out: BulkRemoveTarget[] = [];

	for ( const b of blocks ) {
		const openM = parseHHMM( b.openTime );
		const closeM = parseHHMM( b.closeTime );
		if ( openM === null || closeM === null || openM + sessionM > closeM ) {
			continue;
		}
		const rawEffStart = ymdMin( b.startDate, ff );
		const rawEffEnd = ymdMax( b.endDate, ft );
		const enumerStart = rawEffStart;
		const enumerEnd = rawEffEnd;
		if ( enumerStart > enumerEnd ) {
			continue;
		}
		const dates = listDates( enumerStart, enumerEnd, b.weekdays );
		const starts = sessionStarts( openM, closeM, sessionM );
		for ( const st of starts ) {
			const timeKey = toHHMM( st );
			for ( const ymd of dates ) {
				if ( ymd < ff || ymd > ft ) {
					continue;
				}
				const slots = dayMap.get( ymd );
				if ( ! slots?.length ) {
					continue;
				}
				for ( const slot of slots ) {
					const sid = String( slot.id ?? '' ).trim();
					const did = String( slot.dateId ?? '' ).trim();
					if ( ! sid || ! did ) {
						continue;
					}
					if ( ! slotMatchesBulkRemoveTimeOnly( slot, timeKey ) ) {
						continue;
					}
					const k = encodeManualSlotDateRef( { id: sid, dateId: did } );
					if ( dedupe.has( k ) ) {
						continue;
					}
					dedupe.add( k );
					out.push( { slotId: sid, dateId: did, ymd } );
				}
			}
		}
	}
	return out;
}

/**
 * Same pattern matching as {@link computeBulkRemoveTargets}, but only finite-capacity cells;
 * each target's `removeSpots` is capped by mode (fixed amount vs target total capacity).
 */
function computeBulkReduceStockTargets(
	eventDatesUnknown: unknown,
	blocks: ScheduleBlock[],
	sessionM: number,
	fillFrom: string,
	fillTo: string,
	computation: BulkReduceComputationMode,
): BulkReduceStockPreview {
	const empty: BulkReduceStockPreview = {
		targets: [],
		skippedUnlimited: 0,
		skippedZero: 0,
		skippedAtOrBelowTarget: 0,
		skippedMissingBookedData: 0,
		bookedOverTargetSessions: 0,
		totalSpotsRemoved: 0,
	};

	if ( computation.kind === 'fixedRemove' ) {
		const req = Math.floor( computation.requestedRemovePerCell );
		if ( req < 1 ) {
			return empty;
		}
	} else {
		const tt = Math.floor( computation.targetTotal );
		if ( ! Number.isFinite( tt ) || tt < 0 ) {
			return empty;
		}
	}

	const ff = fillFrom.trim();
	const ft = fillTo.trim();
	const dayMap = buildEventDaySlotsLookup( eventDatesUnknown );
	const dedupe = new Set<string>();
	const out: BulkReduceStockTarget[] = [];
	let skippedUnlimited = 0;
	let skippedZero = 0;
	let skippedAtOrBelowTarget = 0;
	let skippedMissingBookedData = 0;
	let bookedOverTargetSessions = 0;

	for ( const b of blocks ) {
		const openM = parseHHMM( b.openTime );
		const closeM = parseHHMM( b.closeTime );
		if ( openM === null || closeM === null || openM + sessionM > closeM ) {
			continue;
		}
		const rawEffStart = ymdMin( b.startDate, ff );
		const rawEffEnd = ymdMax( b.endDate, ft );
		const enumerStart = rawEffStart;
		const enumerEnd = rawEffEnd;
		if ( enumerStart > enumerEnd ) {
			continue;
		}
		const dates = listDates( enumerStart, enumerEnd, b.weekdays );
		const starts = sessionStarts( openM, closeM, sessionM );
		for ( const st of starts ) {
			const timeKey = toHHMM( st );
			for ( const ymd of dates ) {
				if ( ymd < ff || ymd > ft ) {
					continue;
				}
				const slots = dayMap.get( ymd );
				if ( ! slots?.length ) {
					continue;
				}
				for ( const slot of slots ) {
					const sid = String( slot.id ?? '' ).trim();
					const did = String( slot.dateId ?? '' ).trim();
					if ( ! sid || ! did ) {
						continue;
					}
					if ( ! slotMatchesBulkRemoveTimeOnly( slot, timeKey ) ) {
						continue;
					}
					const k = encodeManualSlotDateRef( { id: sid, dateId: did } );
					if ( dedupe.has( k ) ) {
						continue;
					}
					dedupe.add( k );

					const stRaw = slot.stock;
					if ( stRaw === null || stRaw === undefined ) {
						skippedUnlimited += 1;
						continue;
					}
					if ( typeof stRaw !== 'number' || stRaw < 0 ) {
						skippedZero += 1;
						continue;
					}

					const bookedDisp =
						typeof slot.bookedCount === 'number' && Number.isFinite( slot.bookedCount )
							? Math.max( 0, Math.floor( slot.bookedCount ) )
							: 0;

					if ( computation.kind === 'fixedRemove' ) {
						if ( stRaw <= 0 ) {
							skippedZero += 1;
							continue;
						}
						const req = Math.floor( computation.requestedRemovePerCell );
						const removeSpots = Math.min( req, stRaw );
						if ( removeSpots < 1 ) {
							continue;
						}
						out.push( {
							slotId: sid,
							dateId: did,
							ymd,
							currentStock: stRaw,
							removeSpots,
							bookedCount: bookedDisp,
							currentTotal: stRaw + bookedDisp,
						} );
						continue;
					}

					const targetTotal = Math.floor( computation.targetTotal );
					const bookedRaw = slot.bookedCount;
					if ( typeof bookedRaw !== 'number' || ! Number.isFinite( bookedRaw ) ) {
						skippedMissingBookedData += 1;
						continue;
					}
					const booked = Math.max( 0, Math.floor( bookedRaw ) );

					const plan = planTargetTotalCapacityRemoval( stRaw, booked, targetTotal );
					if ( plan === null ) {
						skippedAtOrBelowTarget += 1;
						continue;
					}
					if ( plan.bookedOverTarget && plan.removeSpots < 1 ) {
						bookedOverTargetSessions += 1;
					}
					if ( plan.removeSpots < 1 ) {
						continue;
					}
					out.push( {
						slotId: sid,
						dateId: did,
						ymd,
						currentStock: stRaw,
						removeSpots: plan.removeSpots,
						bookedCount: booked,
						currentTotal: plan.currentTotal,
						bookedOverTarget: plan.bookedOverTarget,
						targetTotalCapacity: targetTotal,
					} );
				}
			}
		}
	}

	const totalSpotsRemoved = out.reduce( ( acc, t ) => acc + t.removeSpots, 0 );
	return {
		targets: out,
		skippedUnlimited,
		skippedZero,
		skippedAtOrBelowTarget,
		skippedMissingBookedData,
		bookedOverTargetSessions,
		totalSpotsRemoved,
	};
}

async function deleteSlotDateViaRest(
	eventIdStr: string,
	target: BulkRemoveTarget,
): Promise<void> {
	const y = /^\d{4}-\d{2}-\d{2}$/.test( target.ymd.trim() )
		? `?ymd=${ encodeURIComponent( target.ymd.trim() ) }`
		: '';
	const path =
		`internalpos/v1/events/${ encodeURIComponent( eventIdStr ) }/slots/${ encodeURIComponent( target.slotId ) }/dates/${ encodeURIComponent( target.dateId ) }${ y }`;
	await restFetch( path, { method: 'DELETE' } );
}

function todayYmdLocal(): string {
	return dateToLocalYmd( new Date() );
}

export const SESSION_OPTIONS = [ 5, 10, 15, 20, 30, 60 ];

export type UseManageScheduleOptions = {
	/** Runs when the user dismisses the post-success confirmation dialog (e.g. strip `?manage=`). */
	onMutationSuccess?: () => void;
};

export function useManageSchedule(
	eventId: string,
	options: UseManageScheduleOptions = {},
) {
	const { onMutationSuccess } = options;
	const navigate = useNavigate();
	const upcomingEventQuery = useEvent( eventId );
	const pastInclusiveEventQuery = useEvent( eventId, { includePast: true } );

	type EventApiPayload = {
		title?: string;
		dates?: unknown[];
		id?: number;
		bookingMethod?: string;
		siteTodayYmd?: string;
		siteNowLocal?: string;
	};

	const eventData = upcomingEventQuery.data as EventApiPayload | undefined;
	const eventDetailWithPast = pastInclusiveEventQuery.data as EventApiPayload | undefined;

	const isLoading =
		upcomingEventQuery.isLoading || pastInclusiveEventQuery.isLoading;
	const isError = upcomingEventQuery.isError || pastInclusiveEventQuery.isError;
	const error =
		upcomingEventQuery.error ?? pastInclusiveEventQuery.error ?? null;
	const queryClient = useQueryClient();
	const gen = useGenerateSlots( eventId );
	const addManual = useAddManualSlot( eventId );
	const addStock = useAddSlotStock( eventId );

	const apiWpSiteYmd = useMemo( () => {
		if ( eventData && typeof eventData.siteTodayYmd === 'string' ) {
			const trimmed = eventData.siteTodayYmd.trim();
			if ( /^\d{4}-\d{2}-\d{2}$/.test( trimmed ) ) {
				return trimmed;
			}
		}
		return siteYmdPrefixFromWpNowLocal( eventData?.siteNowLocal );
	}, [ eventData ] );

	const siteTodayYmd = apiWpSiteYmd ?? todayYmdLocal();

	const siteTodayWeekday = useMemo( () => {
		const d = parseLocalYmd( siteTodayYmd );
		return d ? format( d, 'EEEE' ) : '';
	}, [ siteTodayYmd ] );

	const [ manualDate, setManualDate ] = useState( todayYmdLocal );
	const [ manualTime, setManualTime ] = useState( '09:00' );
	const [ manualCapacity, setManualCapacity ] = useState( 12 );
	const [ manualLabel, setManualLabel ] = useState( '' );
	const [ manualAddMode, setManualAddMode ] = useState<
		'newSession' | 'extraSpots'
	>( 'newSession' );
	const [ manualSpotSelectValue, setManualSpotSelectValue ] = useState( '' );
	const [ manualAddSpotsDelta, setManualAddSpotsDelta ] = useState( 1 );
	const [ manualStockConfirmOpen, setManualStockConfirmOpen ] =
		useState( false );
	const [ bulkRemoveConfirmOpen, setBulkRemoveConfirmOpen ] = useState( false );
	const [ bulkRemoveRunList, setBulkRemoveRunList ] = useState<
		BulkRemoveTarget[]
	>( [] );
	const [ bulkRemoving, setBulkRemoving ] = useState( false );
	const [ bulkReduceSpotsPerCell, setBulkReduceSpotsPerCell ] = useState( 1 );
	const [ bulkReduceSubMode, setBulkReduceSubMode ] = useState<
		'fixedRemove' | 'targetTotal'
	>( 'fixedRemove' );
	const [ bulkTargetTotalCapacity, setBulkTargetTotalCapacity ] = useState( 8 );
	const [ bulkReduceConfirmOpen, setBulkReduceConfirmOpen ] = useState( false );
	const [ bulkReduceRunList, setBulkReduceRunList ] = useState<
		BulkReduceStockTarget[]
	>( [] );
	const [ bulkReducingStock, setBulkReducingStock ] = useState( false );
	const [ blocks, setBlocks ] = useState< ScheduleBlock[] >( [ emptyBlock( 0 ) ] );
	const [ sessionMinutes, setSessionMinutes ] = useState( 10 );
	const [ capacity, setCapacity ] = useState( 12 );
	const [ formInitialized, setFormInitialized ] = useState( false );
	const [ confirmOpen, setConfirmOpen ] = useState( false );
	const [ mutationSuccessAck, setMutationSuccessAck ] = useState< {
		title: string;
		description: string;
	} | null >( null );
	const dismissingSuccessAckRef = useRef( false );

	const dismissMutationSuccessAck = useCallback( () => {
		if ( dismissingSuccessAckRef.current ) {
			return;
		}
		dismissingSuccessAckRef.current = true;
		setMutationSuccessAck( null );
		onMutationSuccess?.();
		navigate( `/event/${ eventId }` );
		queueMicrotask( () => {
			dismissingSuccessAckRef.current = false;
		} );
	}, [ navigate, eventId, onMutationSuccess ] );

	useEffect( () => {
		if ( ! apiWpSiteYmd || ! formInitialized ) {
			return;
		}
		setManualDate( ( prev ) => {
			const p = prev.trim();
			if ( ! /^\d{4}-\d{2}-\d{2}$/.test( p ) ) {
				return apiWpSiteYmd;
			}
			return p < apiWpSiteYmd ? apiWpSiteYmd : p;
		} );
	}, [ apiWpSiteYmd, formInitialized ] );


	useEffect( () => {
		if ( ! eventData || formInitialized ) {
			return;
		}
		const noSlots = ! eventData.dates || eventData.dates.length === 0;
		if ( noSlots ) {
			setBlocks( bumperPresetBlocks() );
			setSessionMinutes( 10 );
			setCapacity( 12 );
		} else {
			setBlocks( [ emptyBlock( 0 ) ] );
		}
		setFormInitialized( true );
	}, [ eventData, formInitialized ] );

	const preview = useMemo(
		() => previewStats( blocks, sessionMinutes ),
		[ blocks, sessionMinutes ],
	);

	const fillEmptyEnvelope = useMemo(
		() => computedFillEnvelopeForBlocks( blocks, siteTodayYmd ),
		[ blocks, siteTodayYmd ],
	);

	const bulkRemoveEnvelope = useMemo(
		() => computedBulkRemoveEnvelopeForBlocks( blocks ),
		[ blocks ],
	);

	const fillPreview = useMemo(
		() => {
			if ( fillEmptyEnvelope.invalid ) {
				return {
					slotCount: 0,
					dateCount: 0,
					fillRangeInclusiveDays: 0,
					totalEntries: 0,
					categories: [] as CategoryPreview[],
				};
			}
			return previewStatsFillEmpty(
				blocks,
				sessionMinutes,
				fillEmptyEnvelope.fillFrom,
				fillEmptyEnvelope.fillTo,
				siteTodayYmd,
			);
		},
		[ blocks, sessionMinutes, fillEmptyEnvelope, siteTodayYmd ],
	);

	const bulkRemovePatternPreview = useMemo(
		() => {
			if ( bulkRemoveEnvelope.invalid ) {
				return {
					slotCount: 0,
					dateCount: 0,
					fillRangeInclusiveDays: 0,
					totalEntries: 0,
					categories: [] as CategoryPreview[],
				};
			}
			return previewStatsFillEmpty(
				blocks,
				sessionMinutes,
				bulkRemoveEnvelope.removeFrom,
				bulkRemoveEnvelope.removeTo,
				siteTodayYmd,
				{ enumerateFromSiteToday: false },
			);
		},
		[ blocks, sessionMinutes, bulkRemoveEnvelope, siteTodayYmd ],
	);
	const slotsOnManualDate = useMemo( (): SlotLike[] => {
		const raw = eventData?.dates as
		| Array<{ date?: string; slots?: SlotLike[] }>
		| undefined;
		if ( ! raw ) {
			return [];
		}
		const ymd = manualDate.trim();
		const day = raw.find( ( d ) => String( d?.date ?? '' ).trim() === ymd );
		return day?.slots ?? [];
	}, [ eventData?.dates, manualDate ] );

	const manualAddWouldDuplicate = useMemo(
		() =>
			manualAddMode === 'newSession'
			&& manualSlotWouldDuplicateExisting(
				slotsOnManualDate,
				manualTime,
				manualLabel,
			),
		[ manualAddMode, slotsOnManualDate, manualTime, manualLabel ],
	);

	const spotsEligibleSchedule = useMemo(
		() =>
			slotsOnManualDate.filter( ( s ) => {
				const sid = String( s.id ?? '' ).trim();
				const did = String( s.dateId ?? '' ).trim();
				return Boolean( sid && did && s.stock !== null && s.stock !== undefined );
			} ),
		[ slotsOnManualDate ],
	);

	const bulkRemoveTargets = useMemo( () => {
		if ( bulkRemoveEnvelope.invalid ) {
			return [];
		}
		const datesForBulkRemove =
			eventDetailWithPast?.dates ?? eventData?.dates;
		return computeBulkRemoveTargets(
			datesForBulkRemove,
			blocks,
			sessionMinutes,
			bulkRemoveEnvelope.removeFrom,
			bulkRemoveEnvelope.removeTo,
		);
	}, [
		eventDetailWithPast?.dates,
		eventData?.dates,
		blocks,
		sessionMinutes,
		bulkRemoveEnvelope,
	] );

	const bulkReduceComputation = useMemo( (): BulkReduceComputationMode => {
		if ( bulkReduceSubMode === 'targetTotal' ) {
			return {
				kind: 'targetTotal',
				targetTotal: Math.floor( bulkTargetTotalCapacity ),
			};
		}
		return {
			kind: 'fixedRemove',
			requestedRemovePerCell: bulkReduceSpotsPerCell,
		};
	}, [ bulkReduceSubMode, bulkReduceSpotsPerCell, bulkTargetTotalCapacity ] );

	const bulkReduceStockPreview = useMemo( () => {
		if ( bulkRemoveEnvelope.invalid ) {
			return {
				targets: [] as BulkReduceStockTarget[],
				skippedUnlimited: 0,
				skippedZero: 0,
				skippedAtOrBelowTarget: 0,
				skippedMissingBookedData: 0,
				bookedOverTargetSessions: 0,
				totalSpotsRemoved: 0,
			};
		}
		const datesForBulkReduce =
			eventDetailWithPast?.dates ?? eventData?.dates;
		return computeBulkReduceStockTargets(
			datesForBulkReduce,
			blocks,
			sessionMinutes,
			bulkRemoveEnvelope.removeFrom,
			bulkRemoveEnvelope.removeTo,
			bulkReduceComputation,
		);
	}, [
		eventDetailWithPast?.dates,
		eventData?.dates,
		blocks,
		sessionMinutes,
		bulkRemoveEnvelope,
		bulkReduceComputation,
	] );

	useEffect( () => {
		if ( manualAddMode !== 'extraSpots' ) {
			return;
		}
		if ( spotsEligibleSchedule.length === 0 ) {
			setManualSpotSelectValue( '' );
			return;
		}
		setManualSpotSelectValue( ( prev ) => {
			if (
				prev
				&& spotsEligibleSchedule.some(
					( s ) => encodeManualSlotDateRef( s ) === prev,
				)
			) {
				return prev;
			}
			return encodeManualSlotDateRef( spotsEligibleSchedule[ 0 ] );
		} );
	}, [ manualAddMode, spotsEligibleSchedule ] );

	const selectedSpotSchedule = useMemo( () => {
		if ( ! manualSpotSelectValue ) {
			return undefined;
		}
		return spotsEligibleSchedule.find(
			( s ) => encodeManualSlotDateRef( s ) === manualSpotSelectValue,
		);
	}, [ spotsEligibleSchedule, manualSpotSelectValue ] );

	const scheduleManualBusy =
		addManual.isPending
		|| addStock.isPending
		|| bulkRemoving
		|| bulkReducingStock;

	const manualDuplicateMessage =
		'That time already has a session on this date. Use Add ticket spots for more capacity, or pick a different time (or a distinct schedule label if your product allows multiple sessions at one time).';

	const scheduleSlotPickerLabel = useCallback( ( s: SlotLike ): string => {
		const t = formatSlotTime( s );
		const lab = ( s.label ?? '' ).trim();
		const head = lab || t;
		const cap =
			s.stock === null || s.stock === undefined
				? 'Unlimited'
				: `${ s.stock } cap`;
		return `${ head } · ${ t } · ${ cap }`;
	}, [] );

	const updateBlock = useCallback( (
		blockId: string,
		patch: Partial<ScheduleBlock>,
	) => {
		setBlocks( ( prev ) =>
			prev.map( ( b ) => ( b.id === blockId ? { ...b, ...patch } : b ) ),
		);
	}, [] );

	const toggleWeekday = useCallback( (
		blockId: string,
		n: number,
		checked: boolean,
	) => {
		setBlocks( ( prev ) => {
			const b = prev.find( ( x ) => x.id === blockId );
			if ( ! b ) {
				return prev;
			}
			const set = new Set( b.weekdays );
			if ( checked ) {
				set.add( n );
			} else {
				set.delete( n );
			}
			const nextWd = Array.from( set ).sort( ( a, c ) => a - c );
			return prev.map( ( x ) =>
				x.id === blockId ? { ...x, weekdays: nextWd } : x,
			);
		} );
	}, [] );

	const submitManualSlot = useCallback(
		async ( ev: FormEvent ) => {
			ev.preventDefault();
			if ( manualAddMode === 'extraSpots' ) {
				if ( spotsEligibleSchedule.length === 0 ) {
					toast.error(
						'No sessions with a set capacity on that date. Use New session or pick a date that already has numeric limits.',
					);
					return;
				}
				const parsed = decodeManualSlotDateRef( manualSpotSelectValue );
				if ( ! parsed ) {
					toast.error( 'Select a session to add spots to.' );
					return;
				}
				if ( manualAddSpotsDelta < 1 ) {
					toast.error( 'Add at least 1 spot.' );
					return;
				}
				setManualStockConfirmOpen( true );
				return;
			}
			if ( manualAddWouldDuplicate ) {
				toast.error( manualDuplicateMessage );
				return;
			}
			const timeNorm = normalizeTimeInputToHhmm( manualTime.trim() );
			if ( ! timeNorm ) {
				toast.error( 'Enter a valid time (HH:MM).' );
				return;
			}
			try {
				const payload: Record<string, unknown> = {
					date: manualDate.trim(),
					time: timeNorm,
					capacity: manualCapacity < 0 ? 0 : manualCapacity,
				};
				const lab = manualLabel.trim();
				if ( lab ) {
					payload.label = lab;
				}
				await addManual.mutateAsync( payload );
				setMutationSuccessAck( {
					title: 'Session added',
					description:
						'The new session was saved to this product schedule.',
				} );
			} catch ( e ) {
				toast.error(
					String( ( e as Error )?.message || e || 'Request failed' ),
				);
			}
		},
		[
			manualAddMode,
			spotsEligibleSchedule,
			manualSpotSelectValue,
			manualAddSpotsDelta,
			manualAddWouldDuplicate,
			manualDuplicateMessage,
			manualTime,
			manualDate,
			manualCapacity,
			manualLabel,
			addManual,
		],
	);

	const commitManualStockAdd = useCallback( async () => {
		const parsed = decodeManualSlotDateRef( manualSpotSelectValue );
		if ( ! parsed || manualAddSpotsDelta < 1 ) {
			return;
		}
		try {
			await addStock.mutateAsync( {
				slotId: parsed.slotId,
				dateId: parsed.dateId,
				date: manualDate.trim(),
				addSpots: manualAddSpotsDelta,
			} );
			setManualStockConfirmOpen( false );
			setMutationSuccessAck( {
				title: 'Ticket spots added',
				description:
					`Added ${ manualAddSpotsDelta } ticket spot(s) to the selected session.`,
			} );
		} catch ( e ) {
			toast.error(
				String( ( e as Error )?.message || e || 'Request failed' ),
			);
		}
	}, [
		manualSpotSelectValue,
		manualAddSpotsDelta,
		addStock,
		manualDate,
	] );

	const requestBulkRemoveConfirm = useCallback( () => {
		if ( bulkRemoveEnvelope.invalid ) {
			toast.error(
				'Fix every block’s start and end dates (Y-m-d), with start on or before end, before removing cells.',
			);
			return;
		}
		if ( bulkRemoveTargets.length === 0 ) {
			toast.message(
				'No matching slot–date cells on this product for the blocks above (check weekdays, date span, and session length / times).',
			);
			return;
		}
		setBulkRemoveRunList( bulkRemoveTargets );
		setBulkRemoveConfirmOpen( true );
	}, [ bulkRemoveEnvelope.invalid, bulkRemoveTargets ] );

	const runBulkRemoveBlocks = useCallback( async () => {
		const targets = bulkRemoveRunList;
		if ( targets.length === 0 ) {
			return;
		}
		let removed = 0;
		let skippedBooked = 0;
		setBulkRemoving( true );
		try {
			for ( const t of targets ) {
				try {
					await deleteSlotDateViaRest( eventId, t );
					removed += 1;
				} catch ( e ) {
					if ( isWpSlotHasBookingsError( e ) ) {
						skippedBooked += 1;
						continue;
					}
					throw e;
				}
			}
			await invalidateInternalPosAfterSlotWrites( queryClient, eventId );
			setBulkRemoveConfirmOpen( false );
			const skipPart =
				skippedBooked > 0
					? ` ${ skippedBooked } skipped because bookings already exist.`
					: '';
			setMutationSuccessAck( {
				title: 'Time blocks removed',
				description:
					`Removed ${ removed } slot–date cell${ removed === 1 ? '' : 's' }.${ skipPart }`,
			} );
		} catch ( e ) {
			toast.error(
				String( ( e as Error )?.message || e || 'Request failed' ),
			);
		} finally {
			setBulkRemoving( false );
		}
	}, [ bulkRemoveRunList, eventId, queryClient ] );

	const requestBulkReduceStockConfirm = useCallback( () => {
		if ( bulkRemoveEnvelope.invalid ) {
			toast.error(
				'Fix every block’s start and end dates (Y-m-d), with start on or before end, before reducing spots.',
			);
			return;
		}
		if ( bulkReduceSubMode === 'fixedRemove' && bulkReduceSpotsPerCell < 1 ) {
			toast.error( 'Remove at least 1 spot per session.' );
			return;
		}
		const tt = Math.floor( bulkTargetTotalCapacity );
		if (
			bulkReduceSubMode === 'targetTotal'
			&& ( ! Number.isFinite( tt ) || tt < 0 )
		) {
			toast.error( 'Target total capacity must be zero or greater.' );
			return;
		}
		if ( bulkReduceStockPreview.targets.length === 0 ) {
			toast.message(
				bulkReduceSubMode === 'targetTotal'
					? 'No sessions need changes for this target total (unlimited, missing booked counts, already at/below target, or zero removal).'
					: 'No finite-capacity sessions to reduce for this pattern. Unlimited or empty sessions are skipped.',
			);
			return;
		}
		setBulkReduceRunList( bulkReduceStockPreview.targets );
		setBulkReduceConfirmOpen( true );
	}, [
		bulkRemoveEnvelope.invalid,
		bulkReduceSpotsPerCell,
		bulkReduceStockPreview.targets,
		bulkReduceSubMode,
		bulkTargetTotalCapacity,
	] );

	const runBulkReduceStock = useCallback( async () => {
		const targets = bulkReduceRunList;
		if ( targets.length === 0 ) {
			return;
		}
		let applied = 0;
		let failed = 0;
		setBulkReducingStock( true );
		try {
			for ( const t of targets ) {
				if ( t.removeSpots < 1 ) {
					continue;
				}
				try {
					await subtractSlotStockViaRest( eventId, {
						slotId: t.slotId,
						dateId: t.dateId,
						date: t.ymd,
						removeSpots: t.removeSpots,
					} );
					applied += 1;
				} catch {
					failed += 1;
				}
			}
			await invalidateInternalPosAfterSlotWrites( queryClient, eventId );
			setBulkReduceConfirmOpen( false );
			const failPart =
				failed > 0
					? ` ${ failed } failed (capacity may have changed).`
					: '';
			setMutationSuccessAck( {
				title: 'Ticket spots reduced',
				description:
					`Reduced capacity on ${ applied } session${ applied === 1 ? '' : 's' } (${ targets.length } planned).${ failPart }`,
			} );
		} catch ( e ) {
			toast.error(
				String( ( e as Error )?.message || e || 'Request failed' ),
			);
		} finally {
			setBulkReducingStock( false );
		}
	}, [ bulkReduceRunList, eventId, queryClient ] );

	const runGenerate = useCallback( async () => {
		setConfirmOpen( false );
		try {
			const res = ( await gen.mutateAsync( {
				blocks: blocks.map( ( b ) => ( {
					name: ( b.name || '' ).trim(),
					startDate: b.startDate,
					endDate: b.endDate,
					weekdays: b.weekdays,
					openTime: b.openTime,
					closeTime: b.closeTime,
				} ) ),
				sessionMinutes,
				capacity,
				labelFormat: 'time',
				confirm: true,
			} ) ) as {
				warnings?: string[];
				slotsWritten?: number;
				totalEntries?: number;
			};
			if ( res.warnings && res.warnings.length ) {
				for ( const w of res.warnings ) {
					toast.message( w );
				}
			}
			setMutationSuccessAck( {
				title: 'Schedule replaced',
				description: `Saved ${ res.slotsWritten ?? '?' } session times and ${ res.totalEntries ?? '?' } slot–date cells.`,
			} );
		} catch ( e ) {
			toast.error(
				String( ( e as Error )?.message || e || 'Request failed' ),
			);
		}
	}, [
		gen,
		blocks,
		sessionMinutes,
		capacity,
	] );

	const runFillEmpty = useCallback( async () => {
		if ( fillEmptyEnvelope.invalid ) {
			toast.error(
				'Fix every block’s start and end dates (Y-m-d), with start on or before end, before adding sessions.',
			);
			return;
		}
		try {
			const res = ( await gen.mutateAsync( {
				mode: 'fillEmpty',
				fillFrom: fillEmptyEnvelope.fillFrom,
				fillTo: fillEmptyEnvelope.fillTo,
				blocks: blocks.map( ( b ) => ( {
					name: ( b.name || '' ).trim(),
					startDate: b.startDate,
					endDate: b.endDate,
					weekdays: b.weekdays,
					openTime: b.openTime,
					closeTime: b.closeTime,
				} ) ),
				sessionMinutes,
				capacity,
				labelFormat: 'time',
				confirm: true,
			} ) ) as {
				warnings?: string[];
				cellsAdded?: number;
				skippedDuplicates?: number;
			};
			if ( res.warnings && res.warnings.length ) {
				for ( const w of res.warnings ) {
					toast.message( w );
				}
			}
			const skipped = res.skippedDuplicates ?? 0;
			setMutationSuccessAck( {
				title: 'Missing sessions added',
				description:
					skipped > 0
						? `Added ${ res.cellsAdded ?? '?' } new slot–date cell(s). ${ skipped } were skipped because those sessions already existed.`
						: `Added ${ res.cellsAdded ?? '?' } new slot–date cell(s).`,
			} );
		} catch ( e ) {
			toast.error(
				String( ( e as Error )?.message || e || 'Request failed' ),
			);
		}
	}, [
		gen,
		blocks,
		fillEmptyEnvelope,
		sessionMinutes,
		capacity,
	] );

	return {
		eventData,
		isLoading,
		isError,
		error,
		gen,
		manualDate,
		setManualDate,
		manualTime,
		setManualTime,
		manualCapacity,
		setManualCapacity,
		manualLabel,
		setManualLabel,
		manualAddMode,
		setManualAddMode,
		manualSpotSelectValue,
		setManualSpotSelectValue,
		manualAddSpotsDelta,
		setManualAddSpotsDelta,
		manualStockConfirmOpen,
		setManualStockConfirmOpen,
		bulkRemoveConfirmOpen,
		setBulkRemoveConfirmOpen,
		blocks,
		setBlocks,
		sessionMinutes,
		setSessionMinutes,
		capacity,
		setCapacity,
		confirmOpen,
		setConfirmOpen,
		fillEmptyEnvelope,
		bulkRemoveEnvelope,
		bulkRemovePatternPreview,
		siteTodayYmd,
		siteTodayWeekday,
		preview,
		fillPreview,
		bulkRemoveTargets,
		bulkRemoveRunList,
		bulkRemoving,
		bulkReduceSpotsPerCell,
		setBulkReduceSpotsPerCell,
		bulkReduceSubMode,
		setBulkReduceSubMode,
		bulkTargetTotalCapacity,
		setBulkTargetTotalCapacity,
		bulkReduceStockPreview,
		bulkReduceConfirmOpen,
		setBulkReduceConfirmOpen,
		bulkReduceRunList,
		bulkReducingStock,
		requestBulkReduceStockConfirm,
		runBulkReduceStock,
		slotsOnManualDate,
		manualAddWouldDuplicate,
		spotsEligibleSchedule,
		selectedSpotSchedule,
		scheduleManualBusy,
		manualDuplicateMessage,
		scheduleSlotPickerLabel,
		updateBlock,
		toggleWeekday,
		submitManualSlot,
		commitManualStockAdd,
		requestBulkRemoveConfirm,
		runBulkRemoveBlocks,
		runGenerate,
		runFillEmpty,
		addManual,
		addStock,
		mutationSuccessAck,
		dismissMutationSuccessAck,
	};
}

export const WD_LABELS: { n: number; short: string }[] = [
	{ n: 1, short: 'Mon' },
	{ n: 2, short: 'Tue' },
	{ n: 3, short: 'Wed' },
	{ n: 4, short: 'Thu' },
	{ n: 5, short: 'Fri' },
	{ n: 6, short: 'Sat' },
	{ n: 7, short: 'Sun' },
];

/** Append with `setBlocks( ( prev ) => [ ...prev, createScheduleBlockDraft( prev.length ) ] )`. */
export function createScheduleBlockDraft( blockIndex: number ): ScheduleBlock {
	return emptyBlock( blockIndex );
}

export type ManageScheduleController = ReturnType<typeof useManageSchedule>;
