import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, formatDistanceToNow, isSameDay, parseISO } from 'date-fns';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useDashboard } from '../api/queries.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import SlotCartToggleButton from '@/components/SlotCartToggleButton';
import TicketQuantitySelector from '@/components/TicketQuantitySelector';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import Cart from '@/components/Cart';
import BookingScheduleSummaryCards from '@/components/BookingScheduleSummaryCards';
import type {
	BookingScheduleSummaryPayload,
	LeadingDayTimeRange,
} from '@/components/BookingScheduleSummaryCards';
import { cartLineKey, useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import type { POSSelection } from '@/types/posSelection';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
	capacityLabelForSlots,
	defaultAccordionHourKey,
	formatSlotTime,
	groupSlotsByHour,
	hourBucketIsPastForToday,
	hourRangeTitle,
	hourRemainingSpotsLabel,
	slotMeetsTicketQuantity,
	slotSelectable,
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
	calendarSummary?: BookingScheduleSummaryPayload;
};

function findNextSelectableSlotOnDay(
	events: DayEvent[],
	viewYmd: string,
	siteTodayYmd: string,
): BookingScheduleSummaryPayload['nextAvailable'] {
	const rows = events.flatMap( ( e ) => e.slots );
	const sorted = [ ...rows ].sort( ( a, b ) =>
		formatSlotTime( a ).localeCompare( formatSlotTime( b ) ),
	);
	const pick = sorted.find( ( s ) =>
		slotSelectable( viewYmd, s.stock, siteTodayYmd ),
	);
	if ( ! pick ) {
		return null;
	}
	return {
		dateYmd: viewYmd,
		slot: {
			label: pick.label,
			time: pick.time,
			stock: pick.stock,
		},
	};
}

function selectedDayScheduleSpan( slots: SlotRow[] ): LeadingDayTimeRange | null {
	if ( ! slots.length ) {
		return null;
	}
	const sorted = [ ...slots ].sort( ( a, b ) =>
		formatSlotTime( a ).localeCompare( formatSlotTime( b ) ),
	);
	const startLabel = formatSlotTime( sorted[ 0 ] );
	const endLabel = formatSlotTime( sorted[ sorted.length - 1 ] );
	if ( startLabel === '—' || endLabel === '—' ) {
		return null;
	}
	return { startLabel, endLabel };
}

