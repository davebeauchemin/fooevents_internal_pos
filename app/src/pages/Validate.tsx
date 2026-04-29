import { useDeferredValue, useEffect, useId, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Html5QrcodeScanner } from 'html5-qrcode';
import {
	ArrowLeft,
	CalendarClock,
	Camera,
	CheckCircle2,
	CircleAlert,
	Loader2,
	ScanBarcode,
	UserSearch,
	X,
	XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
	useRescheduleTicket,
	useTicketDetail,
	useTicketSearch,
	useUpdateTicketStatus,
	useValidateEvent,
} from '@/api/queries.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import {
	formatSlotTime,
	groupSlotsByHour,
	hidePastHourBucketsForToday,
	slotSelectable,
} from '@/lib/slotHourGrouping';
import { cn } from '@/lib/utils';

const SCAN_REGION_VALIDATE = 'fooevents-validate-scan-region';
const SCAN_REGION_CHECKIN = 'fooevents-checkin-scan-region';

/** Non-empty booking meta id from API (string or number). */
function normalizedBookingMetaId( v: unknown ): string {
	if ( v == null ) {
		return '';
	}
	return String( v ).trim();
}

function ticketHasBookingSlotIds( ticket: FooTicketPayload ): boolean {
	return (
		normalizedBookingMetaId( ticket.WooCommerceEventsBookingSlotID ) !== ''
		&& normalizedBookingMetaId( ticket.WooCommerceEventsBookingDateID ) !== ''
	);
}

/** @param {unknown} s */
function isNonEmptyStr( s: unknown ): s is string {
	return typeof s === 'string' && s.trim().length > 0;
}

type TicketTone = 'neutral' | 'blue' | 'green' | 'yellow' | 'red';

/** Badge + search row accents aligned with ticket visual language. */
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

/**
 * Builds REST `ticketId` path segment for validate/reschedule (matches `get_single_ticket` lookup rules).
 */
function ticketLookupArg(
	ticket: FooTicketPayload,
	selectedId: string | null
): string {
	const sel = selectedId && selectedId.trim() !== '' ? selectedId.trim() : '';
	if ( sel ) {
		return sel;
	}
	const pid = String( ticket.WooCommerceEventsProductID ?? '' ).trim();
	const formatted = ticket.WooCommerceEventsTicketNumberFormatted;
	const fmt = isNonEmptyStr( formatted ) ? formatted.trim() : '';
	if ( pid && fmt && ! fmt.includes( '-' ) ) {
		return `${ pid }-${ fmt }`;
	}
	if ( fmt ) {
		return fmt;
	}
	return String( ticket.WooCommerceEventsTicketID ?? '' ).trim();
}

/** Card border/background tone for main ticket Card. */
function ticketCardToneClass( tone: TicketTone ): string {
	switch ( tone ) {
		case 'blue':
			return 'border-blue-600/65 bg-blue-500/12 shadow-sm dark:border-blue-500/55 dark:bg-blue-950/45';
		case 'green':
			return 'border-green-600/65 bg-green-500/12 shadow-md dark:border-green-500/55 dark:bg-green-950/40';
		case 'yellow':
			return 'border-amber-500/70 bg-amber-400/10 shadow-sm dark:border-amber-500/50 dark:bg-amber-950/35';
		case 'red':
			return 'border-destructive/60 bg-destructive/10 dark:bg-destructive/15';
		default:
			return '';
	}
}

function resolveTicketTone( args: {
	ticket?: FooTicketPayload;
	loading: boolean;
	error: boolean;
	justCheckedInNumericId: string | null;
} ): TicketTone {
	if ( args.error ) {
		return 'red';
	}
	if ( args.loading || ! args.ticket ) {
		return 'neutral';
	}
	const t = args.ticket;
	const nid = String( t.WooCommerceEventsTicketID ?? '' ).trim();
	if (
		args.justCheckedInNumericId
		&& nid
		&& args.justCheckedInNumericId === nid
	) {
		return 'green';
	}
	switch ( String( t.WooCommerceEventsStatus ?? '' ) ) {
		case 'Not Checked In':
			return 'blue';
		case 'Checked In':
			return 'yellow';
		case 'Canceled':
			return 'red';
		default:
			return 'neutral';
	}
}

type ResultPanelCopy = {
	ResultIcon:
		| typeof CheckCircle2
		| typeof CircleAlert
		| typeof XCircle;
	headline: string;
	subtitle: string;
};

