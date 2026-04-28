import { useState } from 'react';
import { useCheckAvailability } from '../api/queries.js';

/**
 * @param {object} props
 * @param {object} props.detail Event detail from API
 */
export default function DateSlotPicker( { detail } ) {
	const [ result, setResult ] = useState( null );
	const mutation = useCheckAvailability();
	const { bookingMethod, dates, labels, id: eventId } = detail;
	const isDateSlot = bookingMethod === 'dateslot';

	if ( ! dates?.length ) {
		return <p className="text-slate-500">No upcoming dates for this event.</p>;
	}

	return (
		<div className="space-y-4">
			{ dates.map( ( day ) => (
				<section
					key={ `${ day.date }-${ day.id }` }
					className="rounded-lg border border-slate-200 bg-white p-4"
				>
					<div className="mb-2 flex items-baseline justify-between gap-2">
						<h3 className="font-medium text-slate-900">
							{ day.label } <span className="text-sm font-normal text-slate-500">({ day.date })</span>
						</h3>
						<span className="text-xs text-slate-500">
							{ labels?.date } / { labels?.slot }
						</span>
					</div>
					<ul className="space-y-2">
						{ ( day.slots || [] ).map( ( slot ) => (
							<li
								key={ slot.id + String( slot.dateId || '' ) }
								className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 first:border-0 first:pt-0"
							>
								<div>
									{ slot.time ? (
										<p className="text-slate-800">
											<span className="font-semibold tabular-nums">{ slot.time }</span>
											{ slot.label && String( slot.label ).trim() !== String( slot.time ).trim() ? (
												<span className="text-slate-600">{ ' \u00b7 ' }{ slot.label }</span>
											) : null }
										</p>
									) : (
										<p className="text-slate-800">{ slot.label }</p>
									) }
									<p className="text-xs text-slate-500">
										{ slot.stock === null || slot.stock === undefined
											? 'Unlimited'
											: `Stock: ${ slot.stock }` }
									</p>
								</div>
								<button
									type="button"
									className="rounded-md bg-fuchsia-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-fuchsia-800 disabled:opacity-50"
									disabled={ mutation.isPending }
									onClick={ () => {
										setResult( null );
										const body = { eventId, slotId: slot.id, dateId: isDateSlot ? day.id : ( slot.dateId || day.id ), qty: 1 };
										mutation.mutate( body, {
											onSuccess: ( r ) => setResult( r ),
											onError: ( e ) => setResult( { error: e.message } ),
										} );
									} }
								>
									Check slot
								</button>
							</li>
						) ) }
					</ul>
				</section>
			) ) }
			{ result && (
				<div
					className={ `rounded-md p-3 text-sm ${ result.error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900' }` }
				>
					{ result.error ? result.error : JSON.stringify( result, null, 2 ) }
				</div>
			) }
		</div>
	);
}