export default function Dashboard() {
	/** '' = use WordPress site-local today. */
	const [ ymd, setYmd ] = useState( '' );
	/**
	 * Real calendar "today" (Y-m-d) from the first default dashboard response.
	 * `data.date` is always the *viewed* day, so it must not drive Today/Tomorrow labels after the user picks another date.
	 */
	const [ siteTodayYmd, setSiteTodayYmd ] = useState<string | null>( null );
	const [ ticketQtyByEventId, setTicketQtyByEventId ] = useState<
		Record<number, number>
	>( {} );
	const { toggleLine, hasLine, items, updateQty } = useCart();
	const { canManageEvents } = useAuth();

	const syncCartQtyForEventDay = useCallback(
		( eventId: number, viewDateYmd: string, nextQty: number ) => {
			items
				.filter(
					( line ) =>
						line.eventId === eventId && line.viewDateYmd === viewDateYmd,
				)
				.forEach( ( line ) =>
					updateQty( cartLineKey( line ), nextQty ),
				);
		},
		[ items, updateQty ],
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

	const dashboardSummaryPayload = useMemo(
		(): BookingScheduleSummaryPayload | null => {
			if ( ! data ) {
				return null;
			}
			const sum = data.calendarSummary;
			if ( sum ) {
				return {
					slotsOnSelectedDay: sum.slotsOnSelectedDay ?? 0,
					capacityOnSelectedDay:
						sum.capacityOnSelectedDay != null &&
						sum.capacityOnSelectedDay !== ''
							? sum.capacityOnSelectedDay
							: '—',
					nextAvailable: sum.nextAvailable ?? null,
				};
			}
			const flatSlots = data.events.flatMap( ( e ) => e.slots );
			return {
				slotsOnSelectedDay: flatSlots.length,
				capacityOnSelectedDay: capacityLabelForSlots( flatSlots ),
				nextAvailable: findNextSelectableSlotOnDay(
					data.events,
					data.date,
					effectiveSiteTodayYmd,
				),
			};
		},
		[ data, effectiveSiteTodayYmd ],
	);

	const dashboardDayScheduleSpan = useMemo( (): LeadingDayTimeRange | null => {
		if ( ! data ) {
			return null;
		}
		return selectedDayScheduleSpan(
			data.events.flatMap( ( e ) => e.slots ),
		);
	}, [ data ] );

	return (
		<div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start lg:gap-8">
		<div className="min-w-0 space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
				<div className="w-full min-w-0 text-left sm:flex-1">
					<h1 className="text-2xl font-bold tracking-tight">Today’s schedule</h1>
					<p className="text-muted-foreground text-sm">
						Live schedule · select slots and build an order (checkout in cart) · WooCommerce orders · auto refresh every 30s
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
						<PopoverContent
							className="w-auto p-0"
							align="start"
							onOpenAutoFocus={ ( e ) => e.preventDefault() }
						>
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

			<div className="space-y-3">
				<p className="text-muted-foreground text-sm leading-relaxed">
					Review upcoming dates and slot availability for this event. Book tickets from Calendar
					(checkout in cart).
				</p>
				<BookingScheduleSummaryCards
					summary={ dashboardSummaryPayload }
					leadingDayTimeRange={ dashboardDayScheduleSpan }
					isLoading={ isLoading && ! data }
				/>
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
						'space-y-6 transition-opacity duration-200',
						isPlaceholderData && isFetching ? 'opacity-60' : 'opacity-100',
					) }
					aria-busy={ isPlaceholderData && isFetching }
				>
					<div className="min-w-0 space-y-6">
					{ data.events.map( ( ev, i ) => {
						const ticketQty = ticketQtyByEventId[ ev.eventId ] ?? 1;
						const hasAnyBookable = ev.slots.some( ( s ) =>
							slotSelectable(
								data.date,
								s.stock,
								effectiveSiteTodayYmd,
							),
						);
						return (
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
												{ canManageEvents ? (
													<Link
														to={ `/event/${ ev.eventId }` }
														className="text-primary hover:underline"
													>
														{ ev.eventTitle }
													</Link>
												) : (
													<span>{ ev.eventTitle }</span>
												) }
											</CardTitle>
											<p className="text-muted-foreground text-xs">{ ev.dateLabel }</p>
										</div>
									</div>
								</CardHeader>
								<CardContent className="space-y-4 pt-0">
									<TicketQuantitySelector
										value={ ticketQty }
										onChange={ ( n ) => {
											setTicketQtyByEventId( ( prev ) => ( {
												...prev,
												[ ev.eventId ]: n,
											} ) );
											if ( data?.date ) {
												syncCartQtyForEventDay(
													ev.eventId,
													data.date,
													n,
												);
											}
										} }
									/>
									{ ev.slots.length === 0 ? (
										<p className="text-muted-foreground text-sm">
											{ hasAnyBookable
												? `No slots available for ${ ticketQty } ticket${ ticketQty === 1 ? '' : 's' } on this day.`
												: `No bookable slots on ${ displayYmd || 'this day' }.` }
										</p>
									) : ( () => {
										const hourGroups = groupSlotsByHour( ev.slots );
										if ( hourGroups.length === 0 ) {
											return (
												<p className="text-muted-foreground text-sm">
													No slots on { displayYmd || 'this day' }.
												</p>
											);
										}
										const openHourKey = defaultAccordionHourKey(
											hourGroups,
											displayYmd,
											effectiveSiteTodayYmd,
										);
										return (
											<Accordion
												key={ `slots-${ ev.eventId }-${ displayYmd }` }
												type="single"
												collapsible
												defaultValue={ openHourKey }
												className="w-full space-y-0"
											>
												{ hourGroups.map( ( g ) => {
													const leftLabel = hourRemainingSpotsLabel( g.slots );
													const isPastHour = hourBucketIsPastForToday(
														g,
														displayYmd,
														effectiveSiteTodayYmd,
													);
													return (
														<AccordionItem
															key={ g.key }
															value={ g.key }
															className="border-border not-last:border-b"
														>
															<AccordionTrigger
																className="items-center py-3 hover:no-underline"
																id={ `hour-${ ev.eventId }-${ g.key }` }
															>
																<span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 pr-2">
																	<span className={ cn(
																		'shrink-0 font-mono text-sm',
																		isPastHour && 'text-muted-foreground',
																	) }>
																		{ hourRangeTitle( g.hour ) }
																	</span>
																	<span className="flex shrink-0 flex-wrap items-center gap-2">
																		{ isPastHour && (
																			<Badge
																				variant="secondary"
																				className="text-xs"
																			>
																				Past
																			</Badge>
																		) }
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
																			{ g.slots.length } slot
																			{ g.slots.length === 1 ? '' : 's' }
																		</span>
																	</span>
																</span>
															</AccordionTrigger>
															<AccordionContent>
																<div className="grid grid-cols-1 gap-2 pt-2 pl-0 sm:grid-cols-2 xl:grid-cols-3 sm:pl-1">
																	{ g.slots.map( ( s ) => {
																		const selectable = slotMeetsTicketQuantity(
																			data.date,
																			s.stock,
																			effectiveSiteTodayYmd,
																			ticketQty,
																		);
																		const disabled = isPastHour || ! selectable;
																		const lineSel: POSSelection = {
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
																		};
																		const inCart = hasLine( lineSel );
																		return (
																			<SlotCartToggleButton
																				key={ `${ s.id }-${ s.dateId }` }
																				timeText={ formatSlotTime( s ) }
																				stock={ s.stock }
																				disabled={ disabled }
																				inCart={ inCart }
																				onToggle={ () => {
																					if ( disabled ) {
																						return;
																					}
																					toggleLine( lineSel, ticketQty );
																				} }
																			/>
																		);
																	} ) }
																</div>
															</AccordionContent>
														</AccordionItem>
													);
												} ) }
											</Accordion>
										);
									} )() }
								</CardContent>
							</Card>
						</div>
						);
					} ) }
					</div>
				</div>
			) }
		</div>
		<aside className="mt-8 min-w-0 lg:sticky lg:top-20 lg:mt-0 lg:self-start">
			<Cart variant="panel" />
		</aside>
		</div>
	);
}
