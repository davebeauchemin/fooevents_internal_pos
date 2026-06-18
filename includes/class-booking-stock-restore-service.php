<?php
/**
 * Restore FooEvents serialized booking stock when cancelled/failed orders do not release spots.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Order;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Safety-net stock restore on order cancel/failed plus retroactive repair on event load.
 */
class Booking_Stock_Restore_Service {

	const ORDER_RELEASE_META  = '_internal_pos_booking_stock_released';
	const ORDER_SNAPSHOT_META = '_internal_pos_booking_stock_snapshot';

	/**
	 * @var Bookings_Service
	 */
	private $bookings;

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
	 * Repair drifted serialized stock for a booking product (called on event read).
	 *
	 * @param int $product_id Product ID.
	 * @return bool True when any cell was updated.
	 */
	public function repair_product_stock( $product_id ) {
		$product_id = absint( $product_id );
		if ( $product_id <= 0 ) {
			return false;
		}

		$cells          = $this->enumerate_slot_date_cells( $product_id );
		$updated        = false;
		$flagged_orders = array();

		foreach ( $cells as $cell ) {
			$raw = $cell['stock'];
			if ( null === $raw ) {
				continue;
			}

			$unrel = count( $cell['unreleased_order_ids'] );
			if ( $unrel <= 0 ) {
				continue;
			}

			$candidate  = (int) $raw + (int) $unrel;
			$needs_bump = (int) $raw < $candidate
				&& (
					1 === (int) $unrel
					|| (int) $raw < ( (int) $unrel * 2 )
				);

			if ( $needs_bump ) {
				if ( $this->sync_serialized_stock( $product_id, $cell['slot_id'], $cell['date_id'], $candidate ) ) {
					$updated = true;
				}
			}

			foreach ( $cell['unreleased_order_ids'] as $oid ) {
				$flagged_orders[ (int) $oid ] = true;
			}
		}

		foreach ( array_keys( $flagged_orders ) as $order_id ) {
			$this->mark_order_stock_released( $order_id );
		}

		return $updated;
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

		$fb            = new \FooEvents_Bookings();
		$sync_products = array();

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
				continue;
			}

			$persisted = false;
			$result    = $this->mutate_booking_stock( $fb, $product_id, $slot_id, $date_id, 1, $persisted );
			if ( true === $result && $persisted ) {
				$sync_products[ $product_id ] = $product_id;
			}
		}

		foreach ( $sync_products as $product_id ) {
			$this->maybe_wpml_sync_bookings( $fb, $product_id );
		}

		$this->mark_order_stock_released( $order_id );
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
	 * @return array<int,array{slot_id:string,date_id:string,stock:int|null,unreleased_order_ids:int[]}>
	 */
	private function enumerate_slot_date_cells( $product_id ) {
		$ctx     = $this->bookings->get_processed_options( $product_id );
		$method  = (string) $ctx['method'];
		$options = $ctx['options'];
		$cells   = array();

		$unreleased_orders = $this->query_orders_for_product( $product_id, array( 'cancelled', 'failed' ) );
		$unreleased_by_key = array();
		foreach ( $unreleased_orders as $order ) {
			if ( $order->get_meta( self::ORDER_RELEASE_META, true ) ) {
				continue;
			}
			if ( $this->order_has_ticket_cpts( $order->get_id() ) ) {
				continue;
			}
			$oid = (int) $order->get_id();
			foreach ( $this->extract_booking_lines_from_order( $order, $product_id ) as $line ) {
				$key = $this->slot_date_key( $line['slot_id'], $line['date_id'] );
				if ( ! isset( $unreleased_by_key[ $key ] ) ) {
					$unreleased_by_key[ $key ] = array();
				}
				$unreleased_by_key[ $key ][ $oid ] = $oid;
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
						'slot_id'              => (string) $slot_id,
						'date_id'              => $date_id,
						'stock'                => $this->normalize_stock_value( $stock ),
						'unreleased_order_ids' => isset( $unreleased_by_key[ $key ] ) ? array_values( $unreleased_by_key[ $key ] ) : array(),
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
					'slot_id'              => (string) $slot_id,
					'date_id'              => (string) $date_id,
					'stock'                => $this->normalize_stock_value( $stock ),
					'unreleased_order_ids' => isset( $unreleased_by_key[ $key ] ) ? array_values( $unreleased_by_key[ $key ] ) : array(),
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
	private function read_serialized_stock_raw( $product_id, $slot_id, $date_id ) {
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
