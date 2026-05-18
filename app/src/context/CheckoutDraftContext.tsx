import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from 'react';

type CheckoutDraftValue = {
	first: string;
	last: string;
	email: string;
	postalCode: string;
	setFirst: ( value: string ) => void;
	setLast: ( value: string ) => void;
	setEmail: ( value: string ) => void;
	setPostalCode: ( value: string ) => void;
	resetAttendeeDraft: () => void;
};

const CheckoutDraftContext = createContext<CheckoutDraftValue | null>( null );

export function CheckoutDraftProvider( { children }: { children: ReactNode } ) {
	const [ first, setFirst ] = useState( '' );
	const [ last, setLast ] = useState( '' );
	const [ email, setEmail ] = useState( '' );
	const [ postalCode, setPostalCode ] = useState( '' );

	const resetAttendeeDraft = useCallback( () => {
		setFirst( '' );
		setLast( '' );
		setEmail( '' );
		setPostalCode( '' );
	}, [] );

	const value = useMemo(
		() =>
			( {
				first,
				last,
				email,
				postalCode,
				setFirst,
				setLast,
				setEmail,
				setPostalCode,
				resetAttendeeDraft,
			} ),
		[ first, last, email, postalCode, resetAttendeeDraft ],
	);

	return (
		<CheckoutDraftContext.Provider value={ value }>{ children }</CheckoutDraftContext.Provider>
	);
}

export function useCheckoutDraft() {
	const ctx = useContext( CheckoutDraftContext );
	if ( ! ctx ) {
		throw new Error( 'useCheckoutDraft must be used within CheckoutDraftProvider' );
	}
	return ctx;
}
