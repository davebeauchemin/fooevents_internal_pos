import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock3 } from 'lucide-react';
import POSCheckoutPanel from '@/components/POSCheckoutPanel';
import type { POSSelection } from '@/types/posSelection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import {
	capacityLabelForSlots,
	formatSlotTime,
	groupSlotsByHour,
	hourRangeTitle,
	hourRemainingSpotsLabel,
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

function findNextAvailable( days: DayApi[] ) {
	const sorted = [ ...days ].sort( ( a, b ) => a.date.localeCompare( b.date ) );
	for ( const d of sorted ) {
		const slots = [ ... ( d.slots || [] ) ].sort( ( a, b ) => formatSlotTime( a ).localeCompare( formatSlotTime( b ) ) );
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

export default function EventDaySchedule( { detail, siteTodayYmd: siteTodayYmdProp }: Props ) {
	const { dates, labels, id: detailEventId, title: detailTitle, price: detailPrice, priceHtml: detailPriceHtml } = detail;
	const eventId = detailEventId;
	const eventTitle = detailTitle ?? '';
	const siteTodayYmd = siteTodayYmdProp ?? format( new Date(), 'yyyy-MM-dd' );
	const [ selectedYmd, setSelectedYmd ] = useState( () => detail.dates[ 0 ]?.date ?? '' );
	const [ checkoutSelection, setCheckoutSelection ] = useState<POSSelection | null>(
		null,
	);

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

	useEffect( () => {
		setCheckoutSelection( null );
	}, [ selectedYmd ] );

	const selectedDay = useMemo(
		() => dates?.find( ( d ) => d.date === selectedYmd ),
		[ dates, selectedYmd ],
	);

	const nextAvail = useMemo( () => findNextAvailable( dates || [] ), [ dates ] );

	const hourGroups = useMemo(
		() =>
			selectedDay?.slots?.length
				? groupSlotsByHour( selectedDay.slots )
				: [],
		[ selectedDay?.slots ],
	);

	const upcomingDaysCount = dates?.length ?? 0;
	const slotCount = selectedDay?.slots?.length ?? 0;
	const capacity = selectedDay
		? capacityLabelForSlots( selectedDay.slots || [] )
		: '—';

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
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Upcoming days</CardDescription>
						<CardTitle className="text-2xl tabular-nums">{ upcomingDaysCount }</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Slots (selected day)</CardDescription>
						<CardTitle className="text-2xl tabular-nums">{ slotCount }</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Capacity (selected day)</CardDescription>
						<CardTitle className="text-2xl tabular-nums">{ capacity }</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Next available</CardDescription>
						<CardTitle className="text-base font-medium leading-snug">
							{ nextAvail ? (
								<>
									{ format( parseISO( `${ nextAvail.day.date }T12:00:00` ), 'MMM d' ) }
									{ ' · ' }
									<span className="text-muted-foreground font-mono text-sm">
										{ formatSlotTime( nextAvail.slot ) }
									</span>
								</>
							) : (
								<span className="text-muted-foreground">—</span>
							) }
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

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
							<div className="max-w-[200px] truncate font-medium">
								{ d.label }
							</div>
							<div className="text-muted-foreground text-xs">
								{ format( parseISO( `${ d.date }T12:00:00` ), 'yyyy-MM-dd' ) }
							</div>
						</button>
					) ) }
				</div>
			</div>

			<div
				className={ cn(
					'lg:grid lg:grid-cols-[1fr_minmax(280px,360px)] lg:items-start lg:gap-6',
					'space-y-6 lg:space-y-0',
				) }
			>
				<Card className="min-w-0">
				<CardHeader>
					<CardTitle className="text-lg">
						{ selectedDay
							? format( parseISO( `${ selectedDay.date }T12:00:00` ), 'PPP' )
							: 'Schedule' }
					</CardTitle>
					<CardDescription>
						{ labels?.slot ?? 'Slot' }s grouped by hour · select a slot for checkout
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					{ ! selectedDay?.slots?.length && (
						<p className="text-muted-foreground text-sm">No slots on this day.</p>
					) }
					{ hourGroups.length > 0 && selectedDay && (
						<Accordion
							key={ selectedYmd }
							type="multiple"
							defaultValue={ [] }
							className="w-full"
						>
							{ hourGroups.map( ( g ) => {
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
										<div className="space-y-2 border-border pl-0 sm:pl-1">
											{ g.slots.map( ( s ) => {
												const selectable =
													Boolean( eventId )
													&& slotSelectable(
														selectedDay.date,
														s.stock,
														siteTodayYmd,
													);
												const rowKey = `${ eventId }|${ s.id }|${ s.dateId ?? '' }|${ selectedDay.date }`;
												const selKey = checkoutSelection
													? `${ checkoutSelection.eventId }|${ checkoutSelection.slotId }|${ checkoutSelection.dateId }|${ checkoutSelection.viewDateYmd }`
													: '';
												const selected = selectable && rowKey === selKey;
												const pickSlot = () => {
													if ( ! eventId || ! selectable ) {
														return;
													}
													setCheckoutSelection( {
														eventId,
														eventTitle: eventTitle || 'Event',
														dateLabel: selectedDay.label,
														viewDateYmd: selectedDay.date,
														slotId: s.id,
														dateId: s.dateId ?? '',
														slotLabel: s.label,
														slotTime: formatSlotTime( s ),
														remaining: s.stock,
														price: detailPrice ?? null,
														priceHtml: detailPriceHtml ?? '',
													} );
												};
												return (
												<div
													key={ `${ s.id }-${ s.dateId ?? '' }` }
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
														<div className="text-muted-foreground flex w-20 shrink-0 items-center gap-1 font-mono text-sm">
															<Clock3 className="h-3.5 w-3.5" />
															{ formatSlotTime( s ) }
														</div>
														<div className="min-w-0 truncate text-sm">
															{ s.label }
														</div>
													</div>
													<div className="flex shrink-0 items-center gap-2">
														<StockBadge stock={ s.stock } />
														{ eventId ? (
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
														) : (
															<span className="text-muted-foreground text-xs">—</span>
														) }
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
					) }
				</CardContent>
				</Card>
				<div className="min-w-0">
					<POSCheckoutPanel
						selection={ checkoutSelection }
						siteTodayYmd={ siteTodayYmd }
						onClear={ () => setCheckoutSelection( null ) }
					/>
				</div>
			</div>
		</div>
	);
}
