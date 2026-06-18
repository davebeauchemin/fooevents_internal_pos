<?php
/**
 * Restore FooEvents serialized booking stock and compute effective POS availability.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Order;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Safety-net stock restore on order cancel/failed, repair on event load, effective remaining for POS.
 */
class Booking_Stock_Restore_Service {

	const ORDER_RELEASE_META  = '_internal_pos_booking_stock_released';
	const ORDER_SNAPSHOT_META = '_internal_pos_booking_stock_snapshot';
	const META_SLOT_TOTALS    = 'fooevents_internal_pos_slot_totals';
	const HOLD_STATUSES       = array( 'pending', 'processing', 'on-hold' );

	/**
	 * @var Bookings_Service
	 */
	private $bookings;

	/**
	 * @var array<int,bool> Product IDs already repaired this request.
	 */
	private $repaired_products = array();

	/**
	 * @var array<int,array<string,int>> Per-product order hold counts keyed by slot-date.
	 */
	private $order_holds_cache = array();

	/**
	 * @param Bookings_Service|null $bookings Optional bookings service.
	 */
	public function __construct( $bookings = null ) {
		$this->bookings = $bookings instanceof Bookings_Service ? $bookings : new Bookings_Service();
	}

	/**
	 * Register WooCommerce order hooks.
	 */
	public function init() {
		add_action( 'woocommerce_order_status_cancelled', array( $this, 'snapshot_order_stock' ), 5, 1 );
		add_action( 'woocommerce_order_status_failed', array( $this, 'snapshot_order_stock' ), 5, 1 );
		add_action( 'woocommerce_order_status_cancelled', array( $this, 'restore_order_stock' ), 20, 1 );
		add_action( 'woocommerce_order_status_failed', array( $this, 'restore_order_stock' ), 20, 1 );
	}

	/**
	 * Repair drifted serialized stock and backfill slot totals (called on event read).
	 *
	 * @param int $product_id Product ID.
	 * @return bool True when any cell was updated.
	 */
	public function repair_product_stock( $product_id ) {
		$product_id = absint( $product_id );
		if ( $product_id <= 0 ) {
			return false;
		}

		$cells   = $this->enumerate_slot_date_cells( $product_id );
		$booked  = $this->bookings->get_active_booked_counts_by_slot_date( $product_id );
		$holds   = $this->count_order_holds_by_slot_date( $product_id );
		$totals  = $this->load_slot_totals( $product_id );
		$updated = false;

		foreach ( $cells as $cell ) {
			$raw = $cell['stock'];
			if ( null === $raw ) {
				continue;
			}

			$slot_id = (string) $cell['slot_id'];
			$date_id = (string) $cell['date_id'];
			$key     = $this->slot_date_key( $slot_id, $date_id );

			$active     = isset( $booked[ $key ] ) ? (int) $booked[ $key ] : 0;
			$hold       = isset( $holds[ $key ] ) ? (int) $holds[ $key ] : 0;
			$drift_cnt  = count( $cell['drift_cancelled_order_ids'] );
			$meta_exist = array_key_exists( $key, $totals );

			if ( ! $meta_exist ) {
				$base = max( 0, (int) $raw + $active + $hold );
				if ( $drift_cnt > 0 && ( 1 === $drift_cnt || (int) $raw < ( $drift_cnt * 2 ) ) ) {
					$totals[ $key ] = max( $base, (int) $raw + $active + $hold + $drift_cnt );
				} else {
					$totals[ $key ] = $base;
				}
			}

			$total     = max( 0, (int) $totals[ $key ] );
			$effective = max( 0, $total - $active - $hold );

			if ( (int) $raw < (int) $effective ) {
				if ( $this->sync_serialized_stock( $product_id, $slot_id, $date_id, $effective ) ) {
					$updated = true;
				}
			}

			if ( ! empty( $cell['drift_cancelled_order_ids'] ) && (int) $raw <= (int) $effective ) {
				foreach ( $cell['drift_cancelled_order_ids'] as $oid ) {
					$this->clear_stale_release_meta_if_needed( (int) $oid, $product_id, $slot_id, $date_id, (int) $raw, (int) $effective );
					if ( (int) $raw < (int) $effective || $this->order_has_release_meta( (int) $oid ) ) {
						$this->mark_order_stock_released( (int) $oid );
					}
				}
			}
		}

		$this->save_slot_totals( $product_id, $totals );

		$this->repaired_products[ $product_id ] = true;

		return $updated;
	}