function ticketResultCopy( args: {
	ticket?: FooTicketPayload;
	error: boolean;
	justCheckedInNumericId: string | null;
} ): ResultPanelCopy {
	if ( args.error ) {
		return {
			ResultIcon: XCircle,
			headline: 'Ticket not found',
			subtitle: 'Do not admit unless verified manually.',
		};
	}
	if ( ! args.ticket ) {
		return {
			ResultIcon: CircleAlert,
			headline: 'Review ticket',
			subtitle: 'Status unavailable or unknown.',
		};
	}
	const t = args.ticket;
	const nid = String( t.WooCommerceEventsTicketID ?? '' ).trim();
	if (
		args.justCheckedInNumericId
		&& nid
		&& args.justCheckedInNumericId === nid
	) {
		return {
			ResultIcon: CheckCircle2,
			headline: 'Checked in',
			subtitle: 'Entry confirmed for this attendee.',
		};
	}
	switch ( String( t.WooCommerceEventsStatus ?? '' ) ) {
		case 'Not Checked In':
			return {
				ResultIcon: CheckCircle2,
				headline: 'Valid ticket',
				subtitle: 'Ready to check in.',
			};
		case 'Checked In':
			return {
				ResultIcon: CircleAlert,
				headline: 'Already checked in',
				subtitle: 'This ticket has already been used.',
			};
		case 'Canceled':
			return {
				ResultIcon: XCircle,
				headline: 'Canceled ticket',
				subtitle: 'Do not admit.',
			};
		default:
			return {
				ResultIcon: CircleAlert,
				headline: 'Review ticket',
				subtitle: 'Status unavailable or unknown.',
			};
	}
}

type FooTicketPayload = Record< string, unknown > & {
	WooCommerceEventsTicketID?: string;
	WooCommerceEventsProductID?: string;
	WooCommerceEventsTicketNumberFormatted?: string;
	WooCommerceEventsOrderTickets?: string[];
	WooCommerceEventsOrderTicketsData?: string[];
	WooCommerceEventsStatus?: string;
	WooCommerceEventsAttendeeName?: string;
	WooCommerceEventsAttendeeLastName?: string;
	WooCommerceEventsAttendeeEmail?: string;
	WooCommerceEventsAttendeeTelephone?: string;
	WooCommerceEventsBookingDate?: string;
	WooCommerceEventsBookingSlot?: string;
	WooCommerceEventsBookingSlotID?: string | number;
	WooCommerceEventsBookingDateID?: string | number;
	eventDisplayName?: string;
};

type EventDetailForReschedule = {
	id?: number;
	bookingMethod?: string;
	labels?: { date?: string; slot?: string };
	dates?: Array<{
		id: string;
		date: string;
		label: string;
		slots?: Array<{
			id: string;
			dateId?: string;
			label: string;
			stock: number | null;
			time?: string;
		}>;
	}>;
	error?: string;
};

type ScanPurpose = 'validate' | 'checkin';

/** True when this API slot/date pair matches the ticket’s stored booking IDs. */
function isTicketOnSlot(
	ticket: FooTicketPayload,
	slotId: string,
	apiDateId: string,
) {
	return (
		String( ticket.WooCommerceEventsBookingSlotID ?? '' ) === String( slotId )
		&& String( ticket.WooCommerceEventsBookingDateID ?? '' ) === String( apiDateId )
	);
}

