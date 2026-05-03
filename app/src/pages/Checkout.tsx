import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useCheckoutPreview, useCreateBooking, usePaymentMethods } from '../api/queries.js';
import {
	CartLineRow,
	CartSubtotalRow,
	cartSubtotalDisplay,
} from '@/components/Cart';
import { cartLineKey, useCart } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { htmlToPlainText } from '@/lib/htmlPlain';

const MAX_POS_COUPONS = 20;

function parseCouponCodesInput( raw: string ): string[] {
	const parts = raw.split( /[\s,;]+/ );
	const out: string[] = [];
	for ( const p of parts ) {
		const t = p.trim();
		if ( ! t ) {
			continue;
		}
		out.push( t );
		if ( out.length >= MAX_POS_COUPONS ) {
			break;
		}
	}
	return out;
}

type PreviewTaxRow = {
	id?: string;
	label?: string;
	amountFormatted?: string;
};

type PreviewCouponApplied = {
	code?: string;
	discountExTaxFormatted?: string;
	discountTaxFormatted?: string;
};

type PreviewCouponError = {
	code?: string;
	message?: string;
	manualEntry?: boolean;
};

type PreviewBundleDiscount = {
	code?: string;
	name?: string;
	qtyCovered?: number;
	amount?: string;
	amountFormatted?: string;
};

