import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cartLineKey, useCart, type CartLine } from '@/context/CartContext';
import { cn } from '@/lib/utils';

type Props = {
	variant?: 'compact' | 'full';
	className?: string;
};

export default function Cart( { variant = 'compact', className }: Props ) {
	const { items, totalQty, lineCount, updateQty, removeLine, clearCart } = useCart();

	if ( variant === 'compact' ) {
		return (
			<div
				className={ cn(
					'border-border bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm',
					className,
				) }
			>
				<span className="text-muted-foreground">
					Order: <strong className="text-foreground">{ lineCount }</strong> line{ lineCount === 1 ? '' : 's' }
					{ ' · ' }
					<strong className="text-foreground">{ totalQty }</strong> ticket{ totalQty === 1 ? '' : 's' }
				</span>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{ lineCount > 0 && (
						<Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={ clearCart }>
							<Trash2 className="mr-1 size-3.5" />
							Clear order
						</Button>
					) }
					{ lineCount === 0 ? (
						<Button type="button" size="sm" variant="secondary" disabled>
							Go to checkout
						</Button>
					) : (
						<Button type="button" size="sm" variant="secondary" asChild>
							<Link to="/checkout">Go to checkout</Link>
						</Button>
					) }
				</div>
			</div>
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

	return (
		<div className="border-border space-y-2 rounded-lg border p-3 text-sm">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p className="font-medium leading-snug">{ line.eventTitle }</p>
					<p className="text-muted-foreground text-xs">{ line.dateLabel }</p>
					<p className="font-mono text-xs tabular-nums">
						{ line.slotTime ? `${ line.slotTime } · ` : '' }
						{ line.slotLabel }
					</p>
					{ line.priceHtml ? (
						<p className="text-muted-foreground mt-1 text-xs">{ line.priceHtml } each</p>
					) : null }
				</div>
				<Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" onClick={ onRemove } aria-label="Remove line">
					<Trash2 className="size-4" />
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<label className="text-muted-foreground text-xs">Qty</label>
				<Input
					className="h-8 w-20"
					type="number"
					min={ 1 }
					max={ cap }
					value={ line.qty }
					onChange={ ( e ) =>
						onQty( Math.max( 1, Math.min( cap, parseInt( e.target.value, 10 ) || 1 ) ) )
					}
				/>
				<span className="text-muted-foreground text-xs">max { cap }</span>
			</div>
		</div>
	);
}