	/**
	 * Cashier-facing remaining spots for a slot–date cell.
	 *
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @return int|null Null = unlimited.
	 */
	public function compute_effective_remaining( $product_id, $slot_id, $date_id ) {
		$product_id = absint( $product_id );
		if ( $product_id > 0 && empty( $this->repaired_products[ $product_id ] ) ) {
			$this->repair_product_stock( $product_id );
			$this->repaired_products[ $product_id ] = true;
		}

		$raw = $this->read_serialized_stock_raw( $product_id, $slot_id, $date_id );
		if ( null === $raw ) {
			return null;
		}

		$key    = $this->slot_date_key( $slot_id, $date_id );
		$booked = $this->bookings->get_active_booked_counts_by_slot_date( $product_id );
		$holds  = $this->count_order_holds_by_slot_date( $product_id );

		$active = isset( $booked[ $key ] ) ? (int) $booked[ $key ] : 0;
		$hold   = isset( $holds[ $key ] ) ? (int) $holds[ $key ] : 0;

		$total = $this->get_total_capacity( $product_id, $slot_id, $date_id, $raw, $active, $hold );
		if ( null === $total ) {
			return null;
		}

		return max( 0, (int) $total - $active - $hold );
	}

	/**
	 * Replace REST slot `stock` with effective remaining and recompute day aggregates.
	 *
	 * @param int                            $product_id Product ID.
	 * @param array<int,array<string,mixed>> $dates_out  Built dates from get_event_detail.
	 * @param array<string,int>              $booked     Active ticket counts by slot-date key.
	 * @return array<int,array<string,mixed>>
	 */
	public function apply_effective_to_dates( $product_id, array $dates_out, array $booked ) {
		$holds = $this->count_order_holds_by_slot_date( $product_id );

		foreach ( $dates_out as &$day ) {
			if ( ! is_array( $day ) || empty( $day['slots'] ) || ! is_array( $day['slots'] ) ) {
				continue;
			}
			foreach ( $day['slots'] as &$slot ) {
				if ( ! is_array( $slot ) ) {
					continue;
				}
				$sid = trim( (string) ( $slot['id'] ?? '' ) );
				$did = trim( (string) ( $slot['dateId'] ?? '' ) );
				if ( '' === $sid || '' === $did ) {
					continue;
				}
				if ( ! array_key_exists( 'stock', $slot ) || null === $slot['stock'] ) {
					continue;
				}

				$key    = $this->slot_date_key( $sid, $did );
				$active = isset( $booked[ $key ] ) ? (int) $booked[ $key ] : 0;
				$hold   = isset( $holds[ $key ] ) ? (int) $holds[ $key ] : 0;
				$raw    = (int) $slot['stock'];

				$total = $this->get_total_capacity( $product_id, $sid, $did, $raw, $active, $hold );
				if ( null === $total ) {
					continue;
				}

				$slot['stock'] = max( 0, (int) $total - $active - $hold );
			}
			unset( $slot );

			$day['stock'] = $this->aggregate_slot_stock_for_rest( $day['slots'] );
		}
		unset( $day );

		return $dates_out;
	}