function TicketRescheduleDialog( props: {
	open: boolean;
	onOpenChange: ( v: boolean ) => void;
	ticket: FooTicketPayload;
	ticketLookup: string;
	eventProductId: number;
} ) {
	const { open, onOpenChange, ticket, ticketLookup, eventProductId } = props;
	const eventQ = useValidateEvent( eventProductId, { enabled: open } );
	const rescheduleMut = useRescheduleTicket();
	const detail = eventQ.data as EventDetailForReschedule | undefined;

	const siteTodayYmd = format( new Date(), 'yyyy-MM-dd' );
	const [ viewYmd, setViewYmd ] = useState( '' );
	const [ picked, setPicked ] = useState< {
		slotId: string;
		dateParam: string;
		internalDateId: string;
	} | null >( null );

	const bookingMethod = detail?.bookingMethod ?? 'slotdate';
	const isDateSlot = bookingMethod === 'dateslot';
	const dates = detail?.dates ?? [];

	useEffect( () => {
		if ( ! open || ! dates.length ) {
			return;
		}
		setViewYmd( ( prev ) => {
			if ( prev && dates.some( ( d ) => d.date === prev ) ) {
				return prev;
			}
			return dates[ 0 ]!.date;
		} );
		setPicked( null );
	}, [ open, dates ] );

	const selectedDay = dates.find( ( d ) => d.date === viewYmd );
	const slots = selectedDay?.slots ?? [];

	const groups = hidePastHourBucketsForToday(
		groupSlotsByHour( slots ),
		viewYmd,
		siteTodayYmd,
	);

	const submitDisabled = ( () => {
		if ( ! picked || ! selectedDay ) {
			return true;
		}
		if (
			isTicketOnSlot( ticket, picked.slotId, picked.internalDateId )
		) {
			return true;
		}
		return false;
	} )();

	const onConfirm = () => {
		if ( ! picked || submitDisabled ) {
			return;
		}
		rescheduleMut.mutate(
			{
				ticketId: ticketLookup,
				eventId: eventProductId,
				slotId: picked.slotId,
				dateId: picked.dateParam,
			},
			{
				onSuccess: () => {
					toast.success( 'Ticket rescheduled.' );
					onOpenChange( false );
				},
				onError: ( err: Error ) => {
					toast.error( err?.message ?? 'Reschedule failed' );
				},
			},
		);
	};

	return (
		<Dialog open={ open } onOpenChange={ onOpenChange }>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton>
				<DialogHeader>
					<DialogTitle>Reschedule booking</DialogTitle>
					<DialogDescription>
						Move this ticket to another date or time on the same event. The existing order
						and payment are unchanged.
					</DialogDescription>
				</DialogHeader>

				<div className="bg-muted/50 space-y-1 rounded-lg border px-3 py-2 text-sm">
					<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
						Current booking
					</p>
					<p>{ ticket.WooCommerceEventsBookingDate || '\u2014' }</p>
					<p>{ ticket.WooCommerceEventsBookingSlot || '\u2014' }</p>
				</div>

				{ String( ticket.WooCommerceEventsStatus ?? '' ) === 'Checked In' && (
					<p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
						This ticket is already checked in. Rescheduling keeps the checked-in status.
					</p>
				) }

				{ eventQ.isLoading && (
					<div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
						<Loader2 className="size-5 animate-spin" aria-hidden />
						Loading event schedule…
					</div>
				) }

				{ eventQ.isError && (
					<p className="text-destructive text-sm">
						{ eventQ.error instanceof Error
							? eventQ.error.message
							: 'Could not load event.' }
					</p>
				) }

				{ detail?.error === 'not_booking_event' && (
					<p className="text-muted-foreground text-sm">
						This ticket is not for a booking event — rescheduling slots is not available.
					</p>
				) }

				{ detail && ! detail.error && dates.length === 0 && (
					<p className="text-muted-foreground text-sm">No upcoming bookable dates.</p>
				) }

				{ detail && ! detail.error && dates.length > 0 && (
					<div className="space-y-4">
						<div>
							<p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
								{ detail.labels?.date ?? 'Date' }
							</p>
							<div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto pb-1">
								{ dates.map( ( d ) => (
									<button
										key={ d.id + d.date }
										type="button"
										onClick={ () => {
											setViewYmd( d.date );
											setPicked( null );
										} }
										className={ cn(
											'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
											viewYmd === d.date
												? 'border-primary bg-primary/10'
												: 'border-border bg-card hover:border-primary/50',
										) }
									>
										<div className="max-w-[180px] truncate font-medium">{ d.label }</div>
										<div className="text-muted-foreground text-xs">
											{ format( parseISO( `${ d.date }T12:00:00` ), 'yyyy-MM-dd' ) }
										</div>
									</button>
								) ) }
							</div>
						</div>

						<div>
							<p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
								{ detail.labels?.slot ?? 'Slot' }
							</p>
							<div className="max-h-52 space-y-3 overflow-y-auto pr-1">
								{ groups.length === 0 ? (
									<p className="text-muted-foreground text-sm">
										No bookable slots for this day.
									</p>
								) : (
									groups.map( ( g ) => (
										<div key={ g.key }>
											<p className="text-muted-foreground mb-1.5 text-xs font-medium">
												{ String( g.hour ).padStart( 2, '0' ) }:00
											</p>
											<div className="flex flex-wrap gap-2">
												{ g.slots.map( ( slot ) => {
													const dateParam = isDateSlot
														? ( selectedDay?.id ?? '' )
														: ( slot.dateId || selectedDay?.id || '' );
													const internalDateId = String( slot.dateId ?? '' );
													const isCurrent = isTicketOnSlot(
														ticket,
														slot.id,
														internalDateId,
													);
													const selectable = slotSelectable(
														viewYmd,
														slot.stock,
														siteTodayYmd,
													);
													const disabled = ! selectable || isCurrent;
													const isPicked =
														picked
														&& picked.slotId === slot.id
														&& picked.internalDateId === internalDateId;
													return (
														<button
															key={ slot.id + String( slot.dateId ?? '' ) }
															type="button"
															disabled={ disabled }
															onClick={ () =>
																setPicked( {
																	slotId: slot.id,
																	dateParam,
																	internalDateId,
																} ) }
															className={ cn(
																'rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
																isPicked
																	&& 'border-primary bg-primary/15 ring-2 ring-primary/25',
																isCurrent
																	&& 'border-amber-600/50 bg-amber-500/10',
																disabled
																	&& 'cursor-not-allowed opacity-45',
																! disabled
																	&& ! isPicked
																	&& 'hover:border-primary/55',
															) }
														>
															<span className="block font-medium">
																{ formatSlotTime( slot ) }
															</span>
															{ slot.label
																&& formatSlotTime( slot ) !== slot.label.trim() ? (
																		<span className="text-muted-foreground block truncate">
																			{ slot.label }
																		</span>
																	) : null }
															{ slot.stock !== null && slot.stock !== undefined ? (
																<span className="text-muted-foreground block">
																	{ slot.stock } left
																</span>
															) : (
																<span className="text-muted-foreground block">
																	Unlimited
																</span>
															) }
															{ isCurrent ? (
																<span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
																	Current
																</span>
															) : null }
														</button>
													);
												} ) }
											</div>
										</div>
									) )
								) }
							</div>
						</div>
					</div>
				) }

				<DialogFooter className="gap-2 sm:gap-0">
					<Button
						type="button"
						variant="outline"
						onClick={ () => onOpenChange( false ) }
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={ submitDisabled || rescheduleMut.isPending }
						onClick={ onConfirm }
					>
						{ rescheduleMut.isPending ? (
							<>
								<Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
								Saving…
							</>
						) : (
							'Confirm reschedule'
						) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export default function Validate() {
	const formId = useId();
	const [ searchInput, setSearchInput ] = useState( '' );
	const deferredSearch = useDeferredValue( searchInput.trim() );
	const [ selectedTicketId, setSelectedTicketId ] = useState< string | null >( null );
	const [ scannerKind, setScannerKind ] = useState< ScanPurpose | null >( null );
	const [ scannerOpen, setScannerOpen ] = useState( false );

	const [ lastScanPurpose, setLastScanPurpose ] = useState< ScanPurpose | null >( null );
	const [ justCheckedInNumericId, setJustCheckedInNumericId ] = useState< string | null >( null );
	const [ rescheduleOpen, setRescheduleOpen ] = useState( false );

	const scanRegionId =
		scannerKind === 'checkin' ? SCAN_REGION_CHECKIN : SCAN_REGION_VALIDATE;

	const searchQuery = useTicketSearch( deferredSearch );
	const detailQuery = useTicketDetail( selectedTicketId );
	const statusMutation = useUpdateTicketStatus();

	const ticket = detailQuery.data?.ticket as FooTicketPayload | undefined;

	const autoCheckInHandledKeyRef = useRef< string >( '' );

	/** Stable lookup for mutate (same logic as mutation body). */
	const getLookupFromTicket = ( t?: FooTicketPayload ) =>
		t ? ticketLookupArg( t, selectedTicketId ) : '';

	useEffect( () => {
		if ( ! scannerOpen ) {
			return;
		}
		const scanner = new Html5QrcodeScanner(
			scanRegionId,
			{
				fps: 10,
				qrbox: { width: 280, height: 280 },
				rememberLastUsedCamera: true,
			},
			false
		);
		let ended = false;
		scanner.render(
			( decodedText ) => {
				if ( ended ) {
					return;
				}
				const t = decodedText.trim();
				if ( ! t ) {
					return;
				}
				const purpose = scannerKind ?? 'validate';
				if ( purpose === 'checkin' ) {
					toast.message( 'Ticket scanned — checking in…' );
				} else {
					toast.message( 'Ticket scanned — loading result…' );
				}
				setLastScanPurpose( purpose );
				setSelectedTicketId( t );
				setScannerOpen( false );
				autoCheckInHandledKeyRef.current = '';
			},
			() => {}
		);
		return () => {
			ended = true;
			void scanner.clear().catch( () => {} );
		};
	}, [ scannerOpen, scanRegionId, scannerKind ] );

	/** Auto check-in once per scan+detail resolve when scan was check-in purpose. */
	useEffect( () => {
		if (
			! ticket
			|| detailQuery.isLoading
			|| detailQuery.isError
			|| selectedTicketId == null
		) {
			return;
		}
		if ( lastScanPurpose !== 'checkin' ) {
			return;
		}
		const key = `${ selectedTicketId }::${ String( ticket.WooCommerceEventsTicketID ?? '' ) }`;
		if ( autoCheckInHandledKeyRef.current === key ) {
			return;
		}

		const st = String( ticket.WooCommerceEventsStatus ?? '' );
		const lookup = getLookupFromTicket( ticket );

		if ( st === 'Not Checked In' ) {
			if ( ! lookup ) {
				autoCheckInHandledKeyRef.current = key;
				return;
			}
			if ( statusMutation.isPending ) {
				return;
			}
			autoCheckInHandledKeyRef.current = key;
			statusMutation.mutate(
				{ ticketId: lookup, status: 'Checked In' },
				{
					onSuccess: () => {
						setJustCheckedInNumericId(
							String( ticket.WooCommerceEventsTicketID ?? '' ).trim()
						);
						toast.success(
							`Checked in — ${ String( ticket.WooCommerceEventsTicketID ?? lookup ) }`
						);
					},
					onError: ( err: Error ) => {
						autoCheckInHandledKeyRef.current = '';
						toast.error( err?.message ?? 'Check-in failed' );
					},
				}
			);
			return;
		}

		autoCheckInHandledKeyRef.current = key;
		if ( st === 'Checked In' ) {
			toast.warning( 'Already checked in — do not admit twice.' );
			return;
		}
		if ( st === 'Canceled' ) {
			toast.error( 'Canceled ticket — do not admit.' );
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- statusMutation object identity would retrigger this effect endlessly
	}, [
		lastScanPurpose,
		ticket,
		detailQuery.isLoading,
		detailQuery.isError,
		selectedTicketId,
		statusMutation.isPending,
	] );

	const clearDetailSession = () => {
		setSelectedTicketId( null );
		setLastScanPurpose( null );
		setJustCheckedInNumericId( null );
		setRescheduleOpen( false );
		autoCheckInHandledKeyRef.current = '';
	};

	const openTicketFromSearchOrSibling = ( id: string ) => {
		setJustCheckedInNumericId( null );
		setLastScanPurpose( null );
		setRescheduleOpen( false );
		autoCheckInHandledKeyRef.current = '';
		setSelectedTicketId( id.trim() );
		setScannerOpen( false );
	};

	const applyStatus = ( status: string ) => {
		if ( ! ticket?.WooCommerceEventsTicketID ) {
			return;
		}
		const lookup = getLookupFromTicket( ticket );

		statusMutation.mutate(
			{ ticketId: lookup, status },
			{
				onSuccess: () => {
					if ( status === 'Checked In' ) {
						setJustCheckedInNumericId(
							String( ticket.WooCommerceEventsTicketID ?? '' ).trim()
						);
					} else if (
						status === 'Not Checked In'
						|| status === 'Canceled'
					) {
						setJustCheckedInNumericId( null );
					}
					toast.success( `${ status } — ${ ticket.WooCommerceEventsTicketID ?? '' }` );
				},
				onError: ( err: Error ) => {
					toast.error( err?.message ?? 'Update failed' );
				},
			}
		);
	};

	if ( selectedTicketId ) {
		const tone =
			resolveTicketTone( {
				ticket,
				loading: detailQuery.isLoading,
				error: detailQuery.isError,
				justCheckedInNumericId,
			} );
		const resultCopy =
			ticketResultCopy( {
				ticket,
				error: detailQuery.isError,
				justCheckedInNumericId,
			} );
		const DisplayResultIcon = resultCopy.ResultIcon;
		const displayIdLarge = ticket
			? String(
				isNonEmptyStr( ticket.WooCommerceEventsTicketNumberFormatted )
					&& `${ ticket.WooCommerceEventsTicketNumberFormatted }`.trim() !== ''
					? ticket.WooCommerceEventsTicketNumberFormatted
					: ticket.WooCommerceEventsTicketID ?? selectedTicketId
			)
			: selectedTicketId;
		const numericIdDisp = ticket
			? String( ticket.WooCommerceEventsTicketID ?? '' )
			: '';

		return (
			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={ clearDetailSession }
						className="gap-1"
					>
						<ArrowLeft className="size-4" aria-hidden />
						Back to search
					</Button>
				</div>

				{ detailQuery.isLoading && (
					<Card className="border-muted-foreground/35">
						<CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
							<Loader2 className="size-8 shrink-0 animate-spin" aria-hidden />
							<span>Checking ticket…</span>
						</CardContent>
					</Card>
				) }

				{ detailQuery.isError && (
					<Card className={ cn( ticketCardToneClass( 'red' ), 'border-2' ) }>
						<CardHeader>
							<CardTitle className="flex items-start gap-2">
								<XCircle className="text-destructive mt-0.5 size-6 shrink-0" aria-hidden />
								<span>Ticket not found</span>
							</CardTitle>
							<CardDescription className="text-destructive">
								{ detailQuery.error instanceof Error
									? detailQuery.error.message
									: 'Ticket could not be loaded.' }
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">
								Do not admit unless manually verified.
							</p>
							<code className="bg-muted rounded px-2 py-1 font-mono text-sm">
								{ selectedTicketId }
							</code>
							<div>
								<Button variant="outline" onClick={ () => void detailQuery.refetch() }>
									Retry
								</Button>
							</div>
						</CardContent>
					</Card>
				) }

				{ ticket && (
					<Card
						className={ cn(
							'overflow-hidden border-2 transition-colors',
							ticketCardToneClass( tone ),
						) }
					>
						<CardHeader className="pb-4">
							<div
								className={ cn(
									'mb-4 flex flex-wrap items-start gap-3 rounded-lg border p-4',
									tone === 'blue' &&
										'border-blue-700/35 bg-blue-500/15 dark:bg-blue-950/50',
									tone === 'green' &&
										'border-green-700/35 bg-green-500/15 dark:bg-green-950/50',
									tone === 'yellow' &&
										'border-amber-600/35 bg-amber-500/12 dark:bg-amber-950/45',
									tone === 'red' &&
										'border-destructive/40 bg-destructive/15',
									tone === 'neutral' && 'border-muted bg-muted/40',
								) }
							>
								<div className="shrink-0">
									<DisplayResultIcon
										className={ cn(
											'size-12 stroke-[1.75]',
											tone === 'green' &&
												'text-green-700 dark:text-green-400',
											tone === 'yellow' &&
												'text-amber-700 dark:text-amber-300',
											tone === 'blue' &&
												'text-blue-700 dark:text-blue-300',
											tone === 'red' && 'text-destructive',
										) }
										aria-hidden
									/>
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-xl font-semibold tracking-tight">
										{ resultCopy.headline }
									</p>
									<p className="text-muted-foreground mt-1 max-w-prose text-sm">
										{ resultCopy.subtitle }
									</p>
								</div>
							</div>

							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<CardTitle className="text-xl leading-tight">
										{ isNonEmptyStr( ticket.eventDisplayName )
											? ticket.eventDisplayName
											: `Event product #${ String( ticket.WooCommerceEventsProductID ?? '' ) }` }
									</CardTitle>
									<CardDescription className="mt-1 space-y-0.5 tabular-nums">
										{ isNonEmptyStr( ticket.WooCommerceEventsBookingDate ) && (
											<span className="block">{ ticket.WooCommerceEventsBookingDate }</span>
										) }
										{ isNonEmptyStr( ticket.WooCommerceEventsBookingSlot ) && (
											<span className="block">{ ticket.WooCommerceEventsBookingSlot }</span>
										) }
									</CardDescription>
								</div>
								<Badge
									className={ `shrink-0 ${ statusBadgeClass( String( ticket.WooCommerceEventsStatus ?? '' ) ) }` }
								>
									{ String( ticket.WooCommerceEventsStatus ?? '—' ) }
								</Badge>
							</div>

							<div className="pt-2">
								<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
									Ticket ID
								</p>
								<p className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
									{ displayIdLarge }
								</p>
								{ numericIdDisp &&
									String( displayIdLarge ).trim()
										!== numericIdDisp.trim() && (
									<p className="font-mono text-muted-foreground text-sm tabular-nums">
										#{ numericIdDisp }
									</p>
								) }
							</div>
						</CardHeader>

						<CardContent className="space-y-5">
							<div className="grid gap-2 sm:grid-cols-2">
								<div>
									<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
										Attendee
									</p>
									<p className="text-sm font-medium">
										{ `${ ticket.WooCommerceEventsAttendeeName ?? '' } ${ ticket.WooCommerceEventsAttendeeLastName ?? '' }`.trim()
											|| '\u2014' }
									</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
										Contact
									</p>
									<p className="text-sm">{ ticket.WooCommerceEventsAttendeeEmail || '\u2014' }</p>
									<p className="font-mono text-sm tabular-nums">
										{ ticket.WooCommerceEventsAttendeeTelephone || '\u2014' }
									</p>
								</div>
							</div>

							<Separator />

							<div>
								<p className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">
									Set status
								</p>
								<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
									<Button
										type="button"
										className={ cn(
											'w-full sm:min-h-11 sm:min-w-[11rem]',
											ticket.WooCommerceEventsStatus === 'Not Checked In' &&
												'shadow-md ring-2 ring-blue-600/35 dark:ring-blue-400/30',
										) }
										size="lg"
										disabled={ statusMutation.isPending || ticket.WooCommerceEventsStatus === 'Checked In' }
										onClick={ () => applyStatus( 'Checked In' ) }
									>
										Check in now
									</Button>
									<Button
										type="button"
										variant="secondary"
										disabled={
											statusMutation.isPending
											|| ticket.WooCommerceEventsStatus === 'Not Checked In'
										}
										onClick={ () => applyStatus( 'Not Checked In' ) }
									>
										Undo check-in
									</Button>
									<Button
										type="button"
										variant="destructive"
										disabled={ statusMutation.isPending || ticket.WooCommerceEventsStatus === 'Canceled' }
										onClick={ () => applyStatus( 'Canceled' ) }
									>
										Cancel ticket
									</Button>
									{ statusMutation.isPending && (
										<Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
									) }
								</div>
							</div>

							<Separator />

							<div>
								<p className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">
									Reschedule
								</p>
								<p className="text-muted-foreground mb-3 text-sm">
									Change date or time on the same event (booking tickets only). Your order and payment stay the
									same.
								</p>
								{ ticket.WooCommerceEventsStatus === 'Canceled' ? (
									<p className="text-muted-foreground text-sm">
										Canceled tickets cannot be rescheduled.
									</p>
								)
									: ticketHasBookingSlotIds( ticket )
										&& Number( ticket.WooCommerceEventsProductID ) > 0 ? (
											<>
												<Button
													type="button"
													variant="outline"
													className="gap-2"
													onClick={ () => setRescheduleOpen( true ) }
												>
													<CalendarClock className="size-4" aria-hidden />
													Reschedule booking
												</Button>
												<TicketRescheduleDialog
													open={ rescheduleOpen }
													onOpenChange={ setRescheduleOpen }
													ticket={ ticket }
													ticketLookup={ getLookupFromTicket( ticket ) }
													eventProductId={ Number( ticket.WooCommerceEventsProductID ) }
												/>
											</>
										) : (
											<p className="text-muted-foreground text-sm">
												This ticket has no booking slot to reschedule.
											</p>
										) }
							</div>

							<SiblingTicketsBlock
								currentNumericId={ String( ticket.WooCommerceEventsTicketID ?? '' ) }
								rawIds={ ticket.WooCommerceEventsOrderTickets }
								labels={ ticket.WooCommerceEventsOrderTicketsData }
								onPick={ openTicketFromSearchOrSibling }
							/>
						</CardContent>
					</Card>
				) }
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-foreground text-2xl font-semibold tracking-tight">
					Validate tickets
				</h1>
				<p className="text-muted-foreground mt-1 max-w-prose text-sm leading-relaxed">
					Validate only (lookup) or check in on scan — or search by email, phone number, or ticket ID.
				</p>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				<Card className="h-fit">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<UserSearch className="size-5" aria-hidden />
							Search
						</CardTitle>
						<CardDescription>At least 3 characters.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label htmlFor={ `${ formId }-search` }>Email, phone, or ticket #</Label>
							<Input
								id={ `${ formId }-search` }
								type="search"
								autoCapitalize="off"
								autoCorrect="off"
								autoComplete="off"
								placeholder='e.g. name@domain.com — or numeric ticket id'
								value={ searchInput }
								onChange={ ( e ) => setSearchInput( e.target.value ) }
								className="mt-2"
							/>
						</div>
						<div className="rounded-md border border-dashed p-3">
							<p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
								Matching tickets
								{ searchQuery.isFetching && deferredSearch.length >= 3 && (
									<Loader2
										className="ml-2 inline-block size-3.5 animate-spin align-middle"
										aria-hidden
									/>
								) }
							</p>
							{ deferredSearch.length < 3 ? (
								<p className="text-muted-foreground py-6 text-center text-sm">Type 3 or more characters…</p>
							) : searchQuery.isError ? (
								<p className="text-destructive py-6 text-center text-sm">
									{ searchQuery.error instanceof Error
										? searchQuery.error.message
										: 'Search failed' }
								</p>
							) : Array.isArray( searchQuery.data?.results ) && searchQuery.data.results.length === 0 ? (
								<p className="text-muted-foreground py-6 text-center text-sm">No matches.</p>
							) : (
								<ul className="divide-y rounded-md border">
									{ ( searchQuery.data?.results ?? [] ).map(
										(
											row: {
												ticketId?: string;
												ticketNumericId?: string;
												attendeeName?: string;
												eventName?: string;
												WooCommerceEventsStatus?: string;
											},
										) => {
											const rs = String( row.WooCommerceEventsStatus ?? '' );
											return (
												<li
													key={ `${ row.ticketId ?? row.ticketNumericId }` }
													className={ cn( 'border-l-4', searchRowAccentClass( rs ) ) }
												>
													<button
														type="button"
														onClick={ () =>
															openTicketFromSearchOrSibling(
																String(
																	row.ticketId ??
																		row.ticketNumericId ??
																		'',
																),
															) }
														className={ cn(
															'flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm transition-colors',
															'relative',
														) }
													>
														<span className="flex flex-wrap items-center justify-between gap-2 font-medium">
															<span>{ row.attendeeName ?? row.ticketId }</span>
															<span className="flex flex-wrap items-center gap-2">
																{ rs === 'Not Checked In' && (
																	<span className="text-blue-700 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-wide">
																		Ready
																	</span>
																) }
																<Badge className={ statusBadgeClass( rs ) }>
																	{ rs || '\u2014' }
																</Badge>
															</span>
														</span>
														<span className="text-muted-foreground truncate text-xs">
															{ row.eventName ?? '\u2014' }
															<span className="font-mono text-[11px] text-muted-foreground/90">
																&nbsp; · { String(
																	row.ticketId ??
																		row.ticketNumericId ??
																		'',
																) }
															</span>
														</span>
													</button>
												</li>
											);
										},
									) }
								</ul>
							) }
								</div>
							</CardContent>
				</Card>

				<Card className="h-fit">
					<CardHeader>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<CardTitle className="flex items-center gap-2 text-lg">
								<ScanBarcode className="size-5" aria-hidden />
								Camera
							</CardTitle>
							{ scannerOpen && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="gap-1"
									onClick={ () => setScannerOpen( false ) }
								>
									<X className="size-4" aria-hidden />
									Close
								</Button>
							) }
						</div>
						<CardDescription>
							Two modes: lookup only without changing status, or scan to check in automatically when the ticket is unused.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{ scannerOpen ? (
							<>
								<div className="bg-muted overflow-hidden rounded-lg">
									<div id={ scanRegionId } />
								</div>
								<p
									className="text-muted-foreground text-xs leading-relaxed"
									role="status"
									aria-live="polite"
								>
									{ scannerKind === 'checkin'
										? 'Grant camera access if prompted; valid unused tickets check in automatically after the read.'
										: 'Grant camera access if prompted; ticket details load after a successful read.' }
								</p>
							</>
						) : (
							<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
								<Button
									type="button"
									className="gap-2"
									onClick={ () => {
										setScannerKind( 'validate' );
										setScannerOpen( true );
									} }
								>
									<Camera className="size-4 shrink-0" aria-hidden />
									Validate ticket (scan)
								</Button>
								<Button
									type="button"
									className="gap-2 bg-amber-600 text-white hover:bg-amber-600/90 dark:bg-amber-700 dark:hover:bg-amber-700/90"
									onClick={ () => {
										setScannerKind( 'checkin' );
										setScannerOpen( true );
									} }
								>
									<ScanBarcode className="size-4 shrink-0" aria-hidden />
									Check-in ticket (scan)
								</Button>
							</div>
						) }
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function SiblingTicketsBlock( props: {
	currentNumericId: string;
	rawIds: unknown;
	labels: unknown;
	onPick: ( id: string ) => void;
} ) {
	const rawIds = Array.isArray( props.rawIds )
		? props.rawIds.filter( isNonEmptyStr )
		: [];
	const labelArr =
		Array.isArray( props.labels )
			? props.labels.filter( isNonEmptyStr )
			: [];
	const siblings = rawIds.filter(
		( tid ) => tid.trim() !== props.currentNumericId.trim()
	);

	if ( siblings.length === 0 ) {
		return null;
	}

	return (
		<>
			<Separator />
			<div className="space-y-3">
				<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
					Related tickets (same order / slot group)
				</p>
				<ul className="divide-y rounded-md border">
					{ siblings.map( ( tid ) => {
						const idx = rawIds.findIndex( ( id ) => id.trim() === tid.trim() );
						const friendly =
							idx >= 0 && labelArr[ idx ]
								? labelArr[ idx ]
								: tid;
						const display =
							isNonEmptyStr( friendly ) && friendly.includes( ' - ' )
								? friendly.split( ' - ', 2 ).slice( 1 ).join( ' — ' ).trim()
								|| friendly
								: friendly;

						return (
							<li key={ tid }>
								<button
									type="button"
									onClick={ () => props.onPick( tid ) }
									className="hover:bg-accent/75 flex w-full gap-3 px-3 py-2.5 text-left text-sm transition-colors"
								>
									<Badge variant="outline" className="shrink-0 font-mono text-[11px]">
										#{ tid }
									</Badge>
									<span>{ display }</span>
								</button>
							</li>
						);
					} ) }
				</ul>
			</div>
		</>
	);
}