type CheckoutPreviewResponse = {
	subtotalFormatted?: string;
	subtotalTaxFormatted?: string;
	taxTotalFormatted?: string;
	totalFormatted?: string;
	discountTotal?: string;
	discountTotalFormatted?: string;
	discountIncludingTaxFormatted?: string;
	appliedCoupons?: PreviewCouponApplied[];
	couponErrors?: PreviewCouponError[];
	bundleDiscounts?: PreviewBundleDiscount[];
	feesTotal?: string;
	feesTotalFormatted?: string;
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
	const { items, clearCart, updateQty, removeLine } = useCart();

	const cartSubDisplay = useMemo( () => cartSubtotalDisplay( items ), [ items ] );

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

	const [ couponInput, setCouponInput ] = useState( '' );
	const couponCodesForApi = useMemo(
		() => parseCouponCodesInput( couponInput ),
		[ couponInput ],
	);
	const [ email, setEmail ] = useState( '' );

	const {
		data: previewRaw,
		isLoading: previewLoading,
		isFetching: previewFetching,
		error: previewError,
	} = useCheckoutPreview( items.length ? previewLines : null, couponCodesForApi, email.trim() );

	const preview = previewRaw as CheckoutPreviewResponse | undefined;

	const couponBlocking = Boolean(
		! previewFetching &&
			preview?.couponErrors?.some( ( row ) => row?.manualEntry && row?.message ),
	);

	const mutation = useCreateBooking();
	const { data: paymentMethods, isLoading: paymentMethodsLoading } = usePaymentMethods();
	const [ first, setFirst ] = useState( '' );
	const [ last, setLast ] = useState( '' );
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
		|| ! postalCode.trim()
		|| couponBlocking;

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
				couponCodes: couponCodesForApi,
			} ) ) as {
				orderId: number;
				qty?: number;
				totalQty?: number;
				totalFormatted?: string;
				paymentMethodLabel?: string;
				checkedInCount?: number;
				checkedInTicketIds?: number[];
				nextPurchaseCoupon?: { code?: string; amountFormatted?: string } | null;
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
			const npc = res.nextPurchaseCoupon;
			if ( npc && typeof npc.code === 'string' && npc.code.length > 0 ) {
				const amt = npc.amountFormatted ? htmlToPlainText( npc.amountFormatted ) : '';
				const amtPart = amt ? ` for ${ amt } off` : '';
				toast.success( `Next-purchase coupon: ${ npc.code }${ amtPart }`, { duration: 12_000 } );
			}
			clearCart();
			setFirst( '' );
			setLast( '' );
			setEmail( '' );
			setPostalCode( '' );
			setCouponInput( '' );
			setCheckInNow( false );
			navigate( '/' );
		} catch ( err: unknown ) {
			const m = err instanceof Error ? err.message : String( err );
			toast.error( m || 'Booking failed' );
		}
	};

	const previewBusy = previewLoading || previewFetching;

	return (
		<div className="mx-auto w-full max-w-xl space-y-6 pb-12">
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
				<form id={ formId } onSubmit={ onSubmit } className="flex flex-col gap-6">
					<div className="space-y-4">
						{ previewError && (
							<p className="text-destructive text-sm">{ String( previewError.message || previewError ) }</p>
						) }

						<Card className="border-primary/40 shadow-md">
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Totals (WooCommerce)</CardTitle>
								<CardDescription>
									Lines you are booking, then store taxes and total to charge.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-3">
									<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
										Order lines
									</p>
									<ul className="max-h-[min(50vh,24rem)] space-y-3 overflow-y-auto pr-1">
										{ items.map( ( line ) => (
											<li key={ cartLineKey( line ) }>
												<CartLineRow
													line={ line }
													onQty={ ( q ) => updateQty( cartLineKey( line ), q ) }
													onRemove={ () => removeLine( cartLineKey( line ) ) }
												/>
											</li>
										) ) }
									</ul>
									<CartSubtotalRow display={ cartSubDisplay } />
									<div className="flex justify-end">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={ clearCart }
											disabled={ mutation.isPending }
										>
											Clear order
										</Button>
									</div>
								</div>

								<Separator />

								<div className="space-y-4">
									<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
										Checkout totals
									</p>
								<div className="grid gap-2">
									<Label htmlFor={ `${ formId }-coupons` }>Coupon codes (optional)</Label>
									<Input
										id={ `${ formId }-coupons` }
										type="text"
										value={ couponInput }
										onChange={ ( e ) => setCouponInput( e.target.value ) }
										placeholder="e.g. SAVE10 or code1, code2"
										autoComplete="off"
										disabled={ mutation.isPending }
										maxLength={ 400 }
									/>
									<p className="text-muted-foreground text-xs leading-relaxed">
										WooCommerce validates codes like the storefront checkout. Auto-apply and bundle tiers are configured on each coupon in WooCommerce (&quot;FooEvents POS / storefront&quot;). Enter optional extra codes above (comma-separated, max { MAX_POS_COUPONS } ).
									</p>
								</div>

								{ ! previewFetching &&
									preview?.couponErrors &&
									preview.couponErrors.length > 0 && (
									<ul className="space-y-1 text-sm">
										{ preview.couponErrors.map( ( err, idx ) => (
											<li
												key={ `${ err.code ?? 'c' }-${ idx }` }
												className={ err.manualEntry ? 'text-destructive' : 'text-muted-foreground' }
											>
												{ err.code ? <span className="font-mono">{ err.code }</span> : null }
												{ err.code && err.message ? ': ' : null }
												{ err.message ?? '' }
											</li>
										) ) }
									</ul>
								) }

								{ ! previewFetching &&
									preview?.appliedCoupons &&
									preview.appliedCoupons.length > 0 && (
										<ul className="text-muted-foreground space-y-1 text-xs">
											{ preview.appliedCoupons.map( ( c ) => (
												<li key={ c.code } className="flex justify-between gap-2 tabular-nums">
													<span>
														Coupon <span className="font-mono">{ htmlToPlainText( c.code ?? '' ) }</span>
													</span>
													<span>
														−{ htmlToPlainText( c.discountExTaxFormatted ?? '' ) }
													</span>
												</li>
											) ) }
										</ul>
									) }

								{ previewFetching && preview && (
									<div className="text-muted-foreground flex items-center gap-2 border-b border-border pb-2 text-xs">
										<Loader2 className="size-3 animate-spin shrink-0" aria-hidden />
										Updating totals…
									</div>
								) }

								{ previewBusy && ! preview && (
									<div className="text-muted-foreground flex items-center gap-2 text-sm">
										<Loader2 className="size-4 animate-spin" aria-hidden />
										Calculating totals…
									</div>
								) }

								{ preview?.lines && preview.lines.length > 0 && (
									<>
									<p className="text-muted-foreground mb-2 text-xs">Line totals exclude tax (after WooCommerce discounts).</p>
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
									{ preview?.discountTotal &&
										Number.parseFloat( String( preview.discountTotal ) ) > 0 &&
										preview.discountTotalFormatted && (
										<div className="flex justify-between gap-4">
											<span className="text-muted-foreground">Discount (ex tax)</span>
											<span className="tabular-nums text-emerald-700 dark:text-emerald-400">
												−{ htmlToPlainText( preview.discountTotalFormatted ) }
											</span>
										</div>
									) }

									{ ! previewFetching &&
										preview?.bundleDiscounts &&
										preview.bundleDiscounts.length > 0 && (
										<div className="space-y-1">
											<p className="text-muted-foreground text-xs font-medium">Bundle discounts</p>
											<ul className="space-y-1 text-xs">
												{ preview.bundleDiscounts.map( ( row, ii ) => (
													<li
														key={ `${ row.code ?? 'b' }-${ ii }` }
														className="flex justify-between gap-4 tabular-nums text-emerald-700 dark:text-emerald-400"
													>
														<span className="min-w-0">
															{ htmlToPlainText( row.name || row.code || '' ) }
														</span>
														<span className="shrink-0">−{ htmlToPlainText( row.amountFormatted ?? '' ) }</span>
													</li>
												) ) }
											</ul>
											{ preview.feesTotalFormatted && (
												<div className="text-muted-foreground flex justify-between gap-4 pt-1 text-xs tabular-nums">
													<span>Bundle total</span>
													<span className="text-emerald-700 dark:text-emerald-400">{ htmlToPlainText( preview.feesTotalFormatted ) }</span>
												</div>
											) }
										</div>
									) }
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
								</div>
							</CardContent>
						</Card>
					</div>

					<div className="space-y-6">
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
								<div className="grid gap-2">
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
								<div className="grid gap-2">
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
								</div>
								<div className="grid gap-2 sm:col-span-2">
									<Label id={ `${ formId }-pm-label` }>Payment method</Label>
									{ paymentMethodsLoading && ! paymentMethods?.length ? (
										<p className="text-muted-foreground text-sm">Loading payment methods…</p>
									) : ! paymentMethods?.length ? (
										<p className="text-muted-foreground text-sm">No payment methods available.</p>
									) : (
										<ToggleGroup
											type="single"
											value={ effectivePaymentKey }
											onValueChange={ ( v ) => {
												if ( v ) {
													setPaymentMethodKey( v );
												}
											} }
											disabled={ mutation.isPending || paymentMethodsLoading }
											aria-labelledby={ `${ formId }-pm-label` }
											className="flex w-full min-w-0 flex-wrap gap-2"
										>
											{ paymentMethods.map( ( m ) => (
												<ToggleGroupItem
													key={ m.key }
													value={ m.key }
													className="h-9 min-h-9 min-w-0 flex-none shrink-0 rounded-full border border-transparent px-4 font-medium shadow-none data-[state=on]:border-primary data-[state=on]:shadow-xs data-[state=off]:border-input data-[state=off]:bg-muted/25 data-[state=off]:hover:bg-muted/45"
												>
													{ m.label }
												</ToggleGroupItem>
											) ) }
										</ToggleGroup>
									) }
								</div>
								<div className="grid gap-2 sm:col-span-2">
									<Label id={ `${ formId }-checkin-label` }>Check-in right now</Label>
									<p className="text-muted-foreground text-xs leading-snug">
										New tickets are emailed to the customer already marked checked in—they cannot validate again later.
									</p>
									<ToggleGroup
										type="single"
										value={ checkInNow ? 'yes' : 'no' }
										onValueChange={ ( v ) => {
											if ( v === 'yes' ) {
												setCheckInNow( true );
											} else {
												setCheckInNow( false );
											}
										} }
										disabled={ mutation.isPending }
										aria-labelledby={ `${ formId }-checkin-label` }
										className="grid w-full grid-cols-2 rounded-md border border-input bg-muted/40 p-0.5 shadow-xs"
									>
										<ToggleGroupItem value="no" className="rounded-sm">
											No
										</ToggleGroupItem>
										<ToggleGroupItem value="yes" className="rounded-sm">
											Yes
										</ToggleGroupItem>
									</ToggleGroup>
								</div>
							</CardContent>
						</Card>
						<Button
							type="submit"
							size="lg"
							className="h-12 w-full justify-center text-base font-semibold"
							disabled={ disabledSubmit }
						>
							{ mutation.isPending ? 'Processing…' : 'Complete order' }
						</Button>
					</div>
				</form>
			) }
		</div>
	);
}
