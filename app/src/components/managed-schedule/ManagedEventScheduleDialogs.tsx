import { useEffect } from 'react';
import { Plus, TriangleAlert } from 'lucide-react';
import { encodeManualSlotDateRef } from '@/lib/slotHourGrouping';
import type { ManageScheduleController } from '@/hooks/useManageSchedule';
import { ScheduleBlockDatePicker } from '@/components/managed-schedule/schedule-block-datepicker';
import { ScheduleDefaultsAndBlocksForm } from '@/components/managed-schedule/schedule-defaults-and-blocks';
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

type Props = {
	mgr: ManageScheduleController;
	sessionOpen: boolean;
	spotsOpen: boolean;
	scheduleOpen: boolean;
	replaceOpen: boolean;
	onSessionOpenChange: ( open: boolean ) => void;
	onSpotsOpenChange: ( open: boolean ) => void;
	onScheduleOpenChange: ( open: boolean ) => void;
	onReplaceOpenChange: ( open: boolean ) => void;
};

export function ManagedEventScheduleDialogs( {
	mgr,
	sessionOpen,
	spotsOpen,
	scheduleOpen,
	replaceOpen,
	onSessionOpenChange,
	onSpotsOpenChange,
	onScheduleOpenChange,
	onReplaceOpenChange,
}: Props ) {
	const {
		manualDate,
		setManualDate,
		manualTime,
		setManualTime,
		manualCapacity,
		setManualCapacity,
		manualLabel,
		setManualLabel,
		manualAddMode,
		setManualAddMode,
		manualSpotSelectValue,
		setManualSpotSelectValue,
		manualAddSpotsDelta,
		setManualAddSpotsDelta,
		manualStockConfirmOpen,
		setManualStockConfirmOpen,
		fillEmptyEnvelope,
		siteTodayYmd,
		siteTodayWeekday,
		fillPreview,
		spotsEligibleSchedule,
		selectedSpotSchedule,
		scheduleManualBusy,
		manualDuplicateMessage,
		scheduleSlotPickerLabel,
		submitManualSlot,
		commitManualStockAdd,
		runFillEmpty,
		runGenerate,
		gen,
		preview,
		manualAddWouldDuplicate,
		addManual,
		addStock,
		confirmOpen,
		setConfirmOpen,
	} = mgr;

	useEffect( () => {
		if ( sessionOpen ) {
			setManualAddMode( 'newSession' );
		}
	}, [ sessionOpen, setManualAddMode ] );

	useEffect( () => {
		if ( spotsOpen ) {
			setManualAddMode( 'extraSpots' );
		}
	}, [ spotsOpen, setManualAddMode ] );

	return (
		<>
			<Dialog open={ sessionOpen } onOpenChange={ onSessionOpenChange }>
				<DialogContent className="max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Add new session</DialogTitle>
						<DialogDescription className="text-left">
							Create one calendar day/time with capacity and an optional schedule label without
							changing existing sessions elsewhere.
						</DialogDescription>
					</DialogHeader>
					<ScheduleBlockDatePicker
						label="Date"
						ymd={ manualDate }
						onSelectYmd={ setManualDate }
						triggerId="dlg-manual-date-session"
						disabled={ scheduleManualBusy || gen.isPending }
						className="max-w-xs"
					/>
					<form
						className="flex flex-col gap-4 pt-2"
						onSubmit={ submitManualSlot }
					>
						<div className="space-y-2">
							<Label htmlFor="dlg-manual-time">Time</Label>
							<Input
								id="dlg-manual-time"
								type="time"
								value={ manualTime }
								onChange={ ( e ) => setManualTime( e.target.value ) }
								disabled={ scheduleManualBusy }
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="dlg-manual-cap">Capacity</Label>
							<p className="text-muted-foreground text-xs">0 = unlimited</p>
							<Input
								id="dlg-manual-cap"
								type="number"
								min={ 0 }
								className="w-[120px]"
								value={ manualCapacity }
								onChange={ ( e ) =>
									setManualCapacity( parseInt( e.target.value, 10 ) || 0 )
								}
								disabled={ scheduleManualBusy }
								required
							/>
						</div>
						<div className="min-w-[200px] flex-1 space-y-2">
							<Label htmlFor="dlg-manual-label">Schedule label (optional)</Label>
							<Input
								id="dlg-manual-label"
								placeholder="e.g. Regular"
								value={ manualLabel }
								onChange={ ( e ) => setManualLabel( e.target.value ) }
								disabled={ scheduleManualBusy }
								maxLength={ 60 }
								autoComplete="off"
							/>
						</div>
						{ manualAddWouldDuplicate && manualAddMode === 'newSession' ? (
							<div
								role="status"
								className="w-full rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-sm leading-snug text-yellow-950 dark:border-yellow-800/50 dark:bg-yellow-950/40 dark:text-yellow-50"
							>
								{ manualDuplicateMessage }
							</div>
						) : null }
						<DialogFooter className="flex-col gap-2 sm:flex-row">
							<Button
								type="button"
								variant="outline"
								onClick={ () => onSessionOpenChange( false ) }
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									scheduleManualBusy
									|| gen.isPending
									|| ( manualAddMode === 'newSession' && manualAddWouldDuplicate )
								}
							>
								{ addManual.isPending ? 'Adding…' : 'Add session' }
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={ spotsOpen } onOpenChange={ onSpotsOpenChange }>
				<DialogContent className="max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Add ticket spots</DialogTitle>
						<DialogDescription className="text-left">
							Choose a session on one date that already has a numeric capacity and increase its limit.
						</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={ submitManualSlot }>
						<ScheduleBlockDatePicker
							label="Date"
							ymd={ manualDate }
							onSelectYmd={ setManualDate }
							triggerId="dlg-manual-date-spots"
							disabled={ scheduleManualBusy || gen.isPending }
							className="max-w-xs"
						/>
						<div className="space-y-2">
							<Label>Session on this date</Label>
							{ spotsEligibleSchedule.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No sessions with a fixed capacity on that date. Pick another date or add a new
									session first.
								</p>
							) : (
								<Select
									value={ manualSpotSelectValue }
									onValueChange={ setManualSpotSelectValue }
									disabled={ scheduleManualBusy || gen.isPending }
								>
									<SelectTrigger className="w-full max-w-xl">
										<SelectValue placeholder="Choose session" />
									</SelectTrigger>
									<SelectContent>
										{ spotsEligibleSchedule.map( ( s ) => (
											<SelectItem
												key={ encodeManualSlotDateRef( s ) }
												value={ encodeManualSlotDateRef( s ) }
											>
												{ scheduleSlotPickerLabel( s ) }
											</SelectItem>
										) ) }
									</SelectContent>
								</Select>
							) }
						</div>
						<div className="space-y-2">
							<Label htmlFor="dlg-add-spots">Additional spots</Label>
							<p className="text-muted-foreground text-xs">
								Adds to the session&apos;s current numeric limit.
							</p>
							<Input
								id="dlg-add-spots"
								type="number"
								min={ 1 }
								className="w-[120px]"
								value={ manualAddSpotsDelta }
								onChange={ ( e ) => {
									const n = parseInt( e.target.value, 10 );
									setManualAddSpotsDelta(
										Number.isFinite( n ) && n >= 1 ? n : 1,
									);
								} }
								disabled={
									scheduleManualBusy
									|| gen.isPending
									|| spotsEligibleSchedule.length === 0
								}
								required
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={ () => onSpotsOpenChange( false ) }
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									scheduleManualBusy
									|| gen.isPending
									|| spotsEligibleSchedule.length === 0
									|| manualAddSpotsDelta < 1
								}
							>
								Continue
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={ manualStockConfirmOpen }
				onOpenChange={ ( open ) => {
					if ( ! scheduleManualBusy ) {
						setManualStockConfirmOpen( open );
					}
				} }
			>
				<DialogContent showCloseButton={ ! scheduleManualBusy }>
					<DialogHeader>
						<DialogTitle>Add ticket spots?</DialogTitle>
						<DialogDescription>
							Extra capacity for this session on{ ' ' }
							<span className="font-mono text-foreground">{ manualDate.trim() }</span>.
						</DialogDescription>
					</DialogHeader>
					<div className="bg-muted/40 border-border space-y-2 rounded-lg border px-3 py-3 text-sm">
						<div className="flex flex-wrap justify-between gap-2">
							<span className="text-muted-foreground">Session</span>
							<span className="max-w-[min(100%,16rem)] text-right font-medium break-words">
								{ selectedSpotSchedule
									? scheduleSlotPickerLabel( selectedSpotSchedule )
									: '—' }
							</span>
						</div>
						<div className="flex flex-wrap justify-between gap-2">
							<span className="text-muted-foreground">Current capacity</span>
							<span className="font-medium tabular-nums">
								{ selectedSpotSchedule != null
								&& typeof selectedSpotSchedule.stock === 'number'
									? selectedSpotSchedule.stock
									: '—' }
							</span>
						</div>
						<div className="flex flex-wrap justify-between gap-2">
							<span className="text-muted-foreground">Adding</span>
							<span className="font-medium tabular-nums">+{ manualAddSpotsDelta }</span>
						</div>
						<div className="flex flex-wrap justify-between gap-2">
							<span className="text-muted-foreground">New capacity</span>
							<span className="font-medium tabular-nums">
								{ selectedSpotSchedule != null
								&& typeof selectedSpotSchedule.stock === 'number'
									? selectedSpotSchedule.stock + manualAddSpotsDelta
									: '—' }
							</span>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={ () => setManualStockConfirmOpen( false ) }
							disabled={ scheduleManualBusy }
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={ commitManualStockAdd }
							disabled={ scheduleManualBusy }
						>
							{ addStock.isPending ? 'Saving…' : 'Confirm add spots' }
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={ scheduleOpen } onOpenChange={ onScheduleOpenChange }>
				<DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
					<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-10 pt-6">
						<DialogHeader className="shrink-0">
							<DialogTitle className="flex items-center gap-2">
								<Plus className="size-5 shrink-0" aria-hidden />
								Manage schedule
							</DialogTitle>
							<DialogDescription className="text-left leading-relaxed">
								Set defaults and schedule blocks below, preview candidates, then add missing sessions ({ ' ' }
								<strong className="text-foreground font-medium">fill empty</strong> — existing slots are kept).
								The merge window follows each block&apos;s start and end dates, clipped so nothing lands before{' ' }
								<strong className="text-foreground font-medium">today</strong> in the site calendar. Admins overwrite
								the whole grid via Replace entire schedule.
							</DialogDescription>
						</DialogHeader>
						<ScheduleDefaultsAndBlocksForm mgr={ mgr } formIdPrefix="mgmt" />

						<section
							aria-labelledby="dlg-fill-empty"
							className="border-border bg-muted/25 space-y-4 rounded-lg border p-4 sm:p-5"
						>
							<div className="space-y-2">
								<h2 id="dlg-fill-empty" className="text-lg font-semibold tracking-tight">
									Add missing sessions
								</h2>
								<p className="text-muted-foreground text-sm leading-relaxed">
									Merge each configured block into the calendar without removing slots that already exist.
									Dates before today in the site calendar are skipped automatically.
								</p>
								<p className="text-muted-foreground text-xs leading-snug">
									Site calendar today:{ ' ' }
									<span className="font-mono text-foreground">{ siteTodayYmd }</span>
									{ siteTodayWeekday ? ` · ${ siteTodayWeekday }` : '' }
								</p>
								{ ! fillEmptyEnvelope.invalid ? (
									<p className="text-muted-foreground border-border/80 bg-muted/40 rounded-md border px-3 py-2 text-xs leading-snug">
										Effective merge window (from block spans):{ ' ' }
										<span className="font-mono text-foreground">{ fillEmptyEnvelope.fillFrom }</span>
										{ ' → ' }
										<span className="font-mono text-foreground">{ fillEmptyEnvelope.fillTo }</span>
									</p>
								) : (
									<p className="text-destructive text-sm">
										Add at least one block and set valid Y-m-d start and end dates on every block before
										filling.
									</p>
								) }
							</div>
							<Card className="border-border/80 bg-background/80">
								<CardHeader className="pb-2">
									<CardTitle className="text-base">
										Preview (candidate cells in range)
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-2 text-sm">
									<p>
										<span className="text-muted-foreground">New slot–date cells to add:</span>{ ' ' }
										<Badge>{ fillPreview.totalEntries }</Badge>
									</p>
									<p>
										<span className="text-muted-foreground">
											Calendar days in fill range (inclusive):
										</span>{ ' ' }
										<strong>{ fillPreview.fillRangeInclusiveDays }</strong>
									</p>
									<p>
										<span className="text-muted-foreground">
											Distinct days with candidate sessions:
										</span>{ ' ' }
										<strong>{ fillPreview.dateCount }</strong>
									</p>
									{ fillPreview.categories.length > 0 && (
										<div className="text-muted-foreground space-y-1 border-t border-border/60 pt-2 text-xs">
											<p className="font-medium text-foreground">By schedule name</p>
											<ul className="list-inside list-disc space-y-1">
												{ fillPreview.categories.map( ( c ) => (
													<li key={ c.displayName }>
														<span className="text-foreground font-medium">
															{ c.displayName }
														</span>
														{ ': ' }
														{ c.slotDateCells } cells, { c.sessionTimeCount } session start
														{ c.sessionTimeCount === 1 ? '' : 's' }
													</li>
												) ) }
											</ul>
										</div>
									) }
								</CardContent>
							</Card>
							<Button
								type="button"
								size="lg"
								disabled={
									gen.isPending
									|| scheduleManualBusy
									|| fillPreview.totalEntries === 0
									|| fillEmptyEnvelope.invalid
								}
								onClick={ () => void runFillEmpty() }
							>
								{ gen.isPending ? 'Saving…' : 'Add missing sessions' }
							</Button>
						</section>

						<Separator className="shrink-0" />
					</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={ replaceOpen }
				onOpenChange={ ( open ) => {
					if ( ! open ) {
						setConfirmOpen( false );
					}
					onReplaceOpenChange( open );
				} }
			>
				<DialogContent className="flex max-h-[92vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
					<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-10 pt-6">
						<DialogHeader className="shrink-0">
							<DialogTitle>Replace entire schedule</DialogTitle>
							<DialogDescription className="text-left leading-relaxed">
								Configuring blocks below is required before overwriting. Saving{' '}
								<strong className="text-foreground">
									replaces every existing FooEvents booking slot and date
								</strong>{ ' ' }
								with a newly generated grid from defaults and blocks.
							</DialogDescription>
						</DialogHeader>
						<div className="bg-destructive/[0.06] flex shrink-0 gap-3 rounded-lg border border-destructive/35 p-4 dark:bg-destructive/10">
							<TriangleAlert
								className="text-destructive mt-0.5 size-5 shrink-0"
								aria-hidden
							/>
							<p className="text-muted-foreground text-sm leading-relaxed">
								Existing ticket counts may no longer line up — only use when you intend a full reset.
							</p>
						</div>
						<ScheduleDefaultsAndBlocksForm mgr={ mgr } formIdPrefix="repl" />
						<Card className="shrink-0">
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
									<span className="text-muted-foreground">
										Total slot–date cells to write:
									</span>{ ' ' }
									<Badge>{ preview.totalEntries }</Badge>
								</p>
							</CardContent>
						</Card>
						<Button
							type="button"
							className="shrink-0"
							size="lg"
							variant="destructive"
							disabled={
								gen.isPending
								|| scheduleManualBusy
								|| preview.totalEntries === 0
							}
							onClick={ () => setConfirmOpen( true ) }
						>
							{ gen.isPending
								? 'Saving…'
								: 'Generate and replace entire schedule…'
							}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={ confirmOpen } onOpenChange={ setConfirmOpen }>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Replace all slots?</DialogTitle>
						<DialogDescription>
							This will <strong>delete</strong> every existing FooEvents booking slot and date for this
							product, then write a new schedule from the defaults and blocks you configured in Replace
							entire schedule. This cannot be undone from the POS.
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

		</>
	);
}
