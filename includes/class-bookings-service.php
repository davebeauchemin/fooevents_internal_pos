<?php
/**
 * FooEvents Bookings: process options, filter past dates, normalize API shape.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

use DateTime;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Bookings service.
 */
class Bookings_Service {

	/**
	 * Get WordPress site timezone.
	 */
	public function get_wp_timezone() {
		$tz = wp_timezone();
		return $tz instanceof \DateTimeZone ? $tz : new DateTimeZone( 'UTC' );
	}

	/**
	 * Parse a FooEvents display date to Y-m-d in site timezone, or null.
	 *
	 * @param string $date_str Human-readable date.
	 * @return string|null
	 */
	public function date_string_to_ymd( $date_str ) {
		$date_str = trim( (string) $date_str );
		if ( '' === $date_str ) {
			return null;
		}
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date_str ) ) {
			return $date_str;
		}

		$tz     = $this->get_wp_timezone();
		$wp_fmt = trim( (string) get_option( 'date_format' ) );
		if ( '' !== $wp_fmt ) {
			$parsed = DateTime::createFromFormat( $wp_fmt, $date_str, $tz );
			if ( $parsed instanceof DateTime ) {
				$errs = DateTime::getLastErrors();
				if ( false === $errs || ( empty( $errs['warning_count'] ) && empty( $errs['error_count'] ) ) ) {
					return $parsed->format( 'Y-m-d' );
				}
			}
		}

		$dt   = new DateTime( 'now', $tz );
		$ts   = strtotime( $date_str, $dt->getTimestamp() );
		if ( false === $ts ) {
			$ts = strtotime( $date_str );
		}
		if ( false === $ts ) {
			return null;
		}
		$d = new DateTime( '@' . $ts );
		$d->setTimezone( $tz );
		return $d->format( 'Y-m-d' );
	}

	/**
	 * Start of today in site timezone.
	 */
	public function today_ymd() {
		$tz = $this->get_wp_timezone();
		$dt = new DateTime( 'now', $tz );
		return $dt->format( 'Y-m-d' );
	}

	/**
	 * WordPress site calendar + clock for POS (authoritative timezone for UI timing).
	 *
	 * @return array{siteTodayYmd:string,siteNowLocal:string,siteCurrentHour:int,siteTimezone:string}
	 */
	public function get_site_time_for_rest() {
		$tz   = $this->get_wp_timezone();
		$dt   = new DateTime( 'now', $tz );
		$tz_s = function_exists( 'wp_timezone_string' ) ? wp_timezone_string() : $tz->getName();
		if ( ! is_string( $tz_s ) || '' === $tz_s ) {
			$tz_s = $tz->getName();
		}
		return array(
			'siteTodayYmd'      => $dt->format( 'Y-m-d' ),
			'siteNowLocal'      => $dt->format( 'c' ),
			'siteCurrentHour'   => (int) $dt->format( 'G' ),
			'siteTimezone'      => $tz_s,
		);
	}

	/**
	 * Display price for POS cart/checkout labels (matches storefront inclusive/exclusive logic).
	 *
	 * @param int $product_id Product ID.
	 * @return array{ price: float|null, priceHtml: string } priceHtml is plain text (not WooCommerce wc_price HTML).
	 */
	public function get_product_price_for_rest( $product_id ) {
		$product_id = absint( $product_id );
		$product    = wc_get_product( $product_id );
		if ( ! $product ) {
			return array(
				'price'     => null,
				'priceHtml' => '',
			);
		}
		$display = (float) wc_get_price_to_display( $product );
		$html    = wc_price( $display );
		return array(
			'price'     => $display,
			// Plain text for SPA/React (wc_price outputs HTML markup).
			'priceHtml' => wp_strip_all_tags( html_entity_decode( $html, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ),
		);
	}

	/**
	 * True if Y-m-d is today or in the future.
	 *
	 * @param string $ymd Y-m-d.
	 */
	public function is_date_not_past( $ymd ) {
		$today = $this->today_ymd();
		return strcmp( (string) $ymd, $today ) >= 0;
	}

	/**
	 * Process booking options with FooEvents_Bookings.
	 *
	 * @param int $product_id Product ID.
	 * @return array{ method: string, options: array, options_raw: array }
	 */
	public function get_processed_options( $product_id ) {
		$raw = get_post_meta( $product_id, 'fooevents_bookings_options_serialized', true );
		$raw = is_string( $raw ) ? json_decode( $raw, true ) : array();
		if ( ! is_array( $raw ) ) {
			$raw = array();
		}
		$bookings  = new \FooEvents_Bookings();
		$processed = $bookings->process_booking_options( $raw );
		$method    = get_post_meta( $product_id, 'WooCommerceEventsBookingsMethod', true );
		if ( empty( $method ) || '1' === (string) $method ) {
			$method = 'slotdate';
		}
		if ( 'dateslot' === $method ) {
			$processed = $bookings->process_date_slot_bookings_options( $processed );
		}
		return array(
			'method'      => (string) $method,
			'options'     => $processed,
			'options_raw' => $raw,
		);
	}

	/**
	 * FooEvents `$bookings->process_booking_options()` output keyed by slot id (before dateslot reshuffle).
	 * Each slot's `add_date` keys match raw `{inner}_add_date` suffix identifiers (digits or FooEvents-style strings).
	 *
	 * @param int $product_id Product ID.
	 * @return array<string,mixed>
	 */
	public function get_preprocess_booking_options( $product_id ) {
		$product_id = absint( $product_id );
		if ( ! class_exists( '\\FooEvents_Bookings' ) ) {
			return array();
		}
		$raw        = get_post_meta( $product_id, 'fooevents_bookings_options_serialized', true );
		$raw        = is_string( $raw ) ? json_decode( wp_unslash( $raw ), true ) : array();
		if ( ! is_array( $raw ) ) {
			$raw = array();
		}
		if ( empty( $raw ) ) {
			return array();
		}
		$bookings = new \FooEvents_Bookings();
		$parsed   = $bookings->process_booking_options( $raw );
		return is_array( $parsed ) ? $parsed : array();
	}

	/**
	 * Whether product has at least one future bookable option.
	 *
	 * @param int $product_id Product ID.
	 */
	public function has_future_booking( $product_id ) {
		$data  = $this->get_event_detail( $product_id );
		$dates = isset( $data['dates'] ) ? $data['dates'] : array();
		return ! empty( $dates );
	}

	/**
	 * Full event detail for API (read-only).
	 *
	 * @param int $product_id Product ID.
	 * @return array
	 */
	public function get_event_detail( $product_id ) {
		$product_id = absint( $product_id );
		$product    = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return array_merge(
				array(
					'id'             => $product_id,
					'error'          => 'not_booking_event',
					'title'         => $product ? $product->get_name() : '',
					'bookingMethod' => '',
					'labels'        => array( 'date' => __( 'Date', 'fooevents-internal-pos' ), 'slot' => __( 'Slot', 'fooevents-internal-pos' ) ),
					'dates'         => array(),
				),
				$this->get_site_time_for_rest(),
			);
		}

		$ctx      = $this->get_processed_options( $product_id );
		$method   = $ctx['method'];
		$options  = $ctx['options'];
		$date_lbl = $product->get_meta( 'WooCommerceEventsBookingsDateOverride', true );
		$slot_lbl = $product->get_meta( 'WooCommerceEventsBookingsSlotOverride', true );
		$labels   = array(
			'date' => $date_lbl ? $date_lbl : __( 'Date', 'fooevents-internal-pos' ),
			'slot' => $slot_lbl ? $slot_lbl : __( 'Slot', 'fooevents-internal-pos' ),
		);

		$dates_out = array();

		if ( 'dateslot' === $method && is_array( $options ) ) {
			// Keyed by human-readable date; value is [ slotId => data ].
			foreach ( $options as $date_display => $slots_for_date ) {
				if ( ! is_array( $slots_for_date ) ) {
					continue;
				}
				$ymd = $this->date_string_to_ymd( (string) $date_display );
				if ( null === $ymd || ! $this->is_date_not_past( $ymd ) ) {
					continue;
				}
				$slot_rows = array();
				foreach ( $slots_for_date as $slot_id => $row ) {
					if ( ! is_array( $row ) ) {
						continue;
					}
					$stock           = $row['stock'] ?? '';
					$slot_label_base = (string) ( $row['slot_label'] ?? $slot_id );
					$slot_time_part  = ! empty( $row['slot_time'] ) ? (string) $row['slot_time'] : '';
					$full_label      = trim( $slot_label_base . ( '' !== $slot_time_part ? ' ' . $slot_time_part : '' ) );
					$time_hhmm_cell  = $this->extract_time( $full_label );
					if ( '' === $time_hhmm_cell && '' !== $slot_time_part ) {
						$time_hhmm_cell = $this->extract_time( $slot_time_part );
					}
					$slot_rows[] = array(
						'id'     => (string) $slot_id,
						'dateId' => (string) ( $row['date_id'] ?? '' ),
						'label'  => $full_label,
						'time'   => $time_hhmm_cell,
						'stock'  => $this->normalize_stock( $stock ),
					);
				}
				if ( ! empty( $slot_rows ) ) {
					$dates_out[] = array(
						'id'     => (string) $date_display,
						'date'   => $ymd,
						'label'  => (string) $date_display,
						'stock'  => $this->aggregate_slot_stock( $slot_rows ),
						'slots'  => $slot_rows,
					);
				}
			}
		} else {
			// slotdate: options keyed by slotId.
			$by_day = array();
			foreach ( $options as $slot_id => $opt ) {
				if ( ! is_array( $opt ) || empty( $opt['add_date'] ) || ! is_array( $opt['add_date'] ) ) {
					continue;
				}
				$base_label = trim( (string) ( $opt['label'] ?? $slot_id ) );
				$hour      = isset( $opt['hour'] ) ? (string) $opt['hour'] : '';
				$minute    = isset( $opt['minute'] ) ? (string) $opt['minute'] : '';
				$time_hhmm = ( '' === $hour || '' === $minute ) ? '' : sprintf( '%02d:%02d', (int) $hour, (int) $minute );
				if ( '' === $time_hhmm ) {
					$time_hhmm = $this->extract_time( $base_label );
				}
				$period     = array_key_exists( 'period', $opt ) ? (string) $opt['period'] : '';
				foreach ( $opt['add_date'] as $date_id => $drow ) {
					if ( ! is_array( $drow ) || empty( $drow['date'] ) ) {
						continue;
					}
					$ymd = $this->date_string_to_ymd( (string) $drow['date'] );
					if ( null === $ymd || ! $this->is_date_not_past( $ymd ) ) {
						continue;
					}
					$stock  = $drow['stock'] ?? '';
					$day_key = $ymd;
					if ( ! isset( $by_day[ $day_key ] ) ) {
						$by_day[ $day_key ] = array(
							'id'     => (string) $day_key,
							'date'   => $ymd,
							'label'  => (string) $drow['date'],
							'stock'  => 0,
							'slots'  => array(),
						);
					}
					$slot_row = array(
						'id'     => (string) $slot_id,
						'dateId' => (string) $date_id,
						'label'  => $base_label,
						'stock'  => $this->normalize_stock( $stock ),
						'time'   => $time_hhmm,
						'hour'   => $hour,
						'minute' => $minute,
						'period' => $period,
					);
					$by_day[ $day_key ]['slots'][] = $slot_row;
				}
			}
			foreach ( $by_day as $row ) {
				$row['stock'] = $this->aggregate_slot_stock( $row['slots'] );
				$dates_out[]  = $row;
			}
			usort(
				$dates_out,
				function( $a, $b ) {
					return strcmp( (string) $a['date'], (string) $b['date'] );
				}
			);
		}

		$price_row = $this->get_product_price_for_rest( $product_id );

		return array_merge(
			array(
				'id'             => $product_id,
				'title'         => $product->get_name(),
				'bookingMethod' => $method,
				'labels'        => $labels,
				'dates'         => $dates_out,
				'price'         => $price_row['price'],
				'priceHtml'     => $price_row['priceHtml'],
			),
			$this->get_site_time_for_rest(),
		);
	}

	/**
	 * @param string|int $stock Raw stock.
	 * @return int|null Null = unlimited.
	 */
	private function normalize_stock( $stock ) {
		if ( '' === $stock || null === $stock ) {
			return null;
		}
		$n = (int) $stock;
		return $n;
	}

	/**
	 * @param array $slots List of [ stock => int|null ].
	 * @return int|null
	 */
	private function aggregate_slot_stock( $slots ) {
		$has_limited  = false;
		$min          = null;
		foreach ( $slots as $s ) {
			$v = is_array( $s ) && array_key_exists( 'stock', $s ) ? $s['stock'] : null;
			if ( null === $v ) {
				continue; // unlimited slot does not cap aggregate.
			}
			$has_limited = true;
			$min         = ( null === $min ) ? $v : min( (int) $min, (int) $v );
		}
		if ( ! $has_limited ) {
			return null;
		}
		return (int) $min;
	}

	/**
	 * List booking events (summary).
	 */
	public function list_booking_events() {
		$q = new WP_Query(
			array(
				'post_type'      => 'product',
				'post_status'   => 'publish',
				'posts_per_page' => 200,
				'fields'         => 'ids',
				'meta_query'     => array(
					'relation' => 'AND',
					array(
						'key'   => 'WooCommerceEventsEvent',
						'value' => 'Event',
					),
					array(
						'key'   => 'WooCommerceEventsType',
						'value' => 'bookings',
					),
				),
			)
		);
		$out = array();
		foreach ( $q->posts as $pid ) {
			if ( ! $this->has_future_booking( (int) $pid ) ) {
				continue;
			}
			$product = wc_get_product( (int) $pid );
			if ( ! $product ) {
				continue;
			}
			$detail  = $this->get_event_detail( (int) $pid );
			$next    = '';
			$first   = isset( $detail['dates'][0] ) ? $detail['dates'][0] : null;
			if ( is_array( $first ) && ! empty( $first['label'] ) ) {
				$next = (string) $first['label'];
			}
			$image = '';
			if ( $product->get_image_id() ) {
				$img = wp_get_attachment_image_src( $product->get_image_id(), 'thumbnail' );
				$image = is_array( $img ) ? (string) $img[0] : '';
			}
			$method = $product->get_meta( 'WooCommerceEventsBookingsMethod', true );
			if ( empty( $method ) || '1' === (string) $method ) {
				$method = 'slotdate';
			}
			$out[] = array(
				'id'             => (int) $pid,
				'title'         => $product->get_name(),
				'image'         => $image,
				'bookingMethod' => (string) $method,
				'nextAvailable' => $next,
			);
		}
		return $out;
	}

	/**
	 * Extract a 24h HH:MM string from a slot label for sorting. Empty if not found.
	 *
	 * @param string $label Slot label (may include time text).
	 * @return string
	 */
	public function extract_time( $label ) {
		$label = (string) $label;
		if ( preg_match( '/\b([01]?\d|2[0-3]):([0-5]\d)\b/', $label, $m ) ) {
			return sprintf( '%02d:%02d', (int) $m[1], (int) $m[2] );
		}
		if ( preg_match( '/\b(\d{1,2}):([0-5]\d)\s*([ap]m)\b/i', $label, $m ) ) {
			$h   = (int) $m[1];
			$min = (int) $m[2];
			$ap  = strtolower( (string) $m[3] );
			if ( 'pm' === $ap && $h < 12 ) {
				$h += 12;
			}
			if ( 'am' === $ap && 12 === $h ) {
				$h = 0;
			}
			return sprintf( '%02d:%02d', $h, $min );
		}
		// e.g. "9:00 a.m." / "9:00 p.m." (FooEvents-style).
		if ( preg_match( '/\b(\d{1,2}):([0-5]\d)\s*([ap])\.\s*m\.?\b/i', $label, $m ) ) {
			$h   = (int) $m[1];
			$min = (int) $m[2];
			$ap  = strtolower( (string) $m[3] );
			if ( 'p' === $ap && $h < 12 ) {
				$h += 12;
			}
			if ( 'a' === $ap && 12 === $h ) {
				$h = 0;
			}
			return sprintf( '%02d:%02d', $h, $min );
		}
		return '';
	}

	/**
	 * Parse FooEvents booking timestamp meta to site-local DateTime.
	 *
	 * @param mixed           $raw Raw meta (often Unix seconds).
	 * @param \DateTimeZone $tz  Site timezone.
	 * @return DateTime|null
	 */
	private function parse_booking_timestamp_to_datetime( $raw, \DateTimeZone $tz ) {
		if ( null === $raw || '' === $raw ) {
			return null;
		}
		if ( is_numeric( $raw ) ) {
			$dt = new DateTime( '@' . (int) $raw );
			$dt->setTimezone( $tz );
			return $dt;
		}
		return null;
	}

	/**
	 * Resolve slot start from internal booking ids using processed options (includes past dates).
	 *
	 * @param int            $product_id Event product id.
	 * @param string         $slot_id    WooCommerceEventsBookingSlotID.
	 * @param string         $date_id    WooCommerceEventsBookingDateID.
	 * @param \DateTimeZone $tz         Site timezone.
	 * @return array<string,mixed>|null  Keys: dateYmd, time, startsAtLocal, dateLabelResolved, slotLabelResolved.
	 */
	private function resolve_booking_slot_datetime_from_ids( $product_id, $slot_id, $date_id, \DateTimeZone $tz ) {
		$product_id = absint( $product_id );
		$slot_id    = trim( (string) $slot_id );
		$date_id    = trim( (string) $date_id );
		if ( $product_id <= 0 || '' === $slot_id || '' === $date_id ) {
			return null;
		}

		$ctx     = $this->get_processed_options( $product_id );
		$method  = $ctx['method'];
		$options = $ctx['options'];
		if ( ! is_array( $options ) ) {
			return null;
		}

		if ( 'dateslot' === $method ) {
			foreach ( $options as $date_display => $slots_for_date ) {
				if ( ! is_array( $slots_for_date ) ) {
					continue;
				}
				$ymd = $this->date_string_to_ymd( (string) $date_display );
				if ( null === $ymd ) {
					continue;
				}
				foreach ( $slots_for_date as $sid => $row ) {
					if ( ! is_array( $row ) ) {
						continue;
					}
					if ( (string) $sid !== $slot_id ) {
						continue;
					}
					$rid = (string) ( $row['date_id'] ?? '' );
					if ( $rid !== $date_id ) {
						continue;
					}
					$slot_label = (string) ( $row['slot_label'] ?? $sid );
					$slot_time  = isset( $row['slot_time'] ) ? (string) $row['slot_time'] : '';
					$full_label = trim( $slot_label . ( '' !== $slot_time ? ' ' . $slot_time : '' ) );
					$time_hhmm  = $this->extract_time( $full_label );
					if ( '' === $time_hhmm && '' !== $slot_time ) {
						$time_hhmm = $this->extract_time( $slot_time );
					}
					$time_part = '' !== $time_hhmm ? $time_hhmm : '00:00';
					$dt        = DateTime::createFromFormat( 'Y-m-d H:i', $ymd . ' ' . $time_part, $tz );
					if ( ! $dt instanceof DateTime ) {
						return null;
					}
					return array(
						'dateYmd'           => $ymd,
						'time'              => $time_hhmm,
						'startsAtLocal'     => $dt->format( 'c' ),
						'dateLabelResolved' => (string) $date_display,
						'slotLabelResolved' => $full_label,
					);
				}
			}
			return null;
		}

		// slotdate: options keyed by slot id.
		if ( ! isset( $options[ $slot_id ] ) || ! is_array( $options[ $slot_id ] ) ) {
			return null;
		}
		$opt = $options[ $slot_id ];
		$add = isset( $opt['add_date'] ) && is_array( $opt['add_date'] ) ? $opt['add_date'] : array();
		$drow = null;
		if ( isset( $add[ $date_id ] ) && is_array( $add[ $date_id ] ) ) {
			$drow = $add[ $date_id ];
		} else {
			foreach ( $add as $dk => $dv ) {
				if ( (string) $dk === $date_id && is_array( $dv ) ) {
					$drow = $dv;
					break;
				}
			}
		}
		if ( ! is_array( $drow ) || empty( $drow['date'] ) ) {
			return null;
		}

		$hour       = isset( $opt['hour'] ) ? (string) $opt['hour'] : '';
		$minute     = isset( $opt['minute'] ) ? (string) $opt['minute'] : '';
		$time_hhmm  = ( '' === $hour || '' === $minute ) ? '' : sprintf( '%02d:%02d', (int) $hour, (int) $minute );
		$ymd        = $this->date_string_to_ymd( (string) $drow['date'] );
		if ( null === $ymd ) {
			return null;
		}
		$base_label = trim( (string) ( $opt['label'] ?? $slot_id ) );
		$time_part  = '' !== $time_hhmm ? $time_hhmm : '00:00';
		$dt         = DateTime::createFromFormat( 'Y-m-d H:i', $ymd . ' ' . $time_part, $tz );
		if ( ! $dt instanceof DateTime ) {
			return null;
		}

		return array(
			'dateYmd'           => $ymd,
			'time'              => $time_hhmm,
			'startsAtLocal'     => $dt->format( 'c' ),
			'dateLabelResolved' => (string) $drow['date'],
			'slotLabelResolved' => $base_label,
		);
	}

	/**
	 * Booking session timing for Validate UI (past dates included; not filtered like get_event_detail).
	 *
	 * @param int                  $product_id  Event product id.
	 * @param array<string,mixed> $ticket_data FooEvents ticket payload (+ optional meta).
	 * @return array<string,mixed>
	 */
	public function get_validate_booking_session( $product_id, array $ticket_data ) {
		$product_id = absint( $product_id );
		$empty      = array(
			'eventId'         => $product_id,
			'slotId'          => '',
			'dateId'          => '',
			'dateYmd'         => null,
			'time'            => '',
			'dateLabel'       => '',
			'slotLabel'       => '',
			'startsAtLocal'   => null,
			'source'          => 'none',
		);

		if ( $product_id <= 0 ) {
			return $empty;
		}

		$product = wc_get_product( $product_id );
		if ( ! $product || 'Event' !== $product->get_meta( 'WooCommerceEventsEvent', true ) || 'bookings' !== $product->get_meta( 'WooCommerceEventsType', true ) ) {
			return $empty;
		}

		$tz           = $this->get_wp_timezone();
		$slot_id      = trim( (string) ( $ticket_data['WooCommerceEventsBookingSlotID'] ?? '' ) );
		$date_id      = trim( (string) ( $ticket_data['WooCommerceEventsBookingDateID'] ?? '' ) );
		$slot_lbl_disp = trim( (string) ( $ticket_data['WooCommerceEventsBookingSlot'] ?? '' ) );
		$date_lbl_disp = trim( (string) ( $ticket_data['WooCommerceEventsBookingDate'] ?? '' ) );

		if ( '' !== $slot_id && '' !== $date_id ) {
			$res = $this->resolve_booking_slot_datetime_from_ids( $product_id, $slot_id, $date_id, $tz );
			if ( is_array( $res ) ) {
				return array(
					'eventId'       => $product_id,
					'slotId'        => $slot_id,
					'dateId'        => $date_id,
					'dateYmd'       => (string) $res['dateYmd'],
					'time'          => (string) $res['time'],
					'dateLabel'     => $date_lbl_disp ? $date_lbl_disp : (string) $res['dateLabelResolved'],
					'slotLabel'     => $slot_lbl_disp ? $slot_lbl_disp : (string) $res['slotLabelResolved'],
					'startsAtLocal' => (string) $res['startsAtLocal'],
					'source'        => 'slot_ids',
				);
			}
		}

		$ymd_f  = $this->date_string_to_ymd( $date_lbl_disp );
		$time_f = $this->extract_time( $slot_lbl_disp );
		if ( null !== $ymd_f && '' !== $time_f ) {
			$dt_disp = DateTime::createFromFormat( 'Y-m-d H:i', $ymd_f . ' ' . $time_f, $tz );
			if ( $dt_disp instanceof DateTime ) {
				return array(
					'eventId'       => $product_id,
					'slotId'        => $slot_id,
					'dateId'        => $date_id,
					'dateYmd'       => $ymd_f,
					'time'          => $time_f,
					'dateLabel'     => $date_lbl_disp,
					'slotLabel'     => $slot_lbl_disp,
					'startsAtLocal' => $dt_disp->format( 'c' ),
					'source'        => 'display_parse',
				);
			}
		}

		$mysql = isset( $ticket_data['WooCommerceEventsBookingDateMySQLFormat'] )
			? trim( (string) $ticket_data['WooCommerceEventsBookingDateMySQLFormat'] ) : '';
		if ( '' !== $mysql ) {
			$dt_mysql = DateTime::createFromFormat( 'Y-m-d H:i:s', $mysql, $tz );
			if ( ! $dt_mysql instanceof DateTime ) {
				$dt_mysql = DateTime::createFromFormat( 'Y-m-d H:i', $mysql, $tz );
			}
			if ( $dt_mysql instanceof DateTime ) {
				return array(
					'eventId'       => $product_id,
					'slotId'        => $slot_id,
					'dateId'        => $date_id,
					'dateYmd'       => $dt_mysql->format( 'Y-m-d' ),
					'time'          => $dt_mysql->format( 'H:i' ),
					'dateLabel'     => $date_lbl_disp,
					'slotLabel'     => $slot_lbl_disp,
					'startsAtLocal' => $dt_mysql->format( 'c' ),
					'source'        => 'mysql',
				);
			}
		}

		$raw_ts = $ticket_data['WooCommerceEventsBookingDateTimestamp'] ?? null;
		$dt_ts  = $this->parse_booking_timestamp_to_datetime( $raw_ts, $tz );
		if ( $dt_ts instanceof DateTime ) {
			return array(
				'eventId'       => $product_id,
				'slotId'        => $slot_id,
				'dateId'        => $date_id,
				'dateYmd'       => $dt_ts->format( 'Y-m-d' ),
				'time'          => $dt_ts->format( 'H:i' ),
				'dateLabel'     => $date_lbl_disp,
				'slotLabel'     => $slot_lbl_disp,
				'startsAtLocal' => $dt_ts->format( 'c' ),
				'source'        => 'timestamp',
			);
		}

		return array(
			'eventId'       => $product_id,
			'slotId'        => $slot_id,
			'dateId'        => $date_id,
			'dateYmd'       => $ymd_f,
			'time'          => $time_f,
			'dateLabel'     => $date_lbl_disp,
			'slotLabel'     => $slot_lbl_disp,
			'startsAtLocal' => null,
			'source'        => 'none',
		);
	}

	/**
	 * ISO 8601 instant for a slot on a calendar day in site TZ (for POS time compares).
	 *
	 * @param string          $ymd   Y-m-d.
	 * @param string          $time  HH:MM or empty.
	 * @param string          $label Slot label fallback for time extraction.
	 * @param \DateTimeZone $tz    Site TZ.
	 * @return string|null
	 */
	private function slot_starts_at_local_iso( $ymd, $time, $label, \DateTimeZone $tz ) {
		$ymd = trim( (string) $ymd );
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd ) ) {
			return null;
		}
		$time_s = trim( (string) $time );
		if ( '' === $time_s || ! preg_match( '/^([01]?\d|2[0-3]):([0-5]\d)$/', $time_s, $tm ) ) {
			$time_s = $this->extract_time( (string) $label );
		}
		if ( '' === $time_s || ! preg_match( '/^([01]?\d|2[0-3]):([0-5]\d)$/', $time_s, $tm ) ) {
			return null;
		}
		$norm = sprintf( '%02d:%02d', (int) $tm[1], (int) $tm[2] );
		$dt   = DateTime::createFromFormat( 'Y-m-d H:i', $ymd . ' ' . $norm, $tz );
		return $dt instanceof DateTime ? $dt->format( 'c' ) : null;
	}

	/**
	 * All bookable slots for a single day (Y-m-d in site timezone), for dashboard.
	 *
	 * @param string $ymd Y-m-d or empty (defaults to today).
	 * @return array{ date: string, events: array<int, mixed>, calendarSummary?: array<string, mixed> }
	 */
	public function get_day_dashboard( $ymd ) {
		$ymd = (string) $ymd;
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd ) ) {
			$ymd = $this->today_ymd();
		}
		$today              = $this->today_ymd();
		$distinct_upcoming  = array();
		$flatten_focus_slots = array();
		$next_entries       = array();
		$out                = array();

		foreach ( $this->list_booking_events() as $row ) {
			$detail = $this->get_event_detail( (int) $row['id'] );
			if ( ! empty( $detail['error'] ) ) {
				continue;
			}
			foreach ( (array) ( $detail['dates'] ?? array() ) as $d ) {
				$ddy = isset( $d['date'] ) ? (string) $d['date'] : '';
				if ( '' === $ddy ) {
					continue;
				}

				$slots = array();
				foreach ( (array) ( $d['slots'] ?? array() ) as $s ) {
					if ( ! is_array( $s ) ) {
						continue;
					}
					$label = (string) ( $s['label'] ?? '' );
					$time  = ( isset( $s['time'] ) && (string) $s['time'] !== '' )
						? (string) $s['time']
						: $this->extract_time( $label );
					$stock_meta = isset( $s['stock'] ) ? $s['stock'] : null;

					$slots[] = array(
						'id'              => (string) ( $s['id'] ?? '' ),
						'dateId'          => (string) ( $s['dateId'] ?? '' ),
						'label'           => $label,
						'time'            => $time,
						'stock'           => $stock_meta,
						'startsAtLocal'   => $this->slot_starts_at_local_iso(
							$ddy,
							$time,
							$label,
							$this->get_wp_timezone()
						),
					);
				}

				usort(
					$slots,
					function( $a, $b ) {
						$ta = (string) ( $a['time'] ?? '' );
						$tb = (string) ( $b['time'] ?? '' );
						$ta = $ta ? $ta : '99:99';
						$tb = $tb ? $tb : '99:99';
						$c  = strcmp( $ta, $tb );
						if ( 0 !== $c ) {
							return $c;
						}
						return strcmp( (string) ( $a['label'] ?? '' ), (string) ( $b['label'] ?? '' ) );
					}
				);

				if ( strcmp( $ddy, $today ) >= 0 ) {
					$distinct_upcoming[ $ddy ] = true;
					foreach ( $slots as $row_slot ) {
						$st = isset( $row_slot['stock'] ) ? $row_slot['stock'] : null;
						$avail = null === $st || '' === $st || (int) $st > 0;
						if ( ! $avail ) {
							continue;
						}
						$tim = isset( $row_slot['time'] ) ? (string) $row_slot['time'] : '';
						$tkey = '' !== trim( $tim ) ? $tim : '99:99';
						$next_entries[] = array(
							'ymd' => $ddy,
							'time' => $tkey,
							'slot' => array(
								'id'    => isset( $row_slot['id'] ) ? $row_slot['id'] : '',
								'label' => isset( $row_slot['label'] ) ? $row_slot['label'] : '',
								'time'  => $tim,
								'stock' => $st,
							),
						);
					}
				}

				if ( $ddy !== $ymd ) {
					continue;
				}

				foreach ( $slots as $sn ) {
					$flatten_focus_slots[] = $sn;
				}

				$price_row = $this->get_product_price_for_rest( (int) $row['id'] );

				$out[] = array(
					'eventId'    => (int) $row['id'],
					'eventTitle' => (string) $row['title'],
					'eventImage' => (string) ( $row['image'] ?? '' ),
					'dateLabel'  => (string) ( $d['label'] ?? '' ),
					'slots'      => $slots,
					'price'      => $price_row['price'],
					'priceHtml'  => $price_row['priceHtml'],
				);
			}
		}

		usort(
			$next_entries,
			function( $a, $b ) {
				$c = strcmp( (string) $a['ymd'], (string) $b['ymd'] );
				if ( 0 !== $c ) {
					return $c;
				}
				return strcmp( (string) $a['time'], (string) $b['time'] );
			}
		);
		$next_best = ! empty( $next_entries ) ? $next_entries[0] : null;

		return array_merge(
			array(
				'date'            => $ymd,
				'events'          => $out,
				'calendarSummary' => array(
					'upcomingDistinctDays'  => count( $distinct_upcoming ),
					'slotsOnSelectedDay'    => count( $flatten_focus_slots ),
					'capacityOnSelectedDay' => $this->dashboard_capacity_label_from_slots( $flatten_focus_slots ),
					'nextAvailable'         => null !== $next_best
						? array(
							'dateYmd' => (string) $next_best['ymd'],
							'slot'    => $next_best['slot'],
						)
						: null,
				),
			),
			$this->get_site_time_for_rest(),
		);
	}

	/**
	 * @param array<int, array{id?:string,dateId?:string,label?:string,time?:string,stock:mixed}> $slots Slots.
	 * @return string
	 */
	private function dashboard_capacity_label_from_slots( array $slots ) {
		if ( empty( $slots ) ) {
			return '—';
		}
		foreach ( $slots as $s ) {
			if ( ! is_array( $s ) ) {
				continue;
			}
			$stk = array_key_exists( 'stock', $s ) ? $s['stock'] : null;
			if ( null === $stk || '' === $stk ) {
				return 'Unlimited';
			}
		}
		$sum = 0;
		foreach ( $slots as $s ) {
			if ( ! is_array( $s ) ) {
				continue;
			}
			$sum += isset( $s['stock'] ) ? (int) $s['stock'] : 0;
		}
		return (string) $sum;
	}

	/**
	 * Resolve dateslot processed row for slot_id + date param (display bucket, Y-m-d, or internal date_id).
	 *
	 * @param array  $options Processed dateslot options [ dateBucket => [ slotId => row ] ].
	 * @param string $slot_id Slot ID.
	 * @param string $date_param Client date segment (may match bucket label, Y-m-d, or FooEvents internal date id).
	 * @return array{ date_bucket: string, row: array, internal_date_id: string }|null
	 */
	private function resolve_dateslot_slot_row( $options, $slot_id, $date_param ) {
		if ( ! is_array( $options ) ) {
			return null;
		}
		foreach ( $options as $date_bucket => $slots_for_date ) {
			if ( ! is_array( $slots_for_date ) ) {
				continue;
			}
			if ( ! isset( $slots_for_date[ $slot_id ] ) || ! is_array( $slots_for_date[ $slot_id ] ) ) {
				continue;
			}
			$row               = $slots_for_date[ $slot_id ];
			$internal_date_id  = isset( $row['date_id'] ) ? (string) $row['date_id'] : '';
			$ymd_bucket        = $this->date_string_to_ymd( (string) $date_bucket );
			$matches_display   = (string) $date_param === (string) $date_bucket;
			$matches_ymd       = $ymd_bucket && (string) $date_param === $ymd_bucket;
			$matches_internal  = '' !== $internal_date_id && (string) $date_param === $internal_date_id;
			if ( $matches_display || $matches_ymd || $matches_internal ) {
				return array(
					'date_bucket'        => (string) $date_bucket,
					'row'                => $row,
					'internal_date_id'   => $internal_date_id,
				);
			}
		}
		return null;
	}

	/**
	 * Normalize booking selection after availability passes (internal date ids + cart-ready hints).
	 *
	 * @param int    $event_id Event product ID.
	 * @param string $slot_id Slot ID.
	 * @param string $date_id Client date id / bucket key / Y-m-d.
	 * @return array{ method: string, slot_id: string, internal_date_id: string, dateslot_date_bucket?: string }|null Null if dateslot row missing (should not happen after check_availability).
	 */
	public function normalize_booking_ids_for_cart( $event_id, $slot_id, $date_id ) {
		$event_id = absint( $event_id );
		$slot_id  = (string) $slot_id;
		$date_id  = (string) $date_id;
		$ctx      = $this->get_processed_options( $event_id );
		$method   = (string) $ctx['method'];
		$options  = $ctx['options'];

		if ( 'dateslot' === $method && is_array( $options ) ) {
			$res = $this->resolve_dateslot_slot_row( $options, $slot_id, $date_id );
			if ( null === $res || '' === $res['internal_date_id'] ) {
				return null;
			}
			return array(
				'method'               => 'dateslot',
				'slot_id'              => $slot_id,
				'internal_date_id'     => $res['internal_date_id'],
				'dateslot_date_bucket' => $res['date_bucket'],
			);
		}

		return array(
			'method'           => '' !== $method ? $method : 'slotdate',
			'slot_id'          => $slot_id,
			'internal_date_id' => $date_id,
		);
	}

	/**
	 * Check stock for a slot+date, optionally via FooEvents (direct math for MVP).
	 *
	 * @param int    $event_id Event product ID.
	 * @param string $slot_id Slot ID.
	 * @param string $date_id Date option ID.
	 * @param int    $qty Requested quantity.
	 * @return array{ available: bool, remaining: int|null, reason: string }
	 */
	public function check_availability( $event_id, $slot_id, $date_id, $qty ) {
		$event_id = absint( $event_id );
		$qty      = max( 1, (int) $qty );
		$ctx      = $this->get_processed_options( $event_id );
		$method   = $ctx['method'];
		$options  = $ctx['options'];

		if ( 'dateslot' === $method && is_array( $options ) ) {
			$res = $this->resolve_dateslot_slot_row( $options, $slot_id, $date_id );
			if ( null === $res ) {
				return array( 'available' => false, 'remaining' => 0, 'reason' => 'not_found' );
			}
			$row        = $res['row'];
			$date_bucket = $res['date_bucket'];
			$ymd        = $this->date_string_to_ymd( (string) $date_bucket );
			if ( null === $ymd || ! $this->is_date_not_past( $ymd ) ) {
				return array( 'available' => false, 'remaining' => 0, 'reason' => 'past_date' );
			}
			$stock = $row['stock'] ?? '';
			return $this->interpret_stock( $stock, $qty );
		}

		// slotdate.
		if ( ! isset( $options[ $slot_id ]['add_date'][ $date_id ] ) ) {
			return array( 'available' => false, 'remaining' => 0, 'reason' => 'not_found' );
		}
		$d = $options[ $slot_id ]['add_date'][ $date_id ];
		$ymd = $this->date_string_to_ymd( (string) ( $d['date'] ?? '' ) );
		if ( null === $ymd || ! $this->is_date_not_past( $ymd ) ) {
			return array( 'available' => false, 'remaining' => 0, 'reason' => 'past_date' );
		}
		$stock = $d['stock'] ?? '';
		return $this->interpret_stock( $stock, $qty );
	}

	/**
	 * @param mixed $stock Stock value.
	 * @param int   $qty Qty.
	 * @return array
	 */
	private function interpret_stock( $stock, $qty ) {
		if ( '' === $stock || null === $stock ) {
			return array( 'available' => true, 'remaining' => null, 'reason' => 'unlimited' );
		}
		$n = (int) $stock;
		if ( $n < 0 ) {
			return array( 'available' => true, 'remaining' => null, 'reason' => 'unlimited' );
		}
		$ok = $n >= $qty;
		return array(
			'available'  => $ok,
			'remaining'  => max( 0, $n ),
			'reason'     => $ok ? 'ok' : 'insufficient',
		);
	}
}
