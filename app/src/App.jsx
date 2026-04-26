import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import EventList from './pages/EventList.jsx';
import EventDetail from './pages/EventDetail.jsx';

export default function App() {
	return (
		<div className="fooevents-internal-pos-app">
			<header className="border-b border-slate-200 bg-white shadow-sm">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
					<NavLink
						end
						to="/"
						className={ ( { isActive } ) =>
							`text-lg font-semibold ${ isActive ? 'text-fuchsia-700' : 'text-slate-700' }`
						}
					>
						Internal POS
					</NavLink>
					<NavLink
						to="/"
						className="text-sm text-slate-500 hover:text-slate-800"
					>
						Events
					</NavLink>
				</div>
			</header>
			<main className="mx-auto max-w-5xl p-4">
				<Routes>
					<Route path="/" element={ <EventList /> } />
					<Route path="/event/:id" element={ <EventDetail /> } />
					<Route path="*" element={ <Navigate to="/" replace /> } />
				</Routes>
			</main>
		</div>
	);
}
