import { useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarIcon, Clock3, Minus, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
	useDeleteManualSlot,
	useRemoveSlotStock,
	useAddSlotStock,
	invalidateInternalPosAfterSlotWrites,
	subtractSlotStockViaRest,
} from '../api/queries.js';
import { slotAvailabilityText } from '@/components/SlotCartToggleButton';
import BookingScheduleSummaryCards, {
	type BookingScheduleSummaryPayload,
} from '@/components/BookingScheduleSummaryCards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import {
	capacityLabelForSlots,
	formatSlotTime,
	groupSlotsByHour,
	hourRangeTitle,
	hourRemainingSpotsLabel,
	planTargetTotalCapacityRemoval,
	slotSelectable,
	type HourSlotGroup,
} from '@/lib/slotHourGrouping';

type SlotApi = {
	id: string;
	label: string;
	time?: string;
	stock: number | null;
	dateId?: string;
	bookedCount?: number;
	totalCapacity?: number | null;
};

type DayApi = {
	id: string;
	date: string;
	label: string;
	slots: SlotApi[];
	stock?: number | null;
};

export type EventDetailForSchedule = {
	id?: number;
	title?: string;
	dates: DayApi[];
	labels?: { date: string; slot: string };
	price?: number | null;
	priceHtml?: string;
	bookingMethod?: string;
	siteTodayYmd?: string;
	siteNowLocal?: string;
	siteCurrentHour?: number;
	siteTimezone?: string;
};

function findNextAvailable( days: DayApi[] ) {
	const sorted = [ ...days ].sort( ( a, b ) => a.date.localeCompare( b.date ) );
	for ( const d of sorted ) {
		const slots = [ ... ( d.slots || [] ) ].sort( ( a, b ) =>
			formatSlotTime( a ).localeCompare( formatSlotTime( b ) ),
		);
		for ( const s of slots ) {
			if ( s.stock === null || s.stock === undefined || s.stock > 0 ) {
				return { day: d, slot: s };
			}
		}
	}
	return null;
}

/** One line for remove-confirm copy: avoid repeating HH:MM when `label` already contains it. */
function slotTitleForRemoveConfirm( slot: SlotApi ): string {
	const label = ( slot.label ?? '' ).trim();
	const timePart = formatSlotTime( slot );
	const timeOk = Boolean( timePart && timePart !== '—' );

	if ( ! label ) {
		return timeOk ? timePart : `Slot ${ String( slot.id ?? '' ).trim() || '—' }`;
	}
	if ( ! timeOk ) {
		return label;
	}
	if ( label === timePart || label.includes( timePart ) ) {
		return label;
	}
	return `${ label } · ${ timePart }`;
}


type Props = {
	detail: EventDetailForSchedule;
	/** Y-m-d site “today” for past-day check; browser-local if omitted. */
	siteTodayYmd?: string;
};

