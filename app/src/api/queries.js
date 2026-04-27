import { useQuery, useMutation } from '@tanstack/react-query';
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
 * Read-only day dashboard. Empty `ymd` lets WordPress use site-local today.
 *
 * @param {string} ymd - Y-m-d or ""
 */
export function useDashboard( ymd ) {
	const q = ymd && /^\d{4}-\d{2}-\d{2}$/.test( ymd ) ? `?date=${ encodeURIComponent( ymd ) }` : '';
	return useQuery( {
		queryKey: [ 'internalpos', 'dashboard', ymd || 'default' ],
		queryFn: () => restFetch( `${ prefix }/dashboard${ q }` ),
		refetchInterval: 30_000,
		refetchOnWindowFocus: true,
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
