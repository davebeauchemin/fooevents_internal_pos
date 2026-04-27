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
	 * Constructor.
	 */
	public function __construct() {
		$this->bookings       = new Bookings_Service();
		$this->slot_generator = new Slot_Generator_Service();
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
}
