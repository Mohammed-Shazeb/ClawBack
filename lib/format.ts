const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Formats a stored amount. A statement can name a deduction without a figure. */
export function formatCurrency(value: number | undefined | null): string {
  return typeof value === "number" ? currencyFormatter.format(value) : "Not stated";
}

export function formatDate(value: number | undefined | null): string {
  return typeof value === "number" ? new Date(value).toLocaleDateString() : "—";
}

export function formatDateTime(value: number | undefined | null): string {
  return typeof value === "number" ? new Date(value).toLocaleString() : "—";
}

export function formatFileSize(bytes: number | undefined): string {
  if (typeof bytes !== "number") return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
