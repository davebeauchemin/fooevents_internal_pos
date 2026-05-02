import {
	createContext,
	useContext,
	useMemo,
	type ReactNode,
} from 'react';
import { Navigate } from 'react-router-dom';

export type POSBootstrapUser = {
	name: string;
	email: string;
	avatarUrl: string;
};

export type POSAccessBootstrap = {
	canUsePos: boolean;
	canManageEvents: boolean;
	canValidateTickets: boolean;
	currentUser?: POSBootstrapUser | null;
	site?: { name: string };
	logoutUrl?: string;
	profileUrl?: string;
};

declare global {
	interface Window {
		FooEventsInternalPOS?: POSAccessBootstrap;
	}
}

/** Vite dev when WordPress does not inject bootstrap — full UI for local dev. */
function defaultDevAccess(): POSAccessBootstrap {
	return {
		canUsePos: true,
		canManageEvents: true,
		canValidateTickets: true,
		currentUser: {
			name: 'Dev User',
			email: 'dev@example.com',
			avatarUrl: '',
		},
		site: { name: 'Internal POS (dev)' },
		logoutUrl: '#',
		profileUrl: '#',
	};
}

function readBootstrap(): POSAccessBootstrap {
	if ( typeof window === 'undefined' ) {
		return defaultDevAccess();
	}
	const raw = window.FooEventsInternalPOS;
	if ( ! raw || typeof raw !== 'object' ) {
		if ( import.meta.env.DEV ) {
			return defaultDevAccess();
		}
		return {
			canUsePos: false,
			canManageEvents: false,
			canValidateTickets: false,
			currentUser: null,
			site: undefined,
			logoutUrl: undefined,
			profileUrl: undefined,
		};
	}
	const userRaw = ( raw as POSAccessBootstrap ).currentUser;
	const siteRaw = ( raw as POSAccessBootstrap ).site;
	return {
		canUsePos: Boolean( ( raw as POSAccessBootstrap ).canUsePos ),
		canManageEvents: Boolean( ( raw as POSAccessBootstrap ).canManageEvents ),
		canValidateTickets: Boolean( ( raw as POSAccessBootstrap ).canValidateTickets ),
		currentUser:
			userRaw && typeof userRaw === 'object'
				? {
						name: String( ( userRaw as POSBootstrapUser ).name ?? '' ),
						email: String( ( userRaw as POSBootstrapUser ).email ?? '' ),
						avatarUrl: String(
							( userRaw as POSBootstrapUser ).avatarUrl ?? ''
						),
					}
				: null,
		site:
			siteRaw && typeof siteRaw === 'object'
				? { name: String( siteRaw.name ?? '' ) }
				: undefined,
		logoutUrl: ( raw as POSAccessBootstrap ).logoutUrl,
		profileUrl: ( raw as POSAccessBootstrap ).profileUrl,
	};
}

type AuthContextValue = POSAccessBootstrap;

const AuthContext = createContext<AuthContextValue | null>( null );

export function AuthProvider( { children }: { children: ReactNode } ) {
	const value = useMemo( () => readBootstrap(), [] );
	return (
		<AuthContext.Provider value={ value }>{ children }</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext( AuthContext );
	if ( ! ctx ) {
		throw new Error( 'useAuth must be used within AuthProvider' );
	}
	return ctx;
}

/** Cashiers are redirected away from `/events`, `/event/:id`, `/event/:id/manage`. */
export function RequireManageEventsRoute( { children }: { children: ReactNode } ) {
	const { canManageEvents } = useAuth();
	if ( ! canManageEvents ) {
		return <Navigate to="/calendar" replace />;
	}
	return <>{ children }</>;
}

/** Requires FooEvents scanner role — `publish_event_magic_ticket`, `publish_event_magic_tickets`, or `app_event_magic_tickets`. */
export function RequireValidateTicketsRoute( { children }: { children: ReactNode } ) {
	const { canValidateTickets } = useAuth();
	if ( ! canValidateTickets ) {
		return <Navigate to="/calendar" replace />;
	}
	return <>{ children }</>;
}
