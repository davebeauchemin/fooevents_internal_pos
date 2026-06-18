<?php
/**
 * Canonical read/write for FooEvents booking remaining stock (`fooevents_bookings_options_serialized`).
 *
 * Mirrors FooEvents storefront availability: each slot–date cell stores remaining spots,
 * not sold count. Unlimited cells use an empty stock string.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Single source for booking capacity mutations and stock interpretation.
 */
class Booking_Stock_Service {

	/**
	 * @return \FooEvents_Bookings|null
	 */
	private function bookings_plugin() {
		return class_exists( '\\FooEvents_Bookings' ) ? new \FooEvents_Bookings() : null;
	}

	/**
	 * WooCommerceEventsBookingsMethod for a product (slotdate|dateslot).
	 *
	 * @param int $product_id Product ID.
	 * @return string
	 */
	public function get_booking_method( $product_id ) {
		$method = get_post_meta( absint( $product_id ), 'WooCommerceEventsBookingsMethod', true );
		if ( empty( $method ) || '1' === (string) $method ) {
			return 'slotdate';
		}
		return (string) $method;
	}

	/**
	 * Load options via FooEvents preprocess (slot-id keyed; before dateslot reshuffle).
	 *
	 * @param int $product_id Product ID.
	 * @return array<string,mixed>
	 */
	public function load_preprocess_options( $product_id ) {
		$product_id = absint( $product_id );
		$fb         = $this->bookings_plugin();
		if ( null === $fb || $product_id <= 0 ) {
			return array();
		}

		$serialized = get_post_meta( $product_id, 'fooevents_bookings_options_serialized', true );
		$raw        = is_string( $serialized ) ? json_decode( wp_unslash( $serialized ), true ) : array();
		if ( ! is_array( $raw ) ) {
			$raw = array();
		}
		if ( empty( $raw ) ) {
			return array();
		}

		$parsed = $fb->process_booking_options( $raw );
		return is_array( $parsed ) ? $parsed : array();
	}

	/**
	 * Remaining spots for a slot–date cell (FooEvents preprocess keys).
	 *
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot key in serialized options.
	 * @param string $date_id    Date attachment key in add_date.
	 * @return int|null Null when unlimited or cell missing; int >= 0 when finite.
	 */
	public function get_remaining_stock( $product_id, $slot_id, $date_id ) {
		$product_id = absint( $product_id );
		$slot_id    = trim( (string) $slot_id );
		$date_id    = trim( (string) $date_id );
		if ( $product_id <= 0 || '' === $slot_id || '' === $date_id ) {
			return null;
		}

		$options = $this->load_preprocess_options( $product_id );
		$cell    = $this->resolve_cell( $options, $slot_id, $date_id );
		if ( null === $cell ) {
			return null;
		}

		return $this->normalize_stock_for_rest( $cell['stock'] ?? '' );
	}

	/**
	 * REST/API normalization: null = unlimited.
	 *
	 * @param mixed $stock Raw stock from serialized options.
	 * @return int|null
	 */
	public function normalize_stock_for_rest( $stock ) {
		if ( '' === $stock || null === $stock ) {
			return null;
		}
		$n = (int) $stock;
		if ( $n < 0 ) {
			return null;
		}
		return $n;
	}

	/**
	 * Availability gate (matches Bookings_Service::interpret_stock).
	 *
	 * @param mixed $stock Raw or normalized stock.
	 * @param int   $qty   Requested quantity.
	 * @return array{ available: bool, remaining: int|null, reason: string }
	 */
	public function interpret_stock( $stock, $qty ) {
		$qty = max( 1, (int) $qty );
		if ( '' === $stock || null === $stock ) {
			return array( 'available' => true, 'remaining' => null, 'reason' => 'unlimited' );
		}
		$n = (int) $stock;
		if ( $n < 0 ) {
			return array( 'available' => true, 'remaining' => null, 'reason' => 'unlimited' );
		}
		$ok = $n >= $qty;
		return array(
			'available' => $ok,
			'remaining' => max( 0, $n ),
			'reason'    => $ok ? 'ok' : 'insufficient',
		);
	}

	/**
	 * Increment or decrement remaining stock for a finite cell.
	 *
	 * @param int    $product_id   Product ID.
	 * @param string $slot_id      Slot key.
	 * @param string $date_id      Date key.
	 * @param int    $delta        Positive releases, negative consumes.
	 * @param bool   $block_on_full When true, consuming below zero returns WP_Error.
	 * @return true|WP_Error
	 */
	public function mutate_remaining_stock( $product_id, $slot_id, $date_id, $delta, $block_on_full = true ) {
		$product_id = absint( $product_id );
		$slot_id    = trim( (string) $slot_id );
		$date_id    = trim( (string) $date_id );
		$delta      = (int) $delta;

		if ( $product_id <= 0 || '' === $slot_id || '' === $date_id || 0 === $delta ) {
			return true;
		}

		$fb = $this->bookings_plugin();
		if ( null === $fb ) {
			return new WP_Error(
				'fooevents_unavailable',
				__( 'FooEvents Bookings is not available.', 'fooevents-internal-pos' ),
				array( 'status' => 503 )
			);
		}

		$persisted = false;
		$result    = $this->mutate_preprocess_options( $fb, $product_id, $slot_id, $date_id, $delta, $block_on_full, $persisted );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		if ( $persisted ) {
			$this->maybe_wpml_sync_bookings( $fb, $product_id );
		}

		return true;
	}

