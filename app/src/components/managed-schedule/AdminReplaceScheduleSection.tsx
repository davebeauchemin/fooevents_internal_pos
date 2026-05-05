import { TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import type { ManageScheduleController } from '@/hooks/useManageSchedule';

type Props = {
	mgr: ManageScheduleController;
};

/**
 * Administrators only (see `canReplaceEventSchedules` / server replace guard).
 */
export function AdminReplaceScheduleSection( { mgr }: Props ) {
	const {
		preview,
		gen,
		confirmOpen,
		setConfirmOpen,
		runGenerate,
		scheduleManualBusy,
	} = mgr;

	return (
		<section
			aria-labelledby="event-admin-replace-heading"
			className="bg-destructive/[0.06] space-y-6 rounded-lg border border-destructive/35 p-4 sm:p-5 dark:bg-destructive/10"
		>
			<div className="bg-background/85 flex gap-3 rounded-md border border-destructive/45 px-4 py-3 dark:bg-background/55">
				<TriangleAlert
					className="text-destructive mt-0.5 size-5 shrink-0"
					aria-hidden
				/>
				<div className="space-y-2 text-sm">
					<p id="event-admin-replace-heading" className="text-destructive font-semibold">
						Admin danger zone · replace entire schedule
					</p>
					<p className="text-muted-foreground leading-relaxed">
						Saving from this section{' '}
						<strong className="text-foreground">overwrites</strong> every existing FooEvents booking slot
						and date on this product. Existing bookings may no longer align with sessions. Only administrators
						with replace permission see this zone.
					</p>
				</div>
			</div>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Preview (full replace)</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<p>
						<span className="text-muted-foreground">Unique (name + time) slots:</span>{ ' ' }
						<strong>{ preview.slotCount }</strong>
					</p>
					<p>
						<span className="text-muted-foreground">Unique dates (all blocks):</span>{ ' ' }
						<strong>{ preview.dateCount }</strong>
					</p>
					<p>
						<span className="text-muted-foreground">Total slot–date cells to write:</span>{ ' ' }
						<Badge>{ preview.totalEntries }</Badge>
					</p>
					{ preview.categories.length > 0 && (
						<div className="text-muted-foreground space-y-1 border-t border-border/60 pt-2 text-xs">
							<p className="font-medium text-foreground">By schedule name</p>
							<ul className="list-inside list-disc space-y-1">
								{ preview.categories.map( ( c ) => (
									<li key={ c.displayName }>
										<span className="text-foreground font-medium">{ c.displayName }</span>
										{ ': ' }
										{ c.slotDateCells } slot–date cells, { c.uniqueDates } unique dates,{ ' ' }
										{ c.sessionTimeCount } session start
										{ c.sessionTimeCount === 1 ? '' : 's' }
									</li>
								) ) }
							</ul>
						</div>
					) }
					<p className="text-muted-foreground text-xs">
						Client preview uses local calendar; the server recalculates in WordPress time when generating.
					</p>
				</CardContent>
			</Card>

			<Button
				type="button"
				size="lg"
				variant="destructive"
				disabled={
					gen.isPending || scheduleManualBusy || preview.totalEntries === 0
				}
				onClick={ () => setConfirmOpen( true ) }
			>
				{ gen.isPending ? 'Saving…' : 'Generate and replace entire schedule…' }
			</Button>

			<Dialog open={ confirmOpen } onOpenChange={ setConfirmOpen }>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Replace all slots?</DialogTitle>
						<DialogDescription>
							This will <strong>delete</strong> every existing FooEvents booking slot and date
							for this product, then write a new schedule from the blocks in Manage schedule plus Defaults
							above. This cannot be undone from the POS.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={ () => setConfirmOpen( false ) }
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={ () => void runGenerate() }
							disabled={ gen.isPending }
						>
							Replace and save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
