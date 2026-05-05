<?php
/**
 * Enqueue storefront assets: date/slot picker (single product), cart formatter, Woo CSS.
 *
 * @package FooEventsInternalPOS
 */

namespace FooEvents_Internal_POS;

defined( 'ABSPATH' ) || exit;

/**
 * Front-of-house assets (migrated from theme child).
 */
class Storefront_Assets {

	/**
	 * Hooks.
	 */
	public function init() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ), 20 );
	}

	/**
	 * Convert HH:MM (24h) to minute-of-day, or null if invalid.
	 *
	 * @param string $hhmm Time string.
	 * @return int|null
	 */
	private function hhmm_to_minute_of_day( $hhmm ) {
		$hhmm = (string) $hhmm;
		if ( ! preg_match( '/^(\d{1,2}):(\d{2})$/', $hhmm, $m ) ) {
			return null;
		}
		$h   = (int) $m[1];
		$min = (int) $m[2];
		if ( $h > 23 || $min > 59 ) {
			return null;
		}
		return ( $h * 60 ) + $min;
	}

	/**
	 * Compact maps keyed by Woo/FooEvents <option value> attrs for storefront slot filtering.
	 *
	 * @param array $detail Return value of Bookings_Service::get_event_detail().
	 * @param int   $product_id Product ID.
	 * @return array{bookingMethod:string,dateKeyToYmd:array<string,string>,slotValueMeta:array<string,array<string,mixed>>}
	 */
	private function build_storefront_booking_maps( array $detail, $product_id ) {
		$product_id       = absint( $product_id );
		$booking_method = isset( $detail['bookingMethod'] ) ? (string) $detail['bookingMethod'] : '';
		$out              = array(
			'bookingMethod' => $booking_method,
			'dateKeyToYmd'  => array(),
			'slotValueMeta' => array(),
		);

		if ( $product_id <= 0 ) {
			return $out;
		}

		$dates = isset( $detail['dates'] ) && is_array( $detail['dates'] ) ? $detail['dates'] : array();
		foreach ( $dates as $bucket ) {
			if ( ! is_array( $bucket ) ) {
				continue;
			}
			$ymd = isset( $bucket['date'] ) ? (string) $bucket['date'] : '';
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $ymd ) ) {
				continue;
			}

			if ( 'dateslot' === $booking_method ) {
				$key = $ymd . '_' . $product_id;
				if ( '' !== $key ) {
					$out['dateKeyToYmd'][ $key ] = $ymd;
				}
				$disp = isset( $bucket['label'] ) ? trim( (string) $bucket['label'] ) : '';
				if ( '' !== $disp ) {
					$out['dateKeyToYmd'][ $disp . '_' . $product_id ] = $ymd;
				}
			}

			$slots = isset( $bucket['slots'] ) && is_array( $bucket['slots'] ) ? $bucket['slots'] : array();
			foreach ( $slots as $slot ) {
				if ( ! is_array( $slot ) ) {
					continue;
				}
				$slot_id  = isset( $slot['id'] ) ? (string) $slot['id'] : '';
				$date_id  = isset( $slot['dateId'] ) ? (string) $slot['dateId'] : '';
				$time_str = isset( $slot['time'] ) ? (string) $slot['time'] : '';
				$label    = isset( $slot['label'] ) ? (string) $slot['label'] : '';

				if ( '' !== $date_id ) {
					$out['dateKeyToYmd'][ $date_id ] = $ymd;
				}

				$minute = $this->hhmm_to_minute_of_day( $time_str );
				$meta   = array(
					'time'          => $time_str,
					'minuteOfDay'   => null === $minute ? null : $minute,
					'slotLabel'     => $label,
					'dateYmd'       => $ymd,
					'productId'     => $product_id,
				);

				if ( '' !== $slot_id ) {
					$slotdate_key = $slot_id . '_' . $product_id;
					$out['slotValueMeta'][ $slotdate_key ] = $meta;
				}
				if ( '' !== $slot_id && '' !== $date_id ) {
					$composite = $slot_id . '_' . $date_id . '_' . $product_id;
					$out['slotValueMeta'][ $composite ]    = $meta;
				}
			}
		}

		return $out;
	}

	/**
	 * Register scripts and styles.
	 */
	public function enqueue() {
		$url = FOOEVENTS_INTERNAL_POS_URL . 'public/frontend/';
		$ver = FOOEVENTS_INTERNAL_POS_VERSION;

		if ( function_exists( 'is_cart' ) && function_exists( 'is_checkout' ) && ( is_cart() || is_checkout() ) ) {
			wp_enqueue_style(
				'fipos-woocommerce',
				$url . 'css/woocommerce.css',
				array(),
				$ver
			);
			wp_enqueue_script(
				'fipos-cart-format',
				$url . 'js/cart-format.js',
				array(),
				$ver,
				true
			);
		}

		if ( function_exists( 'is_product' ) && is_product() ) {
			$bookings   = new Bookings_Service();
			$product_id = function_exists( 'get_queried_object_id' ) ? absint( get_queried_object_id() ) : 0;
			// Product/event TZ when set matches FooEvents expiry; avoids wp_timezone vs America/Toronto drift.
			$site_time        = $bookings->get_storefront_cutoff_clock_for_booking_product( $product_id );
			$site_timestamp_u = isset( $site_time['siteTimestampUtc'] ) ? (int) $site_time['siteTimestampUtc'] : time();

			$tz_disp      = wp_timezone();
			$tz_name_live = isset( $site_time['siteTimezone'] ) ? trim( (string) $site_time['siteTimezone'] ) : '';
			if ( '' !== $tz_name_live ) {
				try {
					$tz_disp = new \DateTimeZone( $tz_name_live );
				} catch ( \Throwable $e ) {
					$tz_disp = wp_timezone();
				}
			}

			$fmt_opt = trim( (string) get_option( 'date_format', '' ) );
			try {
				$dt_label   = ( new \DateTimeImmutable( '@' . $site_timestamp_u ) )->setTimezone( $tz_disp );
				$site_label = $dt_label->format( '' !== $fmt_opt ? $fmt_opt : 'F j, Y' );
			} catch ( \Throwable $e ) {
				$site_label = isset( $site_time['siteTodayYmd'] ) ? (string) $site_time['siteTodayYmd'] : '';
			}

			$event_detail = $product_id > 0 ? $bookings->get_event_detail( $product_id ) : array();
			$slot_maps    = $this->build_storefront_booking_maps( is_array( $event_detail ) ? $event_detail : array(), $product_id );

			wp_enqueue_style(
				'fipos-bundle-pricing',
				$url . 'css/bundle-pricing.css',
				array(),
				$ver
			);
			wp_enqueue_style(
				'fipos-date-slot-picker',
				$url . 'css/date-slot-picker.css',
				array(),
				$ver
			);
			wp_enqueue_script(
				'fipos-date-slot-picker',
				$url . 'js/date-slot-picker.js',
				array( 'jquery' ),
				$ver,
				true
			);
			wp_localize_script(
				'fipos-date-slot-picker',
				'fiposDateSlotPicker',
				array(
					'customTimeSlots' => (bool) apply_filters( 'fipos_enable_custom_time_slot_picker', true ),
					'siteTodayYmd'    => isset( $site_time['siteTodayYmd'] ) ? (string) $site_time['siteTodayYmd'] : '',
					'siteTodayLabel'  => $site_label,
					'siteNowLocal'    => isset( $site_time['siteNowLocal'] ) ? (string) $site_time['siteNowLocal'] : '',
					'siteTimezone'    => isset( $site_time['siteTimezone'] ) ? (string) $site_time['siteTimezone'] : '',
					'siteNowMinutes'  => isset( $site_time['siteNowMinutes'] ) ? (int) $site_time['siteNowMinutes'] : 0,
					'slotMaps'        => $slot_maps,
				)
			);
		}
	}
}
