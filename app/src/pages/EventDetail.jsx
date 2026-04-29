import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import EventSlotOverview from '@/components/EventSlotOverview';
import { useEvent } from '../api/queries.js';

export default function EventDetail() {
	const { id } = useParams();
	const { data, isLoading, isError, error } = useEvent( id );

	if ( isLoading ) {
		return <p className="text-muted-foreground">Loading event…</p>;
	}
	if ( isError ) {
		return (
			<div className="space-y-2">
				<Link to="/events" className="text-primary hover:underline">← Back</Link>
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					{ String( error?.message || error || 'Error' ) }
				</div>
			</div>
		);
	}
	if ( ! data ) {
		return (
			<div>
				<Link to="/events" className="text-primary hover:underline">← Back</Link>
				<p className="text-muted-foreground mt-2">Event not found.</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<Button variant="outline" asChild className="w-fit">
					<Link to="/events">Back to events</Link>
				</Button>
			</div>
			<div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
				<h1 className="text-2xl font-bold tracking-tight">{ data.title }</h1>
				<div className="flex flex-wrap items-center gap-2">
					<span className="bg-muted rounded px-2 py-0.5 font-mono text-xs">
						{ data.bookingMethod }
					</span>
					<Button variant="secondary" asChild>
						<Link to={ `/event/${ id }/manage` }>Manage schedule</Link>
					</Button>
				</div>
			</div>
			<p className="text-muted-foreground text-sm">
				Review upcoming dates and slot availability for this event. Book tickets from Calendar (checkout in cart).
			</p>
			<EventSlotOverview detail={ data } />
		</div>
	);
}
