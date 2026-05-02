import { format, parseISO } from 'date-fns';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatSlotTime } from '@/lib/slotHourGrouping';

export type NextAvailableSlotPayload = {
	dateYmd: string;
	slot: {
		id?: string;
		label?: string;
		time?: string;
		stock?: number | null;
		dateId?: string;
	};
};

export type BookingScheduleSummaryPayload = {
	/** Omit or null when server does not aggregate (shows em dash). */
	upcomingDistinctDays?: number | null;
	slotsOnSelectedDay: number;
	capacityOnSelectedDay: string;
	nextAvailable?: NextAvailableSlotPayload | null;
};

export type LeadingDayTimeRange = {
	startLabel: string;
	endLabel: string;
};

type Props = {
	summary?: BookingScheduleSummaryPayload | null;
	isLoading?: boolean;
	/**
	 * When provided, replaces the first “Upcoming days” card with the selected day’s
	 * first and last slot times (calendar/dashboard). Omit on event manage/overview.
	 */
	leadingDayTimeRange?: LeadingDayTimeRange | null;
};

/** Four cards matching event manage / overview summary stats */
export default function BookingScheduleSummaryCards( {
	summary,
	isLoading,
	leadingDayTimeRange,
}: Props ) {
	if ( isLoading ) {
		return (
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{ [ 1, 2, 3, 4 ].map( ( i ) => (
					<Skeleton key={ i } className="h-[88px] w-full rounded-xl" />
				) ) }
			</div>
		);
	}

	if ( ! summary ) {
		return null;
	}

	const na = summary.nextAvailable;

	const leadingIsDayRange = leadingDayTimeRange !== undefined;
	const span = leadingIsDayRange ? leadingDayTimeRange ?? null : null;
	const showSpan = Boolean(
		span?.startLabel
		&& span?.endLabel
		&& span.startLabel !== '—'
		&& span.endLabel !== '—',
	);

	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<Card>
				<CardHeader className="pb-2">
					<CardDescription>
						{ leadingIsDayRange ? 'Start · end (selected day)' : 'Upcoming days' }
					</CardDescription>
					{ leadingIsDayRange ? (
						<CardTitle className="text-base font-medium leading-snug tabular-nums">
							{ showSpan && span ? (
								<>
									<span>{ span.startLabel }</span>
									<span className="text-muted-foreground">{ ' · ' }</span>
									<span>{ span.endLabel }</span>
								</>
							) : (
								<span className="text-muted-foreground text-2xl">—</span>
							) }
						</CardTitle>
					) : (
						<CardTitle className="text-2xl tabular-nums">
							{ summary.upcomingDistinctDays ?? '—' }
						</CardTitle>
					) }
				</CardHeader>
			</Card>
			<Card>
				<CardHeader className="pb-2">
					<CardDescription>Slots (selected day)</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{ summary.slotsOnSelectedDay }</CardTitle>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader className="pb-2">
					<CardDescription>Capacity (selected day)</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{ summary.capacityOnSelectedDay }</CardTitle>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader className="pb-2">
					<CardDescription>Next available</CardDescription>
					<CardTitle className="text-base font-medium leading-snug">
						{ na?.dateYmd && na.slot ? (
							<>
								{ format(
									parseISO( `${ na.dateYmd }T12:00:00` ),
									'MMM d',
								) }
								{ ' · ' }
								<span className="text-muted-foreground font-mono text-sm">
									{ formatSlotTime( na.slot ) }
								</span>
							</>
						) : (
							<span className="text-muted-foreground">—</span>
						) }
					</CardTitle>
				</CardHeader>
			</Card>
		</div>
	);
}