	/**
	 * @param \FooEvents_Bookings $fb           Bookings instance.
	 * @param int                 $product_id   Product ID.
	 * @param string              $slot_id      Slot key.
	 * @param string              $date_id      Date key.
	 * @param int                 $delta        Stock delta.
	 * @param bool                $block_on_full Block consume when zero remaining.
	 * @param bool                $persisted_out Set true when meta updated.
	 * @return true|WP_Error
	 */
	public function mutate_preprocess_options( $fb, $product_id, $slot_id, $date_id, $delta, $block_on_full, &$persisted_out ) {
		$persisted_out = false;
		$product_id    = absint( $product_id );
		$delta         = (int) $delta;

		$options = $this->load_preprocess_options( $product_id );
		$cell    = $this->resolve_cell( $options, $slot_id, $date_id );
		if ( null === $cell ) {
			return new WP_Error(
				'booking_cell_missing',
				__( 'Booking slot/date cell not found.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$slot_key = $cell['slot_key'];
		$date_key = $cell['date_key'];
		$stock_raw = $options[ $slot_key ]['add_date'][ $date_key ]['stock'] ?? '';

		if ( '' === $stock_raw || null === $stock_raw ) {
			return true;
		}

		$current = (int) $stock_raw;
		if ( $block_on_full && $delta < 0 && $current < 1 ) {
			return new WP_Error(
				'booking_full',
				__( 'Cannot reactivate: this session has no available spots.', 'fooevents-internal-pos' ),
				array( 'status' => 409 )
			);
		}

		$next = $current + $delta;
		if ( $block_on_full && $next < 0 ) {
			return new WP_Error(
				'booking_full',
				__( 'Cannot reactivate: this session has no available spots.', 'fooevents-internal-pos' ),
				array( 'status' => 409 )
			);
		}

		$options[ $slot_key ]['add_date'][ $date_key ]['stock'] = max( 0, $next );

		$updated = wp_json_encode( $options, JSON_UNESCAPED_UNICODE );
		if ( false === $updated ) {
			return new WP_Error(
				'json_error',
				__( 'Failed to encode booking options.', 'fooevents-internal-pos' ),
				array( 'status' => 500 )
			);
		}

		update_post_meta( $product_id, 'fooevents_bookings_options_serialized', $updated );
		$persisted_out = true;

		return true;
	}

	/**
	 * Resolve slot/date keys and stock cell in preprocess options.
	 *
	 * @param array<string,mixed> $options  Preprocess options.
	 * @param string              $slot_id  Slot id.
	 * @param string              $date_id  Date id.
	 * @return array{slot_key:string|int,date_key:string|int,stock:mixed}|null
	 */
	public function resolve_cell( array $options, $slot_id, $date_id ) {
		$slot_key = $this->normalize_struct_key( $options, $slot_id );
		if ( null === $slot_key || ! isset( $options[ $slot_key ] ) || ! is_array( $options[ $slot_key ] ) ) {
			return null;
		}

		$add_date = isset( $options[ $slot_key ]['add_date'] ) && is_array( $options[ $slot_key ]['add_date'] )
			? $options[ $slot_key ]['add_date'] : array();

		$date_key = $this->normalize_struct_key( $add_date, $date_id );
		if ( null === $date_key || ! isset( $add_date[ $date_key ] ) || ! is_array( $add_date[ $date_key ] ) ) {
			return null;
		}

		return array(
			'slot_key' => $slot_key,
			'date_key' => $date_key,
			'stock'    => $add_date[ $date_key ]['stock'] ?? '',
		);
	}

	/**
	 * @param array<string|int,mixed> $struct Keyed subtree.
	 * @param string                  $needle Client id.
	 * @return string|int|null
	 */
	public function normalize_struct_key( array $struct, $needle ) {
		$needle = trim( (string) $needle );
		if ( '' === $needle ) {
			return null;
		}
		foreach ( array_keys( $struct ) as $k ) {
			if ( (string) $k === $needle ) {
				return $k;
			}
		}
		return null;
	}

	/**
	 * @param \FooEvents_Bookings $fb         Bookings instance.
	 * @param int                 $product_id Product ID.
	 */
	public function maybe_wpml_sync_bookings( $fb, $product_id ) {
		if ( method_exists( $fb, 'wpml_sync_bookings_between_translations' ) ) {
			$fb->wpml_sync_bookings_between_translations( absint( $product_id ) );
		}
	}

	/**
	 * Whether a product is a finite-capacity booking event.
	 *
	 * @param int $product_id Product ID.
	 * @return bool
	 */
	public function is_booking_event_product( $product_id ) {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return false;
		}
		$product = wc_get_product( absint( $product_id ) );
		if ( ! $product ) {
			return false;
		}
		return 'Event' === $product->get_meta( 'WooCommerceEventsEvent', true )
			&& 'bookings' === $product->get_meta( 'WooCommerceEventsType', true );
	}
}
