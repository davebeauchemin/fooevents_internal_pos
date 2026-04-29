<?php
/**
 * Same-event paid booking reschedule: ticket CPT + booking inventory + order blueprint.
 *
 * Mirrors FooEvents Bookings `save_edit_ticket_meta_boxes` stock transfers and
 * `process_capture_booking` display fields. See ticket meta:
 * WooCommerceEventsBookingSlotID, WooCommerceEventsBookingDateID,
 * WooCommerceEventsBookingSlot, WooCommerceEventsBookingDate,
 * WooCommerceEventsBookingDateTimestamp, WooCommerceEventsBookingDateMySQLFormat.
 * Order rows use nested WooCommerceEventsBookingOptions (slot, date, slot_id, date_id, …).
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Order;
use WP_Error;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Reschedule a single ticket to another slot/date on the same booking product.
 */
class Ticket_Reschedule_Service {

	/**
	 * @var Bookings_Service
	 */
	private $bookings;

	/**
	 * @param Bookings_Service $bookings Bookings helper.
	 */
	public function __construct( Bookings_Service $bookings ) {
		$this->bookings = $bookings;
	}

	/**
	 * @param string $ticket_lookup Ticket id string (numeric or productId-formatted).
	 * @param int    $event_id      Product id from client (must match ticket).
	 * @param string $slot_id       UI slot id.
	 * @param string $date_id       UI date id / bucket / Y-m-d per Bookings_Service conventions.
	 * @param int    $actor_user_id WP user performing the action.
	 * @return array<string,mixed>|WP_Error
	 */
	public function reschedule(
		$ticket_lookup,
		$event_id,
		$slot_id,
		$date_id,
		$actor_user_id
	) {
		if ( ! function_exists( 'get_single_ticket' ) ) {
			return new WP_Error(
				'fooevents_unavailable',
				__( 'FooEvents ticket API is not available.', 'fooevents-internal-pos' ),
				array( 'status' => 503 )
			);
		}

		$ticket_lookup = sanitize_text_field( (string) $ticket_lookup );
		$event_id      = absint( $event_id );
		$slot_id       = trim( (string) $slot_id );
		$date_id       = trim( (string) $date_id );

		if ( '' === $ticket_lookup || $event_id <= 0 || '' === $slot_id || '' === $date_id ) {
			return new WP_Error(
				'rest_invalid_param',
				__( 'ticketId, eventId, slotId, and dateId are required.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$pack = get_single_ticket( $ticket_lookup );
		if ( ! empty( $pack['status'] ) && 'error' === $pack['status'] ) {
			return new WP_Error(
				'not_found',
				__( 'Ticket not found.', 'fooevents-internal-pos' ),
				array( 'status' => 404 )
			);
		}
		if ( empty( $pack['data'] ) || ! is_array( $pack['data'] ) ) {
			return new WP_Error(
				'not_found',
				__( 'Ticket not found.', 'fooevents-internal-pos' ),
				array( 'status' => 404 )
			);
		}

		$data = $pack['data'];

		$ticket_event = isset( $data['WooCommerceEventsProductID'] ) ? absint( $data['WooCommerceEventsProductID'] ) : 0;
		if ( $ticket_event !== $event_id ) {
			return new WP_Error(
				'rest_invalid_param',
				__( 'Ticket does not belong to this event.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$status = isset( $data['WooCommerceEventsStatus'] ) ? (string) $data['WooCommerceEventsStatus'] : '';
		if ( 'Canceled' === $status ) {
			return new WP_Error(
				'ticket_canceled',
				__( 'Canceled tickets cannot be rescheduled.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}
		$allowed_statuses = array( 'Not Checked In', 'Checked In' );
		if ( ! in_array( $status, $allowed_statuses, true ) ) {
			return new WP_Error(
				'ticket_status',
				__( 'Only tickets that are Not Checked In or Checked In can be rescheduled.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		if ( ! function_exists( 'wc_get_product' ) ) {
			return new WP_Error(
				'woocommerce_unavailable',
				__( 'WooCommerce is not available.', 'fooevents-internal-pos' ),
				array( 'status' => 503 )
			);
		}

		$product = wc_get_product( $event_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error(
				'not_booking_event',
				__( 'This product is not a FooEvents booking event.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$ticket_post_id = $this->resolve_ticket_post_id( $ticket_lookup );
		if ( $ticket_post_id <= 0 ) {
			return new WP_Error(
				'not_found',
				__( 'Ticket post could not be resolved.', 'fooevents-internal-pos' ),
				array( 'status' => 404 )
			);
		}

		$old_slot_id = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingSlotID', true );
		$old_date_id = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingDateID', true );
		if ( '' === $old_slot_id || '' === $old_date_id ) {
			return new WP_Error(
				'not_booking_ticket',
				__( 'This ticket has no booking slot/date to reschedule.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$old_date_label = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingDate', true );
		$old_slot_label = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingSlot', true );

		$normalized = $this->bookings->normalize_booking_ids_for_cart( $event_id, $slot_id, $date_id );
		if ( null === $normalized ) {
			return new WP_Error(
				'invalid_booking',
				__( 'The selected date or slot was not found for this event.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$new_slot_internal = (string) $normalized['slot_id'];
		$new_date_internal = (string) $normalized['internal_date_id'];

		if ( $new_slot_internal === $old_slot_id && $new_date_internal === $old_date_id ) {
			return new WP_Error(
				'unchanged_booking',
				__( 'Select a different slot or date to reschedule.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$avail = $this->bookings->check_availability( $event_id, $slot_id, $date_id, 1 );
		if ( empty( $avail['available'] ) ) {
			$reason = isset( $avail['reason'] ) ? (string) $avail['reason'] : '';
			$msg    = __( 'That slot is not available.', 'fooevents-internal-pos' );
			if ( 'past_date' === $reason ) {
				$msg = __( 'Cannot reschedule to a past date.', 'fooevents-internal-pos' );
			} elseif ( 'not_found' === $reason ) {
				$msg = __( 'The selected date or slot was not found.', 'fooevents-internal-pos' );
			}
			return new WP_Error(
				'booking_unavailable',
				$msg,
				array( 'status' => 400 )
			);
		}

		$fb = new \FooEvents_Bookings();

		$serialized = get_post_meta( $event_id, 'fooevents_bookings_options_serialized', true );
		$raw        = json_decode( (string) $serialized, true );
		if ( ! is_array( $raw ) ) {
			$raw = array();
		}
		$fooevents_bookings_options = $fb->process_booking_options( $raw );

		if ( ! isset( $fooevents_bookings_options[ $new_slot_internal ]['add_date'][ $new_date_internal ] ) ) {
			return new WP_Error(
				'invalid_booking',
				__( 'The destination slot or date is invalid.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}
		if ( ! isset( $fooevents_bookings_options[ $old_slot_id ]['add_date'][ $old_date_id ] ) ) {
			return new WP_Error(
				'invalid_booking',
				__( 'The ticket’s current booking is missing from event options.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$captured = $fb->process_capture_booking(
			$event_id,
			array(
				'slot' => $new_slot_internal,
				'date' => $new_date_internal,
			),
			''
		);
		if ( ! is_array( $captured ) || empty( $captured['slot'] ) || empty( $captured['date'] ) ) {
			return new WP_Error(
				'reschedule_failed',
				__( 'Could not resolve booking labels for the new selection.', 'fooevents-internal-pos' ),
				array( 'status' => 500 )
			);
		}

		$new_stock_cell = $fooevents_bookings_options[ $new_slot_internal ]['add_date'][ $new_date_internal ]['stock'] ?? '';
		$old_stock_cell = $fooevents_bookings_options[ $old_slot_id ]['add_date'][ $old_date_id ]['stock'] ?? '';

		if ( '' !== $new_stock_cell ) {
			$n = (int) $new_stock_cell - 1;
			if ( $n < 0 ) {
				return new WP_Error(
					'booking_unavailable',
					__( 'That slot is full.', 'fooevents-internal-pos' ),
					array( 'status' => 400 )
				);
			}
			$fooevents_bookings_options[ $new_slot_internal ]['add_date'][ $new_date_internal ]['stock'] = $n;
		}
		if ( '' !== $old_stock_cell ) {
			$fooevents_bookings_options[ $old_slot_id ]['add_date'][ $old_date_id ]['stock'] = (int) $old_stock_cell + 1;
		}

		$updated_serialized = wp_json_encode( $fooevents_bookings_options, JSON_UNESCAPED_UNICODE );
		update_post_meta( $event_id, 'fooevents_bookings_options_serialized', $updated_serialized );

		// Writes ticket booking meta + timestamp/mysql using FooEvents helpers (fires `fooevents_create_booking`).
		$fb->process_capture_booking(
			$event_id,
			array(
				'slot' => $new_slot_internal,
				'date' => $new_date_internal,
			),
			$ticket_post_id
		);

		$numeric_ticket_id = isset( $data['WooCommerceEventsTicketID'] ) ? (string) $data['WooCommerceEventsTicketID'] : '';
		$this->maybe_patch_order_tickets_booking(
			(int) ( $data['WooCommerceEventsOrderID'] ?? 0 ),
			$event_id,
			$numeric_ticket_id,
			$captured,
			$product->get_meta( 'WooCommerceEventsBookingsSlotOverride', true ),
			$product->get_meta( 'WooCommerceEventsBookingsDateOverride', true )
		);

		$note = sprintf(
			/* translators: 1: ticket id, 2–3: old slot/date labels, 4–5: new slot/date labels, 6: user id */
			__( 'Internal POS: Ticket #%1$s rescheduled from %2$s / %3$s to %4$s / %5$s by user #%6$d.', 'fooevents-internal-pos' ),
			$numeric_ticket_id !== '' ? $numeric_ticket_id : (string) $ticket_post_id,
			$old_slot_label,
			$old_date_label,
			(string) $captured['slot'],
			(string) $captured['date'],
			absint( $actor_user_id )
		);
		$this->add_order_note( (int) ( $data['WooCommerceEventsOrderID'] ?? 0 ), $note );

		$fresh = get_single_ticket( $ticket_lookup );
		$ticket_out = array();
		if ( ! empty( $fresh['data'] ) && is_array( $fresh['data'] ) ) {
			$ticket_out = $fresh['data'];
			$pid       = isset( $ticket_out['WooCommerceEventsProductID'] ) ? absint( $ticket_out['WooCommerceEventsProductID'] ) : 0;
			if ( $pid > 0 ) {
				$pd = wc_get_product( $pid );
				if ( $pd ) {
					$ticket_out['eventDisplayName'] = $pd->get_name();
				}
			}
		}

		return array(
			'ticket' => $ticket_out,
			'previousBooking' => array(
				'slotId'   => $old_slot_id,
				'dateId'   => $old_date_id,
				'slotLabel'=> $old_slot_label,
				'dateLabel'=> $old_date_label,
			),
			'newBooking' => array(
				'slotId'    => $new_slot_internal,
				'dateId'    => $new_date_internal,
				'slotLabel' => (string) $captured['slot'],
				'dateLabel' => (string) $captured['date'],
			),
		);
	}

	/**
	 * Match FooEvents `get_single_ticket` lookup → `event_magic_tickets` post ID.
	 *
	 * @param string $ticket_lookup Lookup string.
	 * @return int Post ID or 0.
	 */
	private function resolve_ticket_post_id( $ticket_lookup ) {
		$ticket_lookup = sanitize_text_field( (string) $ticket_lookup );
		$args          = array(
			'post_type'        => array( 'event_magic_tickets' ),
			'post_status'      => 'any',
			'posts_per_page'   => 1,
			'suppress_filters' => true,
			'fields'           => 'ids',
		);

		$ticket_id_parts = explode( '-', $ticket_lookup );
		if ( count( $ticket_id_parts ) === 2 ) {
			$args['meta_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
				'relation' => 'AND',
				array(
					'key'   => 'WooCommerceEventsProductID',
					'value' => $ticket_id_parts[0],
				),
				array(
					'key'   => 'WooCommerceEventsTicketNumberFormatted',
					'value' => $ticket_id_parts[1],
				),
			);
		} else {
			$args['meta_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
				array(
					'key'   => 'WooCommerceEventsTicketID',
					'value' => $ticket_id_parts[0],
				),
			);
		}

		$q = new WP_Query( $args );
		return ! empty( $q->posts[0] ) ? absint( $q->posts[0] ) : 0;
	}

	/**
	 * Keep WooCommerceEventsOrderTickets booking display in sync for order admin/emails.
	 *
	 * @param int    $order_id      Order ID.
	 * @param int    $event_id      Product ID.
	 * @param string $numeric_tid   FooEvents WooCommerceEventsTicketID.
	 * @param array  $captured      process_capture_booking return (slot, date, slot_id, date_id).
	 * @param mixed  $slot_override Product slot label override meta.
	 * @param mixed  $date_override Product date label override meta.
	 */
	private function maybe_patch_order_tickets_booking(
		$order_id,
		$event_id,
		$numeric_tid,
		array $captured,
		$slot_override,
		$date_override
	) {
		$order_id = absint( $order_id );
		if ( $order_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			return;
		}
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$tickets = $order->get_meta( 'WooCommerceEventsOrderTickets', true );
		if ( ! is_array( $tickets ) ) {
			return;
		}
		$numeric_tid = (string) $numeric_tid;
		$event_id    = (int) $event_id;
		$slot_term   = $slot_override ? (string) $slot_override : __( 'Slot', 'fooevents-internal-pos' );
		$date_term   = $date_override ? (string) $date_override : __( 'Date', 'fooevents-internal-pos' );

		$changed = false;
		foreach ( $tickets as $xi => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			foreach ( $row as $yi => $t ) {
				if ( ! is_array( $t ) ) {
					continue;
				}
				if ( (int) ( $t['WooCommerceEventsProductID'] ?? 0 ) !== $event_id ) {
					continue;
				}
				if ( (string) ( $t['WooCommerceEventsTicketID'] ?? '' ) !== $numeric_tid ) {
					continue;
				}
				if ( ! isset( $t['WooCommerceEventsBookingOptions'] ) || ! is_array( $t['WooCommerceEventsBookingOptions'] ) ) {
					$t['WooCommerceEventsBookingOptions'] = array();
				}
				$t['WooCommerceEventsBookingOptions']['slot']      = $captured['slot'];
				$t['WooCommerceEventsBookingOptions']['date']      = $captured['date'];
				$t['WooCommerceEventsBookingOptions']['slot_id']   = $captured['slot_id'];
				$t['WooCommerceEventsBookingOptions']['date_id']   = $captured['date_id'];
				$t['WooCommerceEventsBookingOptions']['slot_term'] = $slot_term;
				$t['WooCommerceEventsBookingOptions']['date_term'] = $date_term;
				$tickets[ $xi ][ $yi ]                             = $t;
				$changed                                           = true;
				break 2;
			}
		}

		if ( $changed ) {
			$order->update_meta_data( 'WooCommerceEventsOrderTickets', $tickets );
			$order->save();
		}
	}

	/**
	 * @param int    $order_id Order ID.
	 * @param string $note     Note text.
	 */
	private function add_order_note( $order_id, $note ) {
		$order_id = absint( $order_id );
		if ( $order_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			return;
		}
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$order->add_order_note( $note );
	}
}
