<?php
/**
 * Generate FooEvents Bookings slot meta from schedule blocks (slotdate / slot-first).
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use DateTime;
use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Service to build and persist fooevents_bookings_options_serialized.
 */
class Slot_Generator_Service {

	const MAX_DATES_PER_BLOCK   = 1000;
	const MAX_TOTAL_ENTRIES     = 5000;
	const SESSION_MIN_MINUTES  = 5;
	const SESSION_MAX_MINUTES  = 240;
	/** Max length for a schedule block "name" (slot label). */
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

		$tz        = $this->bookings->get_wp_timezone();
		$today_ymd = $this->bookings->today_ymd();
		$warnings  = array();

		// Map block name (slot label) + time "HH:MM" => set of Y-m-d
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

		$date_format = get_option( 'date_format' );

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

		$seq   = (int) ( microtime( true ) * 1000 );
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
			$h   = (string) str_pad( (string) $hm['h'], 2, '0', STR_PAD_LEFT );
			$min = (string) str_pad( (string) $hm['m'], 2, '0', STR_PAD_LEFT );

			if ( '' !== $bname ) {
				$label = $bname;
			} elseif ( 0 === strpos( $label_mode, 'custom:' ) ) {
				$label = ( '' !== $custom_pre ? $custom_pre . ' ' : '' ) . $time_key;
			} else {
				$label = $time_key;
			}

			$slot_id = (string) ( $seq++ );
			$slot    = array(
				'label'    => $label,
				'add_time' => 'enabled',
				'hour'     => $h,
				'minute'   => $min,
				'period'   => '',
			);

			foreach ( $ymds as $ymd ) {
				$ts = strtotime( $ymd . ' 12:00:00' );
				if ( false === $ts ) {
					continue;
				}
				$display = date_i18n( $date_format, $ts );
				$did     = (string) ( $seq++ );
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
			'totalEntries'  => $total_lines,
			'warnings'      => $warnings,
			'sample'        => $sample,
		);
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