	/**
	 * Persist configured total capacity for a slot–date cell.
	 *
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @param int    $capacity   Total capacity (0 allowed).
	 */
	public function set_slot_total( $product_id, $slot_id, $date_id, $capacity ) {
		$product_id = absint( $product_id );
		$capacity   = max( 0, (int) $capacity );
		$totals     = $this->load_slot_totals( $product_id );
		$totals[ $this->slot_date_key( $slot_id, $date_id ) ] = $capacity;
		$this->save_slot_totals( $product_id, $totals );
	}

	/**
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @param int    $delta      Capacity delta (+/-).
	 */
	public function adjust_slot_total( $product_id, $slot_id, $date_id, $delta ) {
		$product_id = absint( $product_id );
		$delta      = (int) $delta;
		if ( 0 === $delta ) {
			return;
		}
		$key    = $this->slot_date_key( $slot_id, $date_id );
		$totals = $this->load_slot_totals( $product_id );
		$cur    = isset( $totals[ $key ] ) ? (int) $totals[ $key ] : 0;
		$totals[ $key ] = max( 0, $cur + $delta );
		$this->save_slot_totals( $product_id, $totals );
	}

	/**
	 * Seed slot totals from raw fooevents_bookings_options_serialized slot map.
	 *
	 * @param int                 $product_id Product ID.
	 * @param array<string,mixed> $raw_slots  Decoded raw slots.
	 * @param bool                $replace    When true, rebuild totals from raw (full schedule replace).
	 */
	public function seed_slot_totals_from_raw_slots( $product_id, array $raw_slots, $replace = false ) {
		$product_id = absint( $product_id );
		$totals     = $replace ? array() : $this->load_slot_totals( $product_id );

		foreach ( $raw_slots as $slot_id => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			foreach ( array_keys( $row ) as $k ) {
				if ( ! preg_match( '/^(.+)_stock$/', (string) $k, $m ) ) {
					continue;
				}
				$date_id = (string) $m[1];
				$stock   = $row[ $k ] ?? '';
				if ( '' === $stock || null === $stock ) {
					continue;
				}
				$key = $this->slot_date_key( (string) $slot_id, $date_id );
				if ( $replace || ! array_key_exists( $key, $totals ) ) {
					$totals[ $key ] = max( 0, (int) $stock );
				}
			}
		}

		$this->save_slot_totals( $product_id, $totals );
	}

	/**
	 * Snapshot serialized stock before FooEvents cancel restore runs (priority 10).
	 *
	 * @param int $order_id Order ID.
	 */
	public function snapshot_order_stock( $order_id ) {
		$order = wc_get_order( absint( $order_id ) );
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		$snapshot = array();
		foreach ( $this->extract_booking_lines_from_order( $order, 0 ) as $line ) {
			$stock = $this->read_serialized_stock_raw( $line['product_id'], $line['slot_id'], $line['date_id'] );
			if ( null === $stock ) {
				continue;
			}
			$snapshot[ $this->cell_key( $line['product_id'], $line['slot_id'], $line['date_id'] ) ] = (int) $stock;
		}

		$order->update_meta_data( self::ORDER_SNAPSHOT_META, $snapshot );
		$order->save();
	}

