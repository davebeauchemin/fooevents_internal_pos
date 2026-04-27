import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Dashboard from './pages/Dashboard';
import EventDetail from './pages/EventDetail.jsx';
import EventList from './pages/EventList.jsx';

export default function App() {
	return (
		<div className="fooevents-internal-pos-app">
			<header className="bg-background/80 border-b shadow-sm backdrop-blur">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
					<NavLink
						end
						to="/"
						className={ ( { isActive } ) =>
							`text-lg font-semibold ${ isActive ? 'text-primary' : 'text-foreground' }`
						}
					>
						Internal POS
					</NavLink>
					<nav className="flex items-center gap-1">
						<Button variant="ghost" asChild>
							<NavLink
								end
								to="/"
								className={ ( { isActive } ) => ( isActive ? 'font-medium' : 'text-muted-foreground' ) }
							>
								Today
							</NavLink>
						</Button>
						<Button variant="ghost" asChild>
							<NavLink
								to="/events"
								className={ ( { isActive } ) => ( isActive ? 'font-medium' : 'text-muted-foreground' ) }
							>
								Events
							</NavLink>
						</Button>
					</nav>
				</div>
			</header>
			<main className="mx-auto max-w-5xl p-4">
				<Routes>
					<Route path="/" element={ <Dashboard /> } />
					<Route path="/events" element={ <EventList /> } />
					<Route path="/event/:id" element={ <EventDetail /> } />
					<Route path="*" element={ <Navigate to="/" replace /> } />
				</Routes>
			</main>
		</div>
	);
}
