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
