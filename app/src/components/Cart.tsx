import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cartLineKey, useCart, type CartLine } from '@/context/CartContext';
import { htmlToPlainText } from '@/lib/htmlPlain';
import { cn } from '@/lib/utils';

type Props = {
	variant?: 'full' | 'panel';
	className?: string;
};

export default function Cart( { variant = 'panel', className }: Props ) {
	const { items, totalQty, lineCount, updateQty, removeLine, clearCart } = useCart();

	const subtotalDisplay = useMemo( () => cartSubtotalDisplay( items ), [ items ] );

	if ( variant === 'panel' ) {
		return (
			<Card className={ cn( 'shadow-sm', className ) }>
				<CardHeader className="space-y-1 pb-3">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<CardTitle className="text-lg">Cart</CardTitle>
						<p className="text-muted-foreground text-xs tabular-nums">
							{ lineCount === 0
								? 'Empty'
								: `${ lineCount } line${ lineCount === 1 ? '' : 's' } · ${ totalQty } ticket${ totalQty === 1 ? '' : 's' }` }
						</p>
					</div>
				</CardHeader>
				<CardContent className="space-y-4 pt-0">
					{ items.length === 0 ? (
						<p className="text-muted-foreground border-border rounded-lg border border-dashed p-4 text-center text-sm">
							Your cart is empty. Select a time slot to start.
						</p>
					) : (
						<ul className="max-h-[min(60vh,28rem)] space-y-3 overflow-y-auto pr-1">
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
					) }
					{ lineCount > 0 && (
						<CartSubtotalRow display={ subtotalDisplay } />
					) }
					<Separator />
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
						{ lineCount > 0 && (
							<Button type="button" variant="outline" size="sm" onClick={ clearCart }>
								Clear cart
							</Button>
						) }
						{ lineCount === 0 ? (
							<Button type="button" size="sm" className="sm:ml-auto" disabled>
								Checkout
							</Button>
						) : (
							<Button type="button" size="sm" className="sm:ml-auto" asChild>
								<Link to="/checkout">Checkout</Link>
							</Button>
						) }
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className={ className }>
			<CardHeader className="pb-3">
				<CardTitle className="text-base">Order</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{ items.length === 0 ? (
					<p className="text-muted-foreground text-sm">Your order is empty. Add slots from the schedule.</p>
				) : (
					items.map( ( line ) => (
						<CartLineRow
							key={ cartLineKey( line ) }
							line={ line }
							onQty={ ( q ) => updateQty( cartLineKey( line ), q ) }
							onRemove={ () => removeLine( cartLineKey( line ) ) }
						/>
					) )
				) }
				{ items.length > 0 && (
					<CartSubtotalRow display={ subtotalDisplay } className="pt-1" />
				) }
				{ items.length > 0 && (
					<>
						<Separator />
						<div className="flex justify-end gap-2">
							<Button type="button" variant="outline" size="sm" onClick={ clearCart }>
								Clear order
							</Button>
						</div>
					</>
				) }
			</CardContent>
		</Card>
	);
}

function unitPriceFromLine( line: CartLine ): number | null {
	if ( typeof line.price === 'number' && Number.isFinite( line.price ) ) {
		return line.price;
	}
	const plain = htmlToPlainText( line.priceHtml );
	if ( ! plain ) {
		return null;
	}
	const normalized = plain.replace( /,/g, '' ).replace( /[^\d.-]/g, '' );
	const n = parseFloat( normalized );
	return Number.isFinite( n ) ? n : null;
}

type SubtotalDisplay = {
	text: string;
	note?: string;
};

function cartSubtotalDisplay( items: CartLine[] ): SubtotalDisplay {
	if ( items.length === 0 ) {
		return { text: '' };
	}
	let sum = 0;
	let pricedLines = 0;
	const firstSample = items
		.map( ( line ) => htmlToPlainText( line.priceHtml ) )
		.find( Boolean ) ?? '';
	for ( const line of items ) {
		const u = unitPriceFromLine( line );
		if ( u != null ) {
			sum += u * line.qty;
			pricedLines++;
		}
	}
	if ( pricedLines === 0 ) {
		return { text: '—', note: 'No unit prices on file' };
	}
	const sym = currencyPrefixGuess( firstSample || String( items[ 0 ]?.price ?? '' ) );
	const text = `${ sym }${ sum.toFixed( 2 ) }`;
	if ( pricedLines < items.length ) {
		return { text, note: `${ pricedLines } of ${ items.length } lines priced` };
	}
	return { text };
}

function currencyPrefixGuess( sample: string ): string {
	const t = sample.trim();
	if ( t.includes( '€' ) ) {
		return '€';
	}
	if ( t.includes( '£' ) ) {
		return '£';
	}
	if ( t.startsWith( '$' ) || t.includes( '$' ) ) {
		return '$';
	}
	return '$';
}

function CartSubtotalRow( {
	display,
	className,
}: {
	display: SubtotalDisplay;
	className?: string;
} ) {
	if ( ! display.text ) {
		return null;
	}
	return (
		<div className={ cn( 'space-y-0.5', className ) }>
			<div className="text-foreground flex items-center justify-between gap-3 text-sm font-medium tabular-nums">
				<span className="text-muted-foreground font-normal">Subtotal</span>
				<span>{ display.text }</span>
			</div>
			{ display.note ? (
				<p className="text-muted-foreground text-xs">{ display.note }</p>
			) : null }
		</div>
	);
}

function CartLineRow( {
	line,
	onQty,
	onRemove,
}: {
	line: CartLine;
	onQty: ( q: number ) => void;
	onRemove: () => void;
} ) {
	const cap =
		line.remaining === null || line.remaining === undefined
			? 20
			: Math.min( 20, Math.max( 1, line.remaining ) );

	const priceEach = htmlToPlainText( line.priceHtml );

	return (
		<div className="border-border bg-card space-y-2 rounded-lg border p-3 text-sm shadow-sm">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p className="font-medium leading-snug">{ htmlToPlainText( line.eventTitle ) }</p>
					<p className="text-muted-foreground text-xs">{ line.dateLabel }</p>
					{ line.slotTime ? (
						<p className="font-mono text-xs tabular-nums">{ line.slotTime }</p>
					) : null }
					{ priceEach ? (
						<p className="text-muted-foreground mt-1 text-xs">{ priceEach } each</p>
					) : null }
				</div>
				<Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" onClick={ onRemove } aria-label="Remove line">
					<Trash2 className="size-4" />
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
				<label className="text-muted-foreground shrink-0 text-xs" htmlFor={ `cart-qty-${ cartLineKey( line ) }` }>
					Qty
				</label>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="size-8 shrink-0"
						disabled={ line.qty <= 1 }
						onClick={ () =>
							onQty( Math.max( 1, line.qty - 1 ) )
						}
						aria-label="Decrease quantity"
					>
						<Minus className="size-4" />
					</Button>
					<Input
						id={ `cart-qty-${ cartLineKey( line ) }` }
						className="h-8 w-14 text-center tabular-nums"
						type="number"
						min={ 1 }
						max={ cap }
						value={ line.qty }
						onChange={ ( e ) =>
							onQty( Math.max( 1, Math.min( cap, parseInt( e.target.value, 10 ) || 1 ) ) )
						}
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="size-8 shrink-0"
						disabled={ line.qty >= cap }
						onClick={ () =>
							onQty( Math.min( cap, line.qty + 1 ) )
						}
						aria-label="Increase quantity"
					>
						<Plus className="size-4" />
					</Button>
				</div>
				<span className="text-muted-foreground text-xs">max { cap }</span>
			</div>
		</div>
	);
}
