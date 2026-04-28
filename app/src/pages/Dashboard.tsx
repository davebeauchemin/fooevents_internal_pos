import { useEffect, useMemo, useState } from 'react';
import { addDays, format, formatDistanceToNow, isSameDay, parseISO } from 'date-fns';
import { CalendarIcon, Clock3, Loader2 } from 'lucide-react';
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
import POSCheckoutPanel from '@/components/POSCheckoutPanel';
import type { POSSelection } from '@/types/posSelection';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import {
	formatSlotTime,
	groupSlotsByHour,
	hourRangeTitle,
	hourRemainingSpotsLabel,
} from '@/lib/slotHourGrouping';

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
	price?: number | null;
	priceHtml?: string;
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

function slotSelectable(
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

export default function Dashboard() {
	/** '' = use WordPress site-local today. */
	const [ ymd, setYmd ] = useState( '' );
	/**
	 * Real calendar "today" (Y-m-d) from the first default dashboard response.
	 * `data.date` is always the *viewed* day, so it must not drive Today/Tomorrow labels after the user picks another date.
	 */
	const [ siteTodayYmd, setSiteTodayYmd ] = useState<string | null>( null );
	const [ checkoutSelection, setCheckoutSelection ] = useState<POSSelection | null>(
		null,
	);
	const {
		data,
		isLoading,
		isError,
		error,
		isFetching,
		dataUpdatedAt,
		isPlaceholderData,
	} = useDashboard( ymd ) as {
		data: DashboardResponse | undefined;
		isLoading: boolean;
		isError: boolean;
		error: Error | null;
		isFetching: boolean;
		dataUpdatedAt: number;
		isPlaceholderData: boolean;
	};

	const displayYmd = ymd || data?.date || '';

	const calendarDate = useMemo( () => {
		if ( ! displayYmd ) {
			return undefined;
		}
		return parseISO( `${ displayYmd }T12:00:00` );
	}, [ displayYmd ] );

	/** Site “today” Y-m-d — same source for Today/Tomorrow labels and the fixed 7-day strip. */
	const effectiveSiteTodayYmd = useMemo(
		() =>
			siteTodayYmd
			?? ( ymd === '' && data?.date ? data.date : null )
			?? format( new Date(), 'yyyy-MM-dd' ),
		[ siteTodayYmd, ymd, data?.date ],
	);

	const refTodayForLabels = useMemo(
		() => parseISO( `${ effectiveSiteTodayYmd }T12:00:00` ),
		[ effectiveSiteTodayYmd ],
	);

	/** Always site today → today+6. Does not re-anchor when viewing another day. */
	const quickDates = useMemo( () => {
		const start = refTodayForLabels;
		return Array.from( { length: 7 }, ( _, i ) => {
			const date = addDays( start, i );
			return { ymd: format( date, 'yyyy-MM-dd' ), date };
		} );
	}, [ refTodayForLabels ] );

	useEffect( () => {
		if ( ymd === '' && data?.date ) {
			setSiteTodayYmd( ( prev ) => prev ?? data.date );
		}
	}, [ ymd, data?.date ] );

	useEffect( () => {
		setCheckoutSelection( null );
	}, [ displayYmd ] );

	useEffect( () => {
		if ( isError && error ) {
			toast.error( String( ( error as Error )?.message || error || 'Failed to load dashboard' ) );
		}
	}, [ isError, error ] );

	/**
	 * Initial load, date change (placeholder), or any fetch without a completed `data` yet.
	 * Shows fixed copy + spinner; same-key 30s refresh still uses the “Updated” line + spinner.
	 */
	const showLoadingDataLine =
		isFetching && ( isLoading || isPlaceholderData || ! data );

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
				<div className="w-full min-w-0 text-left sm:flex-1">
					<h1 className="text-2xl font-bold tracking-tight">Today’s schedule</h1>
					<p className="text-muted-foreground text-sm">
						Live schedule · select slots and build an order (checkout link in header) · WooCommerce orders · auto refresh every 30s
					</p>
					{ /* Below subtitle (not in toolbar) so date row height stays fixed */ }
					<div className="text-muted-foreground mt-1 flex min-h-5 max-w-sm items-center justify-start gap-2 text-xs">
						{ showLoadingDataLine ? (
							<>
								<span className="inline-flex size-3.5 shrink-0 items-center justify-center">
									<Loader2 className="text-muted-foreground size-3.5 animate-spin" />
								</span>
								<span
									className="min-w-0 flex-1 sm:min-w-[14.5rem]"
									aria-live="polite"
								>
									Loading data...
								</span>
							</>
						) : dataUpdatedAt > 0 ? (
							<>
								{ isFetching && (
									<span
										className="inline-flex size-3.5 shrink-0 items-center justify-center"
										aria-hidden
									>
										<Loader2 className="text-muted-foreground size-3.5 animate-spin" />
									</span>
								) }
								<span className="min-w-0 flex-1 tabular-nums sm:min-w-[14.5rem]">
									Updated{ ' ' }
									{ formatDistanceToNow( dataUpdatedAt, { addSuffix: true } ) }
								</span>
							</>
						) : (
							<span className="invisible sm:min-w-[14.5rem]" aria-hidden>
								Loading data...
							</span>
						) }
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2 sm:flex-1 sm:justify-end">
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
				</div>
			</div>

			<div>
				<p className="text-muted-foreground mb-2 text-sm font-medium">Date</p>
				<div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
					{ quickDates.map( ( pill ) => {
						const title = ( () => {
							if ( isSameDay( pill.date, refTodayForLabels ) ) {
								return 'Today';
							}
							if ( isSameDay( pill.date, addDays( refTodayForLabels, 1 ) ) ) {
								return 'Tomorrow';
							}
							return format( pill.date, 'PP' );
						} )();
						const isSelected = Boolean( displayYmd ) && displayYmd === pill.ymd;
						return (
							<button
								key={ pill.ymd }
								type="button"
								onClick={ () => setYmd( pill.ymd ) }
								className={ cn(
									'rounded-lg border px-3 py-2 text-left text-sm transition',
									isSelected
										? 'border-primary bg-primary/10 text-foreground'
										: 'border-border bg-card hover:border-primary/50',
								) }
							>
								<div className="max-w-[200px] truncate font-medium">
									{ title }
								</div>
								<div className="text-muted-foreground text-xs">
									{ pill.ymd }
								</div>
							</button>
						);
					} ) }
				</div>
			</div>

			{ isLoading && ! data && (
				<div className="space-y-3">
					{ [ 1, 2, 3 ].map( ( k ) => (
						<Skeleton key={ k } className="h-28 w-full rounded-xl" />
					) ) }
				</div>
			) }

			{ ! ( isLoading && ! data ) && ! isError && data && data.events.length === 0 && (
				<Card>
					<CardContent className="pt-6 text-muted-foreground">
						No bookable slots on { displayYmd || 'this day' }.
					</CardContent>
				</Card>
			) }

			{ ! ( isLoading && ! data ) && data && data.events.length > 0 && (
				<div
					className={ cn(
						'lg:grid lg:grid-cols-[1fr_minmax(280px,360px)] lg:items-start lg:gap-6',
						'space-y-6 lg:space-y-0 transition-opacity duration-200',
						isPlaceholderData && isFetching ? 'opacity-60' : 'opacity-100',
					) }
					aria-busy={ isPlaceholderData && isFetching }
				>
					<div className="min-w-0 space-y-6">
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
								<CardContent className="pt-0">
									<Accordion
										key={ `${ ev.eventId }-${ displayYmd }` }
										type="multiple"
										defaultValue={ [] }
										className="w-full"
									>
										{ groupSlotsByHour( ev.slots ).map( ( g ) => {
											const leftLabel = hourRemainingSpotsLabel( g.slots );
											return (
												<AccordionItem key={ g.key } value={ g.key }>
													<AccordionTrigger className="text-left hover:no-underline">
														<span className="flex w-full min-w-0 items-center justify-between gap-2 pr-1">
															<span className="shrink-0 font-mono text-sm">
																{ hourRangeTitle( g.hour ) }
															</span>
															<span className="flex shrink-0 items-center gap-2">
																<Badge
																	variant={
																		leftLabel === 'Unlimited'
																			? 'secondary'
																			: leftLabel === '0 left'
																				? 'destructive'
																				: 'outline'
																	}
																	className="font-mono text-xs"
																>
																	{ leftLabel }
																</Badge>
																<span className="text-muted-foreground text-xs tabular-nums">
																	{ g.slots.length } slot{ g.slots.length === 1 ? '' : 's' }
																</span>
															</span>
														</span>
													</AccordionTrigger>
													<AccordionContent>
														<div className="space-y-2 pl-0 sm:pl-1">
															{ g.slots.map( ( s ) => {
																const selectable = slotSelectable(
																	data.date,
																	s.stock,
																	effectiveSiteTodayYmd,
																);
																const rowKey = `${ ev.eventId }|${ s.id }|${ s.dateId }|${ data.date }`;
																const selKey = checkoutSelection
																	? `${ checkoutSelection.eventId }|${ checkoutSelection.slotId }|${ checkoutSelection.dateId }|${ checkoutSelection.viewDateYmd }`
																	: '';
																const selected = selectable && rowKey === selKey;
																const pickSlot = () => {
																	if ( ! selectable ) {
																		return;
																	}
																	setCheckoutSelection( {
																		eventId: ev.eventId,
																		eventTitle: ev.eventTitle,
																		dateLabel: ev.dateLabel,
																		viewDateYmd: data.date,
																		slotId: s.id,
																		dateId: s.dateId,
																		slotLabel: s.label,
																		slotTime: formatSlotTime( s ),
																		remaining: s.stock,
																		price: ev.price ?? null,
																		priceHtml: ev.priceHtml ?? '',
																	} );
																};
																return (
																<div
																	key={ `${ s.id }-${ s.dateId }` }
																	role={ selectable ? 'button' : undefined }
																	tabIndex={ selectable ? 0 : undefined }
																	onClick={ selectable ? pickSlot : undefined }
																	onKeyDown={
																		selectable
																			? ( e ) => {
																				if (
																					e.key === 'Enter'
																					|| e.key === ' '
																				) {
																					e.preventDefault();
																					pickSlot();
																				}
																			}
																			: undefined
																	}
																	className={ cn(
																		'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
																		selected
																			&& 'border-primary bg-primary/5 ring-2 ring-primary/30',
																		selectable && 'cursor-pointer hover:bg-muted/50',
																	) }
																>
																	<div className="flex min-w-0 items-center gap-3">
																		<div className="text-muted-foreground flex w-14 shrink-0 items-center gap-1 font-mono text-sm">
																			<Clock3 className="h-3.5 w-3.5" />
																			{ formatSlotTime( s ) }
																		</div>
																		<div className="min-w-0 truncate text-sm">
																			{ s.label }
																		</div>
																	</div>
																	<div className="flex shrink-0 items-center gap-2">
																		<StockBadge stock={ s.stock } />
																		<Button
																			type="button"
																			variant={ selected ? 'default' : 'outline' }
																			size="sm"
																			disabled={ ! selectable }
																			onClick={ ( e ) => {
																				e.stopPropagation();
																				pickSlot();
																			} }
																		>
																			Checkout
																		</Button>
																	</div>
																</div>
																);
															} ) }
														</div>
													</AccordionContent>
												</AccordionItem>
											);
										} ) }
									</Accordion>
								</CardContent>
							</Card>
						</div>
					) ) }
					</div>
					<div className="min-w-0">
						<POSCheckoutPanel
							selection={ checkoutSelection }
							siteTodayYmd={ effectiveSiteTodayYmd }
							onClear={ () => setCheckoutSelection( null ) }
						/>
					</div>
				</div>
			) }
		</div>
	);
}
