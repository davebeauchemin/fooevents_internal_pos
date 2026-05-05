import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useCheckoutPreview, useCreateBooking, usePaymentMethods, usePosVisibleCoupons } from '../api/queries.js';
import { CartLineRow } from '@/components/Cart';
import { cartLineKey, useCart } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { htmlToPlainText } from '@/lib/htmlPlain';
import { cn } from '@/lib/utils';

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

function normalizeCouponCodeKey( raw: string ): string {
	return raw.trim().toLowerCase();
}

function mergeManualAndQuickCouponCodes( manualParsed: string[], quickCodes: string[] ): string[] {
	const seen = new Set<string>();
	const out: string[] = [];

	for ( const c of manualParsed.concat( quickCodes ) ) {
		const k = normalizeCouponCodeKey( c );
		if ( ! k || seen.has( k ) ) {
			continue;
		}
		seen.add( k );
		out.push( c.trim() );
		if ( out.length >= MAX_POS_COUPONS ) {
			break;
		}
	}

	return out;
}

function appendQuickApplyCouponCode( couponInputRaw: string, prevQuick: string[], apiCode: string ): string[] {
	const trimmed = apiCode.trim();
	const key = normalizeCouponCodeKey( trimmed );
	if ( ! key ) {
		return prevQuick;
	}
	const manual = parseCouponCodesInput( couponInputRaw );
	const seen = new Set<string>();
	for ( const c of manual ) {
		const k = normalizeCouponCodeKey( c );
		if ( k ) {
			seen.add( k );
		}
	}
	for ( const c of prevQuick ) {
		const k = normalizeCouponCodeKey( c );
		if ( k ) {
			seen.add( k );
		}
	}
	if ( seen.has( key ) ) {
		return prevQuick;
	}
	if ( manual.length + prevQuick.length >= MAX_POS_COUPONS ) {
		return prevQuick;
	}

	return [ ...prevQuick, trimmed ];
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

type PosPromoCoupon = {
	code?: string;
	label?: string;
	description?: string;
	discountSummary?: string;
	id?: number;
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
	const [ clearOrderDialogOpen, setClearOrderDialogOpen ] = useState( false );

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
	const [ quickApplyCouponCodes, setQuickApplyCouponCodes ] = useState<string[]>( [] );
	const couponCodesForApi = useMemo(
		() =>
			mergeManualAndQuickCouponCodes(
				parseCouponCodesInput( couponInput ),
				quickApplyCouponCodes,
			),
		[ couponInput, quickApplyCouponCodes ],
	);
	const [ email, setEmail ] = useState( '' );

	const {
		data: previewRaw,
		isLoading: previewLoading,
		isFetching: previewFetching,
		error: previewError,
	} = useCheckoutPreview( items.length ? previewLines : null, couponCodesForApi, email.trim() );

	const preview = previewRaw as CheckoutPreviewResponse | undefined;

	const { data: posVisibleCouponsRaw } = usePosVisibleCoupons( items.length > 0 );

	const appliedCouponKeysNormalized = useMemo( () => {
		const set = new Set<string>();
		for ( const c of couponCodesForApi ) {
			const k = normalizeCouponCodeKey( String( c ) );
			if ( k ) {
				set.add( k );
			}
		}
		for ( const a of preview?.appliedCoupons ?? [] ) {
			const k = normalizeCouponCodeKey( htmlToPlainText( String( a.code ?? '' ) ) );
			if ( k ) {
				set.add( k );
			}
		}
		return set;
	}, [ couponCodesForApi, preview?.appliedCoupons ] );

	const posPromoCoupons: PosPromoCoupon[] = useMemo(
		() =>
			Array.isArray( posVisibleCouponsRaw?.coupons )
				? ( posVisibleCouponsRaw.coupons as PosPromoCoupon[] )
				: [],
		[ posVisibleCouponsRaw?.coupons ],
	);

	useEffect( () => {
		if ( items.length === 0 ) {
			setQuickApplyCouponCodes( [] );
		}
	}, [ items.length ] );

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
	const showPaymentSelector = Boolean( paymentMethods && paymentMethods.length > 1 );

	const disabledSubmit =
		items.length === 0
		|| mutation.isPending
		|| paymentMethodsLoading
		|| ! effectivePaymentKey
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
			setQuickApplyCouponCodes( [] );
			setCheckInNow( false );
			navigate( '/' );
		} catch ( err: unknown ) {
			const m = err instanceof Error ? err.message : String( err );
			toast.error( m || 'Booking failed' );
		}
	};

	const previewBusy = previewLoading || previewFetching;

	return (
		<div className="mx-auto w-full max-w-xl space-y-6">
			<div className="space-y-3">
				<Button variant="outline" size="sm" className="w-fit" asChild>
					<Link to="/calendar">← Calendar</Link>
				</Button>
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
					<p className="text-muted-foreground mt-2 text-sm leading-relaxed">
						{ items.length === 0 ? (
							<>
								Your cart is empty. Return to the calendar and add time slots to check out.
							</>
						) : (
							<>
								Review the booking, attendee, and tax summary, then finish with payment and
								check-in. Collect{' '}
								<strong className="text-foreground font-medium">the total at the bottom</strong>
								{' '}
								on your card terminal—the figure matches your online store.
							</>
						) }
					</p>
				</div>
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
				<>
					<form id={ formId } onSubmit={ onSubmit } className="flex flex-col gap-6">
						{ previewError && (
							<p className="text-destructive text-sm">{ String( previewError.message || previewError ) }</p>
						) }

						<Card className="border-primary/40 shadow-md">
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Checkout</CardTitle>
								<CardDescription>
									Line items, attendee, totals, then payment and check-in.
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
									<div className="flex justify-end">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={ () => setClearOrderDialogOpen( true ) }
											disabled={ mutation.isPending }
										>
											Clear order
										</Button>
									</div>
								</div>

								<Separator />

								<div className="space-y-3">
									<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
										Attendee
									</p>
									<p className="text-muted-foreground text-xs leading-snug">
										Applied to every ticket in this order.
									</p>
									<div className="grid gap-3 sm:grid-cols-2">
										<div className="grid gap-2">
											<Label htmlFor={ `${ formId }-first` }>
												First name <span className="text-muted-foreground font-normal">(optional)</span>
											</Label>
											<Input
												id={ `${ formId }-first` }
												value={ first }
												onChange={ ( e ) => setFirst( e.target.value ) }
												maxLength={ 100 }
												autoComplete="given-name"
												disabled={ mutation.isPending }
											/>
										</div>
										<div className="grid gap-2">
											<Label htmlFor={ `${ formId }-last` }>
												Last name <span className="text-muted-foreground font-normal">(optional)</span>
											</Label>
											<Input
												id={ `${ formId }-last` }
												value={ last }
												onChange={ ( e ) => setLast( e.target.value ) }
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
									</div>
								</div>

								<Separator />

								<div className="space-y-4">
									<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
										Checkout totals
									</p>
									{ posPromoCoupons.length > 0 ? (
										<div className="space-y-2">
											<p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
												POS promotions
											</p>
											<p className="text-muted-foreground text-xs leading-snug">
												Buttons show the discount only; codes stay off-screen and still apply at checkout.
											</p>
											<div className="flex flex-wrap gap-2">
												{ posPromoCoupons.map( ( row, promoIdx ) => {
													const apiCode = String( row.code ?? '' ).trim();
													const keyed = normalizeCouponCodeKey( apiCode );
													const inactive = ! keyed || appliedCouponKeysNormalized.has( keyed );

													const valueLabel =
														htmlToPlainText( String( row.label ?? '' ) ).trim()
														|| htmlToPlainText( String( row.discountSummary ?? '' ) ).trim()
														|| 'Promotion';

													return (
														<Button
															key={
																typeof row.id === 'number' && row.id > 0
																	? `promo-${ row.id }`
																	: `promo-${ keyed || promoIdx }`
															}
															type="button"
															variant={ inactive ? 'secondary' : 'outline' }
															size="sm"
															className={ cn(
																'h-auto min-h-9 shrink-0 px-4 py-2 text-sm font-semibold tabular-nums',
																inactive && 'opacity-80',
															) }
															disabled={ mutation.isPending || inactive }
															aria-label={ `Apply promo ${ valueLabel }` }
															title={ row.description ? row.description : undefined }
															onClick={ () =>
																setQuickApplyCouponCodes( ( prev ) =>
																	appendQuickApplyCouponCode( couponInput, prev, apiCode ),
																)
															}
														>
															{ valueLabel }
														</Button>
													);
												} ) }
											</div>
										</div>
									) : null }
									<Accordion type="single" collapsible className="w-full">
										<AccordionItem value="coupons" className="border-0">
											<AccordionTrigger className="py-3 hover:no-underline">
												<span className="flex flex-col items-start gap-1 pr-2 text-left">
													<span className="text-foreground text-sm font-medium">
														Coupon codes (optional)
													</span>
													<span className="text-muted-foreground text-xs font-normal">
														Quick promos appear above when enabled—open this to type extra codes.
													</span>
												</span>
											</AccordionTrigger>
											<AccordionContent>
												<div className="grid gap-2">
													<Label htmlFor={ `${ formId }-coupons` } className="sr-only">
														Coupon codes
													</Label>
													<Input
														id={ `${ formId }-coupons` }
														type="text"
														value={ couponInput }
														onChange={ ( e ) => setCouponInput( e.target.value ) }
														placeholder="e.g. SAVE10 or code1, code2"
														autoComplete="off"
														disabled={ mutation.isPending }
														maxLength={ 400 }
														aria-describedby={ `${ formId }-coupons-hint` }
													/>
													<p
														id={ `${ formId }-coupons-hint` }
														className="text-muted-foreground text-xs leading-relaxed"
													>
														Tick &quot;Show on POS&quot; on a WooCommerce coupon (Coupon data sidebar → Module Rouge POS tab). Codes are validated like on your storefront checkout. Auto-apply and bundle tiers live there too. Enter optional extra codes above (comma-separated, max { MAX_POS_COUPONS } ).
													</p>
												</div>
											</AccordionContent>
										</AccordionItem>
									</Accordion>

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
										<section className="bg-muted/25 border-border space-y-2 rounded-lg border px-3 py-3">
											<h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
												Coupons
											</h3>
											<ul className="text-muted-foreground space-y-1 text-xs">
												{ preview.appliedCoupons.map( ( c ) => (
													<li key={ c.code } className="flex justify-between gap-2 tabular-nums">
														<span>
															<span className="font-mono">{ htmlToPlainText( c.code ?? '' ) }</span>
														</span>
														<span className="text-emerald-700 dark:text-emerald-400">
															−{ htmlToPlainText( c.discountExTaxFormatted ?? '' ) }
														</span>
													</li>
												) ) }
											</ul>
										</section>
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
									<p className="text-muted-foreground mb-2 text-xs">Line totals exclude tax (after discounts).</p>
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

								<Separator className="my-1" />

								<div className="space-y-4">
									<section className="bg-muted/25 border-border rounded-lg border px-3 py-3">
										<h3 className="text-muted-foreground mb-2.5 text-xs font-semibold uppercase tracking-wide">
											Subtotal
										</h3>
										<div className="flex justify-between gap-4 text-sm">
											<span className="text-muted-foreground">Before discounts and tax</span>
											<span className="tabular-nums font-medium">
												{ preview?.subtotalFormatted ? htmlToPlainText( preview.subtotalFormatted ) : '—' }
											</span>
										</div>
									</section>

									{ ( () => {
										const hasLineDiscount =
											Boolean( preview?.discountTotal )
											&& Number.parseFloat( String( preview.discountTotal ) ) > 0
											&& Boolean( preview.discountTotalFormatted );
										const hasBundles =
											Boolean( preview?.bundleDiscounts && preview.bundleDiscounts.length > 0 );
										if ( ! hasLineDiscount && ! hasBundles ) {
											return null;
										}
										return (
											<section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
												<h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
													Discounts
												</h3>
												<div className="space-y-2 text-sm">
													{ hasLineDiscount && (
														<div className="flex justify-between gap-4">
															<span className="text-muted-foreground">Discount (ex tax)</span>
															<span className="tabular-nums text-emerald-700 dark:text-emerald-400">
																−{ htmlToPlainText( preview.discountTotalFormatted ) }
															</span>
														</div>
													) }
													{ ! previewFetching && hasBundles && (
														<div className="space-y-1 border-border border-dashed border-t pt-2">
															<p className="text-muted-foreground text-xs font-medium">Bundle savings</p>
															<ul className="space-y-1 text-xs">
																{ preview.bundleDiscounts!.map( ( row, ii ) => (
																	<li
																		key={ `${ row.code ?? 'b' }-${ ii }` }
																		className="flex justify-between gap-4 tabular-nums text-emerald-700 dark:text-emerald-400"
																	>
																		<span className="min-w-0">
																			{ htmlToPlainText( row.name || row.code || '' ) }
																		</span>
																		<span className="shrink-0">
																			−{ htmlToPlainText( row.amountFormatted ?? '' ) }
																		</span>
																	</li>
																) ) }
															</ul>
															{ preview.feesTotalFormatted && (
																<div className="text-muted-foreground flex justify-between gap-4 pt-1 text-xs tabular-nums">
																	<span>Bundle total</span>
																	<span className="text-emerald-700 dark:text-emerald-400">
																		{ htmlToPlainText( preview.feesTotalFormatted ) }
																	</span>
																</div>
															) }
														</div>
													) }
												</div>
											</section>
										);
									} )() }

									<section className="bg-muted/25 border-border space-y-2 rounded-lg border px-3 py-3">
										<h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
											Taxes
										</h3>
										<div className="text-sm">
											{ preview?.taxes && preview.taxes.length > 0 ? (
												<ul className="space-y-1.5">
													{ preview.taxes.map( ( t ) => (
														<li
															key={ t.id ?? t.label }
															className="flex justify-between gap-4"
														>
															<span className="text-muted-foreground">
																{ htmlToPlainText( t.label ) || 'Tax' }
															</span>
															<span className="tabular-nums">
																{ htmlToPlainText( t.amountFormatted ) }
															</span>
														</li>
													) ) }
												</ul>
											) : null }
											<div
												className={ cn(
													'flex justify-between gap-4 font-medium',
													preview?.taxes && preview.taxes.length > 0
														? 'border-border mt-2 border-t pt-2'
														: '',
												) }
											>
												<span className="text-muted-foreground">Tax total</span>
												<span className="tabular-nums">
													{ preview?.taxTotalFormatted ? htmlToPlainText( preview.taxTotalFormatted ) : '—' }
												</span>
											</div>
										</div>
									</section>

									<div className="bg-primary/10 border-primary/30 rounded-lg border px-4 py-4">
										<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
											Total to charge on your terminal
										</p>
										<p className="text-foreground mt-1 text-3xl font-bold tabular-nums">
											{ preview?.totalFormatted ? htmlToPlainText( preview.totalFormatted ) : '—' }
										</p>
									</div>
								</div>
								</div>

								<Separator />

								<div className="space-y-4">
									<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
										{ showPaymentSelector ? 'Payment & check-in' : 'Check-in' }
									</p>
									{ paymentMethodsLoading && ! paymentMethods?.length ? (
										<div className="grid gap-2">
											<Label id={ `${ formId }-pm-label` }>Payment method</Label>
											<p className="text-muted-foreground text-sm">Loading payment methods…</p>
										</div>
									) : ! paymentMethods?.length ? (
										<div className="grid gap-2">
											<Label id={ `${ formId }-pm-label` }>Payment method</Label>
											<p className="text-muted-foreground text-sm">No payment methods available.</p>
										</div>
									) : showPaymentSelector ? (
										<div className="grid gap-2">
											<Label id={ `${ formId }-pm-label` }>Payment method</Label>
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
										</div>
									) : null }
									<div className="grid gap-2">
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
									<Button
										type="submit"
										size="lg"
										className="mt-2 h-12 w-full justify-center bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700 focus-visible:border-emerald-500/50 focus-visible:ring-emerald-500/30 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-500"
										disabled={ disabledSubmit }
									>
										{ mutation.isPending ? 'Processing…' : 'Complete order' }
									</Button>
								</div>
							</CardContent>
						</Card>
					</form>
					<Dialog open={ clearOrderDialogOpen } onOpenChange={ setClearOrderDialogOpen }>
						<DialogContent showCloseButton={ false }>
							<DialogHeader>
								<DialogTitle>Clear order?</DialogTitle>
								<DialogDescription>
									All tickets will be removed from your order. You can add them again from the calendar.
								</DialogDescription>
							</DialogHeader>
							<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
								<Button
									type="button"
									variant="outline"
									onClick={ () => setClearOrderDialogOpen( false ) }
								>
									Cancel
								</Button>
								<Button
									type="button"
									variant="destructive"
									onClick={ () => {
										clearCart();
										setCouponInput( '' );
										setQuickApplyCouponCodes( [] );
										setClearOrderDialogOpen( false );
									} }
								>
									Clear order
								</Button>
							</div>
						</DialogContent>
					</Dialog>
				</>
			) }
		</div>
	);
}
