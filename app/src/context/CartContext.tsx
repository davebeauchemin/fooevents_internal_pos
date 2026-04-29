import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import type { POSSelection } from '@/types/posSelection';

const STORAGE_KEY = 'fooevents-internal-pos-cart-v1';

export type CartLine = POSSelection & {
	qty: number;
};

export function cartLineKey( line: Pick<POSSelection, 'eventId' | 'slotId' | 'dateId' | 'viewDateYmd' > ) {
	return `${ line.eventId }|${ line.slotId }|${ line.dateId }|${ line.viewDateYmd }`;
}

function loadInitial(): CartLine[] {
	try {
		const raw = localStorage.getItem( STORAGE_KEY );
		if ( ! raw ) {
			return [];
		}
		const parsed = JSON.parse( raw ) as unknown;
		if ( ! Array.isArray( parsed ) ) {
			return [];
		}
		return parsed.filter( ( row ) => row && typeof row === 'object' && 'eventId' in row ) as CartLine[];
	} catch {
		return [];
	}
}

function persist( items: CartLine[] ) {
	try {
		localStorage.setItem( STORAGE_KEY, JSON.stringify( items ) );
	} catch {
		// ignore quota / private mode
	}
}

type CartContextValue = {
	items: CartLine[];
	lineCount: number;
	totalQty: number;
	addOrMergeLine: ( line: CartLine ) => void;
	getLine: ( sel: Pick<POSSelection, 'eventId' | 'slotId' | 'dateId' | 'viewDateYmd' > ) => CartLine | undefined;
	hasLine: ( sel: Pick<POSSelection, 'eventId' | 'slotId' | 'dateId' | 'viewDateYmd' > ) => boolean;
	toggleLine: ( line: POSSelection, qty?: number ) => void;
	updateQty: ( key: string, qty: number ) => void;
	removeLine: ( key: string ) => void;
	clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>( null );

function clampQty( line: CartLine, qty: number ) {
	const cap =
		line.remaining === null || line.remaining === undefined
			? 20
			: Math.min( 20, Math.max( 1, line.remaining ) );
	return Math.max( 1, Math.min( cap, qty ) );
}

export function CartProvider( { children }: { children: ReactNode } ) {
	const [ items, setItems ] = useState<CartLine[]>( loadInitial );

	const setItemsPersist = useCallback( ( next: CartLine[] | ( ( prev: CartLine[] ) => CartLine[] ) ) => {
		setItems( ( prev ) => {
			const resolved = typeof next === 'function' ? next( prev ) : next;
			persist( resolved );
			return resolved;
		} );
	}, [] );

	const addOrMergeLine = useCallback( ( line: CartLine ) => {
		const key = cartLineKey( line );
		const q = clampQty( line, line.qty );
		setItemsPersist( ( prev ) => {
			const idx = prev.findIndex( ( p ) => cartLineKey( p ) === key );
			if ( idx === -1 ) {
				return [ ...prev, { ...line, qty: q } ];
			}
			const merged = { ...prev[ idx ], ...line, qty: clampQty( line, prev[ idx ].qty + q ) };
			const copy = [ ...prev ];
			copy[ idx ] = merged;
			return copy;
		} );
	}, [ setItemsPersist ] );

	const updateQty = useCallback(
		( key: string, qty: number ) => {
			setItemsPersist( ( prev ) => {
				const idx = prev.findIndex( ( p ) => cartLineKey( p ) === key );
				if ( idx === -1 ) {
					return prev;
				}
				const line = prev[ idx ];
				if ( qty < 1 ) {
					return prev.filter( ( _, i ) => i !== idx );
				}
				const nextQty = clampQty( line, qty );
				const copy = [ ...prev ];
				copy[ idx ] = { ...line, qty: nextQty };
				return copy;
			} );
		},
		[ setItemsPersist ],
	);

	const removeLine = useCallback(
		( key: string ) => {
			setItemsPersist( ( prev ) => prev.filter( ( p ) => cartLineKey( p ) !== key ) );
		},
		[ setItemsPersist ],
	);

	const clearCart = useCallback( () => {
		setItemsPersist( [] );
	}, [ setItemsPersist ] );

	const getLine = useCallback(
		( sel: Pick<POSSelection, 'eventId' | 'slotId' | 'dateId' | 'viewDateYmd' > ) => {
			const key = cartLineKey( sel );
			return items.find( ( p ) => cartLineKey( p ) === key );
		},
		[ items ],
	);

	const hasLine = useCallback(
		( sel: Pick<POSSelection, 'eventId' | 'slotId' | 'dateId' | 'viewDateYmd' > ) => {
			const key = cartLineKey( sel );
			return items.some( ( p ) => cartLineKey( p ) === key );
		},
		[ items ],
	);

	const toggleLine = useCallback(
		( line: POSSelection, qty?: number ) => {
			const key = cartLineKey( line );
			setItemsPersist( ( prev ) => {
				const idx = prev.findIndex( ( p ) => cartLineKey( p ) === key );
				if ( idx !== -1 ) {
					return prev.filter( ( _, i ) => i !== idx );
				}
				const want = qty ?? 1;
				const draft: CartLine = { ...line, qty: want };
				const q = clampQty( draft, want );
				return [ ...prev, { ...draft, qty: q } ];
			} );
		},
		[ setItemsPersist ],
	);

	const lineCount = items.length;
	const totalQty = useMemo( () => items.reduce( ( acc, x ) => acc + x.qty, 0 ), [ items ] );

	const value = useMemo(
		() => ( {
			items,
			lineCount,
			totalQty,
			addOrMergeLine,
			getLine,
			hasLine,
			toggleLine,
			updateQty,
			removeLine,
			clearCart,
		} ),
		[ items, lineCount, totalQty, addOrMergeLine, getLine, hasLine, toggleLine, updateQty, removeLine, clearCart ],
	);

	return <CartContext.Provider value={ value }>{ children }</CartContext.Provider>;
}

export function useCart() {
	const ctx = useContext( CartContext );
	if ( ! ctx ) {
		throw new Error( 'useCart must be used within CartProvider' );
	}
	return ctx;
}
