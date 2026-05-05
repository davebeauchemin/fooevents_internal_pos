import { useCallback } from 'react';
import {
	Link,
	useParams,
	useSearchParams,
} from 'react-router-dom';
import { AdminReplaceScheduleSection } from '@/components/managed-schedule/AdminReplaceScheduleSection';
import { ManagedEventScheduleDialogs } from '@/components/managed-schedule/ManagedEventScheduleDialogs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import EventSlotOverview from '@/components/EventSlotOverview';
import { useManageSchedule } from '@/hooks/useManageSchedule';

type ManageTab = 'session' | 'spots' | 'schedule';

function parseManageParam( raw: string | null ): ManageTab | null {
	if (
		raw === 'session'
		|| raw === 'spots'
		|| raw === 'schedule'
	) {
		return raw;
	}
	return null;
}

export default function EventDetail() {
	const { id } = useParams<{ id: string }>();
	const eventId = id ?? '';
	const { canReplaceEventSchedules } = useAuth();
	const [ searchParams, setSearchParams ] = useSearchParams();
	const manageTab = parseManageParam( searchParams.get( 'manage' ) );

	const mgr = useManageSchedule( eventId );

	const openTab = useCallback(
		( tab: ManageTab ) => {
			setSearchParams(
				( prev ) => {
					const p = new URLSearchParams( prev.toString() );
					p.set( 'manage', tab );
					return p;
				},
				{ replace: false },
			);
		},
		[ setSearchParams ],
	);

	const closeManagedDialogs = useCallback( () => {
		setSearchParams(
			( prev ) => {
				const p = new URLSearchParams( prev.toString() );
				p.delete( 'manage' );
				return p;
			},
			{ replace: true },
		);
	}, [ setSearchParams ] );

	if ( mgr.isLoading ) {
		return (
			<div className="space-y-3">
				<Skeleton className="h-8 w-2/3" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}
	if ( mgr.isError ) {
		return (
			<div className="space-y-2">
				<Link to="/events" className="text-primary hover:underline">← Back</Link>
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					{ String( mgr.error?.message || mgr.error || 'Error' ) }
				</div>
			</div>
		);
	}
	if ( ! mgr.eventData ) {
		return (
			<div>
				<Link to="/events" className="text-primary hover:underline">← Back</Link>
				<p className="text-muted-foreground mt-2">Event not found.</p>
			</div>
		);
	}

	const data = mgr.eventData;

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<Button variant="outline" asChild className="w-fit">
					<Link to="/events">Back to events</Link>
				</Button>
			</div>
			<div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
				<h1 className="text-2xl font-bold tracking-tight">{ data.title }</h1>
				<span className="bg-muted shrink-0 rounded px-2 py-0.5 font-mono text-xs">
					{ data.bookingMethod }
				</span>
			</div>
			<p className="text-muted-foreground text-sm leading-relaxed">
				<strong className="text-foreground font-medium">
					View the schedule below, then adjust it with focused actions — no separate manage page needed.
				</strong>{ ' ' }
				Use Calendar and checkout when selling.
			</p>

			<div className="flex flex-wrap gap-2">
				<Button type="button" onClick={ () => openTab( 'session' ) }>
					Add new session
				</Button>
				<Button type="button" variant="secondary" onClick={ () => openTab( 'spots' ) }>
					Add ticket spots
				</Button>
				<Button type="button" variant="outline" onClick={ () => openTab( 'schedule' ) }>
					Manage schedule
				</Button>
			</div>

			<EventSlotOverview
				detail={ data }
				hideManualAddToolbar
			/>

			{ canReplaceEventSchedules ? (
				<AdminReplaceScheduleSection mgr={ mgr } />
			) : null }

			<ManagedEventScheduleDialogs
				mgr={ mgr }
				sessionOpen={ manageTab === 'session' }
				spotsOpen={ manageTab === 'spots' }
				scheduleOpen={ manageTab === 'schedule' }
				onSessionOpenChange={ ( open ) => {
					if ( ! open ) {
						closeManagedDialogs();
					}
				} }
				onSpotsOpenChange={ ( open ) => {
					if ( ! open ) {
						closeManagedDialogs();
					}
				} }
				onScheduleOpenChange={ ( open ) => {
					if ( ! open ) {
						closeManagedDialogs();
					}
				} }
			/>
		</div>
	);
}
