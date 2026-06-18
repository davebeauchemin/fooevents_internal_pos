<?php
/**
 * Restore FooEvents booking serialized stock when WooCommerce orders cancel/fail without tickets.
 *
 * FooEvents `order_cancelled_return_stock()` can silently fail when blueprint meta is incomplete.
 * This service runs after FooEvents hooks with idempotent order meta guards.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use WC_Order;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * WooCommerce order lifecycle → booking stock restore.
 */
class Order_Status_Stock_Service {

	const RESTORED_META = '_fipos_booking_stock_restored';

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
	 * Register hooks.
	 */
	public function init() {
		add_action( 'woocommerce_order_status_cancelled', array( $this, 'maybe_restore_order_stock' ), 20, 1 );
		add_action( 'woocommerce_order_status_failed', array( $this, 'maybe_restore_order_stock' ), 10, 1 );
		add_action( 'woocommerce_before_trash_order', array( $this, 'maybe_restore_order_stock' ), 10, 1 );
		add_action( 'before_delete_post', array( $this, 'maybe_restore_on_delete' ), 10, 2 );
	}

	/**
	 * @param int $order_id Order ID.
	 */
	public function maybe_restore_order_stock( $order_id ) {
		$this->restore_order_stock( absint( $order_id ), false );
	}

	/**
	 * @param int      $post_id Post ID.
	 * @param \WP_Post $post    Post object.
	 */
	public function maybe_restore_on_delete( $post_id, $post ) {
		if ( ! $post || 'shop_order' !== $post->post_type ) {
			return;
		}
		$this->restore_order_stock( absint( $post_id ), false );
	}

	/**
	 * Restore booking stock for an order (idempotent unless $force).
	 *
	 * @param int  $order_id Order ID.
	 * @param bool $force    When true, ignore restored meta (repair mode).
	 * @return array{restored:int,skipped:bool,lines:array<int,array<string,mixed>>}
	 */
	public function restore_order_stock( $order_id, $force = false ) {
		$order_id = absint( $order_id );
		$out      = array(
			'restored' => 0,
			'skipped'  => false,
			'lines'    => array(),
		);

		if ( $order_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			$out['skipped'] = true;
			return $out;
		}

		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			$out['skipped'] = true;
			return $out;
		}

		if ( ! $force && 'yes' === (string) $order->get_meta( self::RESTORED_META, true ) ) {
			$out['skipped'] = true;
			return $out;
		}

		if ( $this->order_has_event_tickets( $order_id ) ) {
			if ( ! $force ) {
				$order->update_meta_data( self::RESTORED_META, 'yes' );
				$order->save();
			}
			$out['skipped'] = true;
			return $out;
		}

		$lines = $this->collect_booking_restore_lines( $order );
		if ( empty( $lines ) ) {
			$out['skipped'] = true;
			return $out;
		}

		foreach ( $lines as $line ) {
			$product_id = (int) ( $line['product_id'] ?? 0 );
			$slot_id    = (string) ( $line['slot_id'] ?? '' );
			$date_id    = (string) ( $line['date_id'] ?? '' );
			$qty        = max( 1, (int) ( $line['qty'] ?? 1 ) );

			if ( $product_id <= 0 || '' === $slot_id || '' === $date_id ) {
				continue;
			}
			if ( ! $this->stock->is_booking_event_product( $product_id ) ) {
				continue;
			}

			for ( $i = 0; $i < $qty; $i++ ) {
				$apply = $this->stock->mutate_remaining_stock( $product_id, $slot_id, $date_id, 1, false );
				if ( ! is_wp_error( $apply ) ) {
					++$out['restored'];
					$out['lines'][] = array(
						'productId' => $product_id,
						'slotId'    => $slot_id,
						'dateId'    => $date_id,
					);
				}
			}
		}

		if ( $out['restored'] > 0 || ! $force ) {
			$order->update_meta_data( self::RESTORED_META, 'yes' );
			$order->save();
		}

