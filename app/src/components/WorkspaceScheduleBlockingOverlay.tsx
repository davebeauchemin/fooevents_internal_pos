import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
	open: boolean;
	className?: string;
};

/** Full-viewport blocker while schedule/slot updates run (no stray clicks underneath). */
export function WorkspaceScheduleBlockingOverlay( {
	open,
	className,
}: Props ) {
	useEffect( () => {
		if ( ! open ) {
			return;
		}
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, [ open ] );

	if ( ! open || typeof document === 'undefined' ) {
		return null;
	}

	return createPortal(
		<div
			className={ cn(
				'fixed inset-0 z-[100] flex cursor-wait flex-col items-center justify-center gap-4',
				'bg-background/80 backdrop-blur-sm',
				className,
			) }
			role="status"
			aria-live="polite"
			aria-busy="true"
			aria-label="Updating schedule"
		>
			<LoaderCircleIcon
				className="text-muted-foreground size-12 animate-spin"
				strokeWidth={ 1.5 }
				aria-hidden
			/>
			<p className="text-muted-foreground max-w-[min(20rem,calc(100vw-3rem))] text-center text-sm font-medium leading-snug">
				Updating this event’s booking slots…
			</p>
		</div>,
		document.body,
	);
}
