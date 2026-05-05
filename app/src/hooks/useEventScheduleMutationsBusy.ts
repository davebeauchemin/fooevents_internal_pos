import { useIsMutating } from '@tanstack/react-query';

const SLOT_MUT_KINDS = new Set<string>( [
	'generateSlots',
	'manualSlotAdd',
	'slotStockAdd',
] );

function mutationKeyMatchesEvent(
	mutation: {
		options: { mutationKey?: unknown };
	},
	eventIdRaw: string,
): boolean {
	const id = eventIdRaw.trim();
	if ( ! id ) {
		return false;
	}
	const key = mutation.options.mutationKey;
	if ( ! Array.isArray( key ) || key[ 0 ] !== 'internalpos' ) {
		return false;
	}
	const kind = key[ 1 ];
	if ( typeof kind !== 'string' || ! SLOT_MUT_KINDS.has( kind ) ) {
		return false;
	}
	return String( key[ 2 ] ?? '' ) === id;
}

/**
 * True while any blocking schedule/slot mutation is in flight for this event
 * (bulk generate/fill-empty, manual single session, ticket-spot additions from dialogs or grid).
 */
export function useEventScheduleMutationsBusy( eventId: string ): boolean {
	const count = useIsMutating( {
		predicate: ( m ) => mutationKeyMatchesEvent( m, eventId ),
	} );
	return count > 0;
}
