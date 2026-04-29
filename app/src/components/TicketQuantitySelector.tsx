import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MIN = 1;
const MAX = 20;

type Props = {
	value: number;
	onChange: ( value: number ) => void;
	className?: string;
};

function clamp( n: number ) {
	return Math.max( MIN, Math.min( MAX, n ) );
}

export default function TicketQuantitySelector( { value, onChange, className }: Props ) {
	const safe = clamp( value );

	return (
		<div className={ cn( 'space-y-2', className ) }>
			<p className="text-muted-foreground text-sm font-medium">Tickets</p>
			<div
				className="flex flex-wrap items-center gap-2"
				role="group"
				aria-label="Number of tickets"
			>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="size-8 shrink-0"
						disabled={ safe <= MIN }
						onClick={ () => onChange( clamp( safe - 1 ) ) }
						aria-label="Decrease number of tickets"
					>
						<Minus className="size-4" />
					</Button>
					<div
						className="flex h-8 w-14 shrink-0 select-none items-center justify-center rounded-md border border-input bg-transparent px-2 text-sm shadow-xs tabular-nums outline-none md:text-sm dark:bg-input/30"
						aria-live="polite"
					>
						{ safe }
					</div>
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="size-8 shrink-0"
						disabled={ safe >= MAX }
						onClick={ () => onChange( clamp( safe + 1 ) ) }
						aria-label="Increase number of tickets"
					>
						<Plus className="size-4" />
					</Button>
				</div>
				<span className="text-muted-foreground shrink-0 text-xs">
					{ MIN }–{ MAX }
				</span>
			</div>
		</div>
	);
}
