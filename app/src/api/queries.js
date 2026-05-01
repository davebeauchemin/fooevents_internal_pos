import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { restFetch } from './client.js';

const prefix = 'internalpos/v1';

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
 */
export function useCheckoutPreview( lines, couponCodes ) {
	const codes = Array.isArray( couponCodes ) ? couponCodes : [];
	const key = lines?.length ? JSON.stringify( lines ) + '::' + JSON.stringify( codes ) : '';
	return useQuery( {
		queryKey: [ 'internalpos', 'checkoutPreview', key ],
		queryFn: ( { signal } ) =>
			restFetch( `${ prefix }/checkout/preview`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { lines, couponCodes: codes } ),
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
		onSuccess: () => {
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'event', eventId ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'dashboard' ] } );
			qc.invalidateQueries( { queryKey: [ 'internalpos', 'events' ] } );
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
