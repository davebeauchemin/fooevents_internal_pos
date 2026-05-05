import { Navigate, useParams } from 'react-router-dom';

/** Alias for bookmarked URLs: schedule tools live on the event workspace. */
export default function ScheduleRedirect() {
	const { id } = useParams<{ id: string }>();
	if ( ! id ) {
		return <Navigate to="/events" replace />;
	}
	return (
		<Navigate
			to={ `/event/${ id }?manage=schedule` }
			replace
		/>
	);
}
