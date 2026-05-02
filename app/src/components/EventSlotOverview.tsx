import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock3, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAddManualSlot, useDeleteManualSlot } from '../api/queries.js';
import { slotAvailabilityText } from '@/components/SlotCartToggleButton';
import BookingScheduleSummaryCards, {
	type BookingScheduleSummaryPayload,
} from '@/components/BookingScheduleSummaryCards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
	slotSelectable,
} from '@/lib/slotHourGrouping';

type SlotApi = {
	id: string;
	label: string;
	time?: string;
	stock: number | null;
	dateId?: string;
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
		title: string;
	} | null >( null );
	const siteTodayYmd = siteTodayYmdProp ?? format( new Date(), 'yyyy-MM-dd' );
	const [ selectedYmd, setSelectedYmd ] = useState( () => detail.dates[ 0 ]?.date ?? '' );

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
					{ dates.map( ( d ) => (
						<button
							key={ d.id + d.date }
							type="button"
							onClick={ () => setSelectedYmd( d.date ) }
							className={ cn(
								'rounded-lg border px-3 py-2 text-left text-sm transition',
								selectedYmd === d.date
									? 'border-primary bg-primary/10 text-foreground'
									: 'border-border bg-card hover:border-primary/50',
							) }
						>
							<div className="max-w-[200px] truncate font-medium">{ d.label }</div>
							<div className="text-muted-foreground text-xs">
								{ format( parseISO( `${ d.date }T12:00:00` ), 'yyyy-MM-dd' ) }
							</div>
						</button>
					) ) }
				</div>
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
									You can also add or remove sessions for{' '}
									<span className="font-mono text-xs">{ selectedDay?.date }</span> below (same as
									Manage schedule manual sessions).
								</span>
							) }
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 pt-0">
						{ manageSlotsUi && selectedDay?.date ? (
							<EventOverviewManualAddToolbar
								eventId={ detail.id as number }
								selectedYmd={ selectedDay.date }
							/>
						) : null }

						{ manageSlotsUi ? (
							<EventOverviewDeleteConfirmDialog
								eventId={ detail.id as number }
								pendingDelete={ pendingDelete }
								clearPending={ () => setPendingDelete( null ) }
							/>
						) : null }

						{ ! selectedDay?.slots?.length && (
							<p className="text-muted-foreground text-sm">No slots on this day.</p>
						) }
						{ hourGroups.length > 0 && selectedDay && (
							<div key={ selectedYmd } className="space-y-8">
								{ hourGroups.map( ( g ) => {
									const leftLabel = hourRemainingSpotsLabel( g.slots );
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
													return (
														<SlotOverviewCard
															key={ `${ s.id }-${ s.dateId ?? '' }` }
															timeText={ formatSlotTime( s ) }
															stock={ s.stock }
															emphasized={ bookable }
															manageSlots={ manageSlotsUi }
															canRemoveSlot={ canRemove }
															removeDisabled={ pendingDelete !== null }
															onRequestRemove={
																canRemove
																	? () =>
																		setPendingDelete( {
																			slotId: sid,
																			dateId: did,
																			title:
																				[ s.label, formatSlotTime( s ) ]
																					.filter( Boolean )
																					.join( ' · ' )
																					.trim() ||
																					`Slot ${ sid }`,
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
	removeDisabled,
	onRequestRemove,
}: {
	timeText: string;
	stock: number | null;
	emphasized: boolean;
	manageSlots?: boolean;
	canRemoveSlot?: boolean;
	removeDisabled?: boolean;
	onRequestRemove?: () => void;
} ) {
	const availability = slotAvailabilityText( stock );
	const full =
		stock !== null && stock !== undefined && stock <= 0;
	const unlimited = stock === null || stock === undefined;
	const showTrash =
		manageSlots && canRemoveSlot && typeof onRequestRemove === 'function';
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
			<div className="flex shrink-0 items-center gap-2">
				<span
					className={ cn(
						'text-muted-foreground tabular-nums text-xs',
						full && 'text-destructive font-medium',
					) }
				>
					{ availability }
				</span>
				{ showTrash ? (
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
						disabled={ removeDisabled }
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

function EventOverviewManualAddToolbar( {
	eventId,
	selectedYmd,
}: {
	eventId: number;
	selectedYmd: string;
} ) {
	const [ manualTime, setManualTime ] = useState( '09:00' );
	const [ manualCapacity, setManualCapacity ] = useState( 10 );
	const [ manualLabel, setManualLabel ] = useState( '' );
	const addManual = useAddManualSlot( eventId );

	async function onSubmit( ev: FormEvent ) {
		ev.preventDefault();
		try {
			const payload: Record<string, unknown> = {
				date: selectedYmd.trim(),
				time: manualTime.trim(),
				capacity: manualCapacity < 0 ? 0 : manualCapacity,
			};
			const lab = manualLabel.trim();
			if ( lab ) {
				payload.label = lab;
			}
			await addManual.mutateAsync( payload );
			toast.success( 'Session added to this date.' );
		} catch ( e ) {
			toast.error( String( ( e as Error )?.message || e || 'Request failed' ) );
		}
	}

	return (
		<form
			onSubmit={ onSubmit }
			className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-end"
		>
			<div className="text-muted-foreground w-full shrink-0 text-xs font-medium sm:w-auto">
				Add session · { ' ' }
				<span className="font-mono">{ selectedYmd }</span>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="overview-manual-time" className="text-xs">
					Time
				</Label>
				<Input
					id="overview-manual-time"
					type="time"
					value={ manualTime }
					onChange={ ( e ) => setManualTime( e.target.value ) }
					disabled={ addManual.isPending }
					required
					className="w-[140px]"
				/>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="overview-manual-cap" className="text-xs">
					Capacity
				</Label>
				<Input
					id="overview-manual-cap"
					type="number"
					min={ 0 }
					className="w-[104px]"
					value={ manualCapacity }
					onChange={ ( e ) =>
						setManualCapacity( parseInt( e.target.value, 10 ) || 0 )
					}
					disabled={ addManual.isPending }
					required
				/>
			</div>
			<div className="min-w-[140px] flex-1 space-y-1.5">
				<Label htmlFor="overview-manual-label" className="text-xs">
					Label <span className="text-muted-foreground font-normal">(optional)</span>
				</Label>
				<Input
					id="overview-manual-label"
					placeholder="e.g. Regular"
					value={ manualLabel }
					onChange={ ( e ) => setManualLabel( e.target.value ) }
					disabled={ addManual.isPending }
					maxLength={ 60 }
					autoComplete="off"
				/>
			</div>
			<Button type="submit" disabled={ addManual.isPending } className="shrink-0">
				{ addManual.isPending ? 'Adding…' : 'Add session' }
			</Button>
		</form>
	);
}

function EventOverviewDeleteConfirmDialog( {
	eventId,
	pendingDelete,
	clearPending,
}: {
	eventId: number;
	pendingDelete: { slotId: string; dateId: string; title: string } | null;
	clearPending: () => void;
} ) {
	const delManual = useDeleteManualSlot( eventId );

	async function confirmDelete() {
		if ( ! pendingDelete ) {
			return;
		}
		try {
			await delManual.mutateAsync( {
				slotId: pendingDelete.slotId,
				dateId: pendingDelete.dateId,
			} );
			toast.success( 'Slot removed.' );
			clearPending();
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
