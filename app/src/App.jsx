import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from '@/components/ui/sidebar';
import { RequireManageEventsRoute, RequireValidateTicketsRoute, useAuth } from '@/context/AuthContext';
import Dashboard from './pages/Dashboard';
import Checkout from './pages/Checkout';
import EventDetail from './pages/EventDetail.jsx';
import EventList from './pages/EventList.jsx';
import Schedule from './pages/Schedule';
import Validate from './pages/Validate.tsx';

function breadcrumbPageLabel( pathname ) {
	if ( pathname === '/validate' ) {
		return 'Validate';
	}
	if ( pathname === '/' || pathname === '/calendar' ) {
		return 'Calendar';
	}
	if ( pathname === '/checkout' ) {
		return 'Checkout';
	}
	if ( pathname === '/events' ) {
		return 'Events';
	}
	if ( pathname.match( /^\/event\/[^/]+\/manage$/ ) ) {
		return 'Manage schedule';
	}
	if ( pathname.match( /^\/event\/[^/]+$/ ) ) {
		return 'Event';
	}
	return 'Internal POS';
}

function App() {
	const { pathname } = useLocation();
	const { site, canUsePos, canValidateTickets } = useAuth();
	const parentLabel = site?.name?.trim() || 'Internal POS';
	const parentHref = ! canUsePos && canValidateTickets ? '/validate' : '/calendar';
	const validatorOnly = canValidateTickets && ! canUsePos;

	useEffect( () => {
		const reduceMotion =
			typeof window !== 'undefined'
			&& window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		window.scrollTo( {
			top: 0,
			left: 0,
			behavior: reduceMotion ? 'auto' : 'smooth',
		} );
	}, [ pathname ] );

	if ( validatorOnly && ( pathname === '/' || pathname === '/calendar' || pathname === '/checkout' ) ) {
		return <Navigate to="/validate" replace />;
	}

	return (
		<div className="fooevents-internal-pos-app">
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 backdrop-blur">
						<div className="flex items-center gap-2 px-4 sm:px-6">
							<SidebarTrigger className="-ml-1" />
							<Separator
								orientation="vertical"
								className="mr-2 data-[orientation=vertical]:h-4"
							/>
							<Breadcrumb>
								<BreadcrumbList>
									<BreadcrumbItem className="hidden md:block">
										<BreadcrumbLink asChild>
											<Link to={ parentHref }>{ parentLabel }</Link>
										</BreadcrumbLink>
									</BreadcrumbItem>
									<BreadcrumbSeparator className="hidden md:block" />
									<BreadcrumbItem>
										<BreadcrumbPage>
											{ breadcrumbPageLabel( pathname ) }
										</BreadcrumbPage>
									</BreadcrumbItem>
								</BreadcrumbList>
							</Breadcrumb>
						</div>
					</header>
					<div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-6">
						<Routes>
							<Route path="/" element={ <Dashboard /> } />
							<Route path="/calendar" element={ <Dashboard /> } />
							<Route path="/checkout" element={ <Checkout /> } />
							<Route
								path="/events"
								element={ (
									<RequireManageEventsRoute>
										<EventList />
									</RequireManageEventsRoute>
								) }
							/>
							<Route
								path="/event/:id/manage"
								element={ (
									<RequireManageEventsRoute>
										<Schedule />
									</RequireManageEventsRoute>
								) }
							/>
							<Route
								path="/event/:id"
								element={ (
									<RequireManageEventsRoute>
										<EventDetail />
									</RequireManageEventsRoute>
								) }
							/>
							<Route
								path="/validate"
								element={ (
									<RequireValidateTicketsRoute>
										<Validate />
									</RequireValidateTicketsRoute>
								) }
							/>
							<Route
								path="*"
								element={ (
									<Navigate to={ canUsePos ? '/' : '/validate' } replace />
								) }
							/>
						</Routes>
					</div>
				</SidebarInset>
			</SidebarProvider>
		</div>
	);
}

export default App;
