import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles.css';

/**
 * One-time upgrade: old hash-based URLs → path-based (/internal-pos/#/calendar → /internal-pos/calendar).
 */
function migrateLegacyHashToPath() {
	if ( typeof window === 'undefined' || import.meta.env.DEV ) {
		return;
	}
	const rawHash = window.location.hash;
	if ( ! rawHash || rawHash === '#' ) {
		return;
	}
	const pathname = window.location.pathname;
	const needle = '/internal-pos';
	const idx = pathname.indexOf( needle );
	if ( idx === -1 ) {
		return;
	}
	let inner = rawHash.replace( /^#/, '' ).replace( /^\//, '' );
	const hashQ = inner.indexOf( '?' );
	let searchFromHash = '';
	if ( hashQ !== -1 ) {
		searchFromHash = inner.slice( hashQ );
		inner = inner.slice( 0, hashQ );
	}
	if ( ! inner ) {
		return;
	}
	const basePrefix = pathname.slice( 0, idx + needle.length ).replace( /\/$/, '' );
	const mergedSearch = searchFromHash || window.location.search;
	window.history.replaceState( null, '', `${ basePrefix }/${ inner }${ mergedSearch }` );
}

migrateLegacyHashToPath();

const queryClient = new QueryClient( {
	defaultOptions: {
		queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
	},
} );

/**
 * BrowserRouter basename (e.g. /internal-pos, /blog/internal-pos). Never "/" in production.
 *
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

function getBasename() {
	if (
		import.meta.env.DEV
		&& import.meta.env.VITE_APP_BASENAME !== undefined
		&& import.meta.env.VITE_APP_BASENAME !== ''
	) {
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

const root = document.getElementById( 'root' );
if ( root ) {
	createRoot( root ).render(
		<StrictMode>
			<ThemeProvider attribute="class" defaultTheme="light" enableSystem={ false }>
				<TooltipProvider>
					<QueryClientProvider client={ queryClient }>
						<BrowserRouter basename={ getBasename() } future={ routerFuture }>
							<AuthProvider>
								<CartProvider>
									<App />
									<Toaster />
								</CartProvider>
							</AuthProvider>
						</BrowserRouter>
					</QueryClientProvider>
				</TooltipProvider>
			</ThemeProvider>
		</StrictMode>,
	);
}
