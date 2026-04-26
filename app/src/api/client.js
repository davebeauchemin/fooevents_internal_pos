/**
 * WordPress REST client (cookie auth + X-WP-Nonce).
 */
function getRestBase() {
	if ( typeof localStorage === 'undefined' ) {
		return import.meta.env.VITE_WORDPRESS_URL || '';
	}
	return localStorage.getItem( 'WORDPRESS_URL' ) || import.meta.env.VITE_WORDPRESS_URL || '';
}

function getNonce() {
	if ( typeof localStorage === 'undefined' ) {
		return import.meta.env.VITE_WP_REST_NONCE || '';
	}
	return localStorage.getItem( 'X-WP-Nonce' ) || import.meta.env.VITE_WP_REST_NONCE || '';
}

/**
 * @param {string} path e.g. internalpos/v1/events
 * @param {RequestInit} init
 */
export async function restFetch( path, init = {} ) {
	const base = getRestBase().replace( /\/?$/, '/' );
	const rel = String( path ).replace( /^\//, '' );
	const url = base + rel;
	const headers = {
		Accept: 'application/json',
		'X-WP-Nonce': getNonce(),
		...( init.headers || {} ),
	};
	const res = await fetch( url, {
		...init,
		credentials: 'include',
		headers,
	} );
	if ( ! res.ok ) {
		const text = await res.text();
		throw new Error( `HTTP ${ res.status }: ${ text.slice( 0, 200 ) }` );
	}
	return res.json();
}

export { getRestBase, getNonce };
