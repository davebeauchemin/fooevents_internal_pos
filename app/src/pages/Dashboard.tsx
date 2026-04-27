import { useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { CalendarIcon, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useDashboard } from '../api/queries.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type SlotRow = {
	id: string;
	dateId: string;
	label: string;
	time: string;
	stock: number | null;
};

type DayEvent = {
	eventId: number;
	eventTitle: string;
	eventImage: string;
	dateLabel: string;
	slots: SlotRow[];
};

type DashboardResponse = {
	date: string;
	events: DayEvent[];
};

function StockBadge( { stock }: { stock: number | null } ) {
	if ( stock === null || stock === undefined ) {
		return <Badge variant="secondary">Unlimited</Badge>;
	}
	if ( stock === 0 ) {
		return <Badge variant="destructive">FULL</Badge>;
	}
	if ( stock <= 2 ) {
		return (
			<Badge
				className="border-amber-500/50 bg-amber-100 text-amber-900 hover:bg-amber-100"
			>
				{ stock } left
			</Badge>
		);
	}
	return <Badge>{ stock } left</Badge>;
}

function formatTime( slot: SlotRow ) {
	if ( slot.time && /^\d{2}:\d{2}$/.test( slot.time ) ) {
		return slot.time;
	}
	// Heuristic: time often at end of label
	const m = slot.label.match( /(\d{1,2}:\d{2}\s*(?:[ap]m|AM|PM)?)/ );
	if ( m ) {
		return m[ 1 ];
	}
	return '—';
}

export default function Dashboard() {
	/** '' = use WordPress site-local today. */
	const [ ymd, setYmd ] = useState( '' );
	const { data, isLoading, isError, error, isFetching, dataUpdatedAt } = useDashboard( ymd ) as {
		data: DashboardResponse | undefined;
		isLoading: boolean;
		isError: boolean;
		error: Error | null;
		isFetching: boolean;
		dataUpdatedAt: number;
	};

	const displayYmd = ymd || data?.date || '';

	const calendarDate = useMemo( () => {
		if ( ! displayYmd ) {
			return undefined;
		}
		return parseISO( `${ displayYmd }T12:00:00` );
	}, [ displayYmd ] );

	useEffect( () => {
		if ( isError && error ) {
			toast.error( String( ( error as Error )?.message || error || 'Failed to load dashboard' ) );
		}
	}, [ isError, error ] );

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Today’s schedule</h1>
					<p className="text-muted-foreground text-sm">
						Read-only · live refresh every 30s
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Popover>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								className={ cn(
									'w-[min(100%,240px)] justify-start text-left font-normal',
								) }
								type="button"
							>
								<CalendarIcon className="mr-2 h-4 w-4" />
								{ displayYmd
									? format( parseISO( `${ displayYmd }T12:00:00` ), 'PP' )
									: 'Select date' }
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-0" align="start">
							<Calendar
								mode="single"
								selected={ calendarDate }
								onSelect={ ( d ) => {
									if ( d ) {
										setYmd( format( d, 'yyyy-MM-dd' ) );
									}
								} }
								initialFocus
							/>
						</PopoverContent>
					</Popover>
					<Button
						variant="secondary"
						type="button"
						onClick={ () => setYmd( '' ) }
					>
						Today
					</Button>
					{ dataUpdatedAt > 0 && (
						<span className="text-muted-foreground text-xs">
							Updated { ' ' }
							{ formatDistanceToNow( dataUpdatedAt, { addSuffix: true } ) }
							{ isFetching && ' · refreshing…' }
						</span>
					) }
				</div>
			</div>

			{ isLoading && (
				<div className="space-y-3">
					{ [ 1, 2, 3 ].map( ( k ) => (
						<Skeleton key={ k } className="h-28 w-full rounded-xl" />
					) ) }
				</div>
			) }

			{ ! isLoading && ! isError && data && data.events.length === 0 && (
				<Card>
					<CardContent className="pt-6 text-muted-foreground">
						No bookable slots on { displayYmd || 'this day' }.
					</CardContent>
				</Card>
			) }

			{ ! isLoading && data && data.events.length > 0 && (
				<div className="space-y-6">
					{ data.events.map( ( ev, i ) => (
						<div key={ `${ ev.eventId }-${ ev.dateLabel }` }>
							{ i > 0 && <Separator className="mb-6" /> }
							<Card>
								<CardHeader>
									<div className="flex items-start gap-3">
										{ ev.eventImage ? (
											<img
												src={ ev.eventImage }
												alt=""
												className="h-16 w-16 rounded-lg object-cover"
											/>
										) : (
											<div className="bg-muted text-muted-foreground flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg text-xs">
												—
											</div>
										) }
										<div className="min-w-0 flex-1">
											<CardTitle className="text-lg">
												<Link
													to={ `/event/${ ev.eventId }` }
													className="text-primary hover:underline"
												>
													{ ev.eventTitle }
												</Link>
											</CardTitle>
											<p className="text-muted-foreground text-xs">{ ev.dateLabel }</p>
										</div>
									</div>
								</CardHeader>
								<CardContent className="space-y-2 pt-0">
									{ ev.slots.map( ( s ) => (
										<div
											key={ `${ s.id }-${ s.dateId }` }
											className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
										>
											<div className="flex min-w-0 items-center gap-3">
												<div className="text-muted-foreground flex w-14 shrink-0 items-center gap-1 font-mono text-sm">
													<Clock3 className="h-3.5 w-3.5" />
													{ formatTime( s ) }
												</div>
												<div className="min-w-0 truncate text-sm">
													{ s.label }
												</div>
											</div>
											<StockBadge stock={ s.stock } />
										</div>
									) ) }
								</CardContent>
							</Card>
						</div>
					) ) }
				</div>
			) }
		</div>
	);
}
