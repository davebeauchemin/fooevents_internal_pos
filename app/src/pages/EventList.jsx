import { Link } from 'react-router-dom';
import { useEvents } from '../api/queries.js';

export default function EventList() {
	const { data, isLoading, isError, error } = useEvents();

	if ( isLoading ) {
		return <p className="text-slate-500">Loading events…</p>;
	}
	if ( isError ) {
		return (
			<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
				{ String( error?.message || error || 'Error loading events' ) }
			</div>
		);
	}
	if ( ! data?.length ) {
		return (
			<p className="text-slate-600">
				No upcoming booking events. Create a FooEvents booking product with future dates, or
				adjust the site timezone.
			</p>
		);
	}

	return (
		<div>
			<h1 className="mb-4 text-2xl font-bold text-slate-900">Bookable events</h1>
			<ul className="grid gap-4 sm:grid-cols-2">
				{ data.map( ( ev ) => (
					<li key={ ev.id }>
						<Link
							to={ `/event/${ ev.id }` }
							className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-fuchsia-300 hover:shadow"
						>
							{ ev.image ? (
								<img
									src={ ev.image }
									alt=""
									className="h-20 w-20 flex-shrink-0 rounded-lg object-cover"
								/>
							) : (
								<div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
									#
								</div>
							) }
							<div className="min-w-0">
								<h2 className="font-semibold text-slate-900">{ ev.title }</h2>
								<p className="text-xs text-slate-500">
									{ ev.bookingMethod } · { ev.nextAvailable ? `Next: ${ ev.nextAvailable }` : '—' }
								</p>
							</div>
						</Link>
					</li>
				) ) }
			</ul>
		</div>
	);
}
