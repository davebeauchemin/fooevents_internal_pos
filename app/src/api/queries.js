import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { restFetch } from './client.js';

const prefix = 'internalpos/v1';

/**
 * Mark event detail queries stale and refetch observers so Manage schedule / Event detail repaint immediately.
 *
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {number|string|undefined} eventId
 */
async function invalidateAndRefetchEvent( qc, eventId ) {
	if ( ! eventId ) {
		return;
	}
	const normalizedEventId = String( eventId ).trim();
	const eventDetailQuery = ( query ) =>
		query.queryKey?.[ 0 ] === 'internalpos'
		&& query.queryKey?.[ 1 ] === 'event'
		&& String( query.queryKey?.[ 2 ] ?? '' ).trim() === normalizedEventId;
	const validateEventQuery = ( query ) =>
		query.queryKey?.[ 0 ] === 'internalpos'
		&& query.queryKey?.[ 1 ] === 'validateEvent'
		&& String( query.queryKey?.[ 2 ] ?? '' ).trim() === normalizedEventId;

	await qc.invalidateQueries( { predicate: eventDetailQuery } );
	await qc.refetchQueries( { predicate: eventDetailQuery, type: 'active' } );
	await qc.invalidateQueries( { predicate: validateEventQuery } );
}

function sameId( a, b ) {
	return String( a ?? '' ).trim() === String( b ?? '' ).trim();
}

function removeSlotDateFromEventDetail( data, variables ) {
	if ( ! data || ! Array.isArray( data.dates ) || ! variables ) {
		return data;
	}
	const ymd = typeof variables.ymd === 'string' ? variables.ymd.trim() : '';
	let changed = false;
	const nextDates = data.dates
		.map( ( day ) => {
			if ( ! day || ! Array.isArray( day.slots ) ) {
				return day;
			}
			if ( ymd && String( day.date ?? '' ).trim() !== ymd ) {
				return day;
			}
			const nextSlots = day.slots.filter(
				( slot ) =>
					!(
						sameId( slot?.id, variables.slotId )
						&& sameId( slot?.dateId, variables.dateId )
					),
			);
			if ( nextSlots.length === day.slots.length ) {
				return day;
			}
			changed = true;
			return { ...day, slots: nextSlots };
		} )
		.filter( ( day ) => ! day || ! Array.isArray( day.slots ) || day.slots.length > 0 );

	return changed ? { ...data, dates: nextDates } : data;
}

function removeSlotDateFromDashboard( data, variables, eventId ) {
	if ( ! data || ! Array.isArray( data.events ) || ! variables ) {
		return data;
	}
	const ymd = typeof variables.ymd === 'string' ? variables.ymd.trim() : '';
	if ( ymd && String( data.date ?? '' ).trim() !== ymd ) {
		return data;
	}
	let changed = false;
	const nextEvents = data.events
		.map( ( ev ) => {
			if ( ! ev || ! Array.isArray( ev.slots ) || ! sameId( ev.eventId, eventId ) ) {
				return ev;
			}
			const nextSlots = ev.slots.filter(
				( slot ) =>
					!(
						sameId( slot?.id, variables.slotId )
						&& sameId( slot?.dateId, variables.dateId )
					),
			);
			if ( nextSlots.length === ev.slots.length ) {
				return ev;
			}
			changed = true;
			return { ...ev, slots: nextSlots };
		} )
		.filter( ( ev ) => ! ev || ! Array.isArray( ev.slots ) || ev.slots.length > 0 );

	return changed ? { ...data, events: nextEvents } : data;
}

export function useEvents() {
	return useQuery( {
		queryKey: [ 'internalpos', 'events' ],
		queryFn: () => restFetch( `${ prefix }/events` ),
	} );
}

/**
 * @param {number|string|undefined} id
 */
export function useEvent( id ) {
	return useQuery( {
		queryKey: [ 'internalpos', 'event', id ],
		enabled: Boolean( id ),
		queryFn: () => restFetch( `${ prefix }/events/${ id }` ),
	} );
}

/**
 * Event detail for ticket validation UI (validators may lack `manage_woocommerce`).
 *
 * @param {number|string|undefined} id Product id.
 * @param {{ enabled?: boolean }} options Optional query options.
 */
export function useValidateEvent( id, options = {} ) {
	const { enabled = true } = options;
	return useQuery( {
		queryKey: [ 'internalpos', 'validateEvent', id ],
		enabled: Boolean( id ) && enabled,
		queryFn: () => restFetch( `${ prefix }/validate/event/${ id }` ),
	} );
}

/**
 * Read-only day dashboard. Empty `ymd` lets WordPress use site-local today.
 *
 * @param {string} ymd - Y-m-d or ""
 */
