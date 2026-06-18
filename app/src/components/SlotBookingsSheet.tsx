import { format, parseISO } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSlotBookings } from '../api/queries.js';
import { Badge } from '@/components/ui/badge';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

type SlotBookingsTicket = {
	ticketId?: string;
	ticketNumericId?: string;
	attendeeName?: string;
	status?: string;
};

type SlotBookingsOrder = {
	orderId?: number;
	orderNumber?: string;
	orderDate?: string | null;
	purchaserName?: string;
	purchaserEmail?: string;
	tickets?: SlotBookingsTicket[];
};

type SlotBookingsResponse = {
	summary?: {
		ticketCount?: number;
		orderCount?: number;
		activeTicketCount?: number;
	};
	remainingSpots?: number | null;
	totalCapacity?: number | null;
	capacityDrift?: boolean;
	orders?: SlotBookingsOrder[];
	slotLabel?: string;
	dateLabel?: string;
};

function statusBadgeClass( status: string ) {
	switch ( status ) {
		case 'Not Checked In':
			return 'border-blue-600/50 bg-blue-500/15 text-blue-950 dark:border-blue-500/55 dark:bg-blue-950/45 dark:text-blue-100';
		case 'Checked In':
			return 'border-amber-600/50 bg-amber-500/15 text-amber-950 dark:border-amber-500/55 dark:bg-amber-950/35 dark:text-amber-100';
		case 'Canceled':
			return 'border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-red-300';
		default:
			return 'border-muted-foreground/35 bg-muted/40 text-muted-foreground';
	}
}

function searchRowAccentClass( status: string ): string {
	switch ( status ) {
		case 'Not Checked In':
			return 'border-blue-600/35 bg-blue-500/5 hover:bg-blue-500/15 dark:bg-blue-950/25';
		case 'Checked In':
			return 'border-amber-600/35 bg-amber-500/5 hover:bg-amber-500/12 dark:bg-amber-950/25';
		case 'Canceled':
			return 'border-destructive/30 bg-destructive/5 hover:bg-destructive/12';
		default:
			return 'border-transparent hover:bg-accent/75';
	}
}

function formatOrderDate( iso: string | null | undefined ): string {
	if ( ! iso ) {
		return '—';
	}
	try {
		return format( parseISO( iso ), 'MMM d, yyyy · h:mm a' );
	} catch {
		return iso;
	}
}

type Props = {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	eventId: number;
	eventTitle?: string;
	slotId: string;
	dateId: string;
	timeText: string;
	dateLabel: string;
	bookedCount?: number;
};

