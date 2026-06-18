<?php
/**
 * Booking slot stock adjustments when Internal POS changes ticket status (Canceled ↔ active).
 *
 * FooEvents `update_ticket_status()` only updates ticket meta; WooCommerce order cancel
 * restores serialized booking stock via FooEvents Bookings — ticket cancel from POS did not.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Order;
use WP_Error;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Sync `fooevents_bookings_options_serialized` with validate ticket status transitions.
 */
class Ticket_Status_Stock_Service {

	/**
	 * @var Booking_Stock_Service
	 */
	private $stock;

	/**
	 * @param Booking_Stock_Service|null $stock Optional stock service.
	 */
	public function __construct( ?Booking_Stock_Service $stock = null ) {
		$this->stock = $stock ? $stock : new Booking_Stock_Service();
	}

	/**
	 * @param string $ticket_lookup Same string as `get_single_ticket` / REST validate path.
	 * @param string $new_status    Checked In | Not Checked In | Canceled.
	 * @return string|WP_Error FooEvents message string or error.
	 */
	public function process_status_change( $ticket_lookup, $new_status ) {
		if ( ! function_exists( 'update_ticket_status' ) ) {
			return new WP_Error(
				'fooevents_unavailable',
				__( 'FooEvents ticket API is not available.', 'fooevents-internal-pos' ),
				array( 'status' => 503 )
			);
		}

		$ticket_lookup = sanitize_text_field( (string) $ticket_lookup );
		$new_status    = trim( wp_strip_all_tags( (string) $new_status ) );

		if ( '' === $ticket_lookup ) {
			return new WP_Error(
				'rest_invalid_param',
				__( 'ticketId is required.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$ticket_post_id = $this->resolve_ticket_post_id( $ticket_lookup );
		if ( $ticket_post_id <= 0 ) {
			return new WP_Error(
				'not_found',
				__( 'Ticket not found.', 'fooevents-internal-pos' ),
				array( 'status' => 404 )
			);
		}

		$old_status = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsStatus', true );
		$event_id   = absint( get_post_meta( $ticket_post_id, 'WooCommerceEventsProductID', true ) );

		$delta = $this->stock_delta_for_transition( $old_status, $new_status );
		if ( 0 === $delta ) {
			return update_ticket_status( $ticket_lookup, $new_status );
		}

		$slot_date = $this->resolve_booking_slot_date_ids( $ticket_post_id, $event_id );

		if ( null === $slot_date ) {
			// Not a booking ticket or missing ids — status only.
			return update_ticket_status( $ticket_lookup, $new_status );
		}

		$slot_id = $slot_date['slot_id'];
		$date_id = $slot_date['date_id'];

		if ( ! function_exists( 'wc_get_product' ) ) {
			return new WP_Error(
				'woocommerce_unavailable',
				__( 'WooCommerce is not available.', 'fooevents-internal-pos' ),
				array( 'status' => 503 )
			);
		}

		$product = wc_get_product( $event_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return update_ticket_status( $ticket_lookup, $new_status );
		}

		$apply = $this->stock->mutate_remaining_stock( $event_id, $slot_id, $date_id, $delta, true );
		if ( is_wp_error( $apply ) ) {
			return $apply;
		}

		$result = update_ticket_status( $ticket_lookup, $new_status );

		if ( 'Status is required' === $result ) {
			$this->stock->mutate_remaining_stock( $event_id, $slot_id, $date_id, -1 * (int) $delta, false );
			return new WP_Error(
				'status_failed',
				__( 'Could not update ticket status.', 'fooevents-internal-pos' ),
				array( 'status' => 500 )
			);
		}

		return $result;
	}

	/**
	 * @param string $old_status Prior WooCommerceEventsStatus.
	 * @param string $new_status Target status.
	 * @return int -1 consume spot, +1 release spot, 0 no booking stock effect.
	 */
	private function stock_delta_for_transition( $old_status, $new_status ) {
		$active = array( 'Not Checked In', 'Checked In' );
		if ( 'Canceled' !== $old_status && 'Canceled' === $new_status ) {
			return 1;
		}
		if ( 'Canceled' === $old_status && in_array( $new_status, $active, true ) ) {
			return -1;
		}
		return 0;
	}

	/**
	 * @param int $ticket_post_id Ticket CPT ID.
	 * @param int $event_id       Product ID.
	 * @return array{slot_id:string,date_id:string}|null
	 */
	private function resolve_booking_slot_date_ids( $ticket_post_id, $event_id ) {
		$ticket_post_id = absint( $ticket_post_id );
		$event_id       = absint( $event_id );

		$slot_id = trim( (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingSlotID', true ) );
		$date_id = trim( (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingDateID', true ) );

		if ( '' !== $slot_id && '' !== $date_id ) {
			return array(
				'slot_id' => $slot_id,
				'date_id' => $date_id,
			);
		}

		if ( $event_id <= 0 ) {
			return null;
		}

		$numeric_tid = trim( (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsTicketID', true ) );
		if ( '' === $numeric_tid ) {
			return null;
		}

		$from_order = $this->booking_ids_from_order_meta( $ticket_post_id, $event_id, $numeric_tid );
		if ( null !== $from_order ) {
			return $from_order;
		}

		return null;
	}

	/**
	 * @param int    $ticket_post_id Ticket CPT ID.
	 * @param int    $event_id       Product ID.
	 * @param string $numeric_tid    WooCommerceEventsTicketID.
	 * @return array{slot_id:string,date_id:string}|null
	 */
	private function booking_ids_from_order_meta( $ticket_post_id, $event_id, $numeric_tid ) {
		if ( ! function_exists( 'wc_get_order' ) ) {
			return null;
		}

		$order_id = absint( get_post_meta( $ticket_post_id, 'WooCommerceEventsOrderID', true ) );
		if ( $order_id <= 0 ) {
			return null;
		}

		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return null;
		}

		$tickets = $order->get_meta( 'WooCommerceEventsOrderTickets', true );
		if ( ! is_array( $tickets ) ) {
			return null;
		}

		foreach ( $tickets as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			foreach ( $row as $t ) {
				if ( ! is_array( $t ) ) {
					continue;
				}
				if ( (int) ( $t['WooCommerceEventsProductID'] ?? 0 ) !== $event_id ) {
					continue;
				}
				if ( (string) ( $t['WooCommerceEventsTicketID'] ?? '' ) !== $numeric_tid ) {
					continue;
				}
				$opts = isset( $t['WooCommerceEventsBookingOptions'] ) ? $t['WooCommerceEventsBookingOptions'] : null;
				if ( ! is_array( $opts ) ) {
					return null;
				}
				$sid = isset( $opts['slot_id'] ) ? trim( (string) $opts['slot_id'] ) : '';
				$did = isset( $opts['date_id'] ) ? trim( (string) $opts['date_id'] ) : '';
				if ( '' !== $sid && '' !== $did ) {
					return array(
						'slot_id' => $sid,
						'date_id' => $did,
					);
				}
				break 2;
			}
		}

		return null;
	}

	/**
	 * Match `Ticket_Reschedule_Service::resolve_ticket_post_id`.
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
}
