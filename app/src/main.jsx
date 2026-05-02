import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles.css';

/**
 * WordPress production: keep the real URL on /internal-pos/ (FooEvents POS keeps /sale/ the same way).
 * Path-based client routes were rewriting the browser to /. Use hash routes so only the fragment changes.
 *
 * @see plugins/fooevents_pos/public/class-fooeventspos-public.php fooeventspos_rewrite()
 */
function migrateLegacyInternalPosPathToHash() {
	if ( typeof window === 'undefined' || import.meta.env.DEV ) {
		return;
	}
	const pathname = window.location.pathname;
	const needle = '/internal-pos';
	const idx = pathname.indexOf( needle );
	if ( idx === -1 ) {
		return;
	}
	const after = pathname.slice( idx + needle.length ).replace( /^\/+|\/+$/g, '' );
	const segments = after ? after.split( '/' ).filter( Boolean ) : [];
	const existingHash = window.location.hash.replace( /^#\/?/, '' );
	if ( ! segments.length || existingHash ) {
		return;
	}
	const baseWithSlash = pathname.slice( 0, idx + needle.length ).replace( /\/?$/, '' ) + '/';
	const hashPath = '/' + segments.join( '/' );
	window.history.replaceState(
		null,
		'',
		`${ baseWithSlash }#${ hashPath }${ window.location.search }`
	);
}

migrateLegacyInternalPosPathToHash();

const queryClient = new QueryClient( {
	defaultOptions: {
		queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
	},
} );

/**
 * Basename from the loaded URL (e.g. /internal-pos, /blog/internal-pos). Dev / BrowserRouter only.
 * @param {string} pathname window.location.pathname
 * @returns {string|null}
 */
function basenameFromPathname( pathname ) {
	const needle = '/internal-pos';
	const i = pathname.indexOf( needle );
	if ( i === -1 ) {
		return null;
	}
	return pathname.slice( 0, i + needle.length );
}

function getDevBasename() {
	if ( import.meta.env.VITE_APP_BASENAME !== undefined && import.meta.env.VITE_APP_BASENAME !== '' ) {
		const b = import.meta.env.VITE_APP_BASENAME;
		return b === '/' ? '/' : String( b ).replace( /\/$/, '' );
	}
	const fromUrl =
		typeof window !== 'undefined' ? basenameFromPathname( window.location.pathname ) : null;
	let raw =
		typeof localStorage !== 'undefined'
			? localStorage.getItem( 'INTERNAL_POS_BASENAME' )
			: null;
	if ( fromUrl && ( ! raw || raw === '/' || raw !== fromUrl ) ) {
		raw = fromUrl;
		if ( typeof localStorage !== 'undefined' ) {
			localStorage.setItem( 'INTERNAL_POS_BASENAME', fromUrl );
		}
	}
	if ( ! raw || raw === '/' ) {
		raw = '/internal-pos';
	}
	return raw.replace( /\/$/, '' );
}

const routerFuture = {
	v7_startTransition: true,
	v7_relativeSplatPath: true,
};

function PosRouter( { children } ) {
	if ( import.meta.env.DEV ) {
		return (
			<BrowserRouter basename={ getDevBasename() } future={ routerFuture }>
				{ children }
			</BrowserRouter>
		);
	}
	return <HashRouter future={ routerFuture }>{ children }</HashRouter>;
}

const root = document.getElementById( 'root' );
if ( root ) {
	createRoot( root ).render(
		<StrictMode>
			<ThemeProvider attribute="class" defaultTheme="light" enableSystem={ false }>
				<TooltipProvider>
					<QueryClientProvider client={ queryClient }>
						<PosRouter>
							<AuthProvider>
								<CartProvider>
									<App />
									<Toaster />
								</CartProvider>
							</AuthProvider>
						</PosRouter>
					</QueryClientProvider>
				</TooltipProvider>
			</ThemeProvider>
		</StrictMode>,
	);
}
