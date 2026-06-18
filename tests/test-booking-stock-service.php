<?php
/**
 * Unit tests for Booking_Stock_Service (run with PHPUnit when available).
 *
 * @package FooEventsInternalPOS
 */

use FooEvents_Internal_POS\Booking_Stock_Service;
use PHPUnit\Framework\TestCase;

/**
 * Booking stock normalization and cell resolution tests.
 */
class Booking_Stock_Service_Test extends TestCase {

	/**
	 * @var Booking_Stock_Service
	 */
	private $service;

	/**
	 * Setup.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->service = new Booking_Stock_Service();
	}

	/**
	 * Empty stock means unlimited in REST output.
	 */
	public function test_normalize_stock_for_rest_unlimited() {
		$this->assertNull( $this->service->normalize_stock_for_rest( '' ) );
		$this->assertNull( $this->service->normalize_stock_for_rest( null ) );
		$this->assertNull( $this->service->normalize_stock_for_rest( -1 ) );
	}

	/**
	 * Finite stock parses as non-negative int.
	 */
	public function test_normalize_stock_for_rest_finite() {
		$this->assertSame( 8, $this->service->normalize_stock_for_rest( '8' ) );
		$this->assertSame( 0, $this->service->normalize_stock_for_rest( 0 ) );
	}

	/**
	 * interpret_stock matches FooEvents unlimited and insufficient rules.
	 */
	public function test_interpret_stock_finite_and_unlimited() {
		$unlimited = $this->service->interpret_stock( '', 3 );
		$this->assertTrue( $unlimited['available'] );
		$this->assertNull( $unlimited['remaining'] );
		$this->assertSame( 'unlimited', $unlimited['reason'] );

		$ok = $this->service->interpret_stock( 8, 3 );
		$this->assertTrue( $ok['available'] );
		$this->assertSame( 8, $ok['remaining'] );
		$this->assertSame( 'ok', $ok['reason'] );

		$bad = $this->service->interpret_stock( 2, 3 );
		$this->assertFalse( $bad['available'] );
		$this->assertSame( 2, $bad['remaining'] );
		$this->assertSame( 'insufficient', $bad['reason'] );
	}

	/**
	 * resolve_cell finds slot/date keys in preprocess-shaped options.
	 */
	public function test_resolve_cell_finds_keys() {
		$options = array(
			'slot_a' => array(
				'add_date' => array(
					'date_1' => array(
						'stock' => 5,
						'date'  => 'June 19, 2026',
					),
				),
			),
		);

		$cell = $this->service->resolve_cell( $options, 'slot_a', 'date_1' );
		$this->assertIsArray( $cell );
		$this->assertSame( 'slot_a', $cell['slot_key'] );
		$this->assertSame( 'date_1', $cell['date_key'] );
		$this->assertSame( 5, $cell['stock'] );
	}

	/**
	 * normalize_struct_key matches stringified array keys.
	 */
	public function test_normalize_struct_key() {
		$struct = array( '12' => array(), 99 => array() );
		$this->assertSame( '12', $this->service->normalize_struct_key( $struct, '12' ) );
		$this->assertSame( 99, $this->service->normalize_struct_key( $struct, '99' ) );
		$this->assertNull( $this->service->normalize_struct_key( $struct, 'missing' ) );
	}
}
