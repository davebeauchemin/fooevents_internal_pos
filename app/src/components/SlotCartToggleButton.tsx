import { Check, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function slotAvailabilityText(stock: number | null) {
	if (stock === null || stock === undefined) {
		return 'Unlimited';
	}
	if (stock <= 0) {
		return 'Full';
	}
	return `${stock} ticket${stock === 1 ? '' : 's'}`;
}

type Props = {
	timeText: string;
	stock: number | null;
	disabled: boolean;
	inCart: boolean;
	onToggle: () => void;
};

/**
 * Single slot row: time, availability text, optional check when the line is in the cart.
 */
export default function SlotCartToggleButton({
	timeText,
	stock,
	disabled,
	inCart,
	onToggle,
}: Props) {
	const availability = slotAvailabilityText(stock);
	const full = stock !== null && stock !== undefined && stock <= 0;

	return (
		<button
			type="button"
			disabled={disabled}
			aria-pressed={inCart && !disabled}
			aria-label={`${timeText}. ${availability}.${inCart && !disabled ? ' In cart.' : ''}`}
			onClick={onToggle}
			className={cn(
				'flex min-w-0 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition',
				disabled && 'cursor-not-allowed opacity-60',
				!disabled && 'hover:bg-muted/50',
				inCart && !disabled
				&& 'border-primary bg-primary/5 ring-2 ring-primary/30',
				!inCart && !disabled && 'border-border bg-card',
			)}
		>
			<div className="text-muted-foreground flex shrink-0 items-center gap-1 font-mono text-sm tabular-nums">
				<Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
				<span>{timeText}</span>
			</div>
			<div className="text-muted-foreground flex shrink-0 items-center gap-2 tabular-nums text-xs">
				<span className={cn(full && 'text-destructive font-medium')}>
					{availability}
				</span>
				{inCart && !disabled ? (
					<span
						className="text-primary inline-flex size-6 items-center justify-center rounded-full border border-primary bg-primary/10"
						aria-hidden
					>
						<Check className="size-3.5 stroke-[3]" />
					</span>
				) : (
					<span className="inline-flex size-6 shrink-0" aria-hidden />
				)}
			</div>
		</button>
	);
}
