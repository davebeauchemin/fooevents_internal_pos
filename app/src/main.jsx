import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { CartProvider } from '@/context/CartContext';
import { Toaster } from '@/components/ui/sonner';
import './styles.css';

const queryClient = new QueryClient( {
	defaultOptions: {
		queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
	},
} );

function getBasename() {
	// Dev: VITE_APP_BASENAME in .env.local (e.g. /) so Router matches Vite at /
	if ( import.meta.env.VITE_APP_BASENAME !== undefined && import.meta.env.VITE_APP_BASENAME !== '' ) {
		const b = import.meta.env.VITE_APP_BASENAME;
		return b === '/' ? '/' : String( b ).replace( /\/$/, '' );
	}
	if ( typeof localStorage === 'undefined' ) {
		return '/internal-pos';
	}
	const raw = localStorage.getItem( 'INTERNAL_POS_BASENAME' ) || '/internal-pos';
	// React Router: leading slash, no trailing slash.
	return raw === '/' ? '/' : raw.replace( /\/$/, '' );
}

const root = document.getElementById( 'root' );
if ( root ) {
	createRoot( root ).render(
		<StrictMode>
			<ThemeProvider attribute="class" defaultTheme="light" enableSystem={ false }>
				<QueryClientProvider client={ queryClient }>
					<BrowserRouter basename={ getBasename() }>
						<CartProvider>
							<App />
							<Toaster />
						</CartProvider>
					</BrowserRouter>
				</QueryClientProvider>
			</ThemeProvider>
		</StrictMode>
	);
}