export function useDashboard( ymd ) {
	const q = ymd && /^\d{4}-\d{2}-\d{2}$/.test( ymd ) ? `?date=${ encodeURIComponent( ymd ) }` : '';
	return useQuery( {
		queryKey: [ 'internalpos', 'dashboard', ymd || 'default' ],
		queryFn: () => restFetch( `${ prefix }/dashboard${ q }` ),
		placeholderData: keepPreviousData,
		refetchInterval: 30_000,
		refetchOnWindowFocus: true,
	} );
}

/** FooEvents POS–style payment methods (key/label) for the booking flow. */
export function usePaymentMethods() {
	return useQuery( {
		queryKey: [ 'internalpos', 'paymentMethods' ],
		queryFn: () => restFetch( `${ prefix }/payment-methods` ),
		staleTime: 5 * 60_000,
	} );
}

/**
 * Preview WooCommerce subtotal/taxes/total for booking lines (cart simulation only).
 *
 * @param {Array<{eventId:number,slotId:string,dateId:string,qty:number}>|null|undefined} lines
 * @param {string[]|undefined} couponCodes - Cashier coupon codes; auto-coupons are applied server-side via filter.
 * @param {string|undefined} billingEmail - Checkout email for WooCommerce email-restricted coupon validation.
 */
export function useCheckoutPreview( lines, couponCodes, billingEmail = '' ) {
	const codes = Array.isArray( couponCodes ) ? couponCodes : [];
	const email = typeof billingEmail === 'string' ? billingEmail.trim() : '';
	const key = lines?.length ? JSON.stringify( lines ) + '::' + JSON.stringify( codes ) + '::' + email : '';
	return useQuery( {
		queryKey: [ 'internalpos', 'checkoutPreview', key ],
		queryFn: ( { signal } ) =>
			restFetch( `${ prefix }/checkout/preview`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { lines, couponCodes: codes, billingEmail: email } ),
				signal,
			} ),
		enabled: Boolean( lines?.length ),
		placeholderData: keepPreviousData,
		staleTime: 0,
	} );
}

export function useCheckAvailability() {
	return useMutation( {
		mutationKey: [ 'internalpos', 'availability' ],
		mutationFn: ( body ) =>
			restFetch( `${ prefix }/availability`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
			} ),
	} );
}

/**
 * Replace all FooEvents booking slots for an event product (server writes post meta).
 *
 * @param {number|string|undefined} eventId
 */
export function useGenerateSlots( eventId ) {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'generateSlots', eventId ],
		mutationFn: ( body ) =>
			restFetch( `${ prefix }/events/${ eventId }/slots/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
			} ),
		onSuccess: async () => {
			await invalidateAndRefetchEvent( qc, eventId );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
		},
	} );
}

/**
 * Add one slot–date row without replacing FooEvents serialized options (slot-first and date-first booking).
 *
 * Body: `{ date: 'Y-m-d', time: 'HH:MM', capacity: number, label?: string }`
 *
 * @param {number|string|undefined} eventId
 */
export function useAddManualSlot( eventId ) {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'manualSlotAdd', eventId ],
		mutationFn: ( body ) =>
			restFetch( `${ prefix }/events/${ eventId }/slots/manual`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
			} ),
		onSuccess: async () => {
			await invalidateAndRefetchEvent( qc, eventId );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'checkoutPreview' ] } );
		},
	} );
}

/**
 * Add capacity to an existing slot–date cell (finite stock only).
 *
 * Body: `{ slotId, dateId, date: 'Y-m-d', addSpots: number }`
 *
 * @param {number|string|undefined} eventId
 */
export function useAddSlotStock( eventId ) {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'slotStockAdd', eventId ],
		mutationFn: ( body ) =>
			restFetch( `${ prefix }/events/${ eventId }/slots/stock`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
			} ),
		onSuccess: async () => {
			await invalidateAndRefetchEvent( qc, eventId );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'checkoutPreview' ] } );
		},
	} );
}

/**
 * Remove capacity (remaining spots) from an existing slot–date cell (finite stock only).
 *
 * Body: `{ slotId, dateId, date: 'Y-m-d', removeSpots: number }`
 *
 * @param {number|string|undefined} eventId
 */
export function useRemoveSlotStock( eventId ) {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'slotStockRemove', eventId ],
		mutationFn: ( body ) =>
			restFetch( `${ prefix }/events/${ eventId }/slots/stock`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
			} ),
		onSuccess: async () => {
			await invalidateAndRefetchEvent( qc, eventId );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'checkoutPreview' ] } );
		},
	} );
}

/**
 * Remove one slot–date row by internal ids (blocked if tickets exist server-side).
 * Pass `ymd` (Y-m-d calendar day) when the UI has it so dateslot rows resolve to raw meta reliably.
 *
 * @param {number|string|undefined} eventId
 */
export function useDeleteManualSlot( eventId ) {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'manualSlotDel', eventId ],
		mutationFn: ( { slotId, dateId, ymd } ) => {
			const base = `${ prefix }/events/${ eventId }/slots/${ encodeURIComponent(
				slotId,
			) }/dates/${ encodeURIComponent( dateId ) }`;
			const y =
				typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test( ymd.trim() )
					? ymd.trim()
					: '';
			const url = y ? `${ base }?ymd=${ encodeURIComponent( y ) }` : base;
			return restFetch( url, {
				method: 'DELETE',
			} );
		},
		onMutate: async ( variables ) => {
			const normalizedEventId = String( eventId ?? '' ).trim();
			const affectedQuery = ( query ) =>
				query.queryKey?.[ 0 ] === 'internalpos'
				&& (
					(
						query.queryKey?.[ 1 ] === 'event'
						&& String( query.queryKey?.[ 2 ] ?? '' ).trim() === normalizedEventId
					)
					|| (
						query.queryKey?.[ 1 ] === 'validateEvent'
						&& String( query.queryKey?.[ 2 ] ?? '' ).trim() === normalizedEventId
					)
					|| query.queryKey?.[ 1 ] === 'dashboard'
				);

			await qc.cancelQueries( { predicate: affectedQuery } );

			const snapshots = qc.getQueriesData( { predicate: affectedQuery } );
			for ( const [ queryKey, data ] of snapshots ) {
				if ( queryKey?.[ 1 ] === 'dashboard' ) {
					qc.setQueryData(
						queryKey,
						removeSlotDateFromDashboard( data, variables, eventId ),
					);
					continue;
				}
				qc.setQueryData(
					queryKey,
					removeSlotDateFromEventDetail( data, variables ),
				);
			}

			return { snapshots };
		},
		onError: ( _error, _variables, context ) => {
			if ( ! Array.isArray( context?.snapshots ) ) {
				return;
			}
			for ( const [ queryKey, data ] of context.snapshots ) {
				qc.setQueryData( queryKey, data );
			}
		},
		onSuccess: async () => {
			await invalidateAndRefetchEvent( qc, eventId );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'checkoutPreview' ] } );
		},
	} );
}

/**
 * Book FooEvents booking slot(s) (creates WC order + tickets).
 *
 * @param {object} body - Legacy single-slot or multi-line booking JSON; include `billing.postalCode` and optional `couponCodes` (string[]).
 */
export function useCreateBooking() {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'createBooking' ],
		mutationFn: ( body ) =>
			restFetch( `${ prefix }/bookings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
			} ),
		onSuccess: () => {
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'event' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'checkoutPreview' ] } );
		},
	} );
}

