import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CalendarIcon, Plus, TriangleAlert } from 'lucide-react';
import { useAddManualSlot, useAddSlotStock, useEvent, useGenerateSlots } from '../api/queries.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
	decodeManualSlotDateRef,
	encodeManualSlotDateRef,
	formatSlotTime,
	manualSlotWouldDuplicateExisting,
	normalizeTimeInputToHhmm,
	type SlotLike,
} from '@/lib/slotHourGrouping';
import { cn } from '@/lib/utils';

type ScheduleBlock = {
	id: string;
	/** Shown as FooEvents slot label prefix (e.g. Regular / Late). Empty = use time as label on server. */
	name: string;
	startDate: string;
	endDate: string;
	weekdays: number[];
	openTime: string;
	closeTime: string;
};

const WD_LABELS: { n: number; short: string }[] = [
	{ n: 1, short: 'Mon' },
	{ n: 2, short: 'Tue' },
	{ n: 3, short: 'Wed' },
	{ n: 4, short: 'Thu' },
	{ n: 5, short: 'Fri' },
	{ n: 6, short: 'Sat' },
	{ n: 7, short: 'Sun' },
];

const SESSION_OPTIONS = [ 5, 10, 15, 20, 30, 60 ];

/** Y-m-d in the browser's local calendar (never use toISOString().slice — that is UTC). */
function dateToLocalYmd( d: Date ): string {
	return (
		d.getFullYear() +
		'-' +
		String( d.getMonth() + 1 ).padStart( 2, '0' ) +
		'-' +
		String( d.getDate() ).padStart( 2, '0' )
	);
}

/** Parse Y-m-d as local noon (stable for range iteration and DST). */
function parseLocalYmd( ymd: string ): Date | undefined {
	const m = ymd.trim().match( /^(\d{4})-(\d{2})-(\d{2})$/ );
	if ( ! m ) {
		return undefined;
	}
	return new Date( Number( m[ 1 ] ), Number( m[ 2 ] ) - 1, Number( m[ 3 ] ), 12, 0, 0, 0 );
}

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

/** Bumper car preset from bookings-details.md (May 7 – Jun 23 season segment). */
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

