import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useAddManualSlot, useEvent, useGenerateSlots } from '../api/queries.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

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

function newId() {
	return typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: String( Date.now() ) + Math.random().toString( 16 ).slice( 2 );
}

function emptyBlock( blockIndex: number ): ScheduleBlock {
	const t = new Date();
	const ymd = t.toISOString().slice( 0, 10 );
	return {
		id: newId(),
		name: blockIndex === 0 ? 'Regular' : 'Late',
		startDate: ymd,
		endDate: ymd,
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
	const d = new Date( start + 'T12:00:00' );
	const endD = new Date( end + 'T12:00:00' );
	for ( let i = 0; i < 2000 && d <= endD; i++ ) {
		const n = d.getDay() === 0 ? 7 : d.getDay();
		if ( wset.has( n ) ) {
			out.push( d.toISOString().slice( 0, 10 ) );
		}
		d.setDate( d.getDate() + 1 );
	}
	return out;
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

function todayYmdLocal(): string {
	const t = new Date();
	return (
		t.getFullYear() +
		'-' +
		String( t.getMonth() + 1 ).padStart( 2, '0' ) +
		'-' +
		String( t.getDate() ).padStart( 2, '0' )
	);
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
			  }
			| undefined;
		isLoading: boolean;
		isError: boolean;
		error: Error | null;
	};
	const gen = useGenerateSlots( eventId );
	const addManual = useAddManualSlot( eventId );

	const [ manualDate, setManualDate ] = useState( todayYmdLocal );
	const [ manualTime, setManualTime ] = useState( '09:00' );
	const [ manualCapacity, setManualCapacity ] = useState( 10 );
	const [ manualLabel, setManualLabel ] = useState( '' );
	const [ blocks, setBlocks ] = useState<ScheduleBlock[]>( [ emptyBlock( 0 ) ] );
	const [ sessionMinutes, setSessionMinutes ] = useState( 10 );
	const [ capacity, setCapacity ] = useState( 10 );
	const [ formInitialized, setFormInitialized ] = useState( false );
	const [ confirmOpen, setConfirmOpen ] = useState( false );

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
		try {
			const payload: Record<string, unknown> = {
				date: manualDate.trim(),
				time: manualTime.trim(),
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
					day without changing anything else (slot-first and date-first). See dates and slot
					availability on the{' '}
					<Link to={ `/event/${ eventId }` } className="text-primary underline">
						event page
					</Link>
					. The bulk form below still <strong>replaces</strong> every slot on this product when
					saved (FooEvents slot-first generation).
				</p>
			</div>

			<>
					<Card className="border-primary/30">
						<CardHeader className="pb-2">
							<CardTitle className="flex items-center gap-2 text-lg">
								<Plus className="size-5" aria-hidden />
								Manual sessions
							</CardTitle>
							<p className="text-muted-foreground text-sm leading-relaxed">
								Adds one WooCommerce slot–date cell. Matches an existing slot when the label
								and time are the same so you can add an extra day to that row.
							</p>
						</CardHeader>
						<CardContent>
							<form
								className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
								onSubmit={ submitManualSlot }
							>
								<div className="space-y-2">
									<Label htmlFor="manual-date">Date</Label>
									<Input
										id="manual-date"
										type="date"
										value={ manualDate }
										onChange={ ( e ) => setManualDate( e.target.value ) }
										disabled={ addManual.isPending }
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="manual-time">Time</Label>
									<Input
										id="manual-time"
										type="time"
										value={ manualTime }
										onChange={ ( e ) => setManualTime( e.target.value ) }
										disabled={ addManual.isPending }
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
										disabled={ addManual.isPending }
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
										disabled={ addManual.isPending }
										maxLength={ 60 }
										autoComplete="off"
									/>
								</div>
								<Button
									type="submit"
									disabled={ addManual.isPending || gen.isPending }
								>
									{ addManual.isPending ? 'Adding…' : 'Add session' }
								</Button>
							</form>
						</CardContent>
					</Card>

					<Separator />
			</>

			<Card>
				<CardHeader>
					<CardTitle>Defaults</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap gap-4">
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
							<div className="space-y-2">
								<Label>Start</Label>
								<Input
									type="date"
									value={ b.startDate }
									onChange={ ( e ) => updateBlock( b.id, { startDate: e.target.value } ) }
								/>
							</div>
							<div className="space-y-2">
								<Label>End</Label>
								<Input
									type="date"
									value={ b.endDate }
									onChange={ ( e ) => updateBlock( b.id, { endDate: e.target.value } ) }
								/>
							</div>
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

			<Separator />

			<Card>
				<CardHeader>
					<CardTitle>Preview</CardTitle>
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
					<DialogFooter className="gap-2 sm:gap-0">
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
