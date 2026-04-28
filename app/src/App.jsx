import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Dashboard from './pages/Dashboard';
import Checkout from './pages/Checkout';
import Cart from '@/components/Cart';
import EventDetail from './pages/EventDetail.jsx';
import EventList from './pages/EventList.jsx';
import Schedule from './pages/Schedule';

function App() {
	const { pathname } = useLocation();
	const calendarNavActive = pathname === '/' || pathname === '/calendar';

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
					<nav className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
						<div className="max-w-[min(100vw-10rem,280px)] min-w-0 flex-shrink">
							<Cart variant="compact" />
						</div>
						<Button variant="ghost" asChild>
							<NavLink
								to="/calendar"
								className={ calendarNavActive
									? 'font-medium'
									: 'text-muted-foreground'
								}
							>
								Calendar
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
						<Button variant="ghost" asChild>
							<NavLink
								to="/checkout"
								className={ ( { isActive } ) => ( isActive ? 'font-medium' : 'text-muted-foreground' ) }
							>
								Checkout
							</NavLink>
						</Button>
					</nav>
				</div>
			</header>
			<main className="mx-auto max-w-5xl p-4">
				<Routes>
					<Route path="/" element={ <Dashboard /> } />
					<Route path="/calendar" element={ <Dashboard /> } />
					<Route path="/checkout" element={ <Checkout /> } />
					<Route path="/events" element={ <EventList /> } />
					<Route path="/event/:id/manage" element={ <Schedule /> } />
					<Route path="/event/:id" element={ <EventDetail /> } />
					<Route path="*" element={ <Navigate to="/" replace /> } />
				</Routes>
			</main>
		</div>
	);
}

export default App;
