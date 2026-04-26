import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/queries.js';
import DateSlotPicker from '../components/DateSlotPicker.jsx';

export default function EventDetail() {
	const { id } = useParams();
	const { data, isLoading, isError, error } = useEvent( id );

	if ( isLoading ) {
		return <p className="text-slate-500">Loading event…</p>;
	}
	if ( isError ) {
		return (
			<div className="space-y-2">
				<Link to="/" className="text-fuchsia-700 hover:underline">← Back</Link>
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
					{ String( error?.message || error || 'Error' ) }
				</div>
			</div>
		);
	}
	if ( ! data ) {
		return (
			<div>
				<Link to="/" className="text-fuchsia-700 hover:underline">← Back</Link>
				<p className="mt-2 text-slate-600">Event not found.</p>
			</div>
		);
	}

	return (
		<div>
			<Link to="/" className="text-fuchsia-700 hover:underline">← Event list</Link>
			<div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
				<h1 className="text-2xl font-bold text-slate-900">{ data.title }</h1>
				<span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-mono text-slate-700">
					{ data.bookingMethod }
				</span>
			</div>
			<p className="mb-4 mt-1 text-sm text-slate-500">Read-only · upcoming dates only</p>
			<DateSlotPicker detail={ data } />
		</div>
	);
}
