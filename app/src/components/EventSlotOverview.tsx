import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock3 } from 'lucide-react';
import { slotAvailabilityText } from '@/components/SlotCartToggleButton';
import BookingScheduleSummaryCards, {
	type BookingScheduleSummaryPayload,
} from '@/components/BookingScheduleSummaryCards';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
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

/**
 * Read-only schedule for event detail: dates, summary stats, and slot availability per hour.
 * Does not use cart or booking toggles — use the calendar page to build an order.
 */
export default function EventSlotOverview( {
	detail,
	siteTodayYmd: siteTodayYmdProp,
}: Props ) {
	const { dates, labels } = detail;
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
							Slot availability grouped by hour (read-only; book from Calendar)
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 pt-0">
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
													return (
														<SlotOverviewCard
															key={ `${ s.id }-${ s.dateId ?? '' }` }
															timeText={ formatSlotTime( s ) }
															stock={ s.stock }
															emphasized={ bookable }
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
}: {
	timeText: string;
	stock: number | null;
	emphasized: boolean;
} ) {
	const availability = slotAvailabilityText( stock );
	const full =
		stock !== null && stock !== undefined && stock <= 0;
	const unlimited = stock === null || stock === undefined;
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
			<div className="text-muted-foreground flex shrink-0 items-center gap-1 font-mono text-sm tabular-nums">
				<Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
				<span>{ timeText }</span>
			</div>
			<span
				className={ cn(
					'text-muted-foreground shrink-0 tabular-nums text-xs',
					full && 'text-destructive font-medium',
				) }
			>
				{ availability }
			</span>
		</div>
	);
}