export default function SlotBookingsSheet( {
	open,
	onOpenChange,
	eventId,
	eventTitle,
	slotId,
	dateId,
	timeText,
	dateLabel,
}: Props ) {
	const { canValidateTickets } = useAuth();
	const query = useSlotBookings( eventId, slotId, dateId, { enabled: open } );
	const data = query.data as SlotBookingsResponse | undefined;
	const orders = data?.orders ?? [];
	const summary = data?.summary;
	const capacityDrift = Boolean( data?.capacityDrift );
	const remainingSpots = data?.remainingSpots;

	return (
		<Sheet open={ open } onOpenChange={ onOpenChange }>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
				<SheetHeader className="shrink-0 border-b pb-4">
					<SheetTitle className="font-mono tabular-nums">{ timeText }</SheetTitle>
					<SheetDescription className="text-left">
						<span className="block">{ dateLabel }</span>
						{ eventTitle ? (
							<span className="text-muted-foreground mt-1 block text-xs">{ eventTitle }</span>
						) : null }
					</SheetDescription>
					{ query.isSuccess && summary ? (
						<p className="text-muted-foreground pt-1 text-xs">
							<span className="tabular-nums">{ summary.ticketCount ?? 0 }</span>
							{ ' ticket' }
							{ ( summary.ticketCount ?? 0 ) === 1 ? '' : 's' }
							{ ' · ' }
							<span className="tabular-nums">{ summary.orderCount ?? 0 }</span>
							{ ' order' }
							{ ( summary.orderCount ?? 0 ) === 1 ? '' : 's' }
							{ typeof summary.activeTicketCount === 'number' ? (
								<>
									{ ' · ' }
									<span className="tabular-nums">{ summary.activeTicketCount }</span>
									{ ' active' }
								</>
							) : null }
						</p>
					) : null }
					{ query.isSuccess && capacityDrift && typeof remainingSpots === 'number' ? (
						<p className="rounded-md border border-amber-600/35 bg-amber-500/10 px-2 py-2 text-xs text-amber-950 dark:text-amber-100">
							<span className="tabular-nums font-medium">{ remainingSpots }</span>
							{ ' spots remain in capacity, but no tickets exist for this session. Capacity may need repair after cancelled storefront orders.' }
						</p>
					) : null }
				</SheetHeader>

				<div className="min-h-0 flex-1 overflow-y-auto py-4">
					{ query.isLoading ? (
						<div className="space-y-3 px-1">
							<Skeleton className="h-16 w-full" />
							<Skeleton className="h-16 w-full" />
							<Skeleton className="h-16 w-full" />
						</div>
					) : query.isFetching && ! query.isLoading ? (
						<p className="text-muted-foreground mb-3 flex items-center gap-2 px-1 text-xs">
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
							Refreshing…
						</p>
					) : null }

					{ query.isError ? (
						<p className="text-destructive px-1 py-6 text-center text-sm">
							{ query.error instanceof Error ? query.error.message : 'Could not load bookings.' }
						</p>
					) : null }

					{ query.isSuccess && orders.length === 0 ? (
						<p className="text-muted-foreground px-1 py-6 text-center text-sm">
							No tickets for this session.
						</p>
					) : null }

					{ query.isSuccess && orders.length > 0 ? (
						<div className="space-y-4 px-1">
							{ orders.map( ( order ) => {
								const oid = order.orderId ?? 0;
								const tickets = order.tickets ?? [];
								const orderLabel =
									oid > 0 && order.orderNumber
										? `#${ order.orderNumber }`
										: oid > 0
											? `#${ oid }`
											: 'No order';
								return (
									<section key={ `${ oid }-${ order.orderNumber ?? '' }` } className="space-y-2">
										<div className="flex flex-wrap items-baseline justify-between gap-2">
											<h3 className="text-sm font-medium">{ orderLabel }</h3>
											<span className="text-muted-foreground text-xs">
												{ formatOrderDate( order.orderDate ) }
											</span>
										</div>
										{ order.purchaserName || order.purchaserEmail ? (
											<p className="text-muted-foreground text-xs">
												{ order.purchaserName ?? order.purchaserEmail }
												{ order.purchaserName && order.purchaserEmail ? (
													<span className="text-muted-foreground/80">
														{ ' · ' }
														{ order.purchaserEmail }
													</span>
												) : null }
											</p>
										) : null }
										<ul className="divide-y rounded-md border">
											{ tickets.map( ( ticket ) => {
												const rs = String( ticket.status ?? '' );
												const lookup = String(
													ticket.ticketId ?? ticket.ticketNumericId ?? '',
												).trim();
												const rowInner = (
													<>
														<span className="flex flex-wrap items-center justify-between gap-2 font-medium">
															<span>{ ticket.attendeeName ?? ( lookup || '—' ) }</span>
															<span className="flex flex-wrap items-center gap-2">
																{ rs === 'Not Checked In' && (
																	<span className="text-blue-700 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-wide">
																		Ready
																	</span>
																) }
																<Badge className={ statusBadgeClass( rs ) }>
																	{ rs || '—' }
																</Badge>
															</span>
														</span>
														{ lookup ? (
															<span className="text-muted-foreground font-mono text-[11px]">
																{ lookup }
															</span>
														) : null }
													</>
												);
												return (
													<li
														key={ lookup || `${ oid }-${ ticket.ticketNumericId }` }
														className={ cn( 'border-l-4', searchRowAccentClass( rs ) ) }
													>
														{ canValidateTickets && lookup ? (
															<Link
																to={ `/validate?ticket=${ encodeURIComponent( lookup ) }` }
																className="flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm transition-colors hover:underline"
															>
																{ rowInner }
															</Link>
														) : (
															<div className="flex flex-col gap-1 px-3 py-2.5 text-sm">
																{ rowInner }
															</div>
														) }
													</li>
												);
											} ) }
										</ul>
									</section>
								);
							} ) }
						</div>
					) : null }
				</div>
			</SheetContent>
		</Sheet>
	);
}
