/**
 * WooCommerce `wc_price()` often returns HTML markup. React escapes text nodes, so raw
 * strings show tags — or stale cart rows from localStorage may still contain HTML.
 * Converts markup + numeric entities to plain visible text (e.g. "$18.50").
 */
export function htmlToPlainText( value: string | null | undefined ): string {
	if ( value == null || value === '' ) {
		return '';
	}
	const s = String( value );
	if ( ! /<[a-z][\s\S]*>/i.test( s ) ) {
		return s.trim();
	}
	if ( typeof document === 'undefined' ) {
		return s.replace( /<[^>]+>/g, '' ).trim();
	}
	const doc = new DOMParser().parseFromString( s, 'text/html' );
	return doc.body.textContent?.trim() ?? '';
}