		return $out;
	}

	/**
	 * @param int $order_id Order ID.
	 * @return bool
	 */
	private function order_has_event_tickets( $order_id ) {
		$order_id = absint( $order_id );
		if ( $order_id <= 0 ) {
			return false;
		}

		$q = new WP_Query(
			array(
				'post_type'              => 'event_magic_tickets',
				'post_status'            => 'any',
				'posts_per_page'         => 1,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'meta_query'             => array(
					array(
						'key'   => 'WooCommerceEventsOrderID',
						'value' => (string) $order_id,
					),
				),
			)
		);

		return ! empty( $q->posts );
	}

	/**
	 * Booking restore lines from order blueprint and line items.
	 *
	 * @param WC_Order $order Order.
	 * @return array<int,array{product_id:int,slot_id:string,date_id:string,qty:int}>
	 */
	public function collect_booking_restore_lines( WC_Order $order ) {
		$lines  = array();
		$seen   = array();

		$blueprint = $order->get_meta( 'WooCommerceEventsOrderTickets', true );
		if ( is_array( $blueprint ) ) {
			foreach ( $blueprint as $event_tickets ) {
				if ( ! is_array( $event_tickets ) ) {
					continue;
				}
				foreach ( $event_tickets as $ticket ) {
					if ( ! is_array( $ticket ) ) {
						continue;
					}
					$parsed = $this->parse_booking_line_from_ticket_row( $ticket );
					if ( null === $parsed ) {
						continue;
					}
					$key = $parsed['product_id'] . "\x1e" . $parsed['slot_id'] . "\x1e" . $parsed['date_id'];
					if ( isset( $seen[ $key ] ) ) {
						++$lines[ $seen[ $key ] ]['qty'];
						continue;
					}
					$seen[ $key ]   = count( $lines );
					$lines[]        = $parsed;
				}
			}
		}

		if ( ! empty( $lines ) ) {
			return $lines;
		}

		foreach ( $order->get_items() as $item ) {
			if ( ! is_object( $item ) || ! method_exists( $item, 'get_product_id' ) ) {
				continue;
			}
			$product_id = absint( $item->get_product_id() );
			if ( $product_id <= 0 || ! $this->stock->is_booking_event_product( $product_id ) ) {
				continue;
			}
			$qty = max( 1, (int) $item->get_quantity() );
			$parsed = $this->parse_booking_line_from_order_item( $item, $product_id, $qty );
			if ( null === $parsed ) {
				continue;
			}
			$lines[] = $parsed;
		}

		return $lines;
	}

	/**
	 * @param array<string,mixed> $ticket Ticket blueprint row.
	 * @return array{product_id:int,slot_id:string,date_id:string,qty:int}|null
	 */
	private function parse_booking_line_from_ticket_row( array $ticket ) {
		$product_id = absint( $ticket['WooCommerceEventsProductID'] ?? 0 );
		if ( $product_id <= 0 || ! $this->stock->is_booking_event_product( $product_id ) ) {
			return null;
		}

		$opts = isset( $ticket['WooCommerceEventsBookingOptions'] ) ? $ticket['WooCommerceEventsBookingOptions'] : null;
		if ( ! is_array( $opts ) ) {
			return null;
		}

		$slot_id = '';
		$date_id = '';

		if ( isset( $opts['slot'] ) && '' !== (string) $opts['slot'] ) {
			$slot_id = trim( (string) $opts['slot'] );
		} elseif ( isset( $opts['slot_id'] ) ) {
			$slot_id = trim( (string) $opts['slot_id'] );
		}

		if ( isset( $opts['date'] ) && '' !== (string) $opts['date'] ) {
			$date_id = trim( (string) $opts['date'] );
		} elseif ( isset( $opts['date_id'] ) ) {
			$date_id = trim( (string) $opts['date_id'] );
		}

		if ( '' === $slot_id || '' === $date_id ) {
			return null;
		}

		return array(
			'product_id' => $product_id,
			'slot_id'    => $slot_id,
			'date_id'    => $date_id,
			'qty'        => 1,
		);
	}

	/**
	 * @param mixed $item       Order item.
	 * @param int   $product_id Product ID.
	 * @param int   $qty        Line quantity.
	 * @return array{product_id:int,slot_id:string,date_id:string,qty:int}|null
	 */
	private function parse_booking_line_from_order_item( $item, $product_id, $qty ) {
		if ( ! is_object( $item ) || ! method_exists( $item, 'get_meta' ) ) {
			return null;
		}

		$slot_id = '';
		$date_id = '';

		$meta_keys = array(
			array( 'booking_selection_slot', 'booking_selection_date' ),
			array( 'fooevents_bookings_slot_val', 'fooevents_bookings_date_val' ),
		);

		foreach ( $meta_keys as $pair ) {
			$slot_raw = (string) $item->get_meta( $pair[0], true );
			$date_raw = (string) $item->get_meta( $pair[1], true );
			if ( '' === $slot_raw || '' === $date_raw ) {
				continue;
			}
			$slot_parts = explode( '_', $slot_raw );
			$slot_id    = trim( (string) $slot_parts[0] );
			$date_id    = trim( $date_raw );
			break;
		}

		if ( '' === $slot_id || '' === $date_id ) {
			$composite = (string) $item->get_meta( 'booking_selection_slot_date', true );
			if ( '' !== $composite ) {
				$parts = explode( '_', $composite );
				if ( count( $parts ) >= 2 ) {
					$slot_id = trim( (string) $parts[0] );
					$date_id = trim( (string) $parts[1] );
				}
			}
		}

		if ( '' === $slot_id || '' === $date_id ) {
			return null;
		}

		return array(
			'product_id' => absint( $product_id ),
			'slot_id'    => $slot_id,
			'date_id'    => $date_id,
			'qty'        => max( 1, (int) $qty ),
		);
	}

	/**
	 * Scan cancelled/failed orders for a product and restore orphaned consumption.
	 *
	 * @param int  $product_id Product ID.
	 * @param bool $dry_run    Report only.
	 * @return array<string,mixed>
	 */
	public function reconcile_product_orders( $product_id, $dry_run = true ) {
		$product_id = absint( $product_id );
		$report     = array(
			'productId'     => $product_id,
			'dryRun'        => (bool) $dry_run,
			'ordersScanned' => 0,
			'ordersRestored'=> 0,
			'spotsRestored' => 0,
			'orders'        => array(),
		);

		if ( $product_id <= 0 || ! function_exists( 'wc_get_orders' ) ) {
			return $report;
		}

		$orders = wc_get_orders(
			array(
				'limit'   => -1,
				'status'  => array( 'cancelled', 'failed', 'trash' ),
				'return'  => 'ids',
				'orderby' => 'date',
				'order'   => 'DESC',
			)
		);

		foreach ( $orders as $oid ) {
			$order = wc_get_order( $oid );
			if ( ! $order instanceof WC_Order ) {
				continue;
			}

			$lines = $this->collect_booking_restore_lines( $order );
			$hits  = array();
			foreach ( $lines as $line ) {
				if ( (int) ( $line['product_id'] ?? 0 ) === $product_id ) {
					$hits[] = $line;
				}
			}
			if ( empty( $hits ) ) {
				continue;
			}

			++$report['ordersScanned'];

			if ( $this->order_has_event_tickets( $oid ) ) {
				continue;
			}

			if ( 'yes' === (string) $order->get_meta( self::RESTORED_META, true ) ) {
				continue;
			}

			$row = array(
				'orderId' => (int) $oid,
				'status'  => $order->get_status(),
				'lines'   => $hits,
			);

			if ( ! $dry_run ) {
				$result = $this->restore_order_stock( $oid, true );
				$row['restored'] = (int) ( $result['restored'] ?? 0 );
				if ( $row['restored'] > 0 ) {
					++$report['ordersRestored'];
					$report['spotsRestored'] += $row['restored'];
				}
			}

			$report['orders'][] = $row;
		}

		return $report;
	}
}
