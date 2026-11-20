// Formatting helpers for the plan area. Money is integer pence (GBP);
// lengths are centimetres.

const whole = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// £1,234 for whole pounds, £12.99 otherwise.
export function formatPence(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(pence)) return "—";
  const fmt = Math.round(pence) % 100 === 0 ? whole : exact;
  return fmt.format(Math.round(pence) / 100);
}

// Exact amounts (low === high) keep their pence; real ranges are rounded to
// whole pounds and collapse if the rounded ends meet.
export function formatPenceRange(low: number, high: number): string {
  if (low === high) return formatPence(low);
  const lo = Math.round(low / 100) * 100;
  const hi = Math.round(high / 100) * 100;
  if (lo === hi) return formatPence(lo);
  return `${formatPence(lo)}–${formatPence(hi)}`;
}

export function formatCm(cm: number | null | undefined): string {
  if (cm == null || !Number.isFinite(cm)) return "?";
  return `${Math.round(cm)} cm`;
}

export function formatMetres(cm: number | null | undefined): string {
  if (cm == null || !Number.isFinite(cm)) return "?";
  return `${Number((cm / 100).toFixed(2))} m`;
}

export function formatRoomSize(
  widthCm: number | null | undefined,
  lengthCm: number | null | undefined,
): string {
  if (widthCm == null || lengthCm == null) return "Size unknown";
  return `${Number((widthCm / 100).toFixed(2))} × ${Number((lengthCm / 100).toFixed(2))} m`;
}

// "W 120–200 · D ≤ 90 · H ≤ 85 cm" from requirement bounds.
export function formatBounds(r: {
  minWidthCm?: number;
  maxWidthCm?: number;
  maxDepthCm?: number;
  maxHeightCm?: number;
}): string | null {
  const parts: string[] = [];
  const w = (n: number) => Math.round(n);
  if (r.minWidthCm != null && r.maxWidthCm != null) {
    parts.push(`W ${w(r.minWidthCm)}–${w(r.maxWidthCm)}`);
  } else if (r.maxWidthCm != null) {
    parts.push(`W ≤ ${w(r.maxWidthCm)}`);
  } else if (r.minWidthCm != null) {
    parts.push(`W ≥ ${w(r.minWidthCm)}`);
  }
  if (r.maxDepthCm != null) parts.push(`D ≤ ${w(r.maxDepthCm)}`);
  if (r.maxHeightCm != null) parts.push(`H ≤ ${w(r.maxHeightCm)}`);
  return parts.length ? `${parts.join(" · ")} cm` : null;
}

export function formatProductSize(p: {
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
}): string | null {
  const dims = [p.widthCm, p.depthCm, p.heightCm];
  if (dims.every((d) => d == null)) return null;
  const labels = ["W", "D", "H"];
  return `${dims
    .map((d, i) => (d == null ? null : `${labels[i]} ${Math.round(d)}`))
    .filter(Boolean)
    .join(" × ")} cm`;
}

// Parse a user-typed number; empty → undefined, invalid → NaN.
export function parseOptionalNumber(input: string): number | undefined {
  const t = input.trim();
  if (t === "") return undefined;
  return Number(t.replace(/,/g, ""));
}

export function titleCase(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function hoursAgo(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / 3_600_000;
}

export function formatAge(iso: string, now = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
