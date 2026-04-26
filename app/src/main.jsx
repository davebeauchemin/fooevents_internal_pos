import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

const queryClient = new QueryClient( {
	defaultOptions: {
		queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
	},
} );

function getBasename() {
	if ( typeof localStorage === 'undefined' ) {
		return import.meta.env.VITE_APP_BASENAME || '/';
	}
	const raw = localStorage.getItem( 'INTERNAL_POS_BASENAME' ) || '/internal-pos';
	// React Router: leading slash, no trailing slash.
	return raw === '/' ? '/' : raw.replace( /\/$/, '' );
}

const root = document.getElementById( 'root' );
if ( root ) {
	createRoot( root ).render(
		<StrictMode>
			<QueryClientProvider client={ queryClient }>
				<BrowserRouter basename={ getBasename() }>
					<App />
				</BrowserRouter>
			</QueryClientProvider>
		</StrictMode>
	);
}
