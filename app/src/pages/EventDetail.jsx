import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import EventDaySchedule from '@/components/EventDaySchedule';
import { useEvent } from '../api/queries.js';

export default function EventDetail() {
	const { id } = useParams();
	const { data, isLoading, isError, error } = useEvent( id );

	if ( isLoading ) {
		return <p className="text-slate-500">Loading event…</p>;
	}
	if ( isError ) {
		return (
			<div className="space-y-2">
				<Link to="/events" className="text-primary hover:underline">← Back</Link>
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
					{ String( error?.message || error || 'Error' ) }
				</div>
			</div>
		);
	}
	if ( ! data ) {
		return (
			<div>
				<Link to="/events" className="text-primary hover:underline">← Back</Link>
				<p className="mt-2 text-slate-600">Event not found.</p>
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
				<h1 className="text-2xl font-bold text-slate-900">{ data.title }</h1>
				<div className="flex flex-wrap items-center gap-2">
					<span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-mono text-slate-700">
						{ data.bookingMethod }
					</span>
					<Button variant="secondary" asChild>
						<Link to={ `/event/${ id }/manage` }>Manage schedule</Link>
					</Button>
				</div>
			</div>
			<p className="text-slate-500 text-sm">
				Pick a day, expand an hour, then add slots to your order or open checkout (WooCommerce order + FooEvents tickets).
			</p>
			<EventDaySchedule detail={ data } />
		</div>
	);
}
