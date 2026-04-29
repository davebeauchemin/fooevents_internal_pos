import { useDeferredValue, useEffect, useId, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import {
	ArrowLeft,
	Camera,
	Loader2,
	ScanBarcode,
	UserSearch,
	X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTicketDetail, useTicketSearch, useUpdateTicketStatus } from '@/api/queries.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const SCAN_REGION_ID = 'fooevents-validate-scan-region';

/** @param {unknown} s */
function isNonEmptyStr( s: unknown ): s is string {
	return typeof s === 'string' && s.trim().length > 0;
}

/** @param {string} status */
function statusBadgeClass( status: string ) {
	switch ( status ) {
		case 'Checked In':
			return 'border-green-700/40 bg-green-600/15 text-green-900 dark:border-green-600/45 dark:bg-green-950/40 dark:text-green-300';
		case 'Not Checked In':
			return 'border-amber-700/35 bg-amber-500/15 text-amber-950 dark:border-amber-600/35 dark:bg-amber-950/35 dark:text-amber-100';
		case 'Canceled':
			return 'border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-red-300';
		default:
			return 'border-muted-foreground/35 bg-muted/40 text-muted-foreground';
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
	eventDisplayName?: string;
};

export default function Validate() {
	const formId = useId();
	const [ searchInput, setSearchInput ] = useState( '' );
	const deferredSearch = useDeferredValue( searchInput.trim() );
	const [ selectedTicketId, setSelectedTicketId ] = useState< string | null >( null );
	const [ scannerOpen, setScannerOpen ] = useState( false );

	const searchQuery = useTicketSearch( deferredSearch );
	const detailQuery = useTicketDetail( selectedTicketId );
	const statusMutation = useUpdateTicketStatus();

	const ticket = detailQuery.data?.ticket as FooTicketPayload | undefined;

	useEffect( () => {
		if ( ! scannerOpen ) {
			return;
		}
		const scanner = new Html5QrcodeScanner(
			SCAN_REGION_ID,
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
				toast.success( 'Code captured' );
				setSelectedTicketId( t );
				setScannerOpen( false );
			},
			() => {}
		);
		return () => {
			ended = true;
			void scanner.clear().catch( () => {} );
		};
	}, [ scannerOpen ] );

	const openTicket = ( id: string ) => {
		setSelectedTicketId( id.trim() );
		setScannerOpen( false );
	};

	const applyStatus = ( status: string ) => {
		if ( ! ticket?.WooCommerceEventsTicketID ) {
			return;
		}
		const formatted = ticket.WooCommerceEventsTicketNumberFormatted;
		let lookup =
			isNonEmptyStr( formatted ) && formatted.trim().length > 0
				? formatted.trim()
				: '';
		if ( ! lookup && selectedTicketId && selectedTicketId.length > 0 ) {
			lookup = selectedTicketId.trim();
		}
		if ( ! lookup ) {
			lookup = String( ticket.WooCommerceEventsTicketID ?? '' );
		}
		statusMutation.mutate(
			{ ticketId: lookup, status },
			{
				onSuccess: () => {
					toast.success( `${ status } — ${ ticket.WooCommerceEventsTicketID ?? '' }` );
				},
				onError: ( err: Error ) => {
					toast.error( err?.message ?? 'Update failed' );
				},
			}
		);
	};

	if ( selectedTicketId ) {
		return (
			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={ () => {
							setSelectedTicketId( null );
						} }
						className="gap-1"
					>
						<ArrowLeft className="size-4" aria-hidden />
						Back to search
					</Button>
				</div>

				{ detailQuery.isLoading && (
					<Card>
						<CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
							<Loader2 className="size-8 animate-spin" aria-hidden />
							<span>Loading ticket...</span>
						</CardContent>
					</Card>
				) }

				{ detailQuery.isError && (
					<Card className="border-destructive/50">
						<CardHeader>
							<CardTitle>{ selectedTicketId }</CardTitle>
							<CardDescription className="text-destructive">
								{ detailQuery.error instanceof Error
									? detailQuery.error.message
									: 'Ticket could not be loaded.' }
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button variant="outline" onClick={ () => void detailQuery.refetch() }>
								Retry
							</Button>
						</CardContent>
					</Card>
				) }

				{ ticket && (
					<Card>
						<CardHeader>
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
						</CardHeader>
						<CardContent className="space-y-5">
							<div>
								<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
									Ticket #
								</p>
								<p className="font-mono text-sm">
									{ String(
										( ticket.WooCommerceEventsTicketNumberFormatted && `${ ticket.WooCommerceEventsTicketNumberFormatted }`.trim() !== ''
											? ticket.WooCommerceEventsTicketNumberFormatted
											: ticket.WooCommerceEventsTicketID ) ?? ''
									) }
								</p>
								<p className="font-mono text-xs text-muted-foreground tabular-nums">
									{ String( ticket.WooCommerceEventsTicketID ?? '' ) }
								</p>
							</div>

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
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										disabled={ statusMutation.isPending || ticket.WooCommerceEventsStatus === 'Checked In' }
										onClick={ () => applyStatus( 'Checked In' ) }
									>
										Check In
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
										Undo Check-In
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
										<Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
									) }
								</div>
							</div>

							<SiblingTicketsBlock
								currentNumericId={ String( ticket.WooCommerceEventsTicketID ?? '' ) }
								rawIds={ ticket.WooCommerceEventsOrderTickets }
								labels={ ticket.WooCommerceEventsOrderTicketsData }
								onPick={ openTicket }
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
					Scan a QR or barcode, or search by attendee email, phone number, or ticket ID.
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
											}
										) => (
											<li key={ `${ row.ticketId ?? row.ticketNumericId }` }>
												<button
													type="button"
													onClick={ () => openTicket( String( row.ticketId ) ) }
													className="hover:bg-accent/75 flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm transition-colors"
												>
													<span className="flex flex-wrap items-center justify-between gap-2 font-medium">
														{ row.attendeeName ?? row.ticketId }
														<Badge className={ statusBadgeClass( String( row.WooCommerceEventsStatus ?? '' ) ) }>
															{ String( row.WooCommerceEventsStatus ?? '—' ) }
														</Badge>
													</span>
													<span className="text-muted-foreground truncate text-xs">
														{ row.eventName ?? '\u2014' }
														<span className="font-mono text-[11px] text-muted-foreground/90">
															&nbsp; · { String( row.ticketId ?? row.ticketNumericId ?? '' ) }
														</span>
													</span>
												</button>
											</li>
										)
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
								<Button type="button" variant="outline" size="sm" className="gap-1" onClick={ () => setScannerOpen( false ) }>
									<X className="size-4" aria-hidden />
									Close
								</Button>
							) }
						</div>
						<CardDescription>Use the device camera to read QR codes and barcodes printed on FooEvents tickets.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{ scannerOpen ? (
							<>
								<div className="bg-muted overflow-hidden rounded-lg">
									<div id={ SCAN_REGION_ID } />
								</div>
								<p className="text-muted-foreground text-xs leading-relaxed" role="status" aria-live="polite">
									Grant camera access if prompted; the ticket opens automatically after a successful read.
								</p>
							</>
						) : (
							<Button type="button" className="w-full gap-2 sm:w-auto" onClick={ () => setScannerOpen( true ) }>
								<Camera className="size-4 shrink-0" aria-hidden />
								Start scanner
							</Button>
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