	/**
	 * Restore stock when FooEvents did not (priority 20, after FooEvents priority 10).
	 *
	 * @param int $order_id Order ID.
	 */
	public function restore_order_stock( $order_id ) {
		$order_id = absint( $order_id );
		if ( $order_id <= 0 ) {
			return;
		}

		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		if ( $order->get_meta( self::ORDER_RELEASE_META, true ) ) {
			return;
		}

		if ( $this->order_has_ticket_cpts( $order_id ) ) {
			return;
		}

		$snapshot = $order->get_meta( self::ORDER_SNAPSHOT_META, true );
		if ( ! is_array( $snapshot ) ) {
			$snapshot = array();
		}

		$lines = $this->extract_booking_lines_from_order( $order, 0 );
		if ( empty( $lines ) ) {
			return;
		}

		if ( ! class_exists( '\\FooEvents_Bookings' ) ) {
			return;
		}

		$fb               = new \FooEvents_Bookings();
		$sync_products    = array();
		$restored_any     = false;
		$fooevents_fixed  = false;

		foreach ( $lines as $line ) {
			$product_id = (int) $line['product_id'];
			$slot_id    = $line['slot_id'];
			$date_id    = $line['date_id'];
			$key        = $this->cell_key( $product_id, $slot_id, $date_id );

			$current = $this->read_serialized_stock_raw( $product_id, $slot_id, $date_id );
			if ( null === $current ) {
				continue;
			}

			if ( array_key_exists( $key, $snapshot ) && (int) $current !== (int) $snapshot[ $key ] ) {
				$fooevents_fixed = true;
				continue;
			}

			$persisted = false;
			$result    = $this->mutate_booking_stock( $fb, $product_id, $slot_id, $date_id, 1, $persisted );
			if ( true === $result && $persisted ) {
				$restored_any              = true;
				$sync_products[ $product_id ] = $product_id;
			}
		}

		foreach ( $sync_products as $product_id ) {
			$this->maybe_wpml_sync_bookings( $fb, $product_id );
		}

		if ( $restored_any || $fooevents_fixed ) {
			$this->mark_order_stock_released( $order_id );
		}
	}

	/**
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @param int    $serialized Normalized remaining stock.
	 * @param int    $active     Active ticket count.
	 * @param int    $holds      Order hold count.
	 * @return int|null Null = unlimited.
	 */
	private function get_total_capacity( $product_id, $slot_id, $date_id, $serialized, $active, $holds ) {
		if ( null === $serialized ) {
			return null;
		}

		$key    = $this->slot_date_key( $slot_id, $date_id );
		$totals = $this->load_slot_totals( absint( $product_id ) );

		if ( array_key_exists( $key, $totals ) && null !== $totals[ $key ] ) {
			return max( 0, (int) $totals[ $key ] );
		}

		return max( 0, (int) $serialized + max( 0, (int) $active ) + max( 0, (int) $holds ) );
	}

	/**
	 * @param int $product_id Product ID.
	 * @return array<string,int|null>
	 */
	private function load_slot_totals( $product_id ) {
		$raw = get_post_meta( absint( $product_id ), self::META_SLOT_TOTALS, true );
		return is_array( $raw ) ? $raw : array();
	}

	/**
	 * @param int                $product_id Product ID.
	 * @param array<string,int|null> $totals Totals map.
	 */
	private function save_slot_totals( $product_id, array $totals ) {
		update_post_meta( absint( $product_id ), self::META_SLOT_TOTALS, $totals );
	}

	/**
	 * @param int $product_id Product ID.
	 * @return array<string,int>
	 */
	public function count_order_holds_by_slot_date( $product_id ) {
		$product_id = absint( $product_id );
		if ( isset( $this->order_holds_cache[ $product_id ] ) ) {
			return $this->order_holds_cache[ $product_id ];
		}

		$out    = array();
		$orders = $this->query_orders_for_product( $product_id, self::HOLD_STATUSES );

		foreach ( $orders as $order ) {
			foreach ( $this->extract_booking_lines_from_order( $order, $product_id ) as $line ) {
				$key = $this->slot_date_key( $line['slot_id'], $line['date_id'] );
				if ( ! isset( $out[ $key ] ) ) {
					$out[ $key ] = 0;
				}
				$out[ $key ]++;
			}
		}

		$this->order_holds_cache[ $product_id ] = $out;
		return $out;
	}

	/**
	 * @param int $order_id Order ID.
	 */
	private function mark_order_stock_released( $order_id ) {
		$order = wc_get_order( absint( $order_id ) );
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$order->update_meta_data( self::ORDER_RELEASE_META, '1' );
		$order->save();
	}

