import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Plus } from 'lucide-react';
import { encodeManualSlotDateRef } from '@/lib/slotHourGrouping';
import { cn } from '@/lib/utils';
import {
	createScheduleBlockDraft,
	SESSION_OPTIONS,
	type ManageScheduleController,
	WD_LABELS,
} from '@/hooks/useManageSchedule';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

function dateToLocalYmd( d: Date ): string {
	return (
		d.getFullYear()
		+ '-'
		+ String( d.getMonth() + 1 ).padStart( 2, '0' )
		+ '-'
		+ String( d.getDate() ).padStart( 2, '0' )
	);
}

/** Parse Y-m-d as local noon (stable for range iteration and DST). */
function parseLocalYmd( ymd: string ): Date | undefined {
	const m = ymd.trim().match( /^(\d{4})-(\d{2})-(\d{2})$/ );
	if ( ! m ) {
		return undefined;
	}
	return new Date(
		Number( m[ 1 ] ),
		Number( m[ 2 ] ) - 1,
		Number( m[ 3 ] ),
		12,
		0,
		0,
		0,
	);
}

function ScheduleBlockDatePicker( {
	label,
	ymd,
	onSelectYmd,
	triggerId,
	disabled = false,
	className,
	isDateDisabled,
}: {
	label: string;
	ymd: string;
	onSelectYmd: ( next: string ) => void;
	triggerId: string;
	disabled?: boolean;
	className?: string;
	isDateDisabled?: ( date: Date ) => boolean;
} ) {
	const [ open, setOpen ] = useState( false );
	const selectedDate =
		ymd && /^\d{4}-\d{2}-\d{2}$/.test( ymd.trim() )
			? parseLocalYmd( ymd.trim() )
			: undefined;
	return (
		<div className={ cn( 'space-y-2', className ) }>
			<Label htmlFor={ triggerId }>{ label }</Label>
			<Popover
				open={ disabled ? false : open }
				onOpenChange={ ( next ) => {
					if ( ! disabled ) {
						setOpen( next );
					}
				} }
			>
				<PopoverTrigger asChild>
					<Button
						id={ triggerId }
						type="button"
						variant="outline"
						disabled={ disabled }
						className={ cn(
							'w-full min-w-[11rem] justify-start text-left font-normal',
						) }
					>
						<CalendarIcon className="mr-2 size-4 shrink-0" aria-hidden />
						{ selectedDate ? format( selectedDate, 'PP' ) : 'Pick date…' }
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-auto p-0"
					align="start"
					onOpenAutoFocus={ ( e ) => e.preventDefault() }
				>
					<Calendar
						mode="single"
						selected={ selectedDate }
						defaultMonth={ selectedDate }
						disabled={ isDateDisabled }
						onSelect={ ( d ) => {
							if ( ! d || disabled ) {
								return;
							}
							if ( isDateDisabled?.( d ) ) {
								return;
							}
							onSelectYmd( dateToLocalYmd( d ) );
							setOpen( false );
						} }
						initialFocus
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}

type Props = {
	mgr: ManageScheduleController;
	sessionOpen: boolean;
	spotsOpen: boolean;
	scheduleOpen: boolean;
	onSessionOpenChange: ( open: boolean ) => void;
	onSpotsOpenChange: ( open: boolean ) => void;
	onScheduleOpenChange: ( open: boolean ) => void;
};

export function ManagedEventScheduleDialogs( {
	mgr,
	sessionOpen,
	spotsOpen,
	scheduleOpen,
	onSessionOpenChange,
	onSpotsOpenChange,
	onScheduleOpenChange,
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
		blocks,
		setBlocks,
		sessionMinutes,
		setSessionMinutes,
		capacity,
		setCapacity,
		fillFromYmd,
		setFillFromYmd,
		fillToYmd,
		setFillToYmd,
		fillConfirmOpen,
		setFillConfirmOpen,
		siteTodayYmd,
		siteTodayWeekday,
		fillPreview,
		fillRangeInvalid,
		fillRangeCalendarDisablePast,
		spotsEligibleSchedule,
		selectedSpotSchedule,
		scheduleManualBusy,
		manualDuplicateMessage,
		scheduleSlotPickerLabel,
		updateBlock,
		toggleWeekday,
		submitManualSlot,
		commitManualStockAdd,
		runFillEmpty,
		gen,
		manualAddWouldDuplicate,
		addManual,
		addStock,
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
				<DialogContent className="flex max-h-[90vh] max-w-lg flex-col sm:max-w-4xl">
					<DialogHeader className="shrink-0">
						<DialogTitle className="flex items-center gap-2">
							<Plus className="size-5 shrink-0" aria-hidden />
							Manage schedule
						</DialogTitle>
						<DialogDescription className="text-left leading-relaxed">
							Set defaults and schedule blocks, preview changes, then add missing sessions inside a date
							range (<strong className="text-foreground font-medium">fill empty</strong> — existing
							slots are kept). Admin destructive replace stays on this event page only for users with
							permission.
						</DialogDescription>
					</DialogHeader>
					<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 pb-4">
						<Card className="shrink-0">
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Defaults</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex flex-wrap items-end gap-4">
									<div className="space-y-2">
										<Label>Session length</Label>
										<Select
											value={ String( sessionMinutes ) }
											onValueChange={ ( v ) => setSessionMinutes( parseInt( v, 10 ) ) }
										>
											<SelectTrigger className="w-[180px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{ SESSION_OPTIONS.map( ( n ) => (
													<SelectItem key={ n } value={ String( n ) }>
														{ n } min
													</SelectItem>
												) ) }
											</SelectContent>
										</Select>
									</div>
									<div className="space-y-2">
										<Label htmlFor="dlg-capacity">Capacity</Label>
										<p className="text-muted-foreground text-xs">0 = unlimited</p>
										<Input
											id="dlg-capacity"
											type="number"
											min={ 0 }
											className="w-32"
											value={ capacity }
											onChange={ ( e ) =>
												setCapacity( parseInt( e.target.value, 10 ) || 0 )
											}
										/>
									</div>
								</div>
								<p className="text-muted-foreground text-xs">
									Block <strong>schedule name</strong> is the FooEvents label prefix (e.g. Regular,
									Late). Leave empty to use time only.
								</p>
							</CardContent>
						</Card>

						<section aria-labelledby="dlg-sched-blocks" className="shrink-0 space-y-3">
							<h2 id="dlg-sched-blocks" className="text-base font-semibold tracking-tight">
								Schedule blocks
							</h2>
							<p className="text-muted-foreground text-sm">
								Start/end narrow which calendar days apply; weekdays filter which days in that span get
								sessions; open/close set generated times for those days.
							</p>
							<div className="space-y-4">
								{ blocks.map( ( b, idx ) => (
									<Card key={ b.id }>
										<CardHeader className="flex flex-row items-center justify-between space-y-0">
											<CardTitle className="text-base">Block { idx + 1 }</CardTitle>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={ () =>
													setBlocks( ( prev ) => prev.filter( ( x ) => x.id !== b.id ) )
												}
												disabled={ blocks.length <= 1 }
											>
												Remove block
											</Button>
										</CardHeader>
										<CardContent className="space-y-4">
											<div className="space-y-2">
												<Label htmlFor={ `${ b.id }-dlg-name` }>Schedule name</Label>
												<Input
													id={ `${ b.id }-dlg-name` }
													placeholder={ idx === 0 ? 'Regular' : 'Late' }
													value={ b.name }
													onChange={ ( e ) =>
														updateBlock( b.id, { name: e.target.value } )
													}
													className="max-w-md"
													autoComplete="off"
												/>
											</div>
											<div className="flex flex-wrap gap-3">
												<ScheduleBlockDatePicker
													label="Start"
													ymd={ b.startDate }
													onSelectYmd={ ( next ) =>
														updateBlock( b.id, { startDate: next } )
													}
													triggerId={ `${ b.id }-dlg-start` }
												/>
												<ScheduleBlockDatePicker
													label="End"
													ymd={ b.endDate }
													onSelectYmd={ ( next ) =>
														updateBlock( b.id, { endDate: next } )
													}
													triggerId={ `${ b.id }-dlg-end` }
												/>
											</div>
											<div className="space-y-2">
												<Label>Weekdays</Label>
												<div className="flex flex-wrap gap-3">
													{ WD_LABELS.map( ( { n, short } ) => (
														<div key={ n } className="flex items-center space-x-2">
															<Checkbox
																id={ `${ b.id }-dlg-wd-${ n }` }
																checked={ b.weekdays.includes( n ) }
																onCheckedChange={ ( c ) =>
																	toggleWeekday( b.id, n, c === true )
																}
															/>
															<Label
																htmlFor={ `${ b.id }-dlg-wd-${ n }` }
																className="text-sm font-normal"
															>
																{ short }
															</Label>
														</div>
													) ) }
												</div>
											</div>
											<div className="flex flex-wrap gap-3">
												<div className="space-y-2">
													<Label>Open</Label>
													<Input
														type="time"
														value={ b.openTime }
														onChange={ ( e ) =>
															updateBlock( b.id, { openTime: e.target.value } )
														}
													/>
												</div>
												<div className="space-y-2">
													<Label>Close</Label>
													<Input
														type="time"
														value={ b.closeTime }
														onChange={ ( e ) =>
															updateBlock( b.id, { closeTime: e.target.value } )
														}
													/>
												</div>
											</div>
										</CardContent>
									</Card>
								) ) }
								<Button
									type="button"
									variant="secondary"
									onClick={ () =>
										setBlocks( ( prev ) => [
											...prev,
											createScheduleBlockDraft( prev.length ),
										] )
									}
								>
									+ Add schedule block
								</Button>
							</div>
						</section>

						<section
							aria-labelledby="dlg-fill-empty"
							className="border-border bg-muted/25 space-y-4 rounded-lg border p-4 sm:p-5"
						>
							<div className="space-y-2">
								<h2 id="dlg-fill-empty" className="text-lg font-semibold tracking-tight">
									Add missing sessions
								</h2>
								<p className="text-muted-foreground text-sm leading-relaxed">
									Fill-from / fill-to merges each block into the range without removing existing slots.
								</p>
								<p className="text-muted-foreground text-xs leading-snug">
									Site calendar today:{ ' ' }
									<span className="font-mono text-foreground">{ siteTodayYmd }</span>
									{ siteTodayWeekday ? ` · ${ siteTodayWeekday }` : '' }
								</p>
							</div>
							<div className="flex flex-wrap gap-3">
								<ScheduleBlockDatePicker
									label="Fill from"
									ymd={ fillFromYmd }
									onSelectYmd={ setFillFromYmd }
									triggerId="dlg-fill-from"
									disabled={ gen.isPending }
									isDateDisabled={ fillRangeCalendarDisablePast }
								/>
								<ScheduleBlockDatePicker
									label="Fill to"
									ymd={ fillToYmd }
									onSelectYmd={ setFillToYmd }
									triggerId="dlg-fill-to"
									disabled={ gen.isPending }
									isDateDisabled={ fillRangeCalendarDisablePast }
								/>
							</div>
							{ fillRangeInvalid ? (
								<p className="text-destructive text-sm">
									Choose valid Y-m-d dates with &quot;from&quot; on or before &quot;to&quot;.
								</p>
							) : null }
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
									|| fillRangeInvalid
								}
								onClick={ () => setFillConfirmOpen( true ) }
							>
								{ gen.isPending ? 'Saving…' : 'Add missing sessions…' }
							</Button>
						</section>

						<Separator className="shrink-0" />
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={ fillConfirmOpen } onOpenChange={ setFillConfirmOpen }>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add missing sessions?</DialogTitle>
						<DialogDescription>
							This <strong>keeps</strong> all existing slots and adds up to about{ ' ' }
							<strong>{ fillPreview.totalEntries }</strong> new slot–date cell(s) between{ ' ' }
							<span className="font-mono text-foreground">{ fillFromYmd.trim() }</span> and{ ' ' }
							<span className="font-mono text-foreground">{ fillToYmd.trim() }</span>. Duplicate times on
							a day are skipped.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={ () => setFillConfirmOpen( false ) }
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={ runFillEmpty }
							disabled={
								gen.isPending || fillPreview.totalEntries === 0 || fillRangeInvalid
							}
						>
							{ gen.isPending ? 'Saving…' : 'Add sessions' }
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
