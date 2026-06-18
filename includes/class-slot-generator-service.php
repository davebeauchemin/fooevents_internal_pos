<?php
/**
 * Generate FooEvents Bookings slot meta from schedule blocks (slotdate / slot-first).
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use DateTime;
use WP_Error;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Service to build and persist fooevents_bookings_options_serialized.
 */
class Slot_Generator_Service {

	const MAX_DATES_PER_BLOCK   = 1000;
	const MAX_TOTAL_ENTRIES     = 10000;
	const SESSION_MIN_MINUTES  = 5;
	const SESSION_MAX_MINUTES  = 240;
	/** Max length for a schedule block "name" (slot label prefix). */
	const BLOCK_NAME_MAX        = 60;

	/**
	 * @var Bookings_Service
	 */
	private $bookings;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->bookings = new Bookings_Service();
	}

	/**
	 * Format a Y-m-d calendar day in the WordPress site timezone for FooEvents storage.
	 *
	 * @param string $ymd Calendar day.
	 * @return string
	 */
	private function display_date_from_ymd( $ymd ) {
		$date_format = get_option( 'date_format' );
		$tz          = $this->bookings->get_wp_timezone();
		$dt          = DateTime::createFromFormat( '!Y-m-d H:i:s', (string) $ymd . ' 12:00:00', $tz );

		if ( $dt instanceof DateTime ) {
			return wp_date( $date_format, $dt->getTimestamp(), $tz );
		}

		return (string) $ymd;
	}

	/**
	 * Generate and replace booking options for a product.
	 *
	 * @param int   $product_id Product ID.
	 * @param array $config     Normalized request body.
	 * @return array|WP_Error
	 */
	public function generate( $product_id, $config ) {
		$product_id = absint( $product_id );
		$product    = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error( 'not_booking_event', __( 'Not a FooEvents booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$v = $this->validate_config( $config );
		if ( is_wp_error( $v ) ) {
			return $v;
		}
		$config = $v;
		if ( 'fillEmpty' === (string) ( $config['mode'] ?? 'replace' ) ) {
			return new WP_Error(
				'rest_invalid_param',
				__( 'Full replace must not use mode fillEmpty. Omit mode or use replace.', 'fooevents-internal-pos' ),
				array( 'status' => 400 )
			);
		}

		$tz        = $this->bookings->get_wp_timezone();
		$today_ymd = $this->bookings->today_ymd();
		$warnings  = array();

		// Map block name + session time "HH:MM" => set of Y-m-d.
		$by_name_time = array();

		foreach ( $config['blocks'] as $block_idx => $block ) {
			$start_ymd = (string) $block['startDate'];
			$end_ymd   = (string) $block['endDate'];
			$orig_s    = $start_ymd;
			if ( strcmp( $start_ymd, $today_ymd ) < 0 ) {
				$warnings[] = sprintf(
					/* translators: 1: block, 2: old start, 3: new start */
					__( 'Block %1$d start was before today; using %3$s instead of %2$s.', 'fooevents-internal-pos' ),
					$block_idx + 1,
					$orig_s,
					$today_ymd
				);
				$start_ymd = $today_ymd;
			}
			if ( strcmp( $start_ymd, $end_ymd ) > 0 ) {
				return new WP_Error( 'rest_invalid_param', sprintf( /* translators: %d: block */ __( 'Block %d has no valid dates after today.', 'fooevents-internal-pos' ), $block_idx + 1 ), array( 'status' => 400 ) );
			}

			$dates_in_block = $this->list_dates_in_range( $start_ymd, $end_ymd, $block['weekdays'], $tz );
			if ( count( $dates_in_block ) > self::MAX_DATES_PER_BLOCK ) {
				return new WP_Error(
					'rest_invalid_param',
					sprintf(
						/* translators: 1: block index, 2: max */
						__( 'Block %1$d has more than %2$d days; narrow the range or weekdays.', 'fooevents-internal-pos' ),
						$block_idx + 1,
						self::MAX_DATES_PER_BLOCK
					),
					array( 'status' => 400 )
				);
			}

			$open_m  = $this->to_minutes( $block['openTime'] );
			$close_m = $this->to_minutes( $block['closeTime'] );
			$sess    = (int) $config['sessionMinutes'];
			if ( null === $open_m || null === $close_m || $open_m + $sess > $close_m ) {
				return new WP_Error(
					'rest_invalid_param',
					sprintf(
						/* translators: %d: block index */
						__( 'Block %d: close time must be at least one session after open time.', 'fooevents-internal-pos' ),
						$block_idx + 1
					),
					array( 'status' => 400 )
				);
			}

			$starts = $this->iter_session_starts( $open_m, $close_m, $sess );
			if ( empty( $starts ) ) {
				return new WP_Error( 'rest_invalid_param', sprintf( __( 'Block %d: no session fits in open/close range.', 'fooevents-internal-pos' ), $block_idx + 1 ), array( 'status' => 400 ) );
			}

			$block_name = (string) ( $block['name'] ?? '' );

			foreach ( $starts as $start_m ) {
				$time_key = $this->minutes_to_hhmm( $start_m );
				if ( ! isset( $by_name_time[ $block_name ] ) ) {
					$by_name_time[ $block_name ] = array();
				}
				if ( ! isset( $by_name_time[ $block_name ][ $time_key ] ) ) {
					$by_name_time[ $block_name ][ $time_key ] = array();
				}
				foreach ( $dates_in_block as $ymd ) {
					$by_name_time[ $block_name ][ $time_key ][ $ymd ] = true;
				}
			}
		}

		$unique_dates = array();
		$slot_count   = 0;
		$total_lines  = 0;
		foreach ( $by_name_time as $times ) {
			$slot_count += count( $times );
			foreach ( $times as $set ) {
				$total_lines += count( $set );
				foreach ( array_keys( $set ) as $ymd ) {
					$unique_dates[ $ymd ] = true;
				}
			}
		}
		$date_count = count( $unique_dates );
		if ( $total_lines > self::MAX_TOTAL_ENTRIES ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: 1: current total, 2: max */
					__( 'Total slot-date cells (%1$d) exceeds limit %2$d. Split into runs or raise limits in code after review.', 'fooevents-internal-pos' ),
					$total_lines,
					self::MAX_TOTAL_ENTRIES
				),
				array( 'status' => 400 )
			);
		}

		$capacity = $config['capacity'];
		$stock    = ( 0 === (int) $capacity ) ? '' : (string) (int) $capacity;

		$label_mode = (string) ( $config['labelFormat'] ?? 'time' );
		$custom_pre = '';
		if ( 0 === strpos( $label_mode, 'custom:' ) ) {
			$custom_pre = trim( (string) substr( $label_mode, 7 ) );
		}

		$rows = array();
		foreach ( $by_name_time as $bname => $times ) {
			foreach ( $times as $time_key => $ymd_set ) {
				$rows[] = array(
					'name'     => (string) $bname,
					'time_key' => (string) $time_key,
					'ymd_set'  => $ymd_set,
				);
			}
		}
		usort(
			$rows,
			function( $a, $b ) {
				$c = strcmp( (string) $a['time_key'], (string) $b['time_key'] );
				if ( 0 !== $c ) {
					return $c;
				}
				return strcmp( (string) $a['name'], (string) $b['name'] );
			}
		);

		/*
		 * Use non-leading-digit prefixes so PHP/FooEvents never auto-casts add_date keys to int
		 * (fixes WP admin Edit Ticket strict === mismatch and POS delete resolver).
		 */
		$seq = (int) ( microtime( true ) * 1000 );
		$out   = array();
		$sample = array();

		foreach ( $rows as $row ) {
			$time_key = $row['time_key'];
			$ymd_set  = $row['ymd_set'];
			$bname    = (string) $row['name'];

			$ymds = array_keys( $ymd_set );
			sort( $ymds, SORT_STRING );

			$hm = $this->parse_hhmm( $time_key );
			if ( null === $hm ) {
				continue;
			}
			$h    = (string) str_pad( (string) $hm['h'], 2, '0', STR_PAD_LEFT );
			$min  = (string) str_pad( (string) $hm['m'], 2, '0', STR_PAD_LEFT );
			$h24  = (int) $hm['h'];
			$period = ( $h24 < 12 ) ? 'a.m.' : 'p.m.';

			// Primary slot label: schedule name if set, else time or custom prefix + time. FooEvents
			// appends formatted_time in parentheses in the select options when add_time is enabled.
			if ( '' !== $bname ) {
				$label = $bname;
			} elseif ( 0 === strpos( $label_mode, 'custom:' ) ) {
				$label = ( '' !== $custom_pre ? $custom_pre . ' ' : '' ) . $time_key;
			} else {
				$label = $time_key;
			}

			$slot_id = 's' . str_pad( (string) ( $seq++ ), 14, '0', STR_PAD_LEFT );
			// Key order must match what FooEvents process_booking_options() expects:
			// 'add_time' must be iterated after hour/minute/period or formatted_time is never set.
			$slot    = array(
				'label'    => $label,
				'hour'     => $h,
				'minute'   => $min,
				'period'   => $period,
				'add_time' => 'enabled',
			);

			foreach ( $ymds as $ymd ) {
				$display = $this->display_date_from_ymd( $ymd );
				$did     = 'd' . str_pad( (string) ( $seq++ ), 14, '0', STR_PAD_LEFT );
				$slot[ $did . '_add_date' ] = $display;
				$slot[ $did . '_stock' ]   = $stock;
			}
			$out[ $slot_id ] = $slot;
			if ( count( $sample ) < 2 ) {
				$sample[] = $slot;
			}
		}

		$json = wp_json_encode( $out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		if ( false === $json ) {
			return new WP_Error( 'json_error', __( 'Failed to encode booking options.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}
		// Match FooEvents: wp_slash on save (see class-fooevents-bookings.php update_serialized).
		update_post_meta( $product_id, 'fooevents_bookings_options_serialized', wp_slash( $json ) );

		$method = $product->get_meta( 'WooCommerceEventsBookingsMethod', true );
		if ( empty( $method ) || '1' === (string) $method ) {
			update_post_meta( $product_id, 'WooCommerceEventsBookingsMethod', 'slotdate' );
		}

		return array(
			'slotsWritten'  => $slot_count,
			'datesWritten'  => $date_count,
			'warnings'      => $warnings,
			'sample'        => $sample,
			'totalEntries'  => $total_lines,
		);
	}

	/**
	 * Merge generated block sessions into the fill date range (add-only).
	 *
	 * For each block-derived (label, session time, day), appends a slot–date cell if it does not already
	 * exist. Enumeration spans merge each block's start/end with fillFrom/fillTo so days inside the fill
	 * window count even when the block's saved start is later (or end earlier). Days that already have
	 * sessions still receive new times (e.g. later hours). Never removes or replaces existing rows.
	 * Duplicate label+time+date is skipped with a warning. Requires mode fillEmpty and fillFrom/fillTo on
	 * the validated config.
	 *
	 * @param int   $product_id Product ID.
	 * @param array $config     Request body after {@see validate_config()}.
	 * @return array|WP_Error
	 */
	public function generate_fill_empty_days( $product_id, $config ) {
		$product_id = absint( $product_id );
		$product    = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error( 'not_booking_event', __( 'Not a FooEvents booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$v = $this->validate_config( $config );
		if ( is_wp_error( $v ) ) {
			return $v;
		}
		$config = $v;
		if ( 'fillEmpty' !== (string) ( $config['mode'] ?? 'replace' ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'fill-empty generation requires mode fillEmpty.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$fill_from = (string) $config['fillFrom'];
		$fill_to   = (string) $config['fillTo'];

		$tz          = $this->bookings->get_wp_timezone();
		$today_ymd   = $this->bookings->today_ymd();
		$warnings    = array();
		// Client may send fillFrom from browser-local "today" while the site is already on the next calendar day.
		if ( strcmp( $fill_from, $today_ymd ) < 0 ) {
			$warnings[] = sprintf(
				/* translators: 1: requested fill-from, 2: site today (Y-m-d) */
				__( 'fillFrom %1$s was before site today (%2$s); using %2$s for this run.', 'fooevents-internal-pos' ),
				$fill_from,
				$today_ymd
			);
			$fill_from = $today_ymd;
		}
		if ( strcmp( $fill_from, $fill_to ) > 0 ) {
			$fill_to   = $fill_from;
			$warnings[] = sprintf(
				/* translators: %s: Y-m-d */
				__( 'fillTo was before the adjusted fill-from; using %s for the end of the range.', 'fooevents-internal-pos' ),
				$fill_to
			);
		}
		$by_name_time = array();

		foreach ( $config['blocks'] as $block_idx => $block ) {
			$block_start = (string) $block['startDate'];
			$block_end   = (string) $block['endDate'];
			// Span for this block: merge block dates with the fill-from / fill-to window so days inside
			// the fill range count even when they fall before the block's saved start (or after its end).
			$eff_start = ( strcmp( $block_start, $fill_from ) < 0 ) ? $block_start : $fill_from;
			$eff_end   = ( strcmp( $block_end, $fill_to ) > 0 ) ? $block_end : $fill_to;

			$orig_s = $eff_start;
			if ( strcmp( $eff_start, $today_ymd ) < 0 ) {
				$warnings[] = sprintf(
					/* translators: 1: block, 2: old start, 3: new start */
					__( 'Block %1$d start was before today; using %3$s instead of %2$s.', 'fooevents-internal-pos' ),
					$block_idx + 1,
					$orig_s,
					$today_ymd
				);
				$start_ymd = $today_ymd;
			} else {
				$start_ymd = $eff_start;
			}
			if ( strcmp( $start_ymd, $eff_end ) > 0 ) {
				return new WP_Error( 'rest_invalid_param', sprintf( /* translators: %d: block */ __( 'Block %d has no valid dates after today.', 'fooevents-internal-pos' ), $block_idx + 1 ), array( 'status' => 400 ) );
			}

			$dates_in_block = $this->list_dates_in_range( $start_ymd, $eff_end, $block['weekdays'], $tz );
			if ( count( $dates_in_block ) > self::MAX_DATES_PER_BLOCK ) {
				return new WP_Error(
					'rest_invalid_param',
					sprintf(
						/* translators: 1: block index, 2: max */
						__( 'Block %1$d has more than %2$d days; narrow the range or weekdays.', 'fooevents-internal-pos' ),
						$block_idx + 1,
						self::MAX_DATES_PER_BLOCK
					),
					array( 'status' => 400 )
				);
			}

			$open_m  = $this->to_minutes( $block['openTime'] );
			$close_m = $this->to_minutes( $block['closeTime'] );
			$sess    = (int) $config['sessionMinutes'];
			if ( null === $open_m || null === $close_m || $open_m + $sess > $close_m ) {
				return new WP_Error(
					'rest_invalid_param',
					sprintf(
						/* translators: %d: block index */
						__( 'Block %d: close time must be at least one session after open time.', 'fooevents-internal-pos' ),
						$block_idx + 1
					),
					array( 'status' => 400 )
				);
			}

			$starts = $this->iter_session_starts( $open_m, $close_m, $sess );
			if ( empty( $starts ) ) {
				return new WP_Error( 'rest_invalid_param', sprintf( __( 'Block %d: no session fits in open/close range.', 'fooevents-internal-pos' ), $block_idx + 1 ), array( 'status' => 400 ) );
			}

			$block_name = (string) ( $block['name'] ?? '' );

			foreach ( $starts as $start_m ) {
				$time_key = $this->minutes_to_hhmm( $start_m );
				if ( ! isset( $by_name_time[ $block_name ] ) ) {
					$by_name_time[ $block_name ] = array();
				}
				if ( ! isset( $by_name_time[ $block_name ][ $time_key ] ) ) {
					$by_name_time[ $block_name ][ $time_key ] = array();
				}
				foreach ( $dates_in_block as $ymd ) {
					$by_name_time[ $block_name ][ $time_key ][ $ymd ] = true;
				}
			}
		}

		$raw_slots = $this->decode_booking_options_raw_array( $product_id );
		$cells     = $this->count_slot_date_cells_raw( $raw_slots );
		$capacity   = $config['capacity'];
		$stock      = ( 0 === (int) $capacity ) ? '' : (string) (int) $capacity;

		$candidates = array();
		foreach ( $by_name_time as $bname => $times ) {
			foreach ( $times as $time_key => $ymd_set ) {
				foreach ( array_keys( $ymd_set ) as $ymd ) {
					if ( strcmp( $ymd, $today_ymd ) < 0 ) {
						continue;
					}
					if ( strcmp( $ymd, $fill_from ) < 0 || strcmp( $ymd, $fill_to ) > 0 ) {
						continue;
					}
					$candidates[] = array(
						'name' => (string) $bname,
						'time' => (string) $time_key,
						'ymd'  => (string) $ymd,
					);
				}
			}
		}

		usort(
			$candidates,
			function( $a, $b ) {
				$c = strcmp( (string) $a['ymd'], (string) $b['ymd'] );
				if ( 0 !== $c ) {
					return $c;
				}
				$c = strcmp( (string) $a['time'], (string) $b['time'] );
				if ( 0 !== $c ) {
					return $c;
				}
				return strcmp( (string) $a['name'], (string) $b['name'] );
			}
		);

		$added              = 0;
		$skipped_duplicates = 0;

		foreach ( $candidates as $c ) {
			$ymd  = $c['ymd'];
			$hm   = $this->parse_hhmm( $c['time'] );
			if ( null === $hm ) {
				continue;
			}
			$merge = $this->try_merge_one_slot_date_into_raw( $raw_slots, $cells, $ymd, $hm, $c['name'], $stock );
			if ( is_wp_error( $merge ) ) {
				return $merge;
			}
			if ( 'skipped_exists' === $merge ) {
				++$skipped_duplicates;
				$disp = '' !== trim( $c['name'] ) ? $c['name'] : $c['time'];
				$warnings[] = sprintf(
					/* translators: 1: label or time, 2: HH:MM, 3: Y-m-d */
					__( 'Skipped %1$s at %2$s on %3$s — that session already exists. Other new sessions were still added.', 'fooevents-internal-pos' ),
					$disp,
					$c['time'],
					$ymd
				);
				continue;
			}
			++$added;
		}

		if ( 0 === $added && 0 === $skipped_duplicates ) {
			return new WP_Error(
				'no_empty_days_in_range',
				__( 'Nothing new to add in this fill range for your blocks (weekdays or block dates may not overlap the range, or every session time in the blocks already exists on those days).', 'fooevents-internal-pos' ),
				array( 'status' => 422 )
			);
		}

		$maybe_err = $this->persist_raw_booking_slots_or_fail( $product_id, $raw_slots );
		if ( is_wp_error( $maybe_err ) ) {
			return $maybe_err;
		}

		$bookings_method = $this->bookings_method_for_product( $product );
		if ( 'dateslot' !== $bookings_method ) {
			update_post_meta( $product_id, 'WooCommerceEventsBookingsMethod', 'slotdate' );
		}

		return array(
			'mode'               => 'fillEmpty',
			'cellsAdded'         => $added,
			'skippedDuplicates'  => $skipped_duplicates,
			'warnings'           => $warnings,
			'totalSlotDateCells' => $cells,
		);
	}

	/**
	 * Calendar days (Y-m-d) that already have at least one slot–date cell in raw booking meta.
	 *
	 * @param int $product_id Product.
	 * @return string[] Sorted unique Y-m-d.
	 */
	public function list_occupied_calendar_ymds_for_product( $product_id ) {
		$raw = $this->decode_booking_options_raw_array( absint( $product_id ) );
		$set = $this->collect_occupied_calendar_ymds_from_raw( $raw );
		$out = array_keys( $set );
		sort( $out, SORT_STRING );
		return $out;
	}

	/**
	 * @param array<string, mixed> $raw_slots Raw slot map.
	 * @return array<string, true> Y-m-d => true
	 */
	private function collect_occupied_calendar_ymds_from_raw( array $raw_slots ) {
		$out = array();
		foreach ( $raw_slots as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			foreach ( $row as $key => $val ) {
				if ( ! preg_match( '/^(.+)_add_date$/', (string) $key, $m ) ) {
					continue;
				}
				if ( '' === $this->normalize_booking_raw_date_suffix( $m[1] ) ) {
					continue;
				}
				$display = is_string( $val ) ? trim( $val ) : '';
				if ( '' === $display ) {
					continue;
				}
				$ymd = $this->parse_booking_display_date_to_ymd( $display );
				if ( null !== $ymd && '' !== $ymd ) {
					$out[ $ymd ] = true;
				}
			}
		}
		return $out;
	}

	/**
	 * Parse a FooEvents `{suffix}_add_date` display string to Y-m-d (site timezone / date_format aware).
	 *
	 * @param string $display Stored date string.
	 * @return string|null
	 */
	private function parse_booking_display_date_to_ymd( $display ) {
		$display = trim( (string) $display );
		if ( '' === $display ) {
			return null;
		}
		$tz     = $this->bookings->get_wp_timezone();
		$wp_fmt = trim( (string) get_option( 'date_format' ) );
		if ( '' !== $wp_fmt ) {
			$dtcf = DateTime::createFromFormat( $wp_fmt, $display, $tz );
			if ( $dtcf instanceof DateTime ) {
				$errs = DateTime::getLastErrors();
				if ( is_array( $errs ) && empty( $errs['warning_count'] ) && empty( $errs['error_count'] ) ) {
					return $dtcf->format( 'Y-m-d' );
				}
			}
		}
		$fallback = $this->bookings->date_string_to_ymd( $display );
		return ( null !== $fallback && '' !== (string) $fallback ) ? (string) $fallback : null;
	}

	/**
	 * Append one slot–date cell in-memory (same merge rules as manual add).
	 *
	 * @param array<string, mixed> $raw_slots Slot map (by ref).
	 * @param int                  $cells     Running cell count (by ref).
	 * @param string               $ymd_raw   Y-m-d.
	 * @param array{h:int,m:int}   $hm_in     From {@see parse_hhmm()} digits.
	 * @param string               $name      Block label; empty = time as label.
	 * @param string               $stock     Capacity string (empty = unlimited).
	 * @return 'added'|'skipped_exists'|WP_Error
	 */
	private function try_merge_one_slot_date_into_raw( array &$raw_slots, &$cells, $ymd_raw, array $hm_in, $name, $stock ) {
		$name = trim( (string) $name );
		$name = '' === $name ? '' : sanitize_text_field( $name );
		if ( '' !== $name && strlen( $name ) > self::BLOCK_NAME_MAX ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %d max length */
					__( 'Label must be at most %d characters.', 'fooevents-internal-pos' ),
					self::BLOCK_NAME_MAX
				),
				array( 'status' => 400 )
			);
		}

		if ( $cells >= self::MAX_TOTAL_ENTRIES ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: 1 limit */
					__( 'Total slot–date entries would exceed maximum %d.', 'fooevents-internal-pos' ),
					self::MAX_TOTAL_ENTRIES
				),
				array( 'status' => 400 )
			);
		}

		$h      = str_pad( (string) $hm_in['h'], 2, '0', STR_PAD_LEFT );
		$min    = str_pad( (string) $hm_in['m'], 2, '0', STR_PAD_LEFT );
		$h24    = (int) $hm_in['h'];
		$period = ( $h24 < 12 ) ? 'a.m.' : 'p.m.';
		$hhmm   = sprintf( '%02d:%02d', (int) $hm_in['h'], (int) $hm_in['m'] );

		$effective_label_for_match = '' !== $name ? $name : $hhmm;
		$display_label_for_store   = '' !== $name ? $name : $hhmm;

		foreach ( $raw_slots as $slot_row ) {
			if ( ! is_array( $slot_row ) ) {
				continue;
			}
			if ( ! $this->raw_slot_matches_time_and_label(
				$slot_row,
				$h,
				$min,
				$period,
				$effective_label_for_match
			) ) {
				continue;
			}
			if ( null !== $this->find_date_id_with_ymd_in_slot_raw( $slot_row, $ymd_raw ) ) {
				return 'skipped_exists';
			}
		}

		$slot_id_existing = '';
		foreach ( $raw_slots as $sid => $slot_row ) {
			if ( ! is_array( $slot_row ) ) {
				continue;
			}
			if ( ! $this->raw_slot_matches_time_and_label(
				$slot_row,
				$h,
				$min,
				$period,
				$effective_label_for_match
			) ) {
				continue;
			}
			$slot_id_existing = (string) $sid;
			break;
		}

		$new_date_inner_id = '';
		if ( '' !== $slot_id_existing ) {
			$new_date_inner_id                                                  = $this->next_unique_internal_prefix( $raw_slots );
			$display                                                            = $this->display_date_from_ymd( $ymd_raw );
			$raw_slots[ $slot_id_existing ][ $new_date_inner_id . '_add_date' ] = $display;
			$raw_slots[ $slot_id_existing ][ $new_date_inner_id . '_stock' ]  = $stock;
		} else {
			$new_slot_key                       = $this->next_unique_slot_key( $raw_slots );
			$new_date_inner_id                  = $this->next_unique_internal_prefix( $raw_slots );
			$display                            = $this->display_date_from_ymd( $ymd_raw );
			$raw_slots[ $new_slot_key ]         = array(
				'label'    => $display_label_for_store,
				'hour'     => $h,
				'minute'   => $min,
				'period'   => $period,
				'add_time' => 'enabled',
			);
			$raw_slots[ $new_slot_key ][ $new_date_inner_id . '_add_date' ] = $display;
			$raw_slots[ $new_slot_key ][ $new_date_inner_id . '_stock' ]  = $stock;
		}

		++$cells;
		return 'added';
	}

	/**
	 * Append one slot–date cell without replacing FooEvents serialized options (slot-first or date-first booking).
	 *
	 * Raw `fooevents_bookings_options_serialized` is the same slot-id map for both modes; booking method meta
	 * controls how FooEvents processes it. Products in `dateslot` mode remain `dateslot` after append.
	 *
	 * Body keys: date (Y-m-d), time (HH:MM), capacity (>=0), label (optional schedule name — empty uses time label).
	 *
	 * @param int   $product_id Product ID.
	 * @param array $params Parsed JSON body (camelCase preferred; snake_case accepted).
	 * @return array<string,mixed>|WP_Error Response with assigned slotId/dateId keys.
	 */
	public function manual_add_slot_date( $product_id, array $params ) {
		$product_id = absint( $product_id );
		$product    = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error( 'not_booking_event', __( 'Not a FooEvents booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$bookings_method = $this->bookings_method_for_product( $product );

		$ymd_raw = isset( $params['date'] ) ? (string) $params['date'] : ( isset( $params['bookingDate'] ) ? (string) $params['bookingDate'] : '' );
		$time_in = isset( $params['time'] ) ? (string) $params['time'] : '';
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd_raw ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'date must be Y-m-d.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$hm_in = $this->parse_hhmm( $time_in );
		if ( null === $hm_in ) {
			return new WP_Error( 'rest_invalid_param', __( 'time must be HH:MM (24h).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		if ( ! array_key_exists( 'capacity', $params ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'capacity is required and must be >= 0.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$cap = (int) $params['capacity'];
		if ( $cap < 0 ) {
			return new WP_Error( 'rest_invalid_param', __( 'capacity must be >= 0 (0 = unlimited).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$stock = ( 0 === $cap ) ? '' : (string) $cap;

		$raw_label = isset( $params['label'] ) ? (string) $params['label'] : ( isset( $params['name'] ) ? (string) $params['name'] : '' );
		$name      = trim( $raw_label );
		$name      = '' === $name ? '' : sanitize_text_field( $name );
		if ( '' !== $name && strlen( $name ) > self::BLOCK_NAME_MAX ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %d max length */
					__( 'Label must be at most %d characters.', 'fooevents-internal-pos' ),
					self::BLOCK_NAME_MAX
				),
				array( 'status' => 400 )
			);
		}

		$today = $this->bookings->today_ymd();
		if ( strcmp( $ymd_raw, $today ) < 0 ) {
			return new WP_Error( 'past_date', __( 'Cannot add a slot on a date before today (site timezone).', 'fooevents-internal-pos' ), array( 'status' => 422 ) );
		}

		$raw_slots = $this->decode_booking_options_raw_array( $product_id );
		$cells     = $this->count_slot_date_cells_raw( $raw_slots );
		if ( $cells >= self::MAX_TOTAL_ENTRIES ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: 1 limit */
					__( 'Total slot–date entries would exceed maximum %d.', 'fooevents-internal-pos' ),
					self::MAX_TOTAL_ENTRIES
				),
				array( 'status' => 400 )
			);
		}

		$h     = str_pad( (string) $hm_in['h'], 2, '0', STR_PAD_LEFT );
		$min   = str_pad( (string) $hm_in['m'], 2, '0', STR_PAD_LEFT );
		$h24   = (int) $hm_in['h'];
		$period = ( $h24 < 12 ) ? 'a.m.' : 'p.m.';
		$hhmm  = sprintf( '%02d:%02d', (int) $hm_in['h'], (int) $hm_in['m'] );

		$effective_label_for_match = '' !== $name ? $name : $hhmm;
		$display_label_for_store   = '' !== $name ? $name : $hhmm;

		// Reject if any slot with this label+time already has this calendar day.
		foreach ( $raw_slots as $sid => $slot_row ) {
			if ( ! is_array( $slot_row ) ) {
				continue;
			}
			if ( ! $this->raw_slot_matches_time_and_label(
				$slot_row,
				$h,
				$min,
				$period,
				$effective_label_for_match
			) ) {
				continue;
			}
			if ( null !== $this->find_date_id_with_ymd_in_slot_raw( $slot_row, $ymd_raw ) ) {
				return new WP_Error( 'duplicate_slot', __( 'That date and session time already exist for this slot.', 'fooevents-internal-pos' ), array( 'status' => 409 ) );
			}
		}

		// Find first existing slot row to merge additional dates into (same label + time-of-day metadata).
		$slot_id_existing = '';
		foreach ( $raw_slots as $sid => $slot_row ) {
			if ( ! is_array( $slot_row ) ) {
				continue;
			}
			if ( ! $this->raw_slot_matches_time_and_label(
				$slot_row,
				$h,
				$min,
				$period,
				$effective_label_for_match
			) ) {
				continue;
			}
			$slot_id_existing = (string) $sid;
			break;
		}

		$new_date_inner_id = '';
		if ( '' !== $slot_id_existing ) {
			$new_date_inner_id                   = $this->next_unique_internal_prefix( $raw_slots );
			$display                             = $this->display_date_from_ymd( $ymd_raw );
			$raw_slots[ $slot_id_existing ][ $new_date_inner_id . '_add_date' ] = $display;
			$raw_slots[ $slot_id_existing ][ $new_date_inner_id . '_stock' ]     = $stock;
			$used_slot_id                                                        = $slot_id_existing;
		} else {
			$new_slot_key = $this->next_unique_slot_key( $raw_slots );
			$new_date_inner_id                  = $this->next_unique_internal_prefix( $raw_slots );
			$display                            = $this->display_date_from_ymd( $ymd_raw );
			$raw_slots[ $new_slot_key ]         = array(
				'label'    => $display_label_for_store,
				'hour'     => $h,
				'minute'   => $min,
				'period'   => $period,
				'add_time' => 'enabled',
			);
			$raw_slots[ $new_slot_key ][ $new_date_inner_id . '_add_date' ] = $display;
			$raw_slots[ $new_slot_key ][ $new_date_inner_id . '_stock' ]    = $stock;
			$used_slot_id                                                    = $new_slot_key;
		}

		$maybe_err = $this->persist_raw_booking_slots_or_fail( $product_id, $raw_slots );
		if ( is_wp_error( $maybe_err ) ) {
			return $maybe_err;
		}
		// Slot-first products historically normalized empty/`1` method to explicit slotdate. Never flip dateslot→slotdate.
		if ( 'dateslot' !== $bookings_method ) {
			update_post_meta( $product_id, 'WooCommerceEventsBookingsMethod', 'slotdate' );
		}

		return array(
			'slotId'           => $used_slot_id,
			'dateId'           => $new_date_inner_id,
			'totalSlotDateCells' => $cells + 1,
		);
	}

	/**
	 * Add capacity (ticket spots) to an existing slot–date cell that has a numeric stock limit.
	 *
	 * Body keys: slotId, dateId, date (Y-m-d), addSpots (int >= 1). snake_case accepted.
	 *
	 * @param int   $product_id Product ID.
	 * @param array $params     Parsed JSON body.
	 * @return array<string,mixed>|WP_Error
	 */
	public function manual_add_slot_stock( $product_id, array $params ) {
		$product_id = absint( $product_id );
		$slot_id    = trim( (string) ( $params['slotId'] ?? $params['slot_id'] ?? '' ) );
		$date_id    = $this->normalize_booking_raw_date_suffix( (string) ( $params['dateId'] ?? $params['date_id'] ?? '' ) );
		$ymd_raw    = isset( $params['date'] ) ? trim( (string) $params['date'] ) : ( isset( $params['ymd'] ) ? trim( (string) $params['ymd'] ) : '' );
		$add        = isset( $params['addSpots'] ) ? (int) $params['addSpots'] : ( isset( $params['add_spots'] ) ? (int) $params['add_spots'] : 0 );

		if ( '' === $slot_id || '' === $date_id ) {
			return new WP_Error( 'rest_invalid_param', __( 'slotId and dateId are required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd_raw ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'date must be Y-m-d.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( $add < 1 ) {
			return new WP_Error( 'rest_invalid_param', __( 'addSpots must be at least 1.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$product = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error( 'not_booking_event', __( 'Not a FooEvents booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$raw_slots         = $this->decode_booking_options_raw_array( $product_id );
		$slot_actual_key = $this->normalize_raw_slot_lookup_key( $raw_slots, $slot_id );
		if ( null === $slot_actual_key || ! isset( $raw_slots[ $slot_actual_key ] ) || ! is_array( $raw_slots[ $slot_actual_key ] ) ) {
			return new WP_Error( 'not_found', __( 'Slot not found.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}
		$row = &$raw_slots[ $slot_actual_key ];

		$booking_method_eff = $this->bookings_method_for_product( $product );

		$inner_date_id = '';
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd_raw ) ) {
			$by_ymd = $this->find_date_id_with_ymd_in_slot_raw( $row, $ymd_raw );
			if ( null !== $by_ymd && $this->raw_date_cell_exists( $row, $by_ymd ) ) {
				$inner_date_id = $this->normalize_booking_raw_date_suffix( $by_ymd );
			}
		}
		if ( '' === $inner_date_id ) {
			$inner_date_id = $this->resolve_raw_inner_id_for_manual_remove(
				$product_id,
				$booking_method_eff,
				(string) $slot_id,
				$row,
				(string) $date_id
			);
		}
		if ( '' === $inner_date_id || ! $this->raw_date_cell_exists( $row, $inner_date_id ) ) {
			return new WP_Error( 'not_found', __( 'That date attachment was not found on this slot.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$stock_key = $inner_date_id . '_stock';
		if ( ! isset( $row[ $stock_key ] ) || '' === (string) $row[ $stock_key ] ) {
			return new WP_Error(
				'unlimited_stock',
				__( 'This session has unlimited capacity; add ticket spots only applies when a numeric limit is set.', 'fooevents-internal-pos' ),
				array( 'status' => 422 )
			);
		}

		$current = (int) $row[ $stock_key ];
		if ( $current < 0 ) {
			return new WP_Error(
				'unlimited_stock',
				__( 'This session has unlimited capacity; add ticket spots only applies when a numeric limit is set.', 'fooevents-internal-pos' ),
				array( 'status' => 422 )
			);
		}

		$new                  = $current + $add;
		$row[ $stock_key ] = (string) $new;

		$maybe_err = $this->persist_raw_booking_slots_or_fail( $product_id, $raw_slots );
		if ( is_wp_error( $maybe_err ) ) {
			return $maybe_err;
		}

		return array(
			'slotId'        => (string) $slot_actual_key,
			'dateId'        => (string) $inner_date_id,
			'previousStock' => $current,
			'newStock'      => $new,
			'addSpots'      => $add,
		);
	}

	/**
	 * Reduce capacity (remaining ticket spots) on an existing slot–date cell with a numeric stock limit.
	 *
	 * Body keys: slotId, dateId, date (Y-m-d), removeSpots (int >= 1). snake_case accepted.
	 * Remaining spots cannot go below zero (FooEvents stock is remaining availability).
	 *
	 * @param int   $product_id Product ID.
	 * @param array $params     Parsed JSON body.
	 * @return array<string,mixed>|WP_Error
	 */
	public function manual_subtract_slot_stock( $product_id, array $params ) {
		$product_id = absint( $product_id );
		$slot_id    = trim( (string) ( $params['slotId'] ?? $params['slot_id'] ?? '' ) );
		$date_id    = $this->normalize_booking_raw_date_suffix( (string) ( $params['dateId'] ?? $params['date_id'] ?? '' ) );
		$ymd_raw    = isset( $params['date'] ) ? trim( (string) $params['date'] ) : ( isset( $params['ymd'] ) ? trim( (string) $params['ymd'] ) : '' );
		$remove     = isset( $params['removeSpots'] ) ? (int) $params['removeSpots'] : ( isset( $params['remove_spots'] ) ? (int) $params['remove_spots'] : 0 );

		if ( '' === $slot_id || '' === $date_id ) {
			return new WP_Error( 'rest_invalid_param', __( 'slotId and dateId are required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd_raw ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'date must be Y-m-d.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		if ( $remove < 1 ) {
			return new WP_Error( 'rest_invalid_param', __( 'removeSpots must be at least 1.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$product = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error( 'not_booking_event', __( 'Not a FooEvents booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$raw_slots         = $this->decode_booking_options_raw_array( $product_id );
		$slot_actual_key = $this->normalize_raw_slot_lookup_key( $raw_slots, $slot_id );
		if ( null === $slot_actual_key || ! isset( $raw_slots[ $slot_actual_key ] ) || ! is_array( $raw_slots[ $slot_actual_key ] ) ) {
			return new WP_Error( 'not_found', __( 'Slot not found.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}
		$row = &$raw_slots[ $slot_actual_key ];

		$booking_method_eff = $this->bookings_method_for_product( $product );

		$inner_date_id = '';
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd_raw ) ) {
			$by_ymd = $this->find_date_id_with_ymd_in_slot_raw( $row, $ymd_raw );
			if ( null !== $by_ymd && $this->raw_date_cell_exists( $row, $by_ymd ) ) {
				$inner_date_id = $this->normalize_booking_raw_date_suffix( $by_ymd );
			}
		}
		if ( '' === $inner_date_id ) {
			$inner_date_id = $this->resolve_raw_inner_id_for_manual_remove(
				$product_id,
				$booking_method_eff,
				(string) $slot_id,
				$row,
				(string) $date_id
			);
		}
		if ( '' === $inner_date_id || ! $this->raw_date_cell_exists( $row, $inner_date_id ) ) {
			return new WP_Error( 'not_found', __( 'That date attachment was not found on this slot.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$stock_key = $inner_date_id . '_stock';
		if ( ! isset( $row[ $stock_key ] ) || '' === (string) $row[ $stock_key ] ) {
			return new WP_Error(
				'unlimited_stock',
				__( 'This session has unlimited capacity; change quantity only when a numeric limit is set.', 'fooevents-internal-pos' ),
				array( 'status' => 422 )
			);
		}

		$current = (int) $row[ $stock_key ];
		if ( $current < 0 ) {
			return new WP_Error(
				'unlimited_stock',
				__( 'This session has unlimited capacity; change quantity only when a numeric limit is set.', 'fooevents-internal-pos' ),
				array( 'status' => 422 )
			);
		}

		$new = $current - $remove;
		if ( $new < 0 ) {
			return new WP_Error(
				'insufficient_stock',
				sprintf(
					/* translators: 1: current remaining spots */
					__( 'Cannot remove that many spots; only %d remaining in this cell.', 'fooevents-internal-pos' ),
					$current
				),
				array( 'status' => 422 )
			);
		}

		$row[ $stock_key ] = (string) $new;

		$maybe_err = $this->persist_raw_booking_slots_or_fail( $product_id, $raw_slots );
		if ( is_wp_error( $maybe_err ) ) {
			return $maybe_err;
		}

		return array(
			'slotId'         => (string) $slot_actual_key,
			'dateId'         => (string) $inner_date_id,
			'previousStock'  => $current,
			'newStock'       => $new,
			'removeSpots'    => $remove,
		);
	}

	/**
	 * Normalize a raw booking date suffix (FooEvents `{suffix}_add_date` segment).
	 *
	 * FooEvents admin uses random lowercase strings; internal POS may use digits. Rejects path-like/control chars.
	 *
	 * @param mixed $value Raw suffix or client `dateId`.
	 * @return string Empty when invalid.
	 */
	private function normalize_booking_raw_date_suffix( $value ) {
		$s = preg_replace( '/\s+/', '', trim( (string) $value ) );
		if ( '' === $s || strlen( $s ) > 80 ) {
			return '';
		}
		if ( preg_match( '/[\x00-\x1F\x7F\/\\\\]/', $s ) ) {
			return '';
		}
		return $s;
	}

	/**
	 * Whether the raw slot row contains `{suffix}_add_date` after normalizing suffix.
	 *
	 * @param array<string,mixed> $slot_row FooEvents raw JSON row for one slot.
	 * @param mixed               $suffix   Candidate suffix.
	 * @return bool
	 */
	private function raw_date_cell_exists( array $slot_row, $suffix ) {
		$s = $this->normalize_booking_raw_date_suffix( $suffix );
		return '' !== $s && isset( $slot_row[ $s . '_add_date' ] );
	}

	/**
	 * Remove one slot–date cell. Blocks if FooEvents tickets exist for that pairing (slot-first or date-first).
	 *
	 * @param int    $product_id Product ID.
	 * @param string $slot_id    FooEvents slot row id.
	 * @param string $date_id    Internal date suffix before `_add_date` in serialization / POS `dateId` (digits or FooEvents admin ids).
	 * @param string $ymd_hint  Optional `Y-m-d` for the viewing day; authoritative for matching raw `{suffix}_add_date` for dateslot.
	 * @return array<string,mixed>|WP_Error
	 */
	public function manual_remove_slot_date( $product_id, $slot_id, $date_id, $ymd_hint = '' ) {
		$product_id = absint( $product_id );
		$slot_id    = trim( (string) $slot_id );
		$ymd_hint   = trim( (string) $ymd_hint );
		$date_id    = $this->normalize_booking_raw_date_suffix( $date_id );
		if ( '' === $slot_id || '' === $date_id ) {
			return new WP_Error( 'rest_invalid_param', __( 'slotId and dateId are required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$product = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return new WP_Error( 'not_booking_event', __( 'Not a FooEvents booking product.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}

		$raw_slots = $this->decode_booking_options_raw_array( $product_id );
		$slot_actual_key = $this->normalize_raw_slot_lookup_key( $raw_slots, $slot_id );
		if ( null === $slot_actual_key || ! isset( $raw_slots[ $slot_actual_key ] ) || ! is_array( $raw_slots[ $slot_actual_key ] ) ) {
			return new WP_Error( 'not_found', __( 'Slot not found.', 'fooevents-internal-pos' ), array( 'status' => 404 ) );
		}
		$row = $raw_slots[ $slot_actual_key ];

		$booking_method_eff = $this->bookings_method_for_product( $product );

		$inner_date_id = '';
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd_hint ) ) {
			$by_ymd = $this->find_date_id_with_ymd_in_slot_raw( $row, $ymd_hint );
			if ( null !== $by_ymd && $this->raw_date_cell_exists( $row, $by_ymd ) ) {
				$inner_date_id = $this->normalize_booking_raw_date_suffix( $by_ymd );
			}
		}
		if ( '' === $inner_date_id ) {
			$inner_date_id = $this->resolve_raw_inner_id_for_manual_remove(
				$product_id,
				$booking_method_eff,
				(string) $slot_id,
				$row,
				(string) $date_id
			);
		}
		if ( '' === $inner_date_id ) {
			$suffixes = array();
			foreach ( array_keys( $row ) as $k ) {
				if ( preg_match( '/^(.+)_add_date$/', (string) $k, $m ) ) {
					$norm = $this->normalize_booking_raw_date_suffix( $m[1] );
					if ( '' !== $norm ) {
						$suffixes[] = $norm;
					}
				}
			}
			$suffixes = array_values( array_unique( $suffixes ) );
			return new WP_Error(
				'not_found',
				__( 'That date attachment was not found on this slot.', 'fooevents-internal-pos' ),
				array(
					'status'         => 404,
					'normalized_did' => $date_id,
					'ymd_hint'       => $ymd_hint,
					'available_keys' => $suffixes,
				)
			);
		}

		$ticket_date_ids = array_values(
			array_unique(
				array_filter(
					array( (string) $date_id, (string) $inner_date_id ),
					static function ( $v ) {
						return '' !== trim( (string) $v );
					}
				)
			)
		);
		if ( empty( $ticket_date_ids ) ) {
			$ticket_date_ids = array( (string) $date_id );
		}
		$date_meta_clause = array(
			'key'     => 'WooCommerceEventsBookingDateID',
			'value'   => $ticket_date_ids,
			'type'    => 'CHAR',
			'compare' => 'IN',
		);
		if ( 1 === count( $ticket_date_ids ) ) {
			$date_meta_clause = array(
				'key'     => 'WooCommerceEventsBookingDateID',
				'value'   => $ticket_date_ids[0],
				'type'    => 'CHAR',
				'compare' => '=',
			);
		}

		$blocked = new WP_Query(
			array(
				'post_type'      => 'event_magic_tickets',
				'post_status'    => 'publish',
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_query'     => array(
					'relation' => 'AND',
					array(
						'key'     => 'WooCommerceEventsProductID',
						'value'   => $product_id,
						'compare' => '=',
						'type'    => 'NUMERIC',
					),
					array(
						'key'   => 'WooCommerceEventsBookingSlotID',
						'value' => $slot_id,
						'type' => 'CHAR',
						'compare' => '=',
					),
					$date_meta_clause,
				),
			)
		);
		if ( (int) $blocked->found_posts > 0 || ! empty( $blocked->posts ) ) {
			return new WP_Error(
				'slot_has_bookings',
				__( 'Cannot remove this slot: there are tickets/bookings referencing it.', 'fooevents-internal-pos' ),
				array( 'status' => 409 )
			);
		}

		$dkey = $inner_date_id . '_add_date';
		$skey = $inner_date_id . '_stock';

		unset( $raw_slots[ $slot_actual_key ][ $dkey ], $raw_slots[ $slot_actual_key ][ $skey ] );

		if ( ! $this->slot_row_has_dates_left( $raw_slots[ $slot_actual_key ] ) ) {
			unset( $raw_slots[ $slot_actual_key ] );
		}

		if ( empty( $raw_slots ) ) {
			return new WP_Error(
				'invalid_state',
				__( 'Removing the last slot/date would leave empty booking metadata; cancel or regenerate a schedule.', 'fooevents-internal-pos' ),
				array( 'status' => 422 )
			);
		}

		$maybe_err = $this->persist_raw_booking_slots_or_fail( $product_id, $raw_slots );
		if ( is_wp_error( $maybe_err ) ) {
			return $maybe_err;
		}

		return array(
			'removed'          => true,
			'totalSlotDateCells' => $this->count_slot_date_cells_raw( $raw_slots ),
		);
	}

	/**
	 * @param \WC_Product $product Product.
	 * @return string slotdate|dateslot
	 */
	private function bookings_method_for_product( $product ) {
		if ( ! is_object( $product ) || ! is_a( $product, '\WC_Product' ) ) {
			return 'slotdate';
		}
		$m = $product->get_meta( 'WooCommerceEventsBookingsMethod', true );
		if ( empty( $m ) || '1' === (string) $m ) {
			return 'slotdate';
		}
		return (string) $m;
	}

	/**
	 * After a booking, FooEvents writes the processed shape (nested add_date) back to
	 * fooevents_bookings_options_serialized, dropping the flat `{did}_add_date` / `{did}_stock`
	 * keys manual add/remove depend on. Merge nested cells into flat keys so our writers work.
	 *
	 * @param array<string,mixed> $slot_row Raw or processed FooEvents slot row.
	 * @return array<string,mixed> Flat raw row.
	 */
	private function flatten_processed_slot_row( array $slot_row ) {
		if ( ! isset( $slot_row['add_date'] ) || ! is_array( $slot_row['add_date'] ) ) {
			return $slot_row;
		}
		$nested = $slot_row['add_date'];
		unset( $slot_row['add_date'], $slot_row['formatted_time'], $slot_row['unformatted_time'] );
		foreach ( $nested as $did => $cell ) {
			$suffix = $this->normalize_booking_raw_date_suffix( (string) $did );
			if ( '' === $suffix || ! is_array( $cell ) ) {
				continue;
			}
			if ( array_key_exists( 'date', $cell ) ) {
				$slot_row[ $suffix . '_add_date' ] = $cell['date'];
			}
			if ( array_key_exists( 'stock', $cell ) ) {
				$slot_row[ $suffix . '_stock' ] = $cell['stock'];
			}
			if ( array_key_exists( 'zoom_id', $cell ) ) {
				$slot_row[ $suffix . '_zoom_id' ] = $cell['zoom_id'];
			}
		}
		return $slot_row;
	}

	/**
	 * @param int $product_id Product.
	 * @return array<string, mixed> Raw slot-first map slotId → row (flat `{suffix}_add_date` keys).
	 */
	private function decode_booking_options_raw_array( $product_id ) {
		$raw_meta = get_post_meta( absint( $product_id ), 'fooevents_bookings_options_serialized', true );
		$data     = is_string( $raw_meta ) ? json_decode( wp_unslash( $raw_meta ), true ) : array();
		$data     = is_array( $data ) ? $data : array();
		foreach ( $data as $sid => $row ) {
			if ( is_array( $row ) ) {
				$data[ $sid ] = $this->flatten_processed_slot_row( $row );
			}
		}
		return $data;
	}

	/**
	 * Persist raw slotdate map; returns WP_Error on encode failure.
	 *
	 * @param int                  $product_id Product.
	 * @param array<string, mixed> $slots Raw slot map.
	 * @return true|WP_Error
	 */
	private function persist_raw_booking_slots_or_fail( $product_id, array $slots ) {
		$json = wp_json_encode( $slots, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		if ( false === $json ) {
			return new WP_Error( 'json_error', __( 'Failed to encode booking options.', 'fooevents-internal-pos' ), array( 'status' => 500 ) );
		}
		update_post_meta( absint( $product_id ), 'fooevents_bookings_options_serialized', wp_slash( $json ) );
		return true;
	}

	/**
	 * @param array<string, mixed> $raw Raw serialization.
	 * @return int
	 */
	private function count_slot_date_cells_raw( array $raw ) {
		$n = 0;
		foreach ( $raw as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			foreach ( array_keys( $row ) as $k ) {
				if ( preg_match( '/^(.+)_add_date$/', (string) $k, $m ) && '' !== $this->normalize_booking_raw_date_suffix( $m[1] ) ) {
					++$n;
				}
			}
		}
		return $n;
	}

	/**
	 * @param array<string, mixed> $raw Raw serialization.
	 * @return string
	 */
	private function next_unique_internal_prefix( array $raw ) {
		// Allow multiple adds in one PHP request — microtime-backed id with collision avoidance.
		// Prefix with 'p' so keys are never purely numeric (PHP int-casts add_date keys and breaks FooEvents admin ===).
		$base = (int) floor( microtime( true ) * 1000000 );
		for ( $try = $base; $try < $base + 10000; ++$try ) {
			$candidate = 'p' . (string) $try;
			if ( ! $this->raw_uses_inner_date_prefix_anywhere( $raw, $candidate ) ) {
				return $candidate;
			}
		}
		return 'p' . (string) wp_rand( 100000000, 990000000 );
	}

	/**
	 * @param array<string, mixed> $raw Raw serialization.
	 * @param string               $candidate Inner id digits.
	 * @return bool
	 */
	private function raw_uses_inner_date_prefix_anywhere( array $raw, $candidate ) {
		foreach ( $raw as $slot_row ) {
			if ( ! is_array( $slot_row ) ) {
				continue;
			}
			foreach ( array_keys( $slot_row ) as $k ) {
				if ( preg_match( '/' . preg_quote( $candidate, '/' ) . '_(?:add_date|stock)/', (string) $k ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * @param array<string, mixed> $raw Raw serialization.
	 * @return string
	 */
	private function next_unique_slot_key( array $raw ) {
		$max = 0;
		foreach ( array_keys( $raw ) as $sid ) {
			$s = (string) $sid;
			if ( preg_match( '/^s(\d+)$/i', $s, $m ) ) {
				$max = max( $max, (int) $m[1] );
			} elseif ( ctype_digit( $s ) ) {
				$max = max( $max, (int) $s );
			}
		}
		return 's' . (string) ( $max + 1 );
	}

	/**
	 * @param array<string, mixed> $slot_row Serialized slot row (before add).
	 * @param string               $h Two-digit hour key.
	 * @param string               $min Two-digit minute.
	 * @param string               $period a.m.|p.m.
	 * @param string               $label_match Compare against slot label semantics (merged name-or-time token).
	 * @return bool
	 */
	private function raw_slot_matches_time_and_label( array $slot_row, $h, $min, $period, $label_match ) {
		$lh = isset( $slot_row['hour'] ) ? (string) $slot_row['hour'] : '';
		$lm = isset( $slot_row['minute'] ) ? (string) $slot_row['minute'] : '';
		$lp = array_key_exists( 'period', $slot_row ) ? (string) $slot_row['period'] : '';

		if ( str_pad( (string) (int) $lh, 2, '0', STR_PAD_LEFT ) !== str_pad( (string) (int) $h, 2, '0', STR_PAD_LEFT ) ) {
			return false;
		}
		if ( str_pad( (string) (int) $lm, 2, '0', STR_PAD_LEFT ) !== str_pad( (string) (int) $min, 2, '0', STR_PAD_LEFT ) ) {
			return false;
		}
		if ( $lp !== $period ) {
			return false;
		}
		$lbl = isset( $slot_row['label'] ) ? trim( wp_strip_all_tags( (string) $slot_row['label'] ) ) : '';
		$effective = '' !== $lbl ? $lbl : sprintf( '%02d:%02d', (int) $slot_row['hour'], (int) $slot_row['minute'] );

		return 0 === strcasecmp( (string) $label_match, $effective );
	}

	/**
	 * @param array<string, mixed> $slot_row Serialized slot row.
	 * @param string               $ymd Y-m-d.
	 * @return string|null Matching raw date suffix, or null.
	 */
	private function find_date_id_with_ymd_in_slot_raw( array $slot_row, $ymd ) {
		$tz      = $this->bookings->get_wp_timezone();
		$wp_fmt  = trim( (string) get_option( 'date_format' ) );
		foreach ( $slot_row as $key => $_val ) {
			if ( ! preg_match( '/^(.+)_add_date$/', (string) $key, $m ) ) {
				continue;
			}
			$suffix = $this->normalize_booking_raw_date_suffix( $m[1] );
			if ( '' === $suffix ) {
				continue;
			}
			$display = is_string( $_val ) ? trim( $_val ) : '';
			if ( '' === $display ) {
				continue;
			}
			$parsed_ymd = null;
			if ( '' !== $wp_fmt ) {
				$dtcf = DateTime::createFromFormat( $wp_fmt, $display, $tz );
				if ( $dtcf instanceof DateTime ) {
					$errs = DateTime::getLastErrors();
					if ( is_array( $errs ) && empty( $errs['warning_count'] ) && empty( $errs['error_count'] ) ) {
						$parsed_ymd = $dtcf->format( 'Y-m-d' );
					}
				}
			}
			if ( null === $parsed_ymd ) {
				$parsed_ymd = $this->bookings->date_string_to_ymd( $display );
			}
			if ( null !== $parsed_ymd && (string) $parsed_ymd === (string) $ymd ) {
				return $suffix;
			}
		}
		return null;
	}

	/**
	 * @param array<string, mixed> $slot_row After unsetting date keys maybe left with label/time only.
	 * @return bool
	 */
	private function slot_row_has_dates_left( array $slot_row ) {
		foreach ( array_keys( $slot_row ) as $k ) {
			if ( preg_match( '/^(.+)_add_date$/', (string) $k, $m ) && '' !== $this->normalize_booking_raw_date_suffix( $m[1] ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Top-level slot key as stored in serialized JSON (PHP may keep int-like keys as int or string).
	 *
	 * @param array<string,mixed> $raw_slots Decoded fooevents_bookings_options_serialized.
	 * @param string              $slot_id   Client slot id.
	 * @return array-key|null
	 */
	private function normalize_raw_slot_lookup_key( array $raw_slots, $slot_id ) {
		$needle = preg_replace( '/\s+/', '', trim( (string) $slot_id ) );
		if ( '' === $needle ) {
			return null;
		}
		foreach ( array_keys( $raw_slots ) as $k ) {
			if ( ! is_scalar( $k ) ) {
				continue;
			}
			if ( (string) $k === (string) $needle ) {
				return $k;
			}
		}
		return null;
	}

	/**
	 * Compare two digit-only booking inner ids (leading zeros, etc.).
	 *
	 * @param string $a Digits.
	 * @param string $b Digits.
	 * @return bool
	 */
	private function numeric_booking_suffix_equivalent( $a, $b ) {
		$aa = preg_replace( '/\s+/', '', trim( (string) $a ) );
		$bb = preg_replace( '/\s+/', '', trim( (string) $b ) );
		if ( '' === $aa || '' === $bb || ! ctype_digit( $aa ) || ! ctype_digit( $bb ) ) {
			return false;
		}
		$ta = ltrim( $aa, '0' );
		$tb = ltrim( $bb, '0' );
		$za = '' === $ta ? '0' : $ta;
		$zb = '' === $tb ? '0' : $tb;
		return $za === $zb;
	}

	/**
	 * Map SPA/rest dateId onto raw `{suffix}_add_date` using preprocess `add_date` cells (FooEvents internal).
	 *
	 * @param int                  $product_id Product ID.
	 * @param string               $slot_id    SPA slot row id (request).
	 * @param array<string, mixed> $slot_row   Raw JSON row under that slot.
	 * @param string               $did        Normalized client `dateId`.
	 * @return string Inner suffix or ''.
	 */
	private function resolve_inner_via_preprocess_add_date_cells( $product_id, $slot_id, array $slot_row, $did ) {
		try {
			$pre = $this->bookings->get_preprocess_booking_options( absint( $product_id ) );
		} catch ( \Throwable $e ) {
			return '';
		}
		if ( ! is_array( $pre ) || empty( $pre ) ) {
			return '';
		}

		$branch = null;
		foreach ( $pre as $sid => $node ) {
			if ( ! is_scalar( $sid ) || (string) $sid !== (string) $slot_id ) {
				continue;
			}
			$branch = is_array( $node ) ? $node : null;
			break;
		}
		if ( null === $branch || empty( $branch['add_date'] ) || ! is_array( $branch['add_date'] ) ) {
			return '';
		}

		foreach ( $branch['add_date'] as $inner_key => $cell ) {
			if ( ! is_array( $cell ) ) {
				continue;
			}
			$iks = $this->normalize_booking_raw_date_suffix( $inner_key );
			if ( '' === $iks || ! isset( $slot_row[ $iks . '_add_date' ] ) ) {
				continue;
			}
			$expose = '';
			foreach ( array( 'date_id', 'slot_date_id', 'booking_date_id' ) as $ek ) {
				if ( ! isset( $cell[ $ek ] ) ) {
					continue;
				}
				$cand = preg_replace( '/\s+/', '', trim( (string) $cell[ $ek ] ) );
				if ( '' !== $cand ) {
					$expose = $cand;
					break;
				}
			}
			if ( '' !== $expose ) {
				if ( (string) $expose === (string) $did ) {
					return $iks;
				}
				if ( ctype_digit( (string) $expose ) && ctype_digit( (string) $did ) && $this->numeric_booking_suffix_equivalent( $expose, $did ) ) {
					return $iks;
				}
				continue;
			}
			if ( (string) $iks === (string) $did ) {
				return $iks;
			}
			if ( ctype_digit( (string) $iks ) && ctype_digit( (string) $did ) && $this->numeric_booking_suffix_equivalent( $iks, $did ) ) {
				return $iks;
			}
		}

		return '';
	}

	/**
	 * Align REST slot.dateId from processed options with `{inner}_add_date` keys inside raw serialization.
	 * Preprocess `add_date` keys match raw suffix strings; FooEvents dateslot processed `date_id` may differ until mapped here.
	 *
	 * @param int                  $product_id       Booking product ID.
	 * @param string               $booking_method   slotdate or dateslot.
	 * @param string               $slot_id          SPA slot row id from path.
	 * @param array<string, mixed> $slot_row         Raw FooEvents booking row array.
	 * @param string               $client_date_id   SPA path dateId (normalized opaque suffix).
	 * @return string Inner id matching `{id}_add_date`/`{id}_stock`, or ''.
	 */
	private function resolve_raw_inner_id_for_manual_remove( $product_id, $booking_method, $slot_id, array $slot_row, $client_date_id ) {
		$did = $this->normalize_booking_raw_date_suffix( $client_date_id );
		if ( '' === $did ) {
			return '';
		}

		if ( isset( $slot_row[ $did . '_add_date' ] ) ) {
			return $did;
		}

		if ( ctype_digit( (string) $did ) ) {
			$trim_zeros = preg_replace( '/^0+/', '', $did );
			$trim_zeros = ( '' === $trim_zeros ) ? '0' : $trim_zeros;
			if ( $trim_zeros !== $did && isset( $slot_row[ $trim_zeros . '_add_date' ] ) ) {
				return $trim_zeros;
			}
		}

		$via_pre = $this->resolve_inner_via_preprocess_add_date_cells( $product_id, $slot_id, $slot_row, $did );
		if ( '' !== $via_pre ) {
			return $via_pre;
		}

		if ( 'dateslot' !== (string) $booking_method ) {
			return '';
		}

		$ctx     = $this->bookings->get_processed_options( absint( $product_id ) );
		$options = isset( $ctx['options'] ) ? $ctx['options'] : array();
		if ( ! is_array( $options ) ) {
			return '';
		}

		$ym_candidates = array();
		foreach ( $options as $bucket => $slots_for_date ) {
			if ( ! is_array( $slots_for_date ) ) {
				continue;
			}
			$row_dateslot = null;
			foreach ( $slots_for_date as $sid => $r_cell ) {
				if ( (string) $sid === (string) $slot_id && is_array( $r_cell ) ) {
					$row_dateslot = $r_cell;
					break;
				}
			}
			if ( null === $row_dateslot ) {
				continue;
			}
			$proc_did = isset( $row_dateslot['date_id'] ) ? $this->normalize_booking_raw_date_suffix( $row_dateslot['date_id'] ) : '';
			$proc_match = ( (string) $proc_did === (string) $did );
			if ( ! $proc_match && '' !== $proc_did && ctype_digit( (string) $proc_did ) && ctype_digit( (string) $did ) ) {
				$proc_match = $this->numeric_booking_suffix_equivalent( $proc_did, $did );
			}
			if ( ! $proc_match ) {
				continue;
			}
			// Bucket may already be Y-m-d.
			if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', trim( (string) $bucket ) ) ) {
				$ym_candidates[] = trim( (string) $bucket );
				continue;
			}
			$ym = $this->bookings->date_string_to_ymd( (string) $bucket );
			if ( null !== $ym && '' !== (string) $ym ) {
				$ym_candidates[] = (string) $ym;
			}
		}

		foreach ( array_unique( $ym_candidates ) as $ymd ) {
			$inner = $this->find_date_id_with_ymd_in_slot_raw( $slot_row, $ymd );
			if ( null === $inner || '' === $inner ) {
				continue;
			}
			$inner = $this->normalize_booking_raw_date_suffix( (string) $inner );
			if ( '' !== $inner && $this->raw_date_cell_exists( $slot_row, $inner ) ) {
				return $inner;
			}
		}

		return '';
	}

	/**
	 * Validate and normalize config.
	 *
	 * @param array $config Config.
	 * @return array|WP_Error
	 */
	public function validate_config( $config ) {
		if ( ! is_array( $config ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'Request body must be a JSON object.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$session = isset( $config['sessionMinutes'] ) ? (int) $config['sessionMinutes'] : 0;
		if ( $session < self::SESSION_MIN_MINUTES || $session > self::SESSION_MAX_MINUTES ) {
			return new WP_Error( 'rest_invalid_param', sprintf( /* translators: 1,2: min max */ __( 'sessionMinutes must be between %1$d and %2$d.', 'fooevents-internal-pos' ), self::SESSION_MIN_MINUTES, self::SESSION_MAX_MINUTES ), array( 'status' => 400 ) );
		}
		$cap = array_key_exists( 'capacity', $config ) ? (int) $config['capacity'] : -1;
		if ( $cap < 0 ) {
			return new WP_Error( 'rest_invalid_param', __( 'capacity must be >= 0 (0 = unlimited).', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$label_format = isset( $config['labelFormat'] ) ? (string) $config['labelFormat'] : 'time';
		if ( 'time' !== $label_format && 0 !== strpos( $label_format, 'custom:' ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'labelFormat must be "time" or "custom:Your prefix".', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}
		$blocks = isset( $config['blocks'] ) && is_array( $config['blocks'] ) ? $config['blocks'] : array();
		if ( empty( $blocks ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'At least one schedule block is required.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
		}

		$mode      = 'replace';
		$fill_from = '';
		$fill_to   = '';
		if ( isset( $config['mode'] ) ) {
			$mr = strtolower( trim( (string) $config['mode'] ) );
			$mr = str_replace( '_', '', $mr );
			if ( 'fillempty' === $mr ) {
				$mode = 'fillEmpty';
			} elseif ( 'replace' !== $mr && '' !== $mr ) {
				return new WP_Error( 'rest_invalid_param', __( 'mode must be replace or fillEmpty.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
		}
		if ( 'fillEmpty' === $mode ) {
			$fill_from = isset( $config['fillFrom'] ) ? trim( (string) $config['fillFrom'] ) : '';
			$fill_to   = isset( $config['fillTo'] ) ? trim( (string) $config['fillTo'] ) : '';
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $fill_from ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $fill_to ) ) {
				return new WP_Error( 'rest_invalid_param', __( 'fillEmpty mode requires fillFrom and fillTo as Y-m-d.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
			if ( strcmp( $fill_from, $fill_to ) > 0 ) {
				return new WP_Error( 'rest_invalid_param', __( 'fillFrom must be on or before fillTo.', 'fooevents-internal-pos' ), array( 'status' => 400 ) );
			}
		}

		$norm = array();
		foreach ( $blocks as $i => $b ) {
			if ( ! is_array( $b ) ) {
				return new WP_Error( 'rest_invalid_param', sprintf( /* translators: %d */ __( 'Block %d is invalid.', 'fooevents-internal-pos' ), $i + 1 ), array( 'status' => 400 ) );
			}
			$start = isset( $b['startDate'] ) ? (string) $b['startDate'] : '';
			$end   = isset( $b['endDate'] ) ? (string) $b['endDate'] : '';
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $start ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $end ) ) {
				return new WP_Error( 'rest_invalid_param', sprintf( /* translators: %d */ __( 'Block %d: use Y-m-d for startDate and endDate.', 'fooevents-internal-pos' ), $i + 1 ), array( 'status' => 400 ) );
			}
			$wds = isset( $b['weekdays'] ) && is_array( $b['weekdays'] ) ? $b['weekdays'] : array();
			$wds = array_map( 'intval', $wds );
			$wds = array_values( array_unique( array_filter( $wds, array( __CLASS__, 'is_weekday' ) ) ) );
			if ( empty( $wds ) ) {
				return new WP_Error( 'rest_invalid_param', sprintf( /* translators: %d */ __( 'Block %d: select at least one weekday (1-7, Mon-Sun).', 'fooevents-internal-pos' ), $i + 1 ), array( 'status' => 400 ) );
			}
			sort( $wds, SORT_NUMERIC );
			$ot = isset( $b['openTime'] ) ? (string) $b['openTime'] : '';
			$ct = isset( $b['closeTime'] ) ? (string) $b['closeTime'] : '';
			if ( null === $this->to_minutes( $ot ) || null === $this->to_minutes( $ct ) ) {
				return new WP_Error( 'rest_invalid_param', sprintf( /* translators: %d */ __( 'Block %d: openTime and closeTime must be HH:MM.', 'fooevents-internal-pos' ), $i + 1 ), array( 'status' => 400 ) );
			}
			$raw_name = array_key_exists( 'name', $b ) ? (string) $b['name'] : '';
			$name     = ( '' === trim( $raw_name ) ) ? '' : sanitize_text_field( $raw_name );
			if ( '' !== $name && strlen( $name ) > self::BLOCK_NAME_MAX ) {
				return new WP_Error(
					'rest_invalid_param',
					sprintf(
						/* translators: 1: block index, 2: max length */
						__( 'Block %1$d: schedule name must be at most %2$d characters.', 'fooevents-internal-pos' ),
						$i + 1,
						self::BLOCK_NAME_MAX
					),
					array( 'status' => 400 )
				);
			}
			$norm[] = array(
				'startDate' => $start,
				'endDate'   => $end,
				'weekdays'  => $wds,
				'openTime'  => $ot,
				'closeTime' => $ct,
				'name'      => $name,
			);
		}
		return array(
			'blocks'          => $norm,
			'sessionMinutes'  => $session,
			'capacity'        => $cap,
			'labelFormat'     => $label_format,
			'mode'            => $mode,
			'fillFrom'        => $fill_from,
			'fillTo'          => $fill_to,
		);
	}

	/**
	 * @param int $n 1-7
	 * @return bool
	 */
	public static function is_weekday( $n ) {
		return $n >= 1 && $n <= 7;
	}

	/**
	 * @param string $ymd Y-m-d.
	 * @param string $end Y-m-d inclusive.
	 * @param int[]  $weekdays 1-7.
	 * @return string[]
	 */
	private function list_dates_in_range( $ymd, $end, $weekdays, $tz ) {
		$out  = array();
		$wset = array_fill_keys( $weekdays, true );
		try {
			$cur = new DateTime( $ymd . ' 00:00:00', $tz );
			$end_dt = new DateTime( $end . ' 23:59:59', $tz );
		} catch ( \Exception $e ) {
			return array();
		}
		$it = 0;
		while ( $cur <= $end_dt && $it < 2000 ) {
			$n = (int) $cur->format( 'N' );
			if ( isset( $wset[ $n ] ) ) {
				$out[] = $cur->format( 'Y-m-d' );
			}
			$cur->modify( '+1 day' );
			++$it;
		}
		return $out;
	}

	/**
	 * @param int $open_m Open minute from 00:00.
	 * @param int $close_m Close (exclusive of session end must fit inside: last start + session <= close).
	 * @param int $session Session length minutes.
	 * @return int[] minute-of-day for each session start
	 */
	private function iter_session_starts( $open_m, $close_m, $session ) {
		$out = array();
		for ( $t = $open_m; $t + $session <= $close_m; $t += $session ) {
			$out[] = $t;
		}
		return $out;
	}

	/**
	 * @param string $hhm HH:MM
	 * @return int minutes from midnight
	 */
	private function to_minutes( $hhm ) {
		$m = $this->parse_hhmm( $hhm );
		if ( null === $m ) {
			return null;
		}
		return (int) $m['h'] * 60 + (int) $m['m'];
	}

	/**
	 * @param int $m Minutes.
	 * @return string
	 */
	private function minutes_to_hhmm( $m ) {
		$h = (int) floor( $m / 60 );
		$min = (int) ( $m % 60 );
		return str_pad( (string) $h, 2, '0', STR_PAD_LEFT ) . ':' . str_pad( (string) $min, 2, '0', STR_PAD_LEFT );
	}

	/**
	 * @param string $s HH:MM
	 * @return array{h: int, m: int}|null
	 */
	private function parse_hhmm( $s ) {
		if ( ! preg_match( '/^(\d{1,2}):(\d{2})$/', trim( (string) $s ), $m ) ) {
			return null;
		}
		$h = (int) $m[1];
		$mm = (int) $m[2];
		if ( $h < 0 || $h > 23 || $mm < 0 || $mm > 59 ) {
			return null;
		}
		return array( 'h' => $h, 'm' => $mm );
	}
}
