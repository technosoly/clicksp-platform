/** Badge tones of transfer and count statuses. */
export const TRANSFER_TONE = { draft: "neutral", in_transit: "orange", received: "success", cancelled: "neutral" } as const;
export const COUNT_TONE = { open: "orange", completed: "success", cancelled: "neutral" } as const;
