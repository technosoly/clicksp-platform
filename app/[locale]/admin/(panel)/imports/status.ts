/** Badge tone of an import job's status. */
export const STATUS_TONE = {
  uploaded: "neutral",
  validating: "neutral",
  validated: "orange",
  applying: "brand",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
} as const;

export const isRunning = (status: string) => status === "uploaded" || status === "validating" || status === "applying";
