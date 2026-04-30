import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useCheckoutPreview, useCreateBooking, usePaymentMethods } from '../api/queries.js';
import Cart from '@/components/Cart';
import { useCart } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { htmlToPlainText } from '@/lib/htmlPlain';

type PreviewTaxRow = {
	id?: string;
	label?: string;
	amountFormatted?: string;
};

type CheckoutPreviewResponse = {
	subtotalFormatted?: string;
	subtotalTaxFormatted?: string;
	taxTotalFormatted?: string;
	totalFormatted?: string;
	taxes?: PreviewTaxRow[];
	lines?: Array<{
		name?: string;
		lineTotalFormatted?: string;
		qty?: number;
	}>;
};

export default function Checkout() {
	const navigate = useNavigate();
	const formId = useId();
	const { items, clearCart } = useCart();

	const previewLines = useMemo(
		() =>
			items.map( ( i ) => ( {
				eventId: i.eventId,
				slotId: i.slotId,
				dateId: i.dateId,
				qty: i.qty,
			} ) ),
		[ items ],
	);

	const {
		data: previewRaw,
		isLoading: previewLoading,
		isFetching: previewFetching,
		error: previewError,
	} = useCheckoutPreview( items.length ? previewLines : null );

	const preview = previewRaw;

	const mutation = useCreateBooking();
	const { data: paymentMethods, isLoading: paymentMethodsLoading } = usePaymentMethods();
	const [ first, setFirst ] = useState( '' );
	const [ last, setLast ] = useState( '' );
	const [ email, setEmail ] = useState( '' );
	const [ postalCode, setPostalCode ] = useState( '' );
	const [ paymentMethodKey, setPaymentMethodKey ] = useState( '' );
	const [ checkInNow, setCheckInNow ] = useState( false );

	const effectivePaymentKey = useMemo( () => {
		if ( ! paymentMethods?.length ) {
			return '';
		}
		if ( paymentMethodKey && paymentMethods.some( ( m ) => m.key === paymentMethodKey ) ) {
			return paymentMethodKey;
		}
		return ( paymentMethods.find( ( m ) => m.key === 'fooeventspos_card' ) ?? paymentMethods[ 0 ] ).key;
	}, [ paymentMethods, paymentMethodKey ] );

	const disabledSubmit =
		items.length === 0
		|| mutation.isPending
		|| paymentMethodsLoading
		|| ! effectivePaymentKey
		|| ! first.trim()
		|| ! last.trim()
		|| ! email.trim()
		|| ! postalCode.trim();

	const onSubmit = async ( e: FormEvent ) => {
		e.preventDefault();
		if ( disabledSubmit ) {
			return;
		}
		try {
			const res = ( await mutation.mutateAsync( {
				lines: previewLines,
				paymentMethodKey: effectivePaymentKey,
				checkInNow,
				attendee: {
					firstName: first.trim(),
					lastName: last.trim(),
					email: email.trim(),
				},
				billing: {
					postalCode: postalCode.trim(),
				},
			} ) ) as {
				orderId: number;
				qty?: number;
				totalQty?: number;
				totalFormatted?: string;
				paymentMethodLabel?: string;
				checkedInCount?: number;
				checkedInTicketIds?: number[];
			};
			const q = res.totalQty ?? res.qty ?? 0;
			const ticketPart = q > 1 ? `${ q } tickets` : '1 ticket';
			const methodPart = res.paymentMethodLabel ? ` · ${ res.paymentMethodLabel }` : '';
			const totalPart = res.totalFormatted
				? ` · Total ${ htmlToPlainText( res.totalFormatted ) }`
				: '';
			const checkInPart =
				( res.checkedInCount ?? 0 ) > 0
					? ` · Checked in (${ res.checkedInCount } ticket${ res.checkedInCount === 1 ? '' : 's' })`
					: '';
			toast.success( `Booked order #${ res.orderId } · ${ ticketPart }${ methodPart }${ totalPart }${ checkInPart }` );
			clearCart();
			setFirst( '' );
			setLast( '' );
			setEmail( '' );
			setPostalCode( '' );
			setCheckInNow( false );
			navigate( '/' );
		} catch ( err: unknown ) {
			const m = err instanceof Error ? err.message : String( err );
			toast.error( m || 'Booking failed' );
		}
	};

	const previewBusy = previewLoading || previewFetching;

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
					<p className="text-muted-foreground text-sm">
						Totals below match WooCommerce — use <strong className="text-foreground">Total to charge</strong> on your Interac terminal (not linked to this app).
					</p>
				</div>
				<Button variant="outline" asChild>
					<Link to="/calendar">← Calendar</Link>
				</Button>
			</div>

			{ items.length === 0 ? (
				<Card>
					<CardContent className="text-muted-foreground py-8 text-center text-sm">
						Your order is empty.{ ' ' }
						<Link to="/calendar" className="text-primary font-medium underline-offset-4 hover:underline">
							Add slots from the calendar
						</Link>
						.
					</CardContent>
				</Card>
			) : (
				<form id={ formId } onSubmit={ onSubmit } className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,400px)] lg:items-start">
					<div className="space-y-6">
						<Cart variant="full" />
						<Card>
							<CardHeader>
								<CardTitle className="text-lg">Attendee</CardTitle>
								<CardDescription>Applied to every ticket in this order.</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-3 sm:grid-cols-2">
								<div className="grid gap-2">
									<Label htmlFor={ `${ formId }-first` }>First name</Label>
									<Input
										id={ `${ formId }-first` }
										value={ first }
										onChange={ ( e ) => setFirst( e.target.value ) }
										required
										maxLength={ 100 }
										autoComplete="given-name"
										disabled={ mutation.isPending }
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor={ `${ formId }-last` }>Last name</Label>
									<Input
										id={ `${ formId }-last` }
										value={ last }
										onChange={ ( e ) => setLast( e.target.value ) }
										required
										maxLength={ 100 }
										autoComplete="family-name"
										disabled={ mutation.isPending }
									/>
								</div>
								<div className="grid gap-2 sm:col-span-2">
									<Label htmlFor={ `${ formId }-email` }>Email</Label>
									<Input
										id={ `${ formId }-email` }
										type="email"
										value={ email }
										onChange={ ( e ) => setEmail( e.target.value ) }
										required
										autoComplete="email"
										disabled={ mutation.isPending }
									/>
								</div>
								<div className="grid gap-2 sm:col-span-2">
									<Label htmlFor={ `${ formId }-postal` }>Postal code</Label>
									<Input
										id={ `${ formId }-postal` }
										type="text"
										value={ postalCode }
										onChange={ ( e ) => setPostalCode( e.target.value ) }
										required
										maxLength={ 50 }
										autoComplete="postal-code"
										inputMode="text"
										placeholder="Customer postal / ZIP code"
										disabled={ mutation.isPending }
									/>
									<p className="text-muted-foreground text-xs leading-relaxed">
										Required for regional reporting. Enter exactly as the customer states it.
									</p>
								</div>
								<div className="grid gap-2 sm:col-span-2">
									<Label htmlFor={ `${ formId }-pm` }>Payment method</Label>
									<Select
										value={ effectivePaymentKey }
										onValueChange={ setPaymentMethodKey }
										disabled={ mutation.isPending || paymentMethodsLoading || ! paymentMethods?.length }
									>
										<SelectTrigger id={ `${ formId }-pm` }>
											<SelectValue placeholder={ paymentMethodsLoading ? 'Loading…' : 'Select method' } />
										</SelectTrigger>
										<SelectContent>
											{ paymentMethods?.map( ( m ) => (
												<SelectItem key={ m.key } value={ m.key }>
													{ m.label }
												</SelectItem>
											) ) }
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-2 sm:col-span-2">
									<label className="flex cursor-pointer items-start gap-3">
										<Checkbox
											id={ `${ formId }-checkin` }
											checked={ checkInNow }
											onCheckedChange={ ( v ) => setCheckInNow( v === true ) }
											disabled={ mutation.isPending }
											className="mt-0.5"
										/>
										<span className="leading-snug">
											<span className="font-medium">Check-in right now</span>
											<span className="text-muted-foreground block text-xs">
												New tickets are emailed to the customer already marked checked in—they cannot validate again later.
											</span>
										</span>
									</label>
								</div>
							</CardContent>
						</Card>
						<div className="flex flex-wrap gap-2">
							<Button type="submit" size="lg" disabled={ disabledSubmit }>
								{ mutation.isPending ? 'Processing…' : 'Complete order' }
							</Button>
							<Button type="button" variant="outline" disabled={ mutation.isPending } asChild>
								<Link to="/calendar">Keep shopping</Link>
							</Button>
						</div>
					</div>

					<div className="space-y-4 lg:sticky lg:top-4">
						{ previewError && (
							<p className="text-destructive text-sm">{ String( previewError.message || previewError ) }</p>
						) }

						<Card className="border-primary/40 shadow-md">
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Totals (WooCommerce)</CardTitle>
								<CardDescription>Includes taxes per store settings.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{ previewBusy && (
									<div className="text-muted-foreground flex items-center gap-2 text-sm">
										<Loader2 className="size-4 animate-spin" />
										Calculating totals…
									</div>
								) }

								{ ! previewBusy && preview?.lines && preview.lines.length > 0 && (
									<>
									<p className="text-muted-foreground mb-2 text-xs">Line amounts before tax.</p>
									<ul className="space-y-2 text-sm">
										{ preview.lines.map( ( ln, i ) => (
											<li key={ i } className="flex justify-between gap-4">
												<span className="min-w-0 flex-1">
													<span className="font-medium">{ htmlToPlainText( ln.name ) }</span>
													{ ln.qty ? (
														<span className="text-muted-foreground"> × { ln.qty }</span>
													) : null }
												</span>
												<span className="shrink-0 tabular-nums">
													{ htmlToPlainText( ln.lineTotalFormatted ) }
												</span>
											</li>
										) ) }
									</ul>
									</>
								) }

								<Separator />

								<div className="space-y-1 text-sm">
									<div className="flex justify-between gap-4">
										<span className="text-muted-foreground">Subtotal</span>
										<span className="tabular-nums">
											{ preview?.subtotalFormatted ? htmlToPlainText( preview.subtotalFormatted ) : '—' }
										</span>
									</div>
									{ preview?.taxes?.map( ( t ) => (
										<div key={ t.id ?? t.label } className="flex justify-between gap-4">
											<span className="text-muted-foreground">{ htmlToPlainText( t.label ) || 'Tax' }</span>
											<span className="tabular-nums">{ htmlToPlainText( t.amountFormatted ) }</span>
										</div>
									) ) }
									<div className="flex justify-between gap-4">
										<span className="text-muted-foreground">Tax total</span>
										<span className="tabular-nums">
											{ preview?.taxTotalFormatted ? htmlToPlainText( preview.taxTotalFormatted ) : '—' }
										</span>
									</div>
								</div>

								<div className="bg-primary/10 rounded-lg border border-primary/30 px-4 py-4">
									<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
										Total to charge on Interac
									</p>
									<p className="text-foreground mt-1 text-3xl font-bold tabular-nums">
										{ preview?.totalFormatted ? htmlToPlainText( preview.totalFormatted ) : '—' }
									</p>
								</div>
							</CardContent>
						</Card>
					</div>
				</form>
			) }
		</div>
	);
}