	/**
	 * @param int $order_id Order ID.
	 * @return bool
	 */
	private function order_has_release_meta( $order_id ) {
		$order = wc_get_order( absint( $order_id ) );
		return $order instanceof WC_Order && (bool) $order->get_meta( self::ORDER_RELEASE_META, true );
	}

	/**
	 * @param int    $order_id   Order ID.
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @param int    $raw        Serialized stock before repair.
	 * @param int    $effective  Target effective remaining.
	 */
	private function clear_stale_release_meta_if_needed( $order_id, $product_id, $slot_id, $date_id, $raw, $effective ) {
		if ( (int) $raw >= (int) $effective ) {
			return;
		}
		$order = wc_get_order( absint( $order_id ) );
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		if ( ! $order->get_meta( self::ORDER_RELEASE_META, true ) ) {
			return;
		}
		foreach ( $this->extract_booking_lines_from_order( $order, $product_id ) as $line ) {
			if ( $line['slot_id'] === $slot_id && $line['date_id'] === $date_id ) {
				$order->delete_meta_data( self::ORDER_RELEASE_META );
				$order->save();
				return;
			}
		}
	}

	/**
	 * @param int $order_id Order ID.
	 * @return bool
	 */
	private function order_has_ticket_cpts( $order_id ) {
		$q = new WP_Query(
			array(
				'post_type'              => 'event_magic_tickets',
				'post_status'            => 'any',
				'posts_per_page'         => 1,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
				'meta_query'             => array(
					array(
						'key'   => 'WooCommerceEventsOrderID',
						'value' => absint( $order_id ),
					),
				),
			)
		);

		return ! empty( $q->posts );
	}

	/**
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @return string
	 */
	private function slot_date_key( $slot_id, $date_id ) {
		return trim( (string) $slot_id ) . "\x1e" . trim( (string) $date_id );
	}

	/**
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @return string
	 */
	private function cell_key( $product_id, $slot_id, $date_id ) {
		return absint( $product_id ) . "\x1f" . $this->slot_date_key( $slot_id, $date_id );
	}

	/**
	 * @param array<int,array<string,mixed>> $slots Slot rows with stock keys.
	 * @return int|null
	 */
	private function aggregate_slot_stock_for_rest( array $slots ) {
		$has_limited = false;
		$min         = null;
		foreach ( $slots as $s ) {
			if ( ! is_array( $s ) || ! array_key_exists( 'stock', $s ) ) {
				continue;
			}
			$v = $s['stock'];
			if ( null === $v ) {
				continue;
			}
			$has_limited = true;
			$min         = ( null === $min ) ? (int) $v : min( (int) $min, (int) $v );
		}
		if ( ! $has_limited ) {
			return null;
		}
		return (int) $min;
	}

	/**
	 * @param int   $product_id Product ID.
	 * @param array $statuses   WooCommerce order statuses (without wc- prefix).
	 * @return WC_Order[]
	 */
	private function query_orders_for_product( $product_id, array $statuses ) {
		if ( ! function_exists( 'wc_get_orders' ) ) {
			return array();
		}

		$orders = wc_get_orders(
			array(
				'limit'      => -1,
				'status'     => $statuses,
				'return'     => 'objects',
				'meta_query' => array(
					array(
						'key'     => 'WooCommerceEventsOrderTickets',
						'compare' => 'EXISTS',
					),
				),
			)
		);

		if ( ! is_array( $orders ) ) {
			return array();
		}

		$product_id = absint( $product_id );
		$filtered   = array();

		foreach ( $orders as $order ) {
			if ( ! $order instanceof WC_Order ) {
				continue;
			}
			if ( $product_id > 0 && empty( $this->extract_booking_lines_from_order( $order, $product_id ) ) ) {
				continue;
			}
			$filtered[] = $order;
		}

		return $filtered;
	}