/**
 * Ticket validation: search by email, phone, or ticket id (min 3 chars).
 *
 * @param {string} q
 */
export function useTicketSearch( q ) {
	const trimmed = typeof q === 'string' ? q.trim() : '';
	return useQuery( {
		queryKey: [ 'internalpos', 'validateSearch', trimmed ],
		queryFn: () =>
			restFetch( `${ prefix }/validate/search?q=${ encodeURIComponent( trimmed ) }` ),
		enabled: trimmed.length >= 3,
		staleTime: 30_000,
	} );
}

/**
 * Full ticket payload via FooEvents `get_single_ticket`.
 *
 * @param {string|undefined|null} ticketId Scanner / lookup id (WooCommerceEventsTicketID or productId-formatted)
 */
export function useTicketDetail( ticketId ) {
	const id = typeof ticketId === 'string' ? ticketId.trim() : '';
	return useQuery( {
		queryKey: [ 'internalpos', 'validateTicket', id ],
		queryFn: () => restFetch( `${ prefix }/validate/ticket/${ encodeURIComponent( id ) }` ),
		enabled: id.length > 0,
	} );
}

/**
 * @returns {import('@tanstack/react-query').UseMutationResult<
 *   unknown,
 *   Error,
 *   { ticketId: string, status: string }
 * >}
 */
export function useUpdateTicketStatus() {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'validateTicketStatus' ],
		mutationFn: ( { ticketId, status } ) =>
			restFetch( `${ prefix }/validate/ticket/${ encodeURIComponent( ticketId ) }`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { status } ),
			} ),
		onSuccess: ( _data, variables ) => {
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'validateTicket', variables.ticketId ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'validateSearch' ] } );
		},
	} );
}

/**
 * Same-event booking reschedule (ticket CPT + inventory); body `{ eventId, slotId, dateId }`.
 *
 * @returns {import('@tanstack/react-query').UseMutationResult<
 *   unknown,
 *   Error,
 *   { ticketId: string, eventId: number, slotId: string, dateId: string }
 * >}
 */
export function useRescheduleTicket() {
	const qc = useQueryClient();
	return useMutation( {
		mutationKey: [ 'internalpos', 'rescheduleTicket' ],
		mutationFn: ( { ticketId, eventId, slotId, dateId } ) =>
			restFetch(
				`${ prefix }/validate/ticket/${ encodeURIComponent( ticketId ) }/reschedule`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { eventId, slotId, dateId } ),
				}
			),
		onSuccess: ( _data, variables ) => {
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'validateTicket', variables.ticketId ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'validateSearch' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'event' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'validateEvent', variables.eventId ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
		},
	} );
}
