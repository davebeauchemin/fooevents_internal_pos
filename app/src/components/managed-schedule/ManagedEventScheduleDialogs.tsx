import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, Plus, TriangleAlert } from 'lucide-react';
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
	removeOpen: boolean;
	scheduleOpen: boolean;
	replaceOpen: boolean;
	onSessionOpenChange: ( open: boolean ) => void;
	onSpotsOpenChange: ( open: boolean ) => void;
	onRemoveOpenChange: ( open: boolean ) => void;
	onScheduleOpenChange: ( open: boolean ) => void;
	onReplaceOpenChange: ( open: boolean ) => void;
};

export function ManagedEventScheduleDialogs( {
	mgr,
	sessionOpen,
	spotsOpen,
	removeOpen,
	scheduleOpen,
	replaceOpen,
	onSessionOpenChange,
	onSpotsOpenChange,
	onRemoveOpenChange,
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
		bulkRemoveConfirmOpen,
		setBulkRemoveConfirmOpen,
		bulkRemoving,
		bulkReduceSpotsPerCell,
		setBulkReduceSpotsPerCell,
		bulkReduceSubMode,
		setBulkReduceSubMode,
		bulkTargetTotalCapacity,
		setBulkTargetTotalCapacity,
		bulkReduceStockPreview,
		bulkReduceConfirmOpen,
		setBulkReduceConfirmOpen,
		bulkReduceRunList,
		bulkReducingStock,
		manualAddSpotsDelta,
		setManualAddSpotsDelta,
		manualStockConfirmOpen,
		setManualStockConfirmOpen,
		fillEmptyEnvelope,
		bulkRemoveEnvelope,
		bulkRemovePatternPreview,
		siteTodayYmd,
		siteTodayWeekday,
		fillPreview,
		bulkRemoveTargets,
		bulkRemoveRunList,
		spotsEligibleSchedule,
		selectedSpotSchedule,
		scheduleManualBusy,
		manualDuplicateMessage,
		scheduleSlotPickerLabel,
		submitManualSlot,
		commitManualStockAdd,
		requestBulkRemoveConfirm,
		requestBulkReduceStockConfirm,
		runBulkRemoveBlocks,
		runBulkReduceStock,
		runFillEmpty,
		runGenerate,
		gen,
		preview,
		manualAddWouldDuplicate,
		addManual,
		addStock,
		confirmOpen,
		setConfirmOpen,
		mutationSuccessAck,
		dismissMutationSuccessAck,
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

	useEffect( () => {
		if ( ! removeOpen ) {
			setBulkRemoveConfirmOpen( false );
			setBulkReduceConfirmOpen( false );
		}
	}, [ removeOpen, setBulkRemoveConfirmOpen, setBulkReduceConfirmOpen ] );

	const [ removeBulkMode, setRemoveBulkMode ] = useState<
		'deleteCells' | 'reduceSpots'
	>( 'deleteCells' );

	useEffect( () => {
		if ( removeOpen ) {
			setRemoveBulkMode( 'deleteCells' );
		}
	}, [ removeOpen ] );

	const matchedRemoveDayCount = useMemo(
		() =>
			new Set( bulkRemoveTargets.map( ( t ) => t.ymd.trim() ) ).size,
		[ bulkRemoveTargets ],
	);

	const matchedReduceDayCount = useMemo(
		() =>
			new Set(
				bulkReduceStockPreview.targets.map( ( t ) => t.ymd.trim() ),
			).size,
		[ bulkReduceStockPreview.targets ],
	);

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

			<Dialog open={ removeOpen } onOpenChange={ onRemoveOpenChange }>
				<DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
					<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-10 pt-6">
						<DialogHeader className="shrink-0">
							<DialogTitle>Bulk remove or reduce spots</DialogTitle>
							<DialogDescription className="text-left leading-relaxed">
								Use the same blocks, weekdays, open/close times, and session length as Manage schedule. Choose
								whether to <strong className="text-foreground font-medium">delete entire sessions</strong> or{ ' ' }
								<strong className="text-foreground font-medium">lower numeric capacity</strong> (sessions stay on
								the calendar; unlimited slots are skipped). Patterns can include days before site today (unlike Fill
								empty).
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								size="sm"
								variant={ removeBulkMode === 'deleteCells' ? 'default' : 'outline' }
								onClick={ () => setRemoveBulkMode( 'deleteCells' ) }
							>
								Delete sessions
							</Button>
							<Button
								type="button"
								size="sm"
								variant={ removeBulkMode === 'reduceSpots' ? 'default' : 'outline' }
								onClick={ () => setRemoveBulkMode( 'reduceSpots' ) }
							>
								Reduce ticket spots
							</Button>
						</div>
						{ removeBulkMode === 'deleteCells' ? (
							<div className="bg-destructive/[0.06] flex shrink-0 gap-3 rounded-lg border border-destructive/35 p-4 dark:bg-destructive/10">
								<TriangleAlert
									className="text-destructive mt-0.5 size-5 shrink-0"
									aria-hidden
								/>
								<p className="text-muted-foreground text-sm leading-relaxed">
									Deletion matches{ ' ' }
									<strong className="text-foreground font-medium">weekdays + session start times </strong>
									stepped from Open/Close (same as Fill empty stepping). Stored FooEvents{ ' ' }
									<strong className="text-foreground font-medium">labels are ignored </strong>
									— all slot rows on a day whose resolved time aligns are candidates. The server skips cells
									that already have bookings ({ ' ' }
									<span className="font-mono">slot_has_bookings</span>
									).
								</p>
							</div>
						) : (
							<div className="bg-muted/40 flex shrink-0 gap-3 rounded-lg border border-border p-4">
								<CircleCheck
									className="text-muted-foreground mt-0.5 size-5 shrink-0"
									aria-hidden
								/>
								<p className="text-muted-foreground text-sm leading-relaxed">
									<strong className="text-foreground font-medium">Reduce ticket spots</strong> can
									either remove a fixed number of <strong className="text-foreground font-medium">remaining
									</strong> spots per session, or set a <strong className="text-foreground font-medium">
									target total capacity</strong> (sold + remaining) per session. Remaining inventory is
									adjusted only — <strong className="text-foreground font-medium">sold tickets are never
									canceled or changed</strong>. Unlimited and zero-remaining sessions are skipped.
									When bookings already exceed the target total, remaining spots drop as far as possible
									and those rows are flagged as booked over target.
								</p>
							</div>
						) }
						<ScheduleDefaultsAndBlocksForm
							mgr={ mgr }
							formIdPrefix="rmv"
							hideCapacityDefaults
							bulkRemoveSemantics
						/>
						<section
							className="border-border bg-muted/25 space-y-4 rounded-lg border p-4 sm:p-5"
							aria-labelledby="dlg-remove-bulk"
						>
							<div className="space-y-2">
								<h2 id="dlg-remove-bulk" className="text-lg font-semibold tracking-tight">
									Schedule window &amp; preview
								</h2>
								<p className="text-muted-foreground text-sm leading-relaxed">
									The range is the union of each block&apos;s start/end dates (Y-m-d), clipped per block
									by weekdays and stepped session start times from Open/Close. Use site today only as
									orientation — these tools are{' '}
									<strong className="text-foreground font-medium">not</strong> limited to today or future
									days.
								</p>
								<p className="text-muted-foreground text-xs leading-snug">
									Site calendar today:{ ' ' }
									<span className="font-mono text-foreground">{ siteTodayYmd }</span>
									{ siteTodayWeekday ? ` · ${ siteTodayWeekday }` : '' }
								</p>
								{ ! bulkRemoveEnvelope.invalid ? (
									<p className="text-muted-foreground border-border/80 bg-muted/40 rounded-md border px-3 py-2 text-xs leading-snug">
										Block calendar span (union of start/end dates):{ ' ' }
										<span className="font-mono text-foreground">{ bulkRemoveEnvelope.removeFrom }</span>
										{ ' → ' }
										<span className="font-mono text-foreground">{ bulkRemoveEnvelope.removeTo }</span>
									</p>
								) : (
									<p className="text-destructive text-sm">
										Add at least one block with valid start and end dates (Y-m-d) before continuing.
									</p>
								) }
							</div>
							{ removeBulkMode === 'reduceSpots' ? (
								<div className="space-y-3">
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											variant={
												bulkReduceSubMode === 'fixedRemove' ? 'default' : 'outline'
											}
											onClick={ () => setBulkReduceSubMode( 'fixedRemove' ) }
										>
											Remove X available spots
										</Button>
										<Button
											type="button"
											size="sm"
											variant={
												bulkReduceSubMode === 'targetTotal' ? 'default' : 'outline'
											}
											onClick={ () => setBulkReduceSubMode( 'targetTotal' ) }
										>
											Set total capacity to X
										</Button>
									</div>
									{ bulkReduceSubMode === 'fixedRemove' ? (
										<div className="space-y-2">
											<Label htmlFor="dlg-bulk-reduce-per-cell">
												Spots to remove per matching session
											</Label>
											<p className="text-muted-foreground text-xs">
												Each finite-capacity cell loses up to this many remaining spots (never below
												zero).
											</p>
											<Input
												id="dlg-bulk-reduce-per-cell"
												type="number"
												min={ 1 }
												step={ 1 }
												className="max-w-[140px]"
												value={ bulkReduceSpotsPerCell }
												disabled={
													scheduleManualBusy
													|| gen.isPending
													|| bulkRemoveEnvelope.invalid
												}
												onChange={ ( e ) => {
													const n = parseInt( e.target.value, 10 );
													setBulkReduceSpotsPerCell(
														Number.isFinite( n ) && n >= 1 ? n : 1,
													);
												} }
											/>
										</div>
									) : (
										<div className="space-y-2">
											<Label htmlFor="dlg-bulk-reduce-target-total">
												Target total capacity
											</Label>
											<p className="text-muted-foreground text-xs">
												Goal per session for{' '}
												<span className="text-foreground font-medium">booked + remaining</span>.
												Only remaining spots are reduced; sold tickets stay as-is.
											</p>
											<Input
												id="dlg-bulk-reduce-target-total"
												type="number"
												min={ 0 }
												step={ 1 }
												className="max-w-[140px]"
												value={ bulkTargetTotalCapacity }
												disabled={
													scheduleManualBusy
													|| gen.isPending
													|| bulkRemoveEnvelope.invalid
												}
												onChange={ ( e ) => {
													const n = parseInt( e.target.value, 10 );
													setBulkTargetTotalCapacity(
														Number.isFinite( n ) && n >= 0 ? n : 0,
													);
												} }
											/>
										</div>
									) }
								</div>
							) : null }
							<Card className="border-border/80 bg-background/80">
								<CardHeader className="pb-2">
									<CardTitle className="text-base">
										Pattern preview (candidate times &amp; weekdays)
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-2 text-sm">
									<p className="text-muted-foreground text-xs">
										{ removeBulkMode === 'deleteCells' ? (
											<>
												Block names only
												<strong className="text-foreground font-medium"> group preview rows </strong>;
												they don’t filter what gets deleted — times do.
											</>
										) : (
											<>
												Block names only
												<strong className="text-foreground font-medium"> group preview rows </strong>.
												Matching uses stepped start times (same as delete mode).
											</>
										) }
									</p>
									<p>
										<span className="text-muted-foreground">
											Candidate slot–date positions in merge window:
										</span>{ ' ' }
										<Badge>{ bulkRemovePatternPreview.totalEntries }</Badge>
									</p>
									{ bulkRemovePatternPreview.categories.length > 0 && (
										<div className="text-muted-foreground space-y-1 border-t border-border/60 pt-2 text-xs">
											<p className="font-medium text-foreground">By block schedule name (preview only)</p>
											<ul className="list-inside list-disc space-y-1">
												{ bulkRemovePatternPreview.categories.map( ( c ) => (
													<li key={ c.displayName }>
														<span className="text-foreground font-medium">
															{ c.displayName }
														</span>
														{ ': ' }
														{ c.slotDateCells } cell{ c.slotDateCells === 1 ? '' : 's' },{ ' ' }
														{ c.sessionTimeCount } start time{ c.sessionTimeCount === 1 ? '' : 's' }
													</li>
												) ) }
											</ul>
										</div>
									) }
								</CardContent>
							</Card>
							{ removeBulkMode === 'deleteCells' ? (
								<Card className="border-border/80 bg-background/80">
									<CardHeader className="pb-2">
										<CardTitle className="text-base">
											Matched rows on this product (delete — will be attempted)
										</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3 text-sm">
										<p>
											<span className="text-muted-foreground">Slot–date cells that match:</span>{ ' ' }
											<strong className="tabular-nums">{ bulkRemoveTargets.length }</strong>
										</p>
										<p>
											<span className="text-muted-foreground">Distinct calendar days touched:</span>{ ' ' }
											<strong className="tabular-nums">{ matchedRemoveDayCount }</strong>
										</p>
										{ bulkRemoveTargets.length > 0 ? (
											<ul className="max-h-[10rem] list-inside list-decimal overflow-y-auto border-t border-border/60 pt-2 text-muted-foreground text-xs">
												{ bulkRemoveTargets.slice( 0, 40 ).map( ( t ) => (
													<li
														key={
															t.ymd
															+ '\t'
															+ encodeManualSlotDateRef( {
																id: t.slotId,
																dateId: t.dateId,
															} )
														}
													>
														<span className="font-mono text-foreground">{ t.ymd }</span>
														{ ' · ids ' }
														<span className="font-mono">{ t.slotId }</span>
														<span className="text-muted-foreground/80">/</span>
														<span className="font-mono">{ t.dateId }</span>
													</li>
												) ) }
												{ bulkRemoveTargets.length > 40 ? (
													<li className="list-none pl-5 text-muted-foreground">
														…plus { bulkRemoveTargets.length - 40 } more
													</li>
												) : null }
											</ul>
										) : (
											<p className="text-muted-foreground text-xs">
												Adjust weekdays, Open/Close, session length, or date span — nothing on this schedule shares those start times yet.
											</p>
										) }
									</CardContent>
								</Card>
							) : (
								<Card className="border-border/80 bg-background/80">
									<CardHeader className="pb-2">
										<CardTitle className="text-base">
											Finite-capacity matches (reduce spots)
										</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3 text-sm">
										<p>
											<span className="text-muted-foreground">Sessions to update:</span>{ ' ' }
											<strong className="tabular-nums">{ bulkReduceStockPreview.targets.length }</strong>
										</p>
										<p>
											<span className="text-muted-foreground">Total spots removed (planned):</span>{ ' ' }
											<strong className="tabular-nums">{ bulkReduceStockPreview.totalSpotsRemoved }</strong>
										</p>
										<p>
											<span className="text-muted-foreground">Distinct calendar days touched:</span>{ ' ' }
											<strong className="tabular-nums">{ matchedReduceDayCount }</strong>
										</p>
										<p>
											<span className="text-muted-foreground">Skipped (unlimited capacity):</span>{ ' ' }
											<strong className="tabular-nums">{ bulkReduceStockPreview.skippedUnlimited }</strong>
										</p>
										<p>
											<span className="text-muted-foreground">Skipped (zero remaining):</span>{ ' ' }
											<strong className="tabular-nums">{ bulkReduceStockPreview.skippedZero }</strong>
										</p>
										{ bulkReduceSubMode === 'targetTotal' ? (
											<>
												<p>
													<span className="text-muted-foreground">Skipped (already at/below target):</span>{ ' ' }
													<strong className="tabular-nums">{ bulkReduceStockPreview.skippedAtOrBelowTarget }</strong>
												</p>
												<p>
													<span className="text-muted-foreground">Skipped (missing booked count):</span>{ ' ' }
													<strong className="tabular-nums">{ bulkReduceStockPreview.skippedMissingBookedData }</strong>
												</p>
												<p>
													<span className="text-muted-foreground">Booked over target (no spots left to cut):</span>{ ' ' }
													<strong className="tabular-nums">{ bulkReduceStockPreview.bookedOverTargetSessions }</strong>
												</p>
											</>
										) : null }
										{ bulkReduceStockPreview.targets.length > 0 ? (
											<ul className="max-h-[10rem] list-inside list-decimal overflow-y-auto border-t border-border/60 pt-2 text-muted-foreground text-xs">
												{ bulkReduceStockPreview.targets.slice( 0, 40 ).map( ( t ) => (
													<li
														key={
															t.ymd
															+ '\t'
															+ encodeManualSlotDateRef( {
																id: t.slotId,
																dateId: t.dateId,
															} )
														}
													>
														<span className="font-mono text-foreground">{ t.ymd }</span>
														{ bulkReduceSubMode === 'targetTotal'
														&& typeof t.bookedCount === 'number'
														&& typeof t.currentTotal === 'number'
														&& typeof t.targetTotalCapacity === 'number' ? (
															<>
																{ ' · booked ' }
																<span className="tabular-nums">{ t.bookedCount }</span>
																{ ' + rem ' }
																<span className="tabular-nums">{ t.currentStock }</span>
																{ ' = ' }
																<span className="tabular-nums text-foreground">{ t.currentTotal }</span>
																{ ' → target ' }
																<span className="tabular-nums text-foreground">{ t.targetTotalCapacity }</span>
																{ '; -' }
																<span className="tabular-nums text-foreground">{ t.removeSpots }</span>
																{ t.bookedOverTarget ? ' · booked over target' : '' }
															</>
														) : (
															<>
																{ ' · -'}
																<span className="tabular-nums text-foreground">{ t.removeSpots }</span>
																{ ' (was ' }
																<span className="tabular-nums">{ t.currentStock }</span>
																{ ') ' }
															</>
														) }
														{ ' · ' }
														<span className="font-mono">{ t.slotId }</span>
														<span className="text-muted-foreground/80">/</span>
														<span className="font-mono">{ t.dateId }</span>
													</li>
												) ) }
												{ bulkReduceStockPreview.targets.length > 40 ? (
													<li className="list-none pl-5 text-muted-foreground">
														…plus { bulkReduceStockPreview.targets.length - 40 } more
													</li>
												) : null }
											</ul>
										) : (
											<p className="text-muted-foreground text-xs">
												{ bulkReduceSubMode === 'targetTotal'
													? 'No cells need remaining spots removed for this target, or sessions are unlimited / missing booked counts.'
													: 'No finite-capacity cells match this pattern, or spots per session is below 1.' }
											</p>
										) }
									</CardContent>
								</Card>
							) }
							<DialogFooter className="shrink-0 sm:justify-between">
								<Button
									type="button"
									variant="outline"
									onClick={ () => onRemoveOpenChange( false ) }
									disabled={ bulkRemoving || bulkReducingStock }
								>
									Close
								</Button>
								{ removeBulkMode === 'deleteCells' ? (
									<Button
										type="button"
										variant="destructive"
										disabled={
											scheduleManualBusy
											|| gen.isPending
											|| bulkRemoveEnvelope.invalid
											|| bulkRemoveTargets.length === 0
											|| bulkRemoving
											|| bulkReducingStock
										}
										onClick={ requestBulkRemoveConfirm }
									>
										Continue to confirm deletion…
									</Button>
								) : (
									<Button
										type="button"
										disabled={
											scheduleManualBusy
											|| gen.isPending
											|| bulkRemoveEnvelope.invalid
											|| bulkReduceStockPreview.targets.length === 0
											|| bulkRemoving
											|| bulkReducingStock
											|| ( bulkReduceSubMode === 'fixedRemove'
												&& bulkReduceSpotsPerCell < 1 )
											|| ( bulkReduceSubMode === 'targetTotal'
												&& ( ! Number.isFinite( Math.floor( bulkTargetTotalCapacity ) )
													|| Math.floor( bulkTargetTotalCapacity ) < 0 ) )
										}
										onClick={ requestBulkReduceStockConfirm }
									>
										Continue to confirm spot reduction…
									</Button>
								) }
							</DialogFooter>
						</section>
					</div>
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

			<Dialog
				open={ bulkRemoveConfirmOpen }
				onOpenChange={ ( open ) => {
					if ( ! bulkRemoving ) {
						setBulkRemoveConfirmOpen( open );
					}
				} }
			>
				<DialogContent showCloseButton={ ! bulkRemoving }>
					<DialogHeader>
						<DialogTitle>Remove matched time blocks?</DialogTitle>
						<DialogDescription className="text-left">
							Start bulk deletion for{ ' ' }
							<strong className="text-foreground">
								{ bulkRemoveRunList.length }
							</strong>{ ' ' }
							slot–date cell(s) that matched your blocks.{ ' ' }
							Ticketed cells remain and are counted as skips (no hard stop).
						</DialogDescription>
					</DialogHeader>
					<div className="bg-destructive/[0.06] flex gap-3 rounded-lg border border-destructive/35 p-4 text-sm dark:bg-destructive/10">
						<TriangleAlert className="text-destructive size-5 shrink-0" aria-hidden />
						<p className="text-muted-foreground leading-relaxed">
							This cannot be undone from the POS. Double-check weekdays, merge window ({ ' ' }
							{ ! bulkRemoveEnvelope.invalid ? (
								<>
									<span className="font-mono text-foreground">{ bulkRemoveEnvelope.removeFrom }</span>
									{ ' → ' }
									<span className="font-mono text-foreground">{ bulkRemoveEnvelope.removeTo }</span>
								</>
							) : (
								'invalid'
							) }
							) and start times/weekdays before confirming.
						</p>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={ () => setBulkRemoveConfirmOpen( false ) }
							disabled={ bulkRemoving }
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={ () => void runBulkRemoveBlocks() }
							disabled={ bulkRemoving }
						>
							{ bulkRemoving ? 'Removing…' : 'Remove now' }
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={ bulkReduceConfirmOpen }
				onOpenChange={ ( open ) => {
					if ( ! bulkReducingStock ) {
						setBulkReduceConfirmOpen( open );
					}
				} }
			>
				<DialogContent showCloseButton={ ! bulkReducingStock }>
					<DialogHeader>
						<DialogTitle>Reduce spots on matched sessions?</DialogTitle>
						<DialogDescription className="text-left">
							{ bulkReduceSubMode === 'targetTotal' ? (
								<>
									Set total capacity toward{ ' ' }
									<strong className="text-foreground tabular-nums">
										{ Math.floor( bulkTargetTotalCapacity ) }
									</strong>
									{ ' ' }
									(booked + remaining) on{ ' ' }
									<strong className="text-foreground">{ bulkReduceRunList.length }</strong>
									{ ' ' }
									slot–date cell(s) by lowering <strong className="text-foreground">remaining</strong> spots
									only. Sold tickets are not changed.
								</>
							) : (
								<>
									Lower remaining capacity on{ ' ' }
									<strong className="text-foreground">{ bulkReduceRunList.length }</strong>
									{ ' ' }
									slot–date cell(s), up to{ ' ' }
									<strong className="text-foreground">{ bulkReduceSpotsPerCell }</strong>
									{ ' ' }
									spot(s) each (capped by remaining stock). Sold tickets are not changed.
								</>
							) }
						</DialogDescription>
					</DialogHeader>
					<div className="bg-muted/40 flex gap-3 rounded-lg border border-border p-4 text-sm">
						<CircleCheck className="text-muted-foreground size-5 shrink-0" aria-hidden />
						<p className="text-muted-foreground leading-relaxed">
							Planned total spots removed from remaining inventory:{ ' ' }
							<strong className="text-foreground tabular-nums">
								{ bulkReduceRunList.reduce( ( a, t ) => a + t.removeSpots, 0 ) }
							</strong>
							. Sessions stay on the schedule. If another user changes capacity while this runs, some
							updates may fail (reported in the summary).
						</p>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={ () => setBulkReduceConfirmOpen( false ) }
							disabled={ bulkReducingStock }
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={ () => void runBulkReduceStock() }
							disabled={ bulkReducingStock }
						>
							{ bulkReducingStock ? 'Saving…' : 'Reduce spots now' }
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

			<Dialog
				open={ mutationSuccessAck !== null }
				onOpenChange={ ( open ) => {
					if ( ! open ) {
						dismissMutationSuccessAck();
					}
				} }
			>
				<DialogContent showCloseButton={ false }>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<CircleCheck
								className="text-emerald-600 size-6 shrink-0 dark:text-emerald-400"
								aria-hidden
							/>
							{ mutationSuccessAck?.title ?? 'Success' }
						</DialogTitle>
						<DialogDescription className="text-left text-base">
							{ mutationSuccessAck?.description }
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button type="button" onClick={ dismissMutationSuccessAck }>
							OK
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

		</>
	);
}