	/**
	 * @param WC_Order $order      Order.
	 * @param int      $product_id Product ID filter; 0 = all booking lines on order.
	 * @return array<int,array{slot_id:string,date_id:string,product_id:int}>
	 */
	private function extract_booking_lines_from_order( $order, $product_id ) {
		$product_id = absint( $product_id );
		$tickets    = $order->get_meta( 'WooCommerceEventsOrderTickets', true );
		if ( empty( $tickets ) || ! is_array( $tickets ) ) {
			return array();
		}

		$out = array();
		foreach ( $tickets as $event_tickets ) {
			if ( ! is_array( $event_tickets ) ) {
				continue;
			}
			foreach ( $event_tickets as $ticket ) {
				if ( ! is_array( $ticket ) ) {
					continue;
				}
				$pid = isset( $ticket['WooCommerceEventsProductID'] ) ? absint( $ticket['WooCommerceEventsProductID'] ) : 0;
				if ( $pid <= 0 ) {
					continue;
				}
				if ( $product_id > 0 && $pid !== $product_id ) {
					continue;
				}
				if ( 'bookings' !== get_post_meta( $pid, 'WooCommerceEventsType', true ) ) {
					continue;
				}
				$ids = $this->booking_ids_from_ticket_row( $ticket );
				if ( null === $ids ) {
					continue;
				}
				$out[] = array(
					'slot_id'    => $ids['slot_id'],
					'date_id'    => $ids['date_id'],
					'product_id' => $pid,
				);
			}
		}

		return $out;
	}

	/**
	 * @param array $ticket Ticket row from order meta.
	 * @return array{slot_id:string,date_id:string}|null
	 */
	private function booking_ids_from_ticket_row( array $ticket ) {
		$opts = isset( $ticket['WooCommerceEventsBookingOptions'] ) ? $ticket['WooCommerceEventsBookingOptions'] : null;
		if ( ! is_array( $opts ) ) {
			return null;
		}

		$slot_id = '';
		if ( isset( $opts['slot_id'] ) && '' !== trim( (string) $opts['slot_id'] ) ) {
			$slot_id = trim( (string) $opts['slot_id'] );
		} elseif ( isset( $opts['slot'] ) && '' !== trim( (string) $opts['slot'] ) ) {
			$slot_id = trim( (string) $opts['slot'] );
		}

		$date_id = '';
		if ( isset( $opts['date_id'] ) && '' !== trim( (string) $opts['date_id'] ) ) {
			$date_id = trim( (string) $opts['date_id'] );
		} elseif ( isset( $opts['date'] ) && '' !== trim( (string) $opts['date'] ) ) {
			$date_id = trim( (string) $opts['date'] );
		}

		if ( '' === $slot_id || '' === $date_id ) {
			return null;
		}

		return array(
			'slot_id' => $slot_id,
			'date_id' => $date_id,
		);
	}

