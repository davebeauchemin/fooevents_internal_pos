<?php
/**
 * Lightweight test runner when PHPUnit is not installed.
 *
 * Usage: php tests/run-booking-stock-tests.php
 *
 * @package FooEventsInternalPOS
 */

require_once __DIR__ . '/bootstrap.php';

use FooEvents_Internal_POS\Booking_Stock_Service;

$service = new Booking_Stock_Service();
$failed  = 0;

function assert_same( $expected, $actual, $label ) {
	global $failed;
	if ( $expected !== $actual ) {
		echo "FAIL: {$label}\n  expected: " . var_export( $expected, true ) . "\n  actual:   " . var_export( $actual, true ) . "\n";
		++$failed;
		return;
	}
	echo "OK: {$label}\n";
}

assert_same( null, $service->normalize_stock_for_rest( '' ), 'unlimited empty string' );
assert_same( null, $service->normalize_stock_for_rest( null ), 'unlimited null' );
assert_same( 8, $service->normalize_stock_for_rest( '8' ), 'finite stock 8' );

$ok = $service->interpret_stock( 8, 3 );
assert_same( true, $ok['available'], 'interpret available' );
assert_same( 8, $ok['remaining'], 'interpret remaining' );

$bad = $service->interpret_stock( 2, 3 );
assert_same( false, $bad['available'], 'interpret insufficient' );

$options = array(
	'slot_a' => array(
		'add_date' => array(
			'date_1' => array( 'stock' => 5 ),
		),
	),
);
$cell = $service->resolve_cell( $options, 'slot_a', 'date_1' );
assert_same( 'slot_a', $cell['slot_key'], 'resolve slot key' );
assert_same( 5, $cell['stock'], 'resolve stock' );

if ( $failed > 0 ) {
	echo "\n{$failed} assertion(s) failed.\n";
	exit( 1 );
}

echo "\nAll booking stock assertions passed.\n";
exit( 0 );