function ScheduleBlockDatePicker( {
	label,
	ymd,
	onSelectYmd,
	triggerId,
	disabled = false,
	className,
	isDateDisabled,
}: {
	label: string;
	ymd: string;
	onSelectYmd: ( next: string ) => void;
	triggerId: string;
	disabled?: boolean;
	className?: string;
	/** When provided, grey out days in the popover calendar (e.g. already booked). */
	isDateDisabled?: ( date: Date ) => boolean;
} ) {
	const [ open, setOpen ] = useState( false );
	const selectedDate =
		ymd && /^\d{4}-\d{2}-\d{2}$/.test( ymd.trim() ) ? parseLocalYmd( ymd.trim() ) : undefined;
	return (
		<div className={ cn( 'space-y-2', className ) }>
			<Label htmlFor={ triggerId }>{ label }</Label>
			<Popover
				open={ disabled ? false : open }
				onOpenChange={ ( next ) => {
					if ( ! disabled ) {
						setOpen( next );
					}
				} }
			>
				<PopoverTrigger asChild>
					<Button
						id={ triggerId }
						type="button"
						variant="outline"
						disabled={ disabled }
						className={ cn(
							'w-full min-w-[11rem] justify-start text-left font-normal',
						) }
					>
						<CalendarIcon className="mr-2 size-4 shrink-0" aria-hidden />
						{ selectedDate ? format( selectedDate, 'PP' ) : 'Pick date…' }
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-auto p-0"
					align="start"
					onOpenAutoFocus={ ( e ) => e.preventDefault() }
				>
					<Calendar
						mode="single"
						selected={ selectedDate }
						defaultMonth={ selectedDate }
						disabled={ isDateDisabled }
						onSelect={ ( d ) => {
							if ( ! d || disabled ) {
								return;
							}
							if ( isDateDisabled?.( d ) ) {
								return;
							}
							onSelectYmd( dateToLocalYmd( d ) );
							setOpen( false );
						} }
						initialFocus
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
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

/** Inclusive calendar-day count from startYmd through endYmd. 0 if invalid or start > end. */
function countInclusiveCalendarDays( startYmd: string, endYmd: string ): number {
	const s = startYmd.trim();
	const e = endYmd.trim();
	if ( ! /^\d{4}-\d{2}-\d{2}$/.test( s ) || ! /^\d{4}-\d{2}-\d{2}$/.test( e ) || s > e ) {
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
	// Key matches server: (name, HH:MM) → merge dates.
	const byNameTime = new Map<string, { name: string; time: string; dates: Set<string> }>();
	for ( const b of blocks ) {
		const openM = parseHHMM( b.openTime );
		const closeM = parseHHMM( b.closeTime );
		if ( null === openM || null === closeM || openM + sessionM > closeM ) {
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
	const allDates = new Set<string> ();
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
	const categories: CategoryPreview[] = Array.from( byCategory.entries() ).map( ( [ displayName, v ] ) => ( {
		displayName,
		sessionTimeCount: v.times.size,
		uniqueDates: v.allDates.size,
		slotDateCells: v.cells,
	} ) );
	categories.sort( ( a, c ) => a.displayName.localeCompare( c.displayName ) );

	return {
		slotCount: byNameTime.size,
		dateCount: allDates.size,
		totalEntries,
		categories,
	};
}

/** Preview for add-missing mode: same block+fill span merge as server, then ∩ [fillFrom,fillTo] ∩ today+. */
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
		if ( null === openM || null === closeM || openM + sessionM > closeM ) {
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
	const categories: CategoryPreview[] = Array.from( byCategory.entries() ).map( ( [ displayName, v ] ) => ( {
		displayName,
		sessionTimeCount: v.times.size,
		uniqueDates: v.allDates.size,
		slotDateCells: v.cells,
	} ) );
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

/** Lexicographic min/max for Y-m-d (ISO) strings. */
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

export default function Schedule() {
	const { id } = useParams();
	const eventId = id ? String( id ) : '';
	const navigate = useNavigate();
	const { data: eventData, isLoading, isError, error } = useEvent( eventId ) as {
		data:
			| {
					title?: string;
					dates?: unknown[];
					id?: number;
					bookingMethod?: string;
					siteTodayYmd?: string;
			  }
			| undefined;
		isLoading: boolean;
		isError: boolean;
		error: Error | null;
	};
	const gen = useGenerateSlots( eventId );
	const addManual = useAddManualSlot( eventId );
	const addStock = useAddSlotStock( eventId );

	const siteTodayYmd = useMemo( () => {
		const raw =
			eventData && typeof eventData.siteTodayYmd === 'string'
				? eventData.siteTodayYmd.trim()
				: '';
		return /^\d{4}-\d{2}-\d{2}$/.test( raw ) ? raw : todayYmdLocal();
	}, [ eventData ] );

	const [ manualDate, setManualDate ] = useState( todayYmdLocal );
	const [ manualTime, setManualTime ] = useState( '09:00' );
	const [ manualCapacity, setManualCapacity ] = useState( 10 );
	const [ manualLabel, setManualLabel ] = useState( '' );
	const [ manualAddMode, setManualAddMode ] = useState< 'newSession' | 'extraSpots' >( 'newSession' );
	const [ manualSpotSelectValue, setManualSpotSelectValue ] = useState( '' );
	const [ manualAddSpotsDelta, setManualAddSpotsDelta ] = useState( 1 );
	const [ manualStockConfirmOpen, setManualStockConfirmOpen ] = useState( false );
	const [ blocks, setBlocks ] = useState<ScheduleBlock[]>( [ emptyBlock( 0 ) ] );
	const [ sessionMinutes, setSessionMinutes ] = useState( 10 );
	const [ capacity, setCapacity ] = useState( 10 );
	const [ formInitialized, setFormInitialized ] = useState( false );
	const [ confirmOpen, setConfirmOpen ] = useState( false );
	const [ fillFromYmd, setFillFromYmd ] = useState( () => todayYmdLocal() );
	const [ fillToYmd, setFillToYmd ] = useState( () => todayYmdLocal() );
	const [ fillConfirmOpen, setFillConfirmOpen ] = useState( false );

	/** Keep fill range aligned with site "today" (WordPress). fill from/to are initialized with the browser calendar; once siteTodayYmd loads, any fill date strictly before it is stale and the server will never enumerate those days. */
	useEffect( () => {
		if ( ! /^\d{4}-\d{2}-\d{2}$/.test( siteTodayYmd ) ) {
			return;
		}
		const f = fillFromYmd.trim();
		const t = fillToYmd.trim();
		if ( ! /^\d{4}-\d{2}-\d{2}$/.test( f ) || ! /^\d{4}-\d{2}-\d{2}$/.test( t ) ) {
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
			setCapacity( 10 );
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

	/** Block past days in fill range pickers; occupied days are allowed (e.g. extend hours). */
	function fillRangeCalendarDisablePast( date: Date ) {
		return dateToLocalYmd( date ) < siteTodayYmd;
	}

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
			if ( prev && spotsEligibleSchedule.some( ( s ) => encodeManualSlotDateRef( s ) === prev ) ) {
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

	function scheduleSlotPickerLabel( s: SlotLike ): string {
		const t = formatSlotTime( s );
		const lab = ( s.label ?? '' ).trim();
		const head = lab || t;
		const cap =
			s.stock === null || s.stock === undefined
				? 'Unlimited'
				: `${ s.stock } cap`;
		return `${ head } · ${ t } · ${ cap }`;
	}

	function updateBlock( blockId: string, patch: Partial<ScheduleBlock> ) {
		setBlocks( ( prev ) =>
			prev.map( ( b ) => ( b.id === blockId ? { ...b, ...patch } : b ) )
		);
	}

	function toggleWeekday( blockId: string, n: number, checked: boolean ) {
		const b = blocks.find( ( x ) => x.id === blockId );
		if ( ! b ) {
			return;
		}
		const set = new Set( b.weekdays );
		if ( checked ) {
			set.add( n );
		} else {
			set.delete( n );
		}
		updateBlock( blockId, { weekdays: Array.from( set ).sort( ( a, c ) => a - c ) } );
	}

	async function submitManualSlot( ev: FormEvent ) {
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
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	async function commitManualStockAdd() {
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
			toast.success( `Added ${ manualAddSpotsDelta } ticket spot(s).` );
			setManualStockConfirmOpen( false );
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	async function runGenerate() {
		setConfirmOpen( false );
		try {
			const res = await gen.mutateAsync( {
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
			} ) as { warnings?: string[]; slotsWritten?: number; totalEntries?: number };
			if ( res.warnings && res.warnings.length ) {
				for ( const w of res.warnings ) {
					toast.message( w );
				}
			}
			toast.success(
				`Schedule saved: ${ res.slotsWritten ?? '?' } session times, ${ res.totalEntries ?? '?' } slot–date cells.`
			);
			navigate( `/event/${ eventId }` );
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	async function runFillEmpty() {
		setFillConfirmOpen( false );
		try {
			const res = await gen.mutateAsync( {
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
			} ) as {
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
			navigate( `/event/${ eventId }` );
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	if ( isLoading ) {
		return (
			<div className="space-y-3">
				<Skeleton className="h-8 w-2/3" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}
	if ( isError ) {
		return (
			<div className="text-destructive">
				{ String( error?.message || 'Error' ) }{ ' ' }
				<Link to={ `/event/${ eventId }` } className="text-primary underline">
					Back to event
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<Link
					to={ `/event/${ eventId }` }
					className="text-primary mb-1 inline-block text-sm hover:underline"
				>
					&larr; Event
				</Link>
				<h1 className="text-2xl font-bold tracking-tight">Manage schedule</h1>
				<p className="text-muted-foreground text-sm">
					{ eventData?.title } — use <strong>Manual sessions</strong> to add a single time on one
					day without changing anything else (slot-first and date-first). Use{' '}
					<strong>Add missing sessions</strong> below to merge new block times into a date range
					(including extra hours on days that already have sessions). The{ ' ' }
					<strong>danger zone</strong> still replaces the entire grid. See the{ ' ' }
					<Link to={ `/event/${ eventId }` } className="text-primary underline">
						event page
					</Link>{ ' ' }
					for current dates and availability.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Defaults</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap items-end gap-4">
						<div className="space-y-2">
							<Label>Session length</Label>
							<Select
								value={ String( sessionMinutes ) }
								onValueChange={ ( v ) => setSessionMinutes( parseInt( v, 10 ) ) }
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ SESSION_OPTIONS.map( ( n ) => (
										<SelectItem key={ n } value={ String( n ) }>
											{ n } min
										</SelectItem>
									) ) }
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="capacity">Capacity</Label>
							<p className="text-muted-foreground text-xs">0 = unlimited</p>
							<Input
								id="capacity"
								type="number"
								min={ 0 }
								className="w-32"
								value={ capacity }
								onChange={ ( e ) => setCapacity( parseInt( e.target.value, 10 ) || 0 ) }
							/>
						</div>
					</div>
					<p className="text-muted-foreground text-xs">
						Each block can have a <strong>schedule name</strong> (e.g. Regular, Late) stored as the
						slot label; the storefront shows name plus time. Leave the name empty to use the
						time only. Use multiple blocks for different date ranges or hours.
					</p>
				</CardContent>
			</Card>

			<>
					<Card className="border-primary/30">
						<CardHeader className="pb-2">
							<CardTitle className="flex items-center gap-2 text-lg">
								<Plus className="size-5" aria-hidden />
								Manual sessions
							</CardTitle>
							<p className="text-muted-foreground text-sm leading-relaxed">
								For one calendar day: create a <strong>new session</strong> (new time / label) or{' '}
								<strong>add ticket spots</strong> to a session that already exists with a numeric
								capacity (not unlimited).
							</p>
						</CardHeader>
						<CardContent className="space-y-4">
							<ScheduleBlockDatePicker
								label="Date"
								ymd={ manualDate }
								onSelectYmd={ setManualDate }
								triggerId="manual-date"
								disabled={ scheduleManualBusy }
								className="max-w-xs"
							/>
							<div className="space-y-2">
								<p className="text-muted-foreground text-xs font-medium">What do you want to do?</p>
								<ToggleGroup
									type="single"
									value={ manualAddMode }
									onValueChange={ ( v ) => {
										if ( v === 'newSession' || v === 'extraSpots' ) {
											setManualAddMode( v );
										}
									} }
									disabled={ scheduleManualBusy || gen.isPending }
									className="grid w-full max-w-md grid-cols-2 gap-2"
								>
									<ToggleGroupItem value="newSession" className="text-sm">
										New session
									</ToggleGroupItem>
									<ToggleGroupItem value="extraSpots" className="text-sm">
										Add ticket spots
									</ToggleGroupItem>
								</ToggleGroup>
							</div>
							{ manualAddMode === 'extraSpots' ? (
								<form className="space-y-4" onSubmit={ submitManualSlot }>
									<div className="space-y-2">
										<Label>Session on this date</Label>
										{ spotsEligibleSchedule.length === 0 ? (
											<p className="text-muted-foreground text-sm">
												No sessions with a fixed capacity on that date. Pick another date or use
												New session.
											</p>
										) : (
											<Select
												value={ manualSpotSelectValue }
												onValueChange={ setManualSpotSelectValue }
												disabled={ scheduleManualBusy || gen.isPending }
											>
												<SelectTrigger className="w-full max-w-xl">
													<SelectValue placeholder="Choose session" />
												</SelectTrigger>
												<SelectContent>
													{ spotsEligibleSchedule.map( ( s ) => (
														<SelectItem
															key={ encodeManualSlotDateRef( s ) }
															value={ encodeManualSlotDateRef( s ) }
														>
															{ scheduleSlotPickerLabel( s ) }
														</SelectItem>
													) ) }
												</SelectContent>
											</Select>
										) }
									</div>
									<div className="space-y-2">
										<Label htmlFor="sched-add-spots">Additional spots</Label>
										<p className="text-muted-foreground text-xs">
											Adds to the session&apos;s current numeric limit.
										</p>
										<Input
											id="sched-add-spots"
											type="number"
											min={ 1 }
											className="w-[120px]"
											value={ manualAddSpotsDelta }
											onChange={ ( e ) => {
												const n = parseInt( e.target.value, 10 );
												setManualAddSpotsDelta(
													Number.isFinite( n ) && n >= 1 ? n : 1,
												);
											} }
											disabled={
												scheduleManualBusy
												|| gen.isPending
												|| spotsEligibleSchedule.length === 0
											}
											required
										/>
									</div>
									<Button
										type="submit"
										disabled={
											scheduleManualBusy
											|| gen.isPending
											|| spotsEligibleSchedule.length === 0
											|| manualAddSpotsDelta < 1
										}
									>
										Continue
									</Button>
								</form>
							) : (
								<form
									className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
									onSubmit={ submitManualSlot }
								>
									<div className="space-y-2">
										<Label htmlFor="manual-time">Time</Label>
										<Input
											id="manual-time"
											type="time"
											value={ manualTime }
											onChange={ ( e ) => setManualTime( e.target.value ) }
											disabled={ scheduleManualBusy }
											required
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="manual-cap">Capacity</Label>
										<p className="text-muted-foreground text-xs">0 = unlimited</p>
										<Input
											id="manual-cap"
											type="number"
											min={ 0 }
											className="w-[120px]"
											value={ manualCapacity }
											onChange={ ( e ) =>
												setManualCapacity(
													parseInt( e.target.value, 10 ) || 0,
												)
											}
											disabled={ scheduleManualBusy }
											required
										/>
									</div>
									<div className="min-w-[200px] flex-1 space-y-2">
										<Label htmlFor="manual-label">Schedule label (optional)</Label>
										<Input
											id="manual-label"
											placeholder="Same as bulk blocks (e.g. Regular)"
											value={ manualLabel }
											onChange={ ( e ) => setManualLabel( e.target.value ) }
											disabled={ scheduleManualBusy }
											maxLength={ 60 }
											autoComplete="off"
										/>
									</div>
									{ manualAddWouldDuplicate ? (
										<p className="text-destructive w-full text-sm">{ manualDuplicateMessage }</p>
									) : null }
									<Button
										type="submit"
										disabled={
											scheduleManualBusy || gen.isPending || manualAddWouldDuplicate
										}
									>
										{ addManual.isPending ? 'Adding…' : 'Add session' }
									</Button>
								</form>
							) }
						</CardContent>
					</Card>

					<Dialog
						open={ manualStockConfirmOpen }
						onOpenChange={ ( open ) => {
							if ( ! scheduleManualBusy ) {
								setManualStockConfirmOpen( open );
							}
						} }
					>
						<DialogContent showCloseButton={ ! scheduleManualBusy }>
							<DialogHeader>
								<DialogTitle>Add ticket spots?</DialogTitle>
								<DialogDescription>
									Extra capacity for this session on{ ' ' }
									<span className="font-mono text-foreground">{ manualDate.trim() }</span>.
								</DialogDescription>
							</DialogHeader>
							<div className="bg-muted/40 border-border space-y-2 rounded-lg border px-3 py-3 text-sm">
								<div className="flex flex-wrap justify-between gap-2">
									<span className="text-muted-foreground">Session</span>
									<span className="max-w-[min(100%,16rem)] text-right font-medium break-words">
										{ selectedSpotSchedule
											? scheduleSlotPickerLabel( selectedSpotSchedule )
											: '—' }
									</span>
								</div>
								<div className="flex flex-wrap justify-between gap-2">
									<span className="text-muted-foreground">Current capacity</span>
									<span className="font-medium tabular-nums">
										{ selectedSpotSchedule != null
										&& typeof selectedSpotSchedule.stock === 'number'
											? selectedSpotSchedule.stock
											: '—' }
									</span>
								</div>
								<div className="flex flex-wrap justify-between gap-2">
									<span className="text-muted-foreground">Adding</span>
									<span className="font-medium tabular-nums">+{ manualAddSpotsDelta }</span>
								</div>
								<div className="flex flex-wrap justify-between gap-2">
									<span className="text-muted-foreground">New capacity</span>
									<span className="font-medium tabular-nums">
										{ selectedSpotSchedule != null
										&& typeof selectedSpotSchedule.stock === 'number'
											? selectedSpotSchedule.stock + manualAddSpotsDelta
											: '—' }
									</span>
								</div>
							</div>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={ () => setManualStockConfirmOpen( false ) }
									disabled={ scheduleManualBusy }
								>
									Cancel
								</Button>
								<Button
									type="button"
									onClick={ commitManualStockAdd }
									disabled={ scheduleManualBusy }
								>
									{ addStock.isPending ? 'Saving…' : 'Confirm add spots' }
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					<section aria-labelledby="schedule-blocks-heading" className="space-y-4">
						<h2 id="schedule-blocks-heading" className="text-lg font-semibold tracking-tight">
							Schedule blocks
						</h2>
						<p className="text-muted-foreground text-sm">
							These blocks drive both <strong>add missing sessions</strong> (merge) and{' '}
							<strong>replace all</strong> in the danger zone. Start/end set which calendar days
							each block applies to; open/close set the session times generated for those days.
						</p>
						<div className="space-y-4">
							{ blocks.map( ( b, idx ) => (
								<Card key={ b.id }>
									<CardHeader className="flex flex-row items-center justify-between space-y-0">
										<CardTitle>Block { idx + 1 }</CardTitle>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={ () => setBlocks( ( prev ) => prev.filter( ( x ) => x.id !== b.id ) ) }
											disabled={ blocks.length <= 1 }
										>
											Remove block
										</Button>
									</CardHeader>
									<CardContent className="space-y-4">
										<div className="space-y-2">
											<Label htmlFor={ `${ b.id }-name` }>Schedule name</Label>
											<Input
												id={ `${ b.id }-name` }
												placeholder={ idx === 0 ? 'Regular' : 'Late' }
												value={ b.name }
												onChange={ ( e ) => updateBlock( b.id, { name: e.target.value } ) }
												className="max-w-md"
												autoComplete="off"
											/>
											<p className="text-muted-foreground text-xs">
												FooEvents slot label prefix. Empty = use session time (HH:MM) as the label.
											</p>
										</div>
										<div className="flex flex-wrap gap-3">
											<ScheduleBlockDatePicker
												label="Start"
												ymd={ b.startDate }
												onSelectYmd={ ( next ) => updateBlock( b.id, { startDate: next } ) }
												triggerId={ `${ b.id }-start-date` }
											/>
											<ScheduleBlockDatePicker
												label="End"
												ymd={ b.endDate }
												onSelectYmd={ ( next ) => updateBlock( b.id, { endDate: next } ) }
												triggerId={ `${ b.id }-end-date` }
											/>
										</div>
										<div className="space-y-2">
											<Label>Weekdays</Label>
											<div className="flex flex-wrap gap-3">
												{ WD_LABELS.map( ( { n, short } ) => (
													<div key={ n } className="flex items-center space-x-2">
														<Checkbox
															id={ `${ b.id }-wd-${ n }` }
															checked={ b.weekdays.includes( n ) }
															onCheckedChange={ ( c ) => toggleWeekday( b.id, n, c === true ) }
														/>
														<Label
															htmlFor={ `${ b.id }-wd-${ n }` }
															className="text-sm font-normal"
														>
															{ short }
														</Label>
													</div>
												) ) }
											</div>
										</div>
										<div className="flex flex-wrap gap-3">
											<div className="space-y-2">
												<Label>Open</Label>
												<Input
													type="time"
													value={ b.openTime }
													onChange={ ( e ) => updateBlock( b.id, { openTime: e.target.value } ) }
												/>
											</div>
											<div className="space-y-2">
												<Label>Close</Label>
												<Input
													type="time"
													value={ b.closeTime }
													onChange={ ( e ) => updateBlock( b.id, { closeTime: e.target.value } ) }
												/>
											</div>
										</div>
									</CardContent>
								</Card>
							) ) }
							<Button
								type="button"
								variant="secondary"
								onClick={ () => setBlocks( ( prev ) => [ ...prev, emptyBlock( prev.length ) ] ) }
							>
								+ Add schedule block
							</Button>
						</div>
					</section>

					<section
						aria-labelledby="fill-empty-heading"
						className="border-border bg-muted/25 space-y-4 rounded-lg border p-4 sm:p-5"
					>
						<div className="space-y-2">
							<h2 id="fill-empty-heading" className="text-lg font-semibold tracking-tight">
								Add missing sessions
							</h2>
							<p className="text-muted-foreground text-sm leading-relaxed">
								Pick a fill-from / fill-to range. Each schedule block is merged with that range
								(earlier start / later end) so missing days inside the range are included even when
								the block&apos;s saved dates start later. The server adds every session from your
								blocks that falls in the fill range and <strong>is not already on the schedule</strong>{ ' ' }
								— on brand-new days or on days that already have earlier hours (e.g. extend closing
								from 16:50 to 19:50). Existing slot rows are never removed. True duplicates are
								skipped with a warning. Days outside a block&apos;s weekdays still get no sessions
								for that block.
							</p>
						</div>
						<div className="flex flex-wrap gap-3">
							<ScheduleBlockDatePicker
								label="Fill from"
								ymd={ fillFromYmd }
								onSelectYmd={ setFillFromYmd }
								triggerId="fill-from-ymd"
								disabled={ gen.isPending }
								isDateDisabled={ fillRangeCalendarDisablePast }
							/>
							<ScheduleBlockDatePicker
								label="Fill to"
								ymd={ fillToYmd }
								onSelectYmd={ setFillToYmd }
								triggerId="fill-to-ymd"
								disabled={ gen.isPending }
								isDateDisabled={ fillRangeCalendarDisablePast }
							/>
						</div>
						{ fillRangeInvalid ? (
							<p className="text-destructive text-sm">
								Choose valid Y-m-d dates with &quot;from&quot; on or before &quot;to&quot;.
							</p>
						) : null }
						<Card className="border-border/80 bg-background/80">
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Preview (candidate cells in range)</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 text-sm">
								<p>
									<span className="text-muted-foreground">New slot–date cells to add:</span>{ ' ' }
									<Badge>{ fillPreview.totalEntries }</Badge>
								</p>
								<p>
									<span className="text-muted-foreground">Calendar days in fill range (inclusive):</span>{ ' ' }
									<strong>{ fillPreview.fillRangeInclusiveDays }</strong>
								</p>
								<p>
									<span className="text-muted-foreground">
										Distinct days with candidate sessions (weekdays per block):
									</span>{ ' ' }
									<strong>{ fillPreview.dateCount }</strong>
								</p>
								{ ! fillRangeInvalid
								&& fillPreview.fillRangeInclusiveDays > 0
								&& fillPreview.dateCount < fillPreview.fillRangeInclusiveDays ? (
									<p className="text-muted-foreground text-xs leading-snug">
										The fill range can include days where no block runs (e.g. a Sunday when this
										schedule is Mon–Thu only). Add another block for those weekdays if you need
										sessions on every calendar day.
									</p>
								) : null }
								{ fillPreview.categories.length > 0 && (
									<div className="text-muted-foreground space-y-1 border-t border-border/60 pt-2 text-xs">
										<p className="font-medium text-foreground">By schedule name</p>
										<ul className="list-inside list-disc space-y-1">
											{ fillPreview.categories.map( ( c ) => (
												<li key={ c.displayName }>
													<span className="text-foreground font-medium">{ c.displayName }</span>
													{ ': ' }
													{ c.slotDateCells } cells, { c.sessionTimeCount } session start
													{ c.sessionTimeCount === 1 ? '' : 's' }
												</li>
											) ) }
										</ul>
									</div>
								) }
								<p className="text-muted-foreground text-xs">
									Cannot pick dates before the site&apos;s today ({ ' ' }
									<span className="font-mono text-foreground">{ siteTodayYmd }</span>). Preview
									matches the server on fill-span merge and range; the server may add fewer if some
									cells already exist.
								</p>
							</CardContent>
						</Card>
						<Button
							type="button"
							size="lg"
							variant="default"
							disabled={
								gen.isPending
								|| scheduleManualBusy
								|| fillPreview.totalEntries === 0
								|| fillRangeInvalid
							}
							onClick={ () => setFillConfirmOpen( true ) }
						>
							{ gen.isPending ? 'Saving…' : 'Add missing sessions…' }
						</Button>
					</section>

					<Dialog open={ fillConfirmOpen } onOpenChange={ setFillConfirmOpen }>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add missing sessions?</DialogTitle>
								<DialogDescription>
									This <strong>keeps</strong> all existing FooEvents slots and appends up to about{ ' ' }
									<strong>{ fillPreview.totalEntries }</strong> new slot–date cell(s) between{ ' ' }
									<span className="font-mono text-foreground">{ fillFromYmd.trim() }</span> and{ ' ' }
									<span className="font-mono text-foreground">{ fillToYmd.trim() }</span>, from the
									blocks and Defaults. Times that already exist for a day are skipped (with a
									warning when applicable).
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={ () => setFillConfirmOpen( false ) }
								>
									Cancel
								</Button>
								<Button
									type="button"
									onClick={ runFillEmpty }
									disabled={ gen.isPending || fillPreview.totalEntries === 0 || fillRangeInvalid }
								>
									{ gen.isPending ? 'Saving…' : 'Add sessions' }
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					<Separator />
			</>

			<section
				aria-labelledby="schedule-danger-zone-heading"
				className="bg-destructive/[0.06] space-y-6 rounded-lg border border-destructive/35 p-4 sm:p-5 dark:bg-destructive/10"
			>
				<div className="bg-background/85 flex gap-3 rounded-md border border-destructive/45 px-4 py-3 dark:bg-background/55">
					<TriangleAlert
						className="text-destructive mt-0.5 size-5 shrink-0"
						aria-hidden
					/>
					<div className="space-y-2 text-sm">
						<p id="schedule-danger-zone-heading" className="text-destructive font-semibold">
							Danger zone
						</p>
						<p className="text-muted-foreground leading-relaxed">
							Saving from this section <strong className="text-foreground">overwrites</strong> every
							existing FooEvents booking slot and date on this product with a freshly generated
							schedule. Existing ticket counts and bookings may no longer line up with the new
							grid—customers could see the wrong session, or the same slot could effectively be
							booked twice. Only use this when you intend a full reset and understand the impact.
						</p>
					</div>
				</div>

			<Card>
				<CardHeader>
					<CardTitle>Preview (full replace)</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<p>
						<span className="text-muted-foreground">Unique (name + time) slots:</span>{ ' ' }
						<strong>{ preview.slotCount }</strong>
					</p>
					<p>
						<span className="text-muted-foreground">Unique dates (all blocks):</span>{ ' ' }
						<strong>{ preview.dateCount }</strong>
					</p>
					<p>
						<span className="text-muted-foreground">Total slot–date cells to write:</span>{ ' ' }
						<Badge>{ preview.totalEntries }</Badge>
					</p>
					{ preview.categories.length > 0 && (
						<div className="text-muted-foreground space-y-1 border-t border-border/60 pt-2 text-xs">
							<p className="font-medium text-foreground">By schedule name</p>
							<ul className="list-inside list-disc space-y-1">
								{ preview.categories.map( ( c ) => (
									<li key={ c.displayName }>
										<span className="text-foreground font-medium">{ c.displayName }</span>
										{ ': ' }
										{ c.slotDateCells } slot–date cells, { c.uniqueDates } unique dates, { ' ' }
										{ c.sessionTimeCount } session start{ c.sessionTimeCount === 1 ? '' : 's' }
									</li>
								) ) }
							</ul>
						</div>
					) }
					<p className="text-muted-foreground text-xs">
						Preview uses your browser&apos;s local calendar; the server recalculates in the WordPress
						timezone when you generate.
					</p>
				</CardContent>
			</Card>

			<Button
				type="button"
				size="lg"
				disabled={ gen.isPending || preview.totalEntries === 0 }
				onClick={ () => setConfirmOpen( true ) }
			>
				{ gen.isPending ? 'Saving…' : 'Generate and replace' }
			</Button>
			</section>

			<Dialog open={ confirmOpen } onOpenChange={ setConfirmOpen }>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Replace all slots?</DialogTitle>
						<DialogDescription>
							This will <strong>delete</strong> every existing FooEvents booking slot and date
							attachment on this product, then write a new schedule from the form. This cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={ () => setConfirmOpen( false ) }
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={ runGenerate }
							disabled={ gen.isPending }
						>
							Replace and save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
