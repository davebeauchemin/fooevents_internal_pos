<?php
/**
 * REST API: internalpos/v1
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WP_Error;
use WP_Query;
use WP_REST_Request;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Register REST routes.
 */
class Rest_API {

	const NAMESPACE = 'internalpos/v1';

	/**
	 * @var Bookings_Service
	 */
	private $bookings;

	/**
	 * @var Slot_Generator_Service
	 */
	private $slot_generator;

	/**
	 * @var Bookings_Checkout_Service
	 */
	private $booking_checkout;

	/**
	 * @var Ticket_Reschedule_Service
	 */
	private $ticket_reschedule;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->bookings         = new Bookings_Service();
		$this->slot_generator   = new Slot_Generator_Service();
		$this->booking_checkout = new Bookings_Checkout_Service( $this->bookings );
		$this->ticket_reschedule = new Ticket_Reschedule_Service( $this->bookings );
	}

	/**
	 * Init hooks.
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register routes.
	 */
	public function register_routes() {
		register_rest_route(
			self::NAMESPACE,
			'/dashboard',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_dashboard' ),
				'permission_callback' => array( $this, 'can_use_pos' ),
				'args'                => array(
					'date' => array(
						'required'          => false,
						'validate_callback' => function( $p ) {
							return is_string( $p ) && ( '' === $p || preg_match( '/^\d{4}-\d{2}-\d{2}$/', $p ) );
						},
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/events',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_events' ),
				'permission_callback' => array( $this, 'can_manage_events' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/events/(?P<id>\\d+)/slots/generate',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_slots_generate' ),
				'permission_callback' => array( $this, 'can_manage_events' ),
				'args'                => array(
					'id' => array(
						'validate_callback' => function( $p ) {
							return is_numeric( $p ) && (int) $p > 0;
						},
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/events/(?P<id>\\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_event' ),
				'permission_callback' => array( $this, 'can_manage_events' ),
				'args'                => array(
					'id' => array(
						'validate_callback' => function( $p ) {
							return is_numeric( $p ) && (int) $p > 0;
						},
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/availability',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_availability' ),
				'permission_callback' => array( $this, 'can_use_pos' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/bookings',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_bookings' ),
				'permission_callback' => array( $this, 'can_use_pos' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/checkout/preview',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_checkout_preview' ),
				'permission_callback' => array( $this, 'can_use_pos' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/payment-methods',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_payment_methods' ),
				'permission_callback' => array( $this, 'can_use_pos' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/validate/search',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_validate_search' ),
				'permission_callback' => array( $this, 'can_validate_tickets' ),
				'args'                => array(
					'q' => array(
						'required'          => true,
						'validate_callback' => function( $p ) {
							return is_string( $p ) && mb_strlen( trim( $p ) ) >= 3;
						},
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/validate/ticket/(?P<ticketId>[^/]+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_validate_ticket' ),
					'permission_callback' => array( $this, 'can_validate_tickets' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'post_validate_ticket_status' ),
					'permission_callback' => array( $this, 'can_validate_tickets' ),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/validate/ticket/(?P<ticketId>[^/]+)/reschedule',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_validate_ticket_reschedule' ),
				'permission_callback' => array( $this, 'can_validate_tickets' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/validate/event/(?P<id>\\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_validate_event' ),
				'permission_callback' => array( $this, 'can_validate_tickets' ),
				'args'                => array(
					'id' => array(
						'validate_callback' => function( $p ) {
							return is_numeric( $p ) && (int) $p > 0;
						},
					),
				),
			)
		);
	}

	/**
	 * Cashiers (publish_fooeventspos) + shop managers.
	 *
	 * @return true|WP_Error
	 */
	public function can_use_pos() {
		if ( ! Access_Helper::can_use_pos() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to use Internal POS.', 'fooevents-internal-pos' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Shop managers — event list/detail and slot generation.
	 *
	 * @return true|WP_Error
	 */
	public function can_manage_events() {
		if ( ! Access_Helper::can_manage_shop_events() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission for event management.', 'fooevents-internal-pos' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * FooEvents ticket check-in validators (publish_event_magic_tickets | app_event_magic_tickets).
	 *
	 * @return true|WP_Error
	 */
	public function can_validate_tickets() {
		if ( ! Access_Helper::can_validate_fooevents_tickets() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to validate tickets.', 'fooevents-internal-pos' ),
				array( 'status' => 403 )
			);
		}
		if ( ! function_exists( 'get_single_ticket' ) || ! function_exists( 'update_ticket_status' ) ) {
			return new WP_Error(
				'rest_ticket_api_unavailable',
				__( 'FooEvents ticket API is not available.', 'fooevents-internal-pos' ),
				array( 'status' => 503 )
			);
		}
		return true;
	}

	/**
	 * GET /dashboard?date=YYYY-MM-DD
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function get_dashboard( WP_REST_Request $request ) {
		$date = $request->get_param( 'date' );
		$date = is_string( $date ) ? $date : '';
		$out  = $this->bookings->get_day_dashboard( $date );
		return rest_ensure_response( $out );
	}

	/**
	 * GET /events
	 */
	public function get_events() {
		return rest_ensure_response( $this->bookings->list_booking_events() );
	}

	/**
	 * POST /events/{id}/slots/generate
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function post_slots_generate( WP_REST_Request $request ) {
		$id = (int) $request['id'];
		$params  = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$confirm = $params['confirm'] ?? null;
		$ok      = ( true === $confirm || 1 === (int) $confirm || 'true' === (string) $confirm || '1' === (string) $confirm );
		if ( ! $ok ) {
			return new WP_Error( 'rest_invalid_param', __( 'Set confirm: true to replace all existing slots.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		unset( $params['confirm'] );
		$result = $this->slot_generator->generate( $id, $params );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	/**
	 * GET /events/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function get_event( WP_REST_Request $request ) {
		$id  = (int) $request['id'];
		$out = $this->bookings->get_event_detail( $id );
		if ( ! empty( $out['error'] ) && 'not_booking_event' === $out['error'] ) {
			return new WP_Error( 'not_found', __( 'Event not found or not a booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}
		unset( $out['error'] );
		return rest_ensure_response( $out );
	}

	/**
	 * GET /validate/event/{id} — same payload as GET /events/{id} for ticket validators.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_validate_event( WP_REST_Request $request ) {
		return $this->get_event( $request );
	}

	/**
	 * POST /availability
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function post_availability( WP_REST_Request $request ) {
		$params  = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$event_id = isset( $params['eventId'] ) ? (int) $params['eventId'] : 0;
		$slot_id  = isset( $params['slotId'] ) ? (string) $params['slotId'] : '';
		$date_id  = isset( $params['dateId'] ) ? (string) $params['dateId'] : '';
		$qty      = isset( $params['qty'] ) ? (int) $params['qty'] : 1;
		if ( $event_id <= 0 || '' === $slot_id || '' === $date_id ) {
			return new WP_Error( 'rest_invalid_param', __( 'eventId, slotId, and dateId are required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$result = $this->bookings->check_availability( $event_id, $slot_id, $date_id, $qty );
		return rest_ensure_response(
			array(
				'available'  => (bool) $result['available'],
				'remaining'  => $result['remaining'],
				'reason'     => (string) $result['reason'],
			)
		);
	}

	/**
	 * GET /payment-methods
	 */
	public function get_payment_methods() {
		return rest_ensure_response( Bookings_Checkout_Service::get_payment_methods_for_rest() );
	}

	/**
	 * POST /checkout/preview — WooCommerce totals from booking lines (cart-only; does not create an order).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function post_checkout_preview( WP_REST_Request $request ) {
		$params = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		if ( empty( $params['lines'] ) || ! is_array( $params['lines'] ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'lines array is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$lines_snake = $this->normalize_rest_booking_lines_array( $params['lines'] );
		if ( is_wp_error( $lines_snake ) ) {
			return $lines_snake;
		}

		$out = $this->booking_checkout->preview_checkout_lines( $lines_snake );
		if ( is_wp_error( $out ) ) {
			return $out;
		}

		return rest_ensure_response( $out );
	}

	/**
	 * Convert REST booking lines (camelCase or snake_case) to internal snake_case rows.
	 *
	 * @param array $raw_lines Raw lines array.
	 * @return array<int, array<string, mixed>>|WP_Error
	 */
	private function normalize_rest_booking_lines_array( array $raw_lines ) {
		$out = array();
		foreach ( $raw_lines as $ln ) {
			if ( ! is_array( $ln ) ) {
				return new WP_Error( 'rest_invalid_param', __( 'Invalid booking line.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			$event_id = isset( $ln['eventId'] ) ? (int) $ln['eventId'] : ( isset( $ln['event_id'] ) ? (int) $ln['event_id'] : 0 );
			$slot_id  = isset( $ln['slotId'] ) ? trim( (string) $ln['slotId'] ) : ( isset( $ln['slot_id'] ) ? trim( (string) $ln['slot_id'] ) : '' );
			$date_id  = isset( $ln['dateId'] ) ? trim( (string) $ln['dateId'] ) : ( isset( $ln['date_id'] ) ? trim( (string) $ln['date_id'] ) : '' );
			$qty      = isset( $ln['qty'] ) ? (int) $ln['qty'] : 1;

			if ( $event_id <= 0 || '' === $slot_id || '' === $date_id ) {
				return new WP_Error( 'rest_invalid_param', __( 'Each line needs eventId, slotId, and dateId.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			if ( $qty < 1 || $qty > 20 ) {
				return new WP_Error( 'rest_invalid_param', __( 'qty must be between 1 and 20 per line.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}

			$out[] = array(
				'event_id' => $event_id,
				'slot_id'  => $slot_id,
				'date_id'  => $date_id,
				'qty'      => $qty,
			);
		}

		return $out;
	}

	/**
	 * GET /validate/search?q=
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_validate_search( WP_REST_Request $request ) {
		global $wpdb;
		$q = $request->get_param( 'q' );
		$q = is_string( $q ) ? trim( sanitize_text_field( $q ) ) : '';
		if ( mb_strlen( $q ) < 3 ) {
			return new WP_Error( 'rest_invalid_param', __( 'Query q must be at least 3 characters.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$like_any     = '%' . $wpdb->esc_like( $q ) . '%';
		$hyphen_parts = preg_split( '/-/', $q );

		// Direct SQL for publish `event_magic_tickets` only (FooEvents / get_single_ticket() behavior); avoids empty results from WP_Query meta_query OR + post_status any on some installs.
		$like_keys = array(
			'WooCommerceEventsAttendeeEmail',
			'WooCommerceEventsPurchaserEmail',
			'WooCommerceEventsAttendeeTelephone',
			'WooCommerceEventsTicketID',
			'WooCommerceEventsTicketNumberFormatted',
			'WooCommerceEventsAttendeeName',
			'WooCommerceEventsAttendeeLastName',
		);

		$or_chunks = array();
		$prepare   = array( 'event_magic_tickets', 'publish' );

		foreach ( $like_keys as $meta_key ) {
			$or_chunks[] = '( m.meta_key = %s AND m.meta_value LIKE %s )';
			$prepare[]   = $meta_key;
			$prepare[]   = $like_any;
		}

		// `{productId}-{WooCommerceEventsTicketNumberFormatted}` (see FooEvents `get_single_ticket()`).
		if ( is_array( $hyphen_parts ) && 2 === count( $hyphen_parts ) ) {
			$pid_maybe = isset( $hyphen_parts[0] ) ? sanitize_text_field( (string) $hyphen_parts[0] ) : '';
			$fmt_maybe = isset( $hyphen_parts[1] ) ? sanitize_text_field( (string) $hyphen_parts[1] ) : '';
			if ( absint( $pid_maybe ) > 0 && '' !== $fmt_maybe ) {
				$or_chunks[] = '('
					. " EXISTS ( SELECT 1 FROM {$wpdb->postmeta} e1 WHERE e1.post_id = p.ID AND e1.meta_key = %s AND e1.meta_value = %s )"
					. " AND EXISTS ( SELECT 1 FROM {$wpdb->postmeta} e2 WHERE e2.post_id = p.ID AND e2.meta_key = %s AND e2.meta_value = %s )"
					. ')';
				$prepare[] = 'WooCommerceEventsProductID';
				$prepare[] = (string) absint( $pid_maybe );
				$prepare[] = 'WooCommerceEventsTicketNumberFormatted';
				$prepare[] = $fmt_maybe;
			}
		}

		$sql = "SELECT DISTINCT p.ID FROM {$wpdb->posts} p"
			. " INNER JOIN {$wpdb->postmeta} m ON ( m.post_id = p.ID )"
			. ' WHERE p.post_type = %s AND p.post_status = %s'
			. ' AND ( ' . implode( ' OR ', $or_chunks ) . ' )'
			. ' ORDER BY p.ID DESC'
			. ' LIMIT 50';

		$ticket_post_ids = $wpdb->get_col( $wpdb->prepare( $sql, ...$prepare ) );
		$results         = array();

		foreach ( $ticket_post_ids as $post_id ) {
			$lookup = $this->ticket_lookup_identifier_for_post( $post_id );
			$fn    = (string) get_post_meta( $post_id, 'WooCommerceEventsAttendeeName', true );
			$ln    = (string) get_post_meta( $post_id, 'WooCommerceEventsAttendeeLastName', true );
			$name  = trim( $fn . ' ' . $ln );
			if ( '' === $name ) {
				$name = (string) get_post_meta( $post_id, 'WooCommerceEventsProductName', true );
			}
			$results[] = array(
				'ticketId'                => $lookup['ticketId'],
				'ticketNumericId'         => $lookup['numericId'],
				'attendeeName'            => $name,
				'eventName'               => (string) get_post_meta( $post_id, 'WooCommerceEventsProductName', true ),
				'WooCommerceEventsStatus' => (string) get_post_meta( $post_id, 'WooCommerceEventsStatus', true ),
			);
		}

		return rest_ensure_response(
			array(
				'results' => $results,
			)
		);
	}

	/**
	 * Build the same ticket id string scanners / Check-ins apps use (`get_single_ticket`).
	 *
	 * @param int $ticket_post_id Ticket CPT id.
	 * @return array{ticketId:string,numericId:string}
	 */
	private function ticket_lookup_identifier_for_post( $ticket_post_id ) {
		$ticket_post_id = absint( $ticket_post_id );
		$product_id     = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsProductID', true );
		$numeric_tid    = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsTicketID', true );
		$formatted      = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsTicketNumberFormatted', true );
		if ( '' === $product_id ) {
			return array(
				'ticketId'  => $numeric_tid,
				'numericId' => $numeric_tid,
			);
		}
		$identifier_mode = (string) get_post_meta( absint( $product_id ), 'WooCommerceEventsTicketIdentifierOutput', true );
		if ( '' === $identifier_mode ) {
			$identifier_mode = 'ticketid';
		}
		if ( 'ticketnumberformatted' === $identifier_mode && '' !== $formatted ) {
			return array(
				'ticketId'  => $product_id . '-' . $formatted,
				'numericId' => $numeric_tid,
			);
		}
		return array(
			'ticketId'  => $numeric_tid,
			'numericId' => $numeric_tid,
		);
	}

	/**
	 * Resolve `event_magic_tickets` post ID from the same lookup string as `get_single_ticket()`.
	 *
	 * @param string $ticket_lookup Ticket id or productId-formatted id.
	 * @return int Post ID or 0.
	 */
	private function resolve_ticket_post_id_for_lookup( $ticket_lookup ) {
		$ticket_lookup = sanitize_text_field( (string) $ticket_lookup );
		if ( '' === $ticket_lookup ) {
			return 0;
		}
		$args = array(
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
	 * GET /validate/ticket/{ticketId}
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_validate_ticket( WP_REST_Request $request ) {
		$ticket_id = isset( $request['ticketId'] ) ? sanitize_text_field( rawurldecode( (string) $request['ticketId'] ) ) : '';
		if ( '' === $ticket_id ) {
			return new WP_Error( 'rest_invalid_param', __( 'ticketId is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$out = get_single_ticket( $ticket_id );
		if ( ! empty( $out['status'] ) && 'error' === $out['status'] ) {
			return new WP_Error( 'not_found', __( 'Ticket not found.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}
		if ( empty( $out['data'] ) || ! is_array( $out['data'] ) ) {
			return new WP_Error( 'not_found', __( 'Ticket not found.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$data = $out['data'];
		$pid  = isset( $data['WooCommerceEventsProductID'] ) ? absint( $data['WooCommerceEventsProductID'] ) : 0;

		// FooEvents sometimes omits booking IDs from `get_ticket_data()`; read from the ticket post for Validate UI + reschedule.
		$ticket_post_id = $this->resolve_ticket_post_id_for_lookup( $ticket_id );
		if ( $ticket_post_id > 0 ) {
			if ( empty( $data['WooCommerceEventsBookingSlotID'] ) ) {
				$data['WooCommerceEventsBookingSlotID'] = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingSlotID', true );
			}
			if ( empty( $data['WooCommerceEventsBookingDateID'] ) ) {
				$data['WooCommerceEventsBookingDateID'] = (string) get_post_meta( $ticket_post_id, 'WooCommerceEventsBookingDateID', true );
			}
		}

		if ( $pid > 0 && function_exists( 'wc_get_product' ) ) {
			$product = wc_get_product( $pid );
			if ( $product ) {
				$data['eventDisplayName'] = $product->get_name();
			}
		}

		return rest_ensure_response(
			array(
				'ticket' => $data,
			)
		);
	}

	/**
	 * POST /validate/ticket/{ticketId} — body `{ "status": "Checked In" | "Not Checked In" | "Canceled" }`.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function post_validate_ticket_status( WP_REST_Request $request ) {
		$ticket_id = isset( $request['ticketId'] ) ? sanitize_text_field( rawurldecode( (string) $request['ticketId'] ) ) : '';
		if ( '' === $ticket_id ) {
			return new WP_Error( 'rest_invalid_param', __( 'ticketId is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$params = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$status = isset( $params['status'] ) ? trim( wp_strip_all_tags( (string) $params['status'] ) ) : '';
		$allowed = array( 'Checked In', 'Not Checked In', 'Canceled' );
		if ( ! in_array( $status, $allowed, true ) ) {
			return new WP_Error(
				'rest_invalid_param',
				__( 'Invalid status. Use Checked In, Not Checked In, or Canceled.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$result = update_ticket_status( $ticket_id, $status );

		return rest_ensure_response(
			array(
				'message'       => $result,
				'appliedStatus' => $status,
			)
		);
	}

	/**
	 * POST /validate/ticket/{ticketId}/reschedule — body `{ "eventId", "slotId", "dateId" }`.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function post_validate_ticket_reschedule( WP_REST_Request $request ) {
		$ticket_id = isset( $request['ticketId'] ) ? sanitize_text_field( rawurldecode( (string) $request['ticketId'] ) ) : '';
		if ( '' === $ticket_id ) {
			return new WP_Error( 'rest_invalid_param', __( 'ticketId is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$params = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$event_id = isset( $params['eventId'] ) ? (int) $params['eventId'] : 0;
		$slot_id  = isset( $params['slotId'] ) ? trim( (string) $params['slotId'] ) : '';
		$date_id  = isset( $params['dateId'] ) ? trim( (string) $params['dateId'] ) : '';

		$result = $this->ticket_reschedule->reschedule(
			$ticket_id,
			$event_id,
			$slot_id,
			$date_id,
			(int) get_current_user_id()
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $result );
	}

	/**
	 * POST /bookings
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function post_bookings( WP_REST_Request $request ) {
		$params = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$event_id = isset( $params['eventId'] ) ? (int) $params['eventId'] : 0;
		$slot_id  = isset( $params['slotId'] ) ? trim( (string) $params['slotId'] ) : '';
		$date_id  = isset( $params['dateId'] ) ? trim( (string) $params['dateId'] ) : '';
		$qty      = isset( $params['qty'] ) ? (int) $params['qty'] : 1;
		$att      = isset( $params['attendee'] ) && is_array( $params['attendee'] ) ? $params['attendee'] : array();
		$fn       = isset( $att['firstName'] ) ? trim( (string) $att['firstName'] ) : '';
		$ln       = isset( $att['lastName'] ) ? trim( (string) $att['lastName'] ) : '';
		$em       = isset( $att['email'] ) ? trim( (string) $att['email'] ) : '';
		$note   = isset( $params['note'] ) ? sanitize_text_field( (string) $params['note'] ) : '';
		$pm_key = isset( $params['paymentMethodKey'] ) ? trim( (string) $params['paymentMethodKey'] ) : '';

		$check_in_now = false;
		if ( isset( $params['checkInNow'] ) ) {
			$boo = filter_var( $params['checkInNow'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE );
			$check_in_now = null === $boo ? (bool) $params['checkInNow'] : (bool) $boo;
		}

		$booking_args = array(
			'payment_method_key' => $pm_key,
			'attendee_first'     => $fn,
			'attendee_last'      => $ln,
			'attendee_email'     => $em,
			'note'               => $note,
			'check_in_now'       => $check_in_now,
		);

		if ( ! empty( $params['lines'] ) && is_array( $params['lines'] ) ) {
			$lines_snake = $this->normalize_rest_booking_lines_array( $params['lines'] );
			if ( is_wp_error( $lines_snake ) ) {
				return $lines_snake;
			}
			$booking_args['lines'] = $lines_snake;
		} else {
			if ( $event_id <= 0 || '' === $slot_id || '' === $date_id ) {
				return new WP_Error( 'rest_invalid_param', __( 'eventId, slotId, and dateId are required unless lines[] is sent.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			if ( $qty < 1 || $qty > 20 ) {
				return new WP_Error( 'rest_invalid_param', __( 'qty must be between 1 and 20.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			$booking_args['event_id'] = $event_id;
			$booking_args['slot_id']  = $slot_id;
			$booking_args['date_id']  = $date_id;
			$booking_args['qty']      = $qty;
		}

		if ( '' === $fn || '' === $ln || mb_strlen( $fn ) > 100 || mb_strlen( $ln ) > 100 ) {
			return new WP_Error( 'rest_invalid_param', __( 'attendee.firstName and attendee.lastName are required (max 100 characters each).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( ! is_email( $em ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'A valid attendee.email is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$out = $this->booking_checkout->create_booking( $booking_args );

		if ( is_wp_error( $out ) ) {
			return $out;
		}

		return rest_ensure_response( $out );
	}
}
