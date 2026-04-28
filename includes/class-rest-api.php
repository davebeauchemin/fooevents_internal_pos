<?php
/**
 * REST API: internalpos/v1
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WP_Error;
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
	 * Constructor.
	 */
	public function __construct() {
		$this->bookings         = new Bookings_Service();
		$this->slot_generator   = new Slot_Generator_Service();
		$this->booking_checkout = new Bookings_Checkout_Service( $this->bookings );
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
				'permission_callback' => array( $this, 'can_manage' ),
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
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/events/(?P<id>\\d+)/slots/generate',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_slots_generate' ),
				'permission_callback' => array( $this, 'can_manage' ),
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
				'permission_callback' => array( $this, 'can_manage' ),
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
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/bookings',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_bookings' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/checkout/preview',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'post_checkout_preview' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/payment-methods',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_payment_methods' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);
	}

	/**
	 * @return true|WP_Error
	 */
	public function can_manage() {
		if ( ! is_user_logged_in() || ! current_user_can( 'manage_woocommerce' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to use Internal POS.', 'fooevents-internal-pos' ),
				array( 'status' => 403 )
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
		$note     = isset( $params['note'] ) ? sanitize_text_field( (string) $params['note'] ) : '';
		$pm_key   = isset( $params['paymentMethodKey'] ) ? trim( (string) $params['paymentMethodKey'] ) : '';

		$booking_args = array(
			'payment_method_key' => $pm_key,
			'attendee_first'     => $fn,
			'attendee_last'      => $ln,
			'attendee_email'     => $em,
			'note'               => $note,
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
