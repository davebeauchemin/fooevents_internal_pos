import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
	useAddManualSlot,
	useAddSlotStock,
	useEvent,
	useGenerateSlots,
} from '@/api/queries.js';
import {
	decodeManualSlotDateRef,
	encodeManualSlotDateRef,
	formatSlotTime,
	manualSlotWouldDuplicateExisting,
	normalizeTimeInputToHhmm,
	type SlotLike,
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

function previewStatsFillEmpty(
	blocks: ScheduleBlock[],
	sessionM: number,
	fillFrom: string,
	fillTo: string,
	todayYmd: string,
) {
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
		const enumerStart = ymdMax( todayYmd, rawEffStart );
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

function todayYmdLocal(): string {
	return dateToLocalYmd( new Date() );
}

export const SESSION_OPTIONS = [ 5, 10, 15, 20, 30, 60 ];

export function useManageSchedule( eventId: string ) {
	const navigate = useNavigate();
	const {
		data: eventData,
		isLoading,
		isError,
		error,
	} = useEvent( eventId ) as {
		data:
			| {
				title?: string;
				dates?: unknown[];
				id?: number;
				bookingMethod?: string;
				siteTodayYmd?: string;
				siteNowLocal?: string;
			}
			| undefined;
		isLoading: boolean;
		isError: boolean;
		error: Error | null;
	};
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
	const [ blocks, setBlocks ] = useState< ScheduleBlock[] >( [ emptyBlock( 0 ) ] );
	const [ sessionMinutes, setSessionMinutes ] = useState( 10 );
	const [ capacity, setCapacity ] = useState( 12 );
	const [ formInitialized, setFormInitialized ] = useState( false );
	const [ confirmOpen, setConfirmOpen ] = useState( false );
	const [ fillFromYmd, setFillFromYmd ] = useState( () => todayYmdLocal() );
	const [ fillToYmd, setFillToYmd ] = useState( () => todayYmdLocal() );
	const [ fillConfirmOpen, setFillConfirmOpen ] = useState( false );

	const afterMutationSuccess = useCallback( () => {
		navigate( `/event/${ eventId }` );
	}, [ navigate, eventId ] );

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
		setBlocks( ( prev ) =>
			prev.map( ( b ) => ( {
				...b,
				startDate:
					b.startDate.trim() < apiWpSiteYmd ? apiWpSiteYmd : b.startDate,
				endDate:
					b.endDate.trim() < apiWpSiteYmd ? apiWpSiteYmd : b.endDate,
			} ) ),
		);
	}, [ apiWpSiteYmd, formInitialized ] );

	useEffect( () => {
		if ( ! /^\d{4}-\d{2}-\d{2}$/.test( siteTodayYmd ) ) {
			return;
		}
		const f = fillFromYmd.trim();
		const t = fillToYmd.trim();
		if (
			! /^\d{4}-\d{2}-\d{2}$/.test( f )
			|| ! /^\d{4}-\d{2}-\d{2}$/.test( t )
		) {
			return;
		}
		let nf = f < siteTodayYmd ? siteTodayYmd : f;
		let nt = t < siteTodayYmd ? siteTodayYmd : t;
		if ( nf > nt ) {
			nt = nf;
		}
		if ( nf !== f ) {
			setFillFromYmd( nf );
		}
		if ( nt !== t ) {
			setFillToYmd( nt );
		}
	}, [ siteTodayYmd, fillFromYmd, fillToYmd ] );

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

	const fillPreview = useMemo(
		() =>
			previewStatsFillEmpty(
				blocks,
				sessionMinutes,
				fillFromYmd.trim(),
				fillToYmd.trim(),
				siteTodayYmd,
			),
		[ blocks, sessionMinutes, fillFromYmd, fillToYmd, siteTodayYmd ],
	);

	const fillRangeInvalid =
		! /^\d{4}-\d{2}-\d{2}$/.test( fillFromYmd.trim() )
		|| ! /^\d{4}-\d{2}-\d{2}$/.test( fillToYmd.trim() )
		|| fillFromYmd.trim() > fillToYmd.trim();

	const fillRangeCalendarDisablePast = useCallback(
		( date: Date ) => {
			return dateToLocalYmd( date ) < siteTodayYmd;
		},
		[ siteTodayYmd ],
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

	const scheduleManualBusy = addManual.isPending || addStock.isPending;

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
				toast.success( 'Session added to this product schedule.' );
				afterMutationSuccess();
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
			afterMutationSuccess,
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
			toast.success(
				`Added ${ manualAddSpotsDelta } ticket spot(s).`,
			);
			setManualStockConfirmOpen( false );
			afterMutationSuccess();
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
		afterMutationSuccess,
	] );

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
			toast.success(
				`Schedule saved: ${ res.slotsWritten ?? '?' } session times, ${ res.totalEntries ?? '?' } slot–date cells.`,
			);
			afterMutationSuccess();
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
		afterMutationSuccess,
	] );

	const runFillEmpty = useCallback( async () => {
		setFillConfirmOpen( false );
		try {
			const res = ( await gen.mutateAsync( {
				mode: 'fillEmpty',
				fillFrom: fillFromYmd.trim(),
				fillTo: fillToYmd.trim(),
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
			toast.success(
				skipped > 0
					? `Added ${ res.cellsAdded ?? '?' } new slot–date cell(s). ${ skipped } were skipped because those sessions already existed.`
					: `Added ${ res.cellsAdded ?? '?' } new slot–date cell(s).`,
			);
			afterMutationSuccess();
		} catch ( e ) {
			toast.error(
				String( ( e as Error )?.message || e || 'Request failed' ),
			);
		}
	}, [
		gen,
		fillFromYmd,
		fillToYmd,
		blocks,
		sessionMinutes,
		capacity,
		afterMutationSuccess,
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
		blocks,
		setBlocks,
		sessionMinutes,
		setSessionMinutes,
		capacity,
		setCapacity,
		confirmOpen,
		setConfirmOpen,
		fillFromYmd,
		setFillFromYmd,
		fillToYmd,
		setFillToYmd,
		fillConfirmOpen,
		setFillConfirmOpen,
		siteTodayYmd,
		siteTodayWeekday,
		preview,
		fillPreview,
		fillRangeInvalid,
		fillRangeCalendarDisablePast,
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
		runGenerate,
		runFillEmpty,
		addManual,
		addStock,
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
