import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';

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

export function ScheduleBlockDatePicker( {
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
