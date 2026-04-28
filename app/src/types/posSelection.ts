/** Selected booking slot line item for POS cart / checkout. */
export type POSSelection = {
	eventId: number;
	eventTitle: string;
	/** Human-readable day label shown in summary. */
	dateLabel: string;
	/** Y-m-d of the booked day; used for past-day checks. */
	viewDateYmd: string;
	slotId: string;
	dateId: string;
	slotLabel: string;
	/** Optional short time text (e.g. from formatSlotTime). */
	slotTime?: string;
	remaining: number | null;
	/** Display unit price from WooCommerce (optional). */
	price?: number | null;
	priceHtml?: string;
};