	/**
	 * @param int $product_id Product ID.
	 * @return array<int,array{slot_id:string,date_id:string,stock:int|null,drift_cancelled_order_ids:int[]}>
	 */
	private function enumerate_slot_date_cells( $product_id ) {
		$ctx     = $this->bookings->get_processed_options( $product_id );
		$method  = (string) $ctx['method'];
		$options = $ctx['options'];
		$cells   = array();

		$drift_orders = $this->query_orders_for_product( $product_id, array( 'cancelled', 'failed' ) );
		$drift_by_key = array();
		foreach ( $drift_orders as $order ) {
			if ( $this->order_has_ticket_cpts( $order->get_id() ) ) {
				continue;
			}
			$oid = (int) $order->get_id();
			foreach ( $this->extract_booking_lines_from_order( $order, $product_id ) as $line ) {
				$key = $this->slot_date_key( $line['slot_id'], $line['date_id'] );
				if ( ! isset( $drift_by_key[ $key ] ) ) {
					$drift_by_key[ $key ] = array();
				}
				$drift_by_key[ $key ][ $oid ] = $oid;
			}
		}

		if ( 'dateslot' === $method && is_array( $options ) ) {
			foreach ( $options as $slots_for_date ) {
				if ( ! is_array( $slots_for_date ) ) {
					continue;
				}
				foreach ( $slots_for_date as $slot_id => $row ) {
					if ( ! is_array( $row ) ) {
						continue;
					}
					$date_id = (string) ( $row['date_id'] ?? '' );
					$stock   = $row['stock'] ?? '';
					$key     = $this->slot_date_key( (string) $slot_id, $date_id );
					$cells[] = array(
						'slot_id'                    => (string) $slot_id,
						'date_id'                    => $date_id,
						'stock'                      => $this->normalize_stock_value( $stock ),
						'drift_cancelled_order_ids'  => isset( $drift_by_key[ $key ] ) ? array_values( $drift_by_key[ $key ] ) : array(),
					);
				}
			}
			return $cells;
		}

		if ( ! is_array( $options ) ) {
			return $cells;
		}

		foreach ( $options as $slot_id => $opt ) {
			if ( ! is_array( $opt ) || empty( $opt['add_date'] ) || ! is_array( $opt['add_date'] ) ) {
				continue;
			}
			foreach ( $opt['add_date'] as $date_id => $drow ) {
				if ( ! is_array( $drow ) ) {
					continue;
				}
				$stock = $drow['stock'] ?? '';
				$key   = $this->slot_date_key( (string) $slot_id, (string) $date_id );
				$cells[] = array(
					'slot_id'                   => (string) $slot_id,
					'date_id'                   => (string) $date_id,
					'stock'                     => $this->normalize_stock_value( $stock ),
					'drift_cancelled_order_ids' => isset( $drift_by_key[ $key ] ) ? array_values( $drift_by_key[ $key ] ) : array(),
				);
			}
		}

		return $cells;
	}

	/**
	 * @param mixed $stock Raw stock.
	 * @return int|null
	 */
	private function normalize_stock_value( $stock ) {
		if ( '' === $stock || null === $stock ) {
			return null;
		}
		return (int) $stock;
	}

	/**
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @return int|null
	 */
	public function read_serialized_stock_raw( $product_id, $slot_id, $date_id ) {
		$ctx     = $this->bookings->get_processed_options( absint( $product_id ) );
		$method  = (string) $ctx['method'];
		$options = $ctx['options'];

		if ( 'dateslot' === $method && is_array( $options ) ) {
			foreach ( $options as $slots_for_date ) {
				if ( ! is_array( $slots_for_date ) || ! isset( $slots_for_date[ $slot_id ] ) || ! is_array( $slots_for_date[ $slot_id ] ) ) {
					continue;
				}
				$row              = $slots_for_date[ $slot_id ];
				$internal_date_id = isset( $row['date_id'] ) ? (string) $row['date_id'] : '';
				if ( (string) $date_id !== $internal_date_id ) {
					continue;
				}
				return $this->normalize_stock_value( $row['stock'] ?? '' );
			}
			return null;
		}

		if ( ! is_array( $options ) || ! isset( $options[ $slot_id ]['add_date'][ $date_id ] ) ) {
			return null;
		}

		return $this->normalize_stock_value( $options[ $slot_id ]['add_date'][ $date_id ]['stock'] ?? '' );
	}

