import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useCart } from '@/context/CartContext';
import type { POSSelection } from '@/types/posSelection';

export type { POSSelection };

type Props = {
	/** Current selection; null shows empty state. */
	selection: POSSelection | null;
	/** Site today Y-m-d (WordPress-aligned when provided). */
	siteTodayYmd?: string;
	/** Called when user clears slot selection only. */
	onClear: () => void;
	/** Additional className for the outer card (e.g. sticky on large screens). */
	className?: string;
};

function todayYmdLocal() {
	return new Date().toISOString().slice( 0, 10 );
}

export default function POSCheckoutPanel( {
	selection,
	siteTodayYmd,
	onClear,
	className,
}: Props ) {
	const formId = useId();
	const navigate = useNavigate();
	const { addOrMergeLine } = useCart();
	const [ qty, setQty ] = useState( 1 );

	const anchor = siteTodayYmd ?? todayYmdLocal();
	const isPastDay = selection ? selection.viewDateYmd < anchor : false;
	const remaining = selection?.remaining;
	const maxByStock =
		remaining === null || remaining === undefined ? 20 : Math.min( 20, Math.max( 1, remaining ) );
	const canBook =
		selection
		&& ! isPastDay
		&& ( remaining === null || remaining === undefined || remaining > 0 );

	const selectionKey = selection
		? `${ selection.eventId }|${ selection.slotId }|${ selection.dateId }|${ selection.viewDateYmd }`
		: '';

	useEffect( () => {
		if ( ! selection ) {
			return;
		}
		setQty( 1 );
	}, [ selectionKey ] );

	const buildLine = () => ( selection ? { ...selection, qty } : null );

	const addThen = ( goCheckout: boolean ) => {
		const line = buildLine();
		if ( ! line || ! canBook ) {
			return;
		}
		addOrMergeLine( line );
		if ( goCheckout ) {
			navigate( '/checkout' );
		} else {
			toast.success( 'Added to order' );
		}
	};

	return (
		<Card
			className={ cn(
				'border-border/80 flex flex-col shadow-md lg:sticky lg:top-4 lg:max-h-[min(100vh-2rem,calc(100vh-6rem))]',
				className,
			) }
		>
			<CardHeader className="pb-3">
				<CardTitle className="text-lg">Slot</CardTitle>
				<CardDescription>
					{ selection
						? 'Add this slot to the order or open checkout.'
						: 'Select a slot from the schedule to start.' }
				</CardDescription>
			</CardHeader>
			{ selection ? (
				<>
					<CardContent className="border-border space-y-3 border-y bg-muted/30 py-4 text-sm">
						<div>
							<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
								Event
							</p>
							<p className="font-medium leading-snug">{ selection.eventTitle }</p>
							{ selection.priceHtml ? (
								<p className="text-muted-foreground mt-0.5 text-xs">{ selection.priceHtml } each</p>
							) : null }
						</div>
						<div className="grid gap-2 sm:grid-cols-2">
							<div>
								<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
									Date
								</p>
								<p className="tabular-nums">{ selection.dateLabel }</p>
							</div>
							<div>
								<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
									Slot
								</p>
								<p className="font-mono text-xs tabular-nums">
									{ selection.slotTime ? `${ selection.slotTime } · ` : '' }
									{ selection.slotLabel }
								</p>
							</div>
						</div>
						<div>
							<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
								Capacity
							</p>
							<p className="tabular-nums">
								{ remaining === null || remaining === undefined
									? 'Unlimited'
									: `${ remaining } spot${ remaining === 1 ? '' : 's' } left` }
							</p>
						</div>
					</CardContent>
					<div className="flex flex-1 flex-col">
						<CardContent className="flex flex-1 flex-col gap-3 pt-4">
							{ isPastDay && (
								<p className="text-destructive text-sm">This day is in the past — booking is disabled.</p>
							) }
							{ ! isPastDay && remaining !== null && remaining !== undefined && remaining <= 0 && (
								<p className="text-destructive text-sm">This slot is full.</p>
							) }
							<div className="grid gap-2">
								<Label htmlFor={ `${ formId }-qty` }>Quantity (max { maxByStock })</Label>
								<Input
									id={ `${ formId }-qty` }
									type="number"
									min={ 1 }
									max={ maxByStock }
									value={ qty }
									onChange={ ( e ) =>
										setQty( Math.max( 1, Math.min( maxByStock, parseInt( e.target.value, 10 ) || 1 ) ) )
									}
									disabled={ ! canBook }
								/>
							</div>
						</CardContent>
						<CardFooter className="mt-auto flex flex-col gap-2 border-t pt-4">
							<div className="grid gap-2 sm:grid-cols-2">
								<Button
									type="button"
									variant="secondary"
									className="w-full"
									disabled={ ! canBook }
									onClick={ () => addThen( false ) }
								>
									Add to order
								</Button>
								<Button type="button" className="w-full" disabled={ ! canBook } onClick={ () => addThen( true ) }>
									Checkout now
								</Button>
							</div>
							<Button type="button" variant="outline" className="w-full" onClick={ onClear }>
								Clear selection
							</Button>
						</CardFooter>
					</div>
				</>
			) : (
				<CardContent className="text-muted-foreground pb-6 text-sm">
					No slot selected. Choose a time row or tap Checkout on a row.
				</CardContent>
			) }
		</Card>
	);
}