/** Schedule overview on event detail: availability by hour plus optional manual sessions (slot-first and date-first booking). */
export default function EventSlotOverview( {
	detail,
	siteTodayYmd: siteTodayYmdProp,
}: Props ) {
	const { canManageEvents } = useAuth();
	const { dates, labels } = detail;
	const manageSlotsUi =
		canManageEvents
		&& typeof detail.id === 'number'
		&& Number.isFinite( detail.id );

	const [ pendingDelete, setPendingDelete ] = useState< {
		slotId: string;
		dateId: string;
		ymd: string;
		title: string;
	} | null >( null );
	const [ pendingDeleteHourGroup, setPendingDeleteHourGroup ] = useState<HourSlotGroup | null>(
		null,
	);
	const [ hourGroupDeleteWorking, setHourGroupDeleteWorking ] = useState( false );
	const [ pendingReduceHourGroup, setPendingReduceHourGroup ] = useState<HourSlotGroup | null>(
		null,
	);
	const [ hourGroupReduceWorking, setHourGroupReduceWorking ] = useState( false );
	const [ pendingReduce, setPendingReduce ] = useState< {
		slotId: string;
		dateId: string;
		ymd: string;
		title: string;
		currentStock: number;
		bookedCount?: number;
	} | null >( null );
	const [ pendingAdd, setPendingAdd ] = useState< {
		slotId: string;
		dateId: string;
		ymd: string;
		title: string;
		currentStock: number;
	} | null >( null );
	const siteTodayYmd = useMemo( () => {
		const norm = ( v: unknown ) => {
			if ( typeof v !== 'string' ) {
				return null;
			}
			const t = v.trim();
			return /^\d{4}-\d{2}-\d{2}$/.test( t ) ? t : null;
		};
		return norm( siteTodayYmdProp ) ??
			norm( detail.siteTodayYmd )
			?? format( new Date(), 'yyyy-MM-dd' );
	}, [ siteTodayYmdProp, detail.siteTodayYmd ] );
	const [ selectedYmd, setSelectedYmd ] = useState( () => detail.dates[ 0 ]?.date ?? '' );
	const [ otherDateDialogOpen, setOtherDateDialogOpen ] = useState( false );

	useEffect( () => {
		if ( ! dates?.length ) {
			return;
		}
		setSelectedYmd( ( prev ) => {
			if ( prev && dates.some( ( d ) => d.date === prev ) ) {
				return prev;
			}
			return dates[ 0 ]!.date;
		} );
	}, [ dates ] );

	const selectedDay = useMemo(
		() => dates?.find( ( d ) => d.date === selectedYmd ),
		[ dates, selectedYmd ],
	);

	const nextAvail = useMemo( () => findNextAvailable( dates || [] ), [ dates ] );

	const summaryCardsPayload = useMemo( (): BookingScheduleSummaryPayload => {
		const na = nextAvail;
		return {
			upcomingDistinctDays: dates?.length ?? 0,
			slotsOnSelectedDay: selectedDay?.slots?.length ?? 0,
			capacityOnSelectedDay: selectedDay
				? capacityLabelForSlots( selectedDay.slots || [] )
				: '—',
			nextAvailable:
				na && na.day && na.slot
					? {
							dateYmd: na.day.date,
							slot: {
								label: na.slot.label,
								time: na.slot.time,
								stock: na.slot.stock,
							},
					  }
					: null,
		};
	}, [ dates, nextAvail, selectedDay ] );

	const hourGroups = useMemo( () => {
		if ( ! selectedDay?.slots?.length ) {
			return [];
		}
		return groupSlotsByHour( selectedDay.slots );
	}, [ selectedDay ] );

	const allowedDateSet = useMemo(
		() => new Set( ( dates ?? [] ).map( ( d ) => d.date ) ),
		[ dates ],
	);

	const refTodayForQuick = useMemo(
		() => parseISO( `${ siteTodayYmd }T12:00:00` ),
		[ siteTodayYmd ],
	);

	const quickDates = useMemo(
		() =>
			Array.from( { length: 3 }, ( _, i ) => {
				const date = addDays( refTodayForQuick, i );
				return { ymd: format( date, 'yyyy-MM-dd' ), date };
			} ),
		[ refTodayForQuick ],
	);

	const isOtherDateSelected = Boolean(
		selectedYmd && ! quickDates.some( ( p ) => p.ymd === selectedYmd ),
	);

	const calendarSelected = useMemo( () => {
		if ( ! selectedYmd || ! /^\d{4}-\d{2}-\d{2}$/.test( selectedYmd ) ) {
			return undefined;
		}
		return parseISO( `${ selectedYmd }T12:00:00` );
	}, [ selectedYmd ] );

	if ( ! dates?.length ) {
		return (
			<Card>
				<CardContent className="text-muted-foreground pt-6">
					No upcoming dates for this event.
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			<BookingScheduleSummaryCards summary={ summaryCardsPayload } />

			<div>
				<p className="text-muted-foreground mb-2 text-sm font-medium">
					{ labels?.date ?? 'Date' }
				</p>
				<div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
					{ quickDates.map( ( pill, idx ) => {
						const title =
							idx === 0 ? 'Today' : idx === 1 ? 'Tomorrow' : 'Day after tomorrow';
						const hasDay = allowedDateSet.has( pill.ymd );
						const showSelected = Boolean( selectedYmd ) && selectedYmd === pill.ymd;
						return (
							<button
								key={ pill.ymd }
								type="button"
								disabled={ ! hasDay }
								title={ hasDay ? undefined : 'No sessions on this day for this product' }
								onClick={ () => hasDay && setSelectedYmd( pill.ymd ) }
								className={ cn(
									'rounded-lg border px-3 py-2 text-left text-sm transition',
									! hasDay && 'cursor-not-allowed opacity-45',
									showSelected
										? 'border-primary bg-primary/10 text-foreground'
										: 'border-border bg-card hover:border-primary/50',
								) }
							>
								<div className="max-w-[200px] truncate font-medium">{ title }</div>
								<div className="text-muted-foreground text-xs">{ pill.ymd }</div>
							</button>
						);
					} ) }
					<button
						type="button"
						onClick={ () => setOtherDateDialogOpen( true ) }
						className={ cn(
							'rounded-lg border px-3 py-2 text-left text-sm transition',
							isOtherDateSelected
								? 'border-primary bg-primary/10 text-foreground'
								: 'border-border bg-card hover:border-primary/50',
						) }
					>
						<div className="flex max-w-[220px] items-center gap-2 truncate font-medium">
							<CalendarIcon className="size-4 shrink-0 opacity-70" aria-hidden />
							<span>Select another date</span>
						</div>
						<div className="text-muted-foreground text-xs">
							{ isOtherDateSelected && selectedYmd ? selectedYmd : 'Pick from your schedule' }
						</div>
					</button>
				</div>

				<Dialog open={ otherDateDialogOpen } onOpenChange={ setOtherDateDialogOpen }>
					<DialogContent
						className="w-[19rem] max-w-[min(19rem,calc(100vw-2rem))]"
						onOpenAutoFocus={ ( e ) => e.preventDefault() }
					>
						<DialogHeader className="text-center sm:text-center">
							<DialogTitle>Select a date</DialogTitle>
							<DialogDescription className="text-pretty">
								Only dates with sessions for this product are enabled.
							</DialogDescription>
						</DialogHeader>
						<div className="flex w-full justify-center">
							<Calendar
								mode="single"
								selected={ calendarSelected }
								disabled={ ( d ) => ! allowedDateSet.has( format( d, 'yyyy-MM-dd' ) ) }
								onSelect={ ( d ) => {
									if ( d ) {
										const ymd = format( d, 'yyyy-MM-dd' );
										if ( allowedDateSet.has( ymd ) ) {
											setSelectedYmd( ymd );
											setOtherDateDialogOpen( false );
										}
									}
								} }
								initialFocus
							/>
						</div>
					</DialogContent>
				</Dialog>
			</div>

			<div className="space-y-6">
				<Card className="min-w-0">
					<CardHeader>
						<CardTitle className="text-lg">
							{ selectedDay
								? format( parseISO( `${ selectedDay.date }T12:00:00` ), 'PPP' )
								: 'Schedule' }
						</CardTitle>
						<CardDescription>
							<span className="block">
								Slot availability grouped by hour. Book orders from Calendar (checkout in cart).
							</span>
							{ manageSlotsUi && (
								<span className="text-muted-foreground mt-2 block font-normal leading-relaxed">
									Use <strong>Add new session</strong>, <strong>Add ticket spots</strong>,{' ' }
									<strong>Remove time block</strong>, or <strong>Manage schedule</strong> above for focused
									updates and bulk changes; use the +/- and trash actions on each slot, or the hour{' ' }
									<strong>−</strong>/<strong>trash</strong> controls to reduce spots or delete all sessions
									in a clock hour for{ ' ' }
									<span className="font-mono text-xs">{ selectedDay?.date }</span>.
								</span>
							) }
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 pt-0">
						{ manageSlotsUi ? (
							<EventOverviewAddStockDialog
								eventId={ detail.id as number }
								pendingAdd={ pendingAdd }
								clearPending={ () => setPendingAdd( null ) }
							/>
						) : null }

						{ manageSlotsUi ? (
							<EventOverviewReduceStockDialog
								eventId={ detail.id as number }
								pendingReduce={ pendingReduce }
								clearPending={ () => setPendingReduce( null ) }
							/>
						) : null }

						{ manageSlotsUi ? (
							<EventOverviewDeleteConfirmDialog
								eventId={ detail.id as number }
								pendingDelete={ pendingDelete }
								clearPending={ () => setPendingDelete( null ) }
							/>
						) : null }

						{ manageSlotsUi && selectedDay?.date ? (
							<EventOverviewDeleteHourGroupDialog
								eventId={ detail.id as number }
								eventTitle={ detail.title?.trim() || 'this event' }
								ymd={ selectedDay.date }
								pendingGroup={ pendingDeleteHourGroup }
								clearPending={ () => setPendingDeleteHourGroup( null ) }
								onWorkingChange={ setHourGroupDeleteWorking }
							/>
						) : null }

						{ manageSlotsUi && selectedDay?.date ? (
							<EventOverviewReduceHourGroupDialog
								eventId={ detail.id as number }
								eventTitle={ detail.title?.trim() || 'this event' }
								ymd={ selectedDay.date }
								pendingGroup={ pendingReduceHourGroup }
								clearPending={ () => setPendingReduceHourGroup( null ) }
								onWorkingChange={ setHourGroupReduceWorking }
							/>
						) : null }

						{ ! selectedDay?.slots?.length && (
							<p className="text-muted-foreground text-sm">No slots on this day.</p>
						) }
						{ hourGroups.length > 0 && selectedDay && (
							<div key={ selectedYmd } className="space-y-8">
								{ hourGroups.map( ( g ) => {
									const leftLabel = hourRemainingSpotsLabel( g.slots );
									const allSlotsRemovable = g.slots.every( ( s ) => {
										const sid = String( s.id ?? '' ).trim();
										const did = String( s.dateId ?? '' ).trim();
										return sid !== '' && did !== '';
									} );
									const hasFiniteStockToReduce = g.slots.some( ( s ) => {
										const sid = String( s.id ?? '' ).trim();
										const did = String( s.dateId ?? '' ).trim();
										return Boolean(
											sid
											&& did
											&& typeof s.stock === 'number'
											&& s.stock > 0,
										);
									} );
									const slotActionsLocked =
										pendingDelete !== null
										|| pendingReduce !== null
										|| pendingAdd !== null
										|| pendingDeleteHourGroup !== null
										|| hourGroupDeleteWorking
										|| pendingReduceHourGroup !== null
										|| hourGroupReduceWorking;
									return (
										<section
											key={ g.key }
											aria-labelledby={ `overview-hour-${ g.key }` }
										>
											<div
												id={ `overview-hour-${ g.key }` }
												className="mb-3 flex w-full min-w-0 flex-wrap items-center justify-between gap-2 border-border border-b pb-3"
											>
												<span className="shrink-0 font-mono text-sm">
													{ hourRangeTitle( g.hour ) }
												</span>
												<span className="flex shrink-0 flex-wrap items-center gap-2">
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
													{ manageSlotsUi && hasFiniteStockToReduce ? (
														<Button
															type="button"
															variant="ghost"
															size="icon"
															className="text-muted-foreground hover:text-foreground size-8 shrink-0"
															disabled={ slotActionsLocked }
															aria-label={ `Remove ticket spots from all sessions in ${ hourRangeTitle( g.hour ) }` }
															onClick={ () => setPendingReduceHourGroup( g ) }
														>
															<Minus className="size-4" aria-hidden />
														</Button>
													) : null }
													{ manageSlotsUi && allSlotsRemovable ? (
														<Button
															type="button"
															variant="ghost"
															size="icon"
															className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
															disabled={ slotActionsLocked }
															aria-label={ `Remove all sessions for ${ hourRangeTitle( g.hour ) }` }
															onClick={ () => setPendingDeleteHourGroup( g ) }
														>
															<Trash2 className="size-4" aria-hidden />
														</Button>
													) : null }
												</span>
											</div>
											<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 pl-0 sm:pl-1">
												{ g.slots.map( ( s ) => {
													const bookable =
														slotSelectable(
															selectedDay.date,
															s.stock,
															siteTodayYmd,
														);
													const sid = String( s.id ?? '' ).trim();
													const did = String( s.dateId ?? '' ).trim();
													const canRemove = sid !== '' && did !== '';
													const canReduceStock =
														canRemove
														&& typeof s.stock === 'number'
														&& s.stock > 0;
													const canAddStock =
														canRemove && typeof s.stock === 'number';
													const slotBusy =
														pendingDelete !== null
														|| pendingReduce !== null
														|| pendingAdd !== null
														|| pendingDeleteHourGroup !== null
														|| hourGroupDeleteWorking
														|| pendingReduceHourGroup !== null
														|| hourGroupReduceWorking;
													return (
														<SlotOverviewCard
															key={ `${ s.id }-${ s.dateId ?? '' }` }
															timeText={ formatSlotTime( s ) }
															stock={ s.stock }
															emphasized={ bookable }
															manageSlots={ manageSlotsUi }
															canRemoveSlot={ canRemove }
															slotActionsDisabled={ slotBusy }
															onRequestRemove={
																canRemove
																	? () =>
																		setPendingDelete( {
																			slotId: sid,
																			dateId: did,
																			ymd: selectedDay.date,
																			title: slotTitleForRemoveConfirm( s ),
																		} )
																	: undefined
															}
															canReduceStock={ canReduceStock }
															onRequestReduce={
																canReduceStock
																	? () =>
																		setPendingReduce( {
																			slotId: sid,
																			dateId: did,
																			ymd: selectedDay.date,
																			title: slotTitleForRemoveConfirm( s ),
																			currentStock: s.stock as number,
																			bookedCount:
																				typeof s.bookedCount === 'number'
																				&& Number.isFinite( s.bookedCount )
																					? Math.max(
																						0,
																						Math.floor( s.bookedCount ),
																					)
																					: undefined,
																		} )
																	: undefined
															}
															canAddStock={ canAddStock }
															onRequestAdd={
																canAddStock
																	? () =>
																		setPendingAdd( {
																			slotId: sid,
																			dateId: did,
																			ymd: selectedDay.date,
																			title: slotTitleForRemoveConfirm( s ),
																			currentStock: s.stock as number,
																		} )
																	: undefined
															}
														/>
													);
												} ) }
											</div>
										</section>
									);
								} ) }
							</div>
						) }
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function SlotOverviewCard( {
	timeText,
	stock,
	emphasized,
	manageSlots,
	canRemoveSlot,
	slotActionsDisabled,
	onRequestRemove,
	canReduceStock,
	onRequestReduce,
	canAddStock,
	onRequestAdd,
}: {
	timeText: string;
	stock: number | null;
	emphasized: boolean;
	manageSlots?: boolean;
	canRemoveSlot?: boolean;
	slotActionsDisabled?: boolean;
	onRequestRemove?: () => void;
	canReduceStock?: boolean;
	onRequestReduce?: () => void;
	canAddStock?: boolean;
	onRequestAdd?: () => void;
} ) {
	const availability = slotAvailabilityText( stock );
	const full =
		stock !== null && stock !== undefined && stock <= 0;
	const unlimited = stock === null || stock === undefined;
	const showTrash =
		manageSlots && canRemoveSlot && typeof onRequestRemove === 'function';
	const showReduce =
		manageSlots
		&& canReduceStock
		&& typeof onRequestReduce === 'function';
	const showAdd =
		manageSlots && canAddStock && typeof onRequestAdd === 'function';
	return (
		<div
			aria-label={ `${ timeText }. ${ availability }.` }
			className={ cn(
				'flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm',
				emphasized && ! full
					? 'border-border bg-card'
					: 'border-border bg-muted/30 opacity-85',
				full && 'opacity-75',
				unlimited && emphasized && 'border-secondary/60',
			) }
		>
			<div className="text-muted-foreground flex min-w-0 shrink-0 items-center gap-1 font-mono text-sm tabular-nums">
				<Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
				<span className="truncate">{ timeText }</span>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<span
					className={ cn(
						'text-muted-foreground tabular-nums text-xs',
						full && 'text-destructive font-medium',
					) }
				>
					{ availability }
				</span>
				{ showAdd ? (
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="text-muted-foreground hover:text-foreground size-8 shrink-0"
						disabled={ slotActionsDisabled }
						aria-label={ `Add ticket spots for ${ timeText }` }
						onClick={ onRequestAdd }
					>
						<Plus className="size-4" />
					</Button>
				) : null }
				{ showReduce ? (
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="text-muted-foreground hover:text-foreground size-8 shrink-0"
						disabled={ slotActionsDisabled }
						aria-label={ `Remove ticket spots for ${ timeText }` }
						onClick={ onRequestReduce }
					>
						<Minus className="size-4" />
					</Button>
				) : null }
				{ showTrash ? (
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
						disabled={ slotActionsDisabled }
						aria-label={ `Remove session ${ timeText }` }
						onClick={ onRequestRemove }
					>
						<Trash2 className="size-4" />
					</Button>
				) : null }
			</div>
		</div>
	);
}


function EventOverviewAddStockDialog( {
	eventId,
	pendingAdd,
	clearPending,
}: {
	eventId: number;
	pendingAdd: {
		slotId: string;
		dateId: string;
		ymd: string;
		title: string;
		currentStock: number;
	} | null;
	clearPending: () => void;
} ) {
	const addStock = useAddSlotStock( eventId );
	const [ addDelta, setAddDelta ] = useState( 1 );

	useEffect( () => {
		if ( pendingAdd ) {
			setAddDelta( 1 );
		}
	}, [ pendingAdd ] );

	const clampedAdd =
		Number.isFinite( addDelta ) && addDelta >= 1 ? Math.floor( addDelta ) : 1;

	async function confirmAdd() {
		if ( ! pendingAdd ) {
			return;
		}
		const n = Math.max( 1, clampedAdd );
		try {
			await addStock.mutateAsync( {
				slotId: pendingAdd.slotId,
				dateId: pendingAdd.dateId,
				date: pendingAdd.ymd,
				addSpots: n,
			} );
			clearPending();
			toast.success(
				n === 1 ? 'Added 1 ticket spot.' : `Added ${ n } ticket spots.`,
			);
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	return (
		<Dialog
			open={ pendingAdd !== null }
			onOpenChange={ ( open ) => {
				if ( ! open && ! addStock.isPending ) {
					clearPending();
				}
			} }
		>
			<DialogContent showCloseButton={ ! addStock.isPending }>
				<DialogHeader>
					<DialogTitle>Add ticket spots?</DialogTitle>
					<DialogDescription>
						Increases remaining capacity for{ ' ' }
						<span className="text-foreground font-medium">{ pendingAdd?.title }</span>
						{ ' ' }
						on{ ' ' }
						<span className="font-mono text-foreground">{ pendingAdd?.ymd }</span>. Numeric limits
						only (not unlimited).
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor="overview-add-delta">Spots to add</Label>
					<Input
						id="overview-add-delta"
						type="number"
						min={ 1 }
						step={ 1 }
						value={ addDelta }
						onChange={ ( e ) => {
							const v = parseInt( e.target.value, 10 );
							setAddDelta( Number.isFinite( v ) ? v : 1 );
						} }
						disabled={ addStock.isPending }
					/>
					<p className="text-muted-foreground text-xs">
						Current remaining slots:{ ' ' }
						<span className="text-foreground font-medium tabular-nums">
							{ pendingAdd?.currentStock ?? '—' }
						</span>
						{ ' ' }
						· after add:{ ' ' }
						<span className="text-foreground font-medium tabular-nums">
							{ pendingAdd != null ? pendingAdd.currentStock + Math.max( 1, clampedAdd ) : '—' }
						</span>
					</p>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={ clearPending }
						disabled={ addStock.isPending }
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={ confirmAdd }
						disabled={ addStock.isPending || clampedAdd < 1 }
					>
						{ addStock.isPending ? 'Saving…' : 'Add spots' }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EventOverviewReduceStockDialog( {
	eventId,
	pendingReduce,
	clearPending,
}: {
	eventId: number;
	pendingReduce: {
		slotId: string;
		dateId: string;
		ymd: string;
		title: string;
		currentStock: number;
		bookedCount?: number;
	} | null;
	clearPending: () => void;
} ) {
	const removeStock = useRemoveSlotStock( eventId );
	const [ reduceSubMode, setReduceSubMode ] = useState<
		'fixedRemove' | 'targetTotal'
	>( 'fixedRemove' );
	const [ removeDelta, setRemoveDelta ] = useState( 1 );
	const [ targetTotalCap, setTargetTotalCap ] = useState( 0 );

	useEffect( () => {
		if ( pendingReduce ) {
			setRemoveDelta( 1 );
			setReduceSubMode( 'fixedRemove' );
			const cap = pendingReduce.currentStock + (
				typeof pendingReduce.bookedCount === 'number'
				&& Number.isFinite( pendingReduce.bookedCount )
					? Math.max( 0, Math.floor( pendingReduce.bookedCount ) )
					: 0
			);
			setTargetTotalCap( Math.max( 0, cap - 1 ) );
		}
	}, [ pendingReduce ] );

	const maxRemove = pendingReduce?.currentStock ?? 1;
	const clampedDelta =
		Number.isFinite( removeDelta ) && removeDelta >= 1
			? Math.min( removeDelta, maxRemove )
			: 1;

	const bookedCount = pendingReduce
		&& typeof pendingReduce.bookedCount === 'number'
		&& Number.isFinite( pendingReduce.bookedCount )
		? Math.max( 0, Math.floor( pendingReduce.bookedCount ) )
		: null;

	const targetPlan =
		pendingReduce && bookedCount !== null
			? planTargetTotalCapacityRemoval(
				pendingReduce.currentStock,
				bookedCount,
				Math.floor( targetTotalCap ),
			)
			: null;

	async function confirmReduce() {
		if ( ! pendingReduce ) {
			return;
		}
		const target = pendingReduce;
		let n = 0;
		if ( reduceSubMode === 'fixedRemove' ) {
			n = Math.min(
				Math.max( 1, Math.floor( clampedDelta ) ),
				target.currentStock,
			);
		} else {
			if ( bookedCount === null ) {
				return;
			}
			const plan = planTargetTotalCapacityRemoval(
				target.currentStock,
				bookedCount,
				Math.floor( targetTotalCap ),
			);
			if ( ! plan || plan.removeSpots < 1 ) {
				return;
			}
			n = plan.removeSpots;
		}
		try {
			await removeStock.mutateAsync( {
				slotId: target.slotId,
				dateId: target.dateId,
				date: target.ymd,
				removeSpots: n,
			} );
			clearPending();
			toast.success(
				n === 1
					? 'Removed 1 ticket spot.'
					: `Removed ${ n } ticket spots.`,
			);
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	const canSubmitTarget =
		bookedCount !== null
		&& targetPlan !== null
		&& targetPlan.removeSpots >= 1
		&& Number.isFinite( Math.floor( targetTotalCap ) )
		&& Math.floor( targetTotalCap ) >= 0;

	return (
		<Dialog
			open={ pendingReduce !== null }
			onOpenChange={ ( open ) => {
				if ( ! open && ! removeStock.isPending ) {
					clearPending();
				}
			} }
		>
			<DialogContent showCloseButton={ ! removeStock.isPending }>
				<DialogHeader>
					<DialogTitle>Remove ticket spots?</DialogTitle>
					<DialogDescription>
						Lowers <strong className="text-foreground">remaining</strong> availability for{ ' ' }
						<span className="text-foreground font-medium">{ pendingReduce?.title }</span>
						{ ' ' }
						on{ ' ' }
						<span className="font-mono text-foreground">{ pendingReduce?.ymd }</span>. Sold tickets are not
						changed. This does not delete the session (use the trash icon for that).
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							variant={ reduceSubMode === 'fixedRemove' ? 'default' : 'outline' }
							onClick={ () => setReduceSubMode( 'fixedRemove' ) }
							disabled={ removeStock.isPending }
						>
							Remove X available spots
						</Button>
						<Button
							type="button"
							size="sm"
							variant={ reduceSubMode === 'targetTotal' ? 'default' : 'outline' }
							onClick={ () => setReduceSubMode( 'targetTotal' ) }
							disabled={
								removeStock.isPending || bookedCount === null
							}
						>
							Set total capacity to X
						</Button>
					</div>
					{ reduceSubMode === 'fixedRemove' ? (
						<div className="space-y-2">
							<Label htmlFor="overview-reduce-delta">Spots to remove</Label>
							<Input
								id="overview-reduce-delta"
								type="number"
								min={ 1 }
								max={ maxRemove }
								value={ removeDelta }
								onChange={ ( e ) => {
									const v = parseInt( e.target.value, 10 );
									setRemoveDelta( Number.isFinite( v ) ? v : 1 );
								} }
								disabled={ removeStock.isPending }
							/>
							<p className="text-muted-foreground text-xs">
								Current remaining slots:{ ' ' }
								<span className="text-foreground font-medium tabular-nums">{ maxRemove }</span>
								{ bookedCount !== null ? (
									<>
										{ ' · booked ' }
										<span className="text-foreground font-medium tabular-nums">{ bookedCount }</span>
									</>
								) : null }
							</p>
						</div>
					) : (
						<div className="space-y-2">
							<Label htmlFor="overview-reduce-target-total">Target total capacity</Label>
							<Input
								id="overview-reduce-target-total"
								type="number"
								min={ 0 }
								value={ targetTotalCap }
								onChange={ ( e ) => {
									const v = parseInt( e.target.value, 10 );
									setTargetTotalCap(
										Number.isFinite( v ) && v >= 0 ? v : 0,
									);
								} }
								disabled={
									removeStock.isPending || bookedCount === null
								}
							/>
							{ bookedCount !== null && pendingReduce ? (
								<p className="text-muted-foreground text-xs">
									Booked{ ' ' }
									<span className="tabular-nums text-foreground">{ bookedCount }</span>
									{ ' + remaining ' }
									<span className="tabular-nums text-foreground">{ pendingReduce.currentStock }</span>
									{ ' = ' }
									<span className="tabular-nums text-foreground">
										{ bookedCount + pendingReduce.currentStock }
									</span>
									{ targetPlan && targetPlan.removeSpots >= 1 ? (
										<>
											{ ' → target ' }
											<span className="tabular-nums text-foreground">
												{ Math.floor( targetTotalCap ) }
											</span>
											{ '; remove ' }
											<span className="tabular-nums text-foreground">
												{ targetPlan.removeSpots }
											</span>
											{ targetPlan.bookedOverTarget
												? ' (booked already exceeds target)'
												: '' }
										</>
									) : (
										<>
											{ '. ' }
											{ targetPlan === null
												? 'Already at or below that total.'
												: 'Nothing to remove.' }
										</>
									) }
								</p>
							) : (
								<p className="text-destructive text-xs">
									Booked count unavailable — reload event data or use fixed removal.
								</p>
							) }
						</div>
					) }
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={ clearPending }
						disabled={ removeStock.isPending }
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={ confirmReduce }
						disabled={
							removeStock.isPending
							|| maxRemove < 1
							|| ( reduceSubMode === 'fixedRemove'
								&& ( clampedDelta < 1 || clampedDelta > maxRemove ) )
							|| ( reduceSubMode === 'targetTotal' && ! canSubmitTarget )
						}
					>
						{ removeStock.isPending ? 'Saving…' : 'Remove spots' }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EventOverviewDeleteHourGroupDialog( {
	eventId,
	eventTitle,
	ymd,
	pendingGroup,
	clearPending,
	onWorkingChange,
}: {
	eventId: number;
	eventTitle: string;
	ymd: string;
	pendingGroup: HourSlotGroup | null;
	clearPending: () => void;
	onWorkingChange: ( busy: boolean ) => void;
} ) {
	const delManual = useDeleteManualSlot( eventId );
	const [ working, setWorking ] = useState( false );
	const busy = working;

	async function confirmDeleteHourGroup() {
		if ( ! pendingGroup ) {
			return;
		}
		setWorking( true );
		onWorkingChange( true );
		const n = pendingGroup.slots.length;
		try {
			for ( const s of pendingGroup.slots ) {
				const sid = String( s.id ?? '' ).trim();
				const did = String( s.dateId ?? '' ).trim();
				await delManual.mutateAsync( {
					slotId: sid,
					dateId: did,
					ymd,
				} );
			}
			toast.success(
				n === 1
					? 'Removed 1 session.'
					: `Removed all ${ n } sessions in this hour.`,
			);
			clearPending();
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		} finally {
			setWorking( false );
			onWorkingChange( false );
		}
	}

	const slotCount = pendingGroup?.slots.length ?? 0;

	return (
		<Dialog
			open={ pendingGroup !== null }
			onOpenChange={ ( open ) => {
				if ( ! open && ! busy ) {
					clearPending();
				}
			} }
		>
			<DialogContent showCloseButton={ ! busy }>
				<DialogHeader>
					<DialogTitle>Remove all sessions in this hour?</DialogTitle>
					<DialogDescription>
						This removes { slotCount === 1 ? '1 session' : `all ${ slotCount } sessions` } in{ ' ' }
						{ pendingGroup ? hourRangeTitle( pendingGroup.hour ) : '' } on{ ' ' }
						<span className="font-mono text-foreground">{ ymd }</span> for{ ' ' }
						<span className="font-medium text-foreground">{ eventTitle }</span>. The server will
						refuse removal for any session that already has bookings (you may see an error partway
						through). This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={ clearPending }
						disabled={ busy }
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="destructive"
						onClick={ () => void confirmDeleteHourGroup() }
						disabled={ busy || slotCount < 1 }
					>
						{ busy ? 'Removing…' : 'Remove all in this hour' }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EventOverviewReduceHourGroupDialog( {
	eventId,
	eventTitle,
	ymd,
	pendingGroup,
	clearPending,
	onWorkingChange,
}: {
	eventId: number;
	eventTitle: string;
	ymd: string;
	pendingGroup: HourSlotGroup | null;
	clearPending: () => void;
	onWorkingChange: ( busy: boolean ) => void;
} ) {
	const qc = useQueryClient();
	const [ hourReduceSubMode, setHourReduceSubMode ] = useState<
		'fixedRemove' | 'targetTotal'
	>( 'fixedRemove' );
	const [ removeDelta, setRemoveDelta ] = useState( 1 );
	const [ hourTargetTotal, setHourTargetTotal ] = useState( 8 );
	const [ working, setWorking ] = useState( false );
	const busy = working;

	useEffect( () => {
		if ( pendingGroup ) {
			setRemoveDelta( 1 );
			setHourReduceSubMode( 'fixedRemove' );
			setHourTargetTotal( 8 );
		}
	}, [ pendingGroup ] );

	type HourReduceRow = {
		slotId: string;
		dateId: string;
		removeSpots: number;
		currentStock: number;
		title: string;
		bookedCount?: number;
		currentTotal?: number;
		bookedOverTarget?: boolean;
		targetTotalCapacity?: number;
	};

	const hourReducePreview = useMemo( () => {
		if ( ! pendingGroup ) {
			return {
				rows: [] as HourReduceRow[],
				skippedUnlimited: 0,
				skippedZero: 0,
				skippedAtOrBelowTarget: 0,
				skippedMissingBookedData: 0,
				bookedOverTargetSessions: 0,
			};
		}
		const rows: HourReduceRow[] = [];
		let skippedUnlimited = 0;
		let skippedZero = 0;
		let skippedAtOrBelowTarget = 0;
		let skippedMissingBookedData = 0;
		let bookedOverTargetSessions = 0;

		if ( hourReduceSubMode === 'fixedRemove' ) {
			const d = Math.floor( removeDelta );
			if ( d < 1 ) {
				return {
					rows: [],
					skippedUnlimited: 0,
					skippedZero: 0,
					skippedAtOrBelowTarget: 0,
					skippedMissingBookedData: 0,
					bookedOverTargetSessions: 0,
				};
			}
			for ( const s of pendingGroup.slots ) {
				const sid = String( s.id ?? '' ).trim();
				const did = String( s.dateId ?? '' ).trim();
				if ( ! sid || ! did ) {
					continue;
				}
				if ( s.stock === null || s.stock === undefined ) {
					skippedUnlimited += 1;
					continue;
				}
				if ( typeof s.stock !== 'number' || s.stock < 0 ) {
					skippedZero += 1;
					continue;
				}
				if ( s.stock <= 0 ) {
					skippedZero += 1;
					continue;
				}
				const removeSpots = Math.min( d, s.stock );
				if ( removeSpots < 1 ) {
					continue;
				}
				const bc =
					typeof s.bookedCount === 'number' && Number.isFinite( s.bookedCount )
						? Math.max( 0, Math.floor( s.bookedCount ) )
						: 0;
				rows.push( {
					slotId: sid,
					dateId: did,
					removeSpots,
					currentStock: s.stock,
					title: slotTitleForRemoveConfirm( s as SlotApi ),
					bookedCount: bc,
					currentTotal: s.stock + bc,
				} );
			}
		} else {
			const tt = Math.floor( hourTargetTotal );
			if ( ! Number.isFinite( tt ) || tt < 0 ) {
				return {
					rows: [],
					skippedUnlimited: 0,
					skippedZero: 0,
					skippedAtOrBelowTarget: 0,
					skippedMissingBookedData: 0,
					bookedOverTargetSessions: 0,
				};
			}
			for ( const s of pendingGroup.slots ) {
				const sid = String( s.id ?? '' ).trim();
				const did = String( s.dateId ?? '' ).trim();
				if ( ! sid || ! did ) {
					continue;
				}
				if ( s.stock === null || s.stock === undefined ) {
					skippedUnlimited += 1;
					continue;
				}
				if ( typeof s.stock !== 'number' || s.stock < 0 ) {
					skippedZero += 1;
					continue;
				}
				const st = s.stock;
				const bookedRaw = s.bookedCount;
				if ( typeof bookedRaw !== 'number' || ! Number.isFinite( bookedRaw ) ) {
					skippedMissingBookedData += 1;
					continue;
				}
				const booked = Math.max( 0, Math.floor( bookedRaw ) );
				const plan = planTargetTotalCapacityRemoval( st, booked, tt );
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
				rows.push( {
					slotId: sid,
					dateId: did,
					removeSpots: plan.removeSpots,
					currentStock: st,
					title: slotTitleForRemoveConfirm( s as SlotApi ),
					bookedCount: booked,
					currentTotal: plan.currentTotal,
					bookedOverTarget: plan.bookedOverTarget,
					targetTotalCapacity: tt,
				} );
			}
		}

		return {
			rows,
			skippedUnlimited,
			skippedZero,
			skippedAtOrBelowTarget,
			skippedMissingBookedData,
			bookedOverTargetSessions,
		};
	}, [ pendingGroup, hourReduceSubMode, removeDelta, hourTargetTotal ] );

	const reduceRows = hourReducePreview.rows;
	const skippedUnlimited = hourReducePreview.skippedUnlimited;
	const skippedZero = hourReducePreview.skippedZero;
	const skippedAtOrBelowTarget = hourReducePreview.skippedAtOrBelowTarget;
	const skippedMissingBookedData = hourReducePreview.skippedMissingBookedData;
	const bookedOverTargetSessions = hourReducePreview.bookedOverTargetSessions;

	const maxFiniteInHour = useMemo( () => {
		if ( ! pendingGroup ) {
			return 1;
		}
		let m = 1;
		for ( const s of pendingGroup.slots ) {
			if ( typeof s.stock === 'number' && s.stock > m ) {
				m = s.stock;
			}
		}
		return m;
	}, [ pendingGroup ] );

	const clampedDelta =
		Number.isFinite( removeDelta ) && removeDelta >= 1
			? Math.min( Math.floor( removeDelta ), Math.max( 1, maxFiniteInHour ) )
			: 1;

	const totalPlannedRemoved = reduceRows.reduce( ( a, r ) => a + r.removeSpots, 0 );

	const targetTotalFloored = Math.floor( hourTargetTotal );

	async function confirmReduceHourGroup() {
		if ( ! pendingGroup || reduceRows.length === 0 ) {
			return;
		}
		setWorking( true );
		onWorkingChange( true );
		let ok = 0;
		let failed = 0;
		try {
			for ( const r of reduceRows ) {
				if ( r.removeSpots < 1 ) {
					continue;
				}
				try {
					await subtractSlotStockViaRest( eventId, {
						slotId: r.slotId,
						dateId: r.dateId,
						date: ymd,
						removeSpots: r.removeSpots,
					} );
					ok += 1;
				} catch {
					failed += 1;
				}
			}
			await invalidateInternalPosAfterSlotWrites( qc, eventId );
			const failPart =
				failed > 0
					? ` ${ failed } failed (capacity may have changed).`
					: '';
			toast.success(
				ok === 1
					? `Reduced spots on 1 session.${ failPart }`
					: `Reduced spots on ${ ok } sessions.${ failPart }`,
			);
			clearPending();
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		} finally {
			setWorking( false );
			onWorkingChange( false );
		}
	}

	const finiteCount = reduceRows.length;

	return (
		<Dialog
			open={ pendingGroup !== null }
			onOpenChange={ ( open ) => {
				if ( ! open && ! busy ) {
					clearPending();
				}
			} }
		>
			<DialogContent showCloseButton={ ! busy } className="max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Remove ticket spots for this hour?</DialogTitle>
					<DialogDescription>
						Lower <strong className="text-foreground">remaining</strong> capacity for finite sessions in{ ' ' }
						{ pendingGroup ? hourRangeTitle( pendingGroup.hour ) : '' } on{ ' ' }
						<span className="font-mono text-foreground">{ ymd }</span> for{ ' ' }
						<span className="font-medium text-foreground">{ eventTitle }</span>. Sold tickets are not
						changed. Sessions stay on the schedule. Unlimited sessions are skipped.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							variant={ hourReduceSubMode === 'fixedRemove' ? 'default' : 'outline' }
							onClick={ () => setHourReduceSubMode( 'fixedRemove' ) }
							disabled={ busy }
						>
							Remove X available spots
						</Button>
						<Button
							type="button"
							size="sm"
							variant={ hourReduceSubMode === 'targetTotal' ? 'default' : 'outline' }
							onClick={ () => setHourReduceSubMode( 'targetTotal' ) }
							disabled={ busy }
						>
							Set total capacity to X
						</Button>
					</div>
					{ hourReduceSubMode === 'fixedRemove' ? (
						<div className="space-y-2">
							<Label htmlFor="overview-hour-reduce-delta">Spots to remove per session</Label>
							<Input
								id="overview-hour-reduce-delta"
								type="number"
								min={ 1 }
								max={ Math.max( 1, maxFiniteInHour ) }
								value={ removeDelta }
								onChange={ ( e ) => {
									const v = parseInt( e.target.value, 10 );
									setRemoveDelta( Number.isFinite( v ) ? v : 1 );
								} }
								disabled={ busy }
							/>
						</div>
					) : (
						<div className="space-y-2">
							<Label htmlFor="overview-hour-reduce-target">Target total capacity per session</Label>
							<Input
								id="overview-hour-reduce-target"
								type="number"
								min={ 0 }
								value={ hourTargetTotal }
								onChange={ ( e ) => {
									const v = parseInt( e.target.value, 10 );
									setHourTargetTotal(
										Number.isFinite( v ) && v >= 0 ? v : 0,
									);
								} }
								disabled={ busy }
							/>
						</div>
					) }
					<p className="text-muted-foreground text-xs">
						Largest remaining cap in this hour:{ ' ' }
						<span className="text-foreground font-medium tabular-nums">{ maxFiniteInHour }</span>
						{ ' · ' }
						Planned total spots removed:{ ' ' }
						<span className="text-foreground font-medium tabular-nums">{ totalPlannedRemoved }</span>
					</p>
					<p className="text-muted-foreground text-xs">
						Skipped unlimited:{ ' ' }
						<span className="tabular-nums">{ skippedUnlimited }</span>
						{ ' · ' }
						Skipped zero remaining:{ ' ' }
						<span className="tabular-nums">{ skippedZero }</span>
					</p>
					{ hourReduceSubMode === 'targetTotal' ? (
						<p className="text-muted-foreground text-xs">
							Skipped (at/below target):{ ' ' }
							<span className="tabular-nums">{ skippedAtOrBelowTarget }</span>
							{ ' · ' }
							Skipped (missing booked):{ ' ' }
							<span className="tabular-nums">{ skippedMissingBookedData }</span>
							{ ' · ' }
							Booked over target (nothing to cut):{ ' ' }
							<span className="tabular-nums">{ bookedOverTargetSessions }</span>
						</p>
					) : null }
				</div>
				{ finiteCount > 0 ? (
					<ul className="max-h-[12rem] list-inside list-decimal overflow-y-auto border border-border/60 rounded-md p-2 text-muted-foreground text-xs">
						{ reduceRows.map( ( r ) => (
							<li key={ `${ r.slotId }-${ r.dateId }` }>
								<span className="text-foreground font-medium">{ r.title }</span>
								{ hourReduceSubMode === 'targetTotal'
								&& typeof r.bookedCount === 'number'
								&& typeof r.currentTotal === 'number'
								&& typeof r.targetTotalCapacity === 'number' ? (
									<>
										{ ': booked ' }
										<span className="tabular-nums">{ r.bookedCount }</span>
										{ ' + rem ' }
										<span className="tabular-nums">{ r.currentStock }</span>
										{ ' = ' }
										<span className="tabular-nums">{ r.currentTotal }</span>
										{ ' → ' }
										<span className="tabular-nums">{ r.targetTotalCapacity }</span>
										{ '; -' }
										<span className="tabular-nums">{ r.removeSpots }</span>
										{ r.bookedOverTarget ? ' · booked over target' : '' }
									</>
								) : (
									<>
										{ ': -' }
										<span className="tabular-nums">{ r.removeSpots }</span>
										{ ' (was ' }
										<span className="tabular-nums">{ r.currentStock }</span>
										{ ')' }
									</>
								) }
							</li>
						) ) }
					</ul>
					) : (
						<p className="text-muted-foreground text-sm">
							{ hourReduceSubMode === 'targetTotal'
							&& ( ! Number.isFinite( targetTotalFloored ) || targetTotalFloored < 0 )
								? 'Enter a valid target total (0 or greater).'
								: 'No finite-capacity sessions in this hour need changes for this input.' }
						</p>
					) }
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={ clearPending }
						disabled={ busy }
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={ () => void confirmReduceHourGroup() }
						disabled={
							busy
							|| finiteCount < 1
							|| ( hourReduceSubMode === 'fixedRemove' && clampedDelta < 1 )
							|| ( hourReduceSubMode === 'targetTotal'
								&& ( ! Number.isFinite( targetTotalFloored ) || targetTotalFloored < 0 ) )
						}
					>
						{ busy ? 'Saving…' : 'Remove spots from hour' }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EventOverviewDeleteConfirmDialog( {
	eventId,
	pendingDelete,
	clearPending,
}: {
	eventId: number;
	pendingDelete: { slotId: string; dateId: string; ymd: string; title: string } | null;
	clearPending: () => void;
} ) {
	const delManual = useDeleteManualSlot( eventId );

	async function confirmDelete() {
		if ( ! pendingDelete ) {
			return;
		}
		const target = pendingDelete;
		clearPending();
		try {
			await delManual.mutateAsync( {
				slotId: target.slotId,
				dateId: target.dateId,
				ymd: target.ymd,
			} );
			toast.success( 'Slot removed.' );
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	return (
		<Dialog
			open={ pendingDelete !== null }
			onOpenChange={ ( open ) => {
				if ( ! open && ! delManual.isPending ) {
					clearPending();
				}
			} }
		>
			<DialogContent showCloseButton={ ! delManual.isPending }>
				<DialogHeader>
					<DialogTitle>Remove this session?</DialogTitle>
					<DialogDescription>
						This stops new bookings for{' '}
						<span className="text-foreground font-medium">{ pendingDelete?.title }</span>.
						The server will refuse removal if tickets already exist for this slot and date.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={ clearPending }
						disabled={ delManual.isPending }
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="destructive"
						onClick={ confirmDelete }
						disabled={ delManual.isPending }
					>
						{ delManual.isPending ? 'Removing…' : 'Remove session' }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
