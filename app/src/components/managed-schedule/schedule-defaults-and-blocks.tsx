import {
	createScheduleBlockDraft,
	SESSION_OPTIONS,
	type ManageScheduleController,
	WD_LABELS,
} from '@/hooks/useManageSchedule';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { ScheduleBlockDatePicker } from '@/components/managed-schedule/schedule-block-datepicker';

type Props = {
	mgr: ManageScheduleController;
	/** Separate HTML ids when defaults/blocks render in multiple dialogs at once (e.g. `mgmt`, `repl`). */
	formIdPrefix: string;
	disableDefaultsWhileBusy?: boolean;
};

export function ScheduleDefaultsAndBlocksForm( {
	mgr,
	formIdPrefix,
	disableDefaultsWhileBusy = false,
}: Props ) {
	const {
		sessionMinutes,
		setSessionMinutes,
		capacity,
		setCapacity,
		blocks,
		setBlocks,
		updateBlock,
		toggleWeekday,
		gen,
		scheduleManualBusy,
	} = mgr;

	const busyInputs = disableDefaultsWhileBusy || gen.isPending || scheduleManualBusy;

	return (
		<>
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
								disabled={ busyInputs }
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
							<Label htmlFor={ `${ formIdPrefix }-capacity` }>Tickets per session</Label>
							<p className="text-muted-foreground text-xs">0 = unlimited</p>
							<Input
								id={ `${ formIdPrefix }-capacity` }
								type="number"
								min={ 0 }
								className="w-32"
								value={ capacity }
								onChange={ ( e ) =>
									setCapacity( parseInt( e.target.value, 10 ) || 0 )
								}
								disabled={ busyInputs }
							/>
						</div>
					</div>
					<p className="text-muted-foreground text-xs">
						Block <strong>schedule name</strong> is the FooEvents label prefix (e.g. Regular, Late).
						Leave empty to use time only.
					</p>
				</CardContent>
			</Card>

			<section
				aria-labelledby={ `${ formIdPrefix }-sched-blocks` }
				className="shrink-0 space-y-3"
			>
				<h2
					id={ `${ formIdPrefix }-sched-blocks` }
					className="text-base font-semibold tracking-tight"
				>
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
									disabled={ blocks.length <= 1 || busyInputs }
								>
									Remove block
								</Button>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor={ `${ b.id }-${ formIdPrefix }-name` }>Schedule name</Label>
									<Input
										id={ `${ b.id }-${ formIdPrefix }-name` }
										placeholder={ idx === 0 ? 'Regular' : 'Late' }
										value={ b.name }
										onChange={ ( e ) =>
											updateBlock( b.id, { name: e.target.value } )
										}
										className="max-w-md"
										autoComplete="off"
										disabled={ busyInputs }
									/>
								</div>
								<div className="flex flex-wrap gap-3">
									<ScheduleBlockDatePicker
										label="Start"
										ymd={ b.startDate }
										onSelectYmd={ ( next ) =>
											updateBlock( b.id, { startDate: next } )
										}
										triggerId={ `${ b.id }-${ formIdPrefix }-start` }
										disabled={ busyInputs }
									/>
									<ScheduleBlockDatePicker
										label="End"
										ymd={ b.endDate }
										onSelectYmd={ ( next ) =>
											updateBlock( b.id, { endDate: next } )
										}
										triggerId={ `${ b.id }-${ formIdPrefix }-end` }
										disabled={ busyInputs }
									/>
								</div>
								<div className="space-y-2">
									<Label>Weekdays</Label>
									<div className="flex flex-wrap gap-3">
										{ WD_LABELS.map( ( { n, short } ) => (
											<div key={ n } className="flex items-center space-x-2">
												<Checkbox
													id={ `${ b.id }-${ formIdPrefix }-wd-${ n }` }
													checked={ b.weekdays.includes( n ) }
													disabled={ busyInputs }
													onCheckedChange={ ( c ) =>
														toggleWeekday( b.id, n, c === true )
													}
												/>
												<Label
													htmlFor={ `${ b.id }-${ formIdPrefix }-wd-${ n }` }
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
											disabled={ busyInputs }
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
											disabled={ busyInputs }
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
						disabled={ busyInputs }
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
		</>
	);
}