	/**
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    Slot id.
	 * @param string $date_id    Date id.
	 * @param int    $remaining  Remaining spots.
	 * @return bool
	 */
	private function sync_serialized_stock( $product_id, $slot_id, $date_id, $remaining ) {
		if ( ! class_exists( '\\FooEvents_Bookings' ) ) {
			return false;
		}

		$product_id = absint( $product_id );
		$remaining  = max( 0, (int) $remaining );
		$fb         = new \FooEvents_Bookings();

		$serialized = get_post_meta( $product_id, 'fooevents_bookings_options_serialized', true );
		$raw        = json_decode( wp_unslash( (string) $serialized ), true );
		if ( ! is_array( $raw ) ) {
			$raw = array();
		}

		$options = $fb->process_booking_options( $raw );

		$slot_key = $this->normalize_struct_key( $options, $slot_id );
		if ( null === $slot_key || ! isset( $options[ $slot_key ] ) || ! is_array( $options[ $slot_key ] ) ) {
			return false;
		}

		$add_date = isset( $options[ $slot_key ]['add_date'] ) && is_array( $options[ $slot_key ]['add_date'] )
			? $options[ $slot_key ]['add_date'] : array();

		$date_key = $this->normalize_struct_key( $add_date, $date_id );
		if ( null === $date_key || ! isset( $add_date[ $date_key ] ) || ! is_array( $add_date[ $date_key ] ) ) {
			return false;
		}

		$stock_raw = $add_date[ $date_key ]['stock'] ?? '';
		if ( '' === $stock_raw || null === $stock_raw ) {
			return false;
		}

		$options[ $slot_key ]['add_date'][ $date_key ]['stock'] = $remaining;

		$updated = wp_json_encode( $options, JSON_UNESCAPED_UNICODE );
		if ( false === $updated ) {
			return false;
		}

		update_post_meta( $product_id, 'fooevents_bookings_options_serialized', $updated );
		$this->maybe_wpml_sync_bookings( $fb, $product_id );
		return true;
	}

	/**
	 * @param \FooEvents_Bookings $fb            Bookings instance.
	 * @param int                 $event_id      Product ID.
	 * @param string              $slot_id       Slot key.
	 * @param string              $date_id       Date attachment key.
	 * @param int                 $delta         +1 or -1.
	 * @param bool                $persisted_out Set true when post meta was updated.
	 * @return true
	 */
	private function mutate_booking_stock( $fb, $event_id, $slot_id, $date_id, $delta, &$persisted_out ) {
		$persisted_out = false;

		$serialized = get_post_meta( $event_id, 'fooevents_bookings_options_serialized', true );
		$raw        = json_decode( (string) $serialized, true );
		if ( ! is_array( $raw ) ) {
			$raw = array();
		}

		$options = $fb->process_booking_options( $raw );

		$slot_key = $this->normalize_struct_key( $options, $slot_id );
		if ( null === $slot_key || ! isset( $options[ $slot_key ] ) || ! is_array( $options[ $slot_key ] ) ) {
			return true;
		}

		$add_date = isset( $options[ $slot_key ]['add_date'] ) && is_array( $options[ $slot_key ]['add_date'] )
			? $options[ $slot_key ]['add_date'] : array();

		$date_key = $this->normalize_struct_key( $add_date, $date_id );
		if ( null === $date_key || ! isset( $add_date[ $date_key ] ) || ! is_array( $add_date[ $date_key ] ) ) {
			return true;
		}

		$stock_raw = $add_date[ $date_key ]['stock'] ?? '';
		if ( '' === $stock_raw || null === $stock_raw ) {
			return true;
		}

		$options[ $slot_key ]['add_date'][ $date_key ]['stock'] = (int) $stock_raw + (int) $delta;

		$updated = wp_json_encode( $options, JSON_UNESCAPED_UNICODE );
		if ( false === $updated ) {
			return true;
		}

		update_post_meta( $event_id, 'fooevents_bookings_options_serialized', $updated );
		$persisted_out = true;

		return true;
	}

	/**
	 * @param array<string|int,mixed> $struct Processed booking subtree.
	 * @param string                  $needle Client id.
	 * @return string|int|null
	 */
	private function normalize_struct_key( array $struct, $needle ) {
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
	 * @param \FooEvents_Bookings $fb       Bookings instance.
	 * @param int                 $event_id Product ID.
	 */
	private function maybe_wpml_sync_bookings( $fb, $event_id ) {
		if ( method_exists( $fb, 'wpml_sync_bookings_between_translations' ) ) {
			$fb->wpml_sync_bookings_between_translations( $event_id );
		}
	}
}
