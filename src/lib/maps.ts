// Address composition and map links.
//
// Directions deliberately use a plain Google Maps URL rather than an embedded
// map: it opens the app the collector already has, works offline-ish on any
// phone, needs no API key, and adds no third-party request to the app itself.

export interface AddressParts {
  street_purok?: string | null;
  barangay?: string | null;
  municipality?: string | null;
  province?: string | null;
  landmark?: string | null;
  address?: string | null; // the legacy free text
}

/** "Purok 2 · Santa Filomena, San Juan, Southern Leyte" — falls back to the raw string. */
export function formatAddress(c: AddressParts): string {
  const parts = [c.street_purok, c.barangay, c.municipality, c.province]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  if (!parts.length) return (c.address ?? "").trim();
  return parts.join(", ");
}

/** Short form for tight rows: "Santa Filomena, San Juan". */
export function shortArea(c: AddressParts): string {
  const parts = [c.barangay, c.municipality].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.join(", ") || (c.municipality ?? "").trim() || "No address";
}

export interface Located extends AddressParts {
  lat?: number | null;
  lng?: number | null;
  gps_url?: string | null;
}

/**
 * Best available directions link:
 *   1. tagged coordinates — exact, what the collector recorded at the door
 *   2. the legacy Sheet link — opaque but usually a real pin
 *   3. a text search of the address — rough, but better than nothing
 * Returns null when there is nothing to go on at all.
 */
export function directionsUrl(c: Located): string | null {
  if (typeof c.lat === "number" && typeof c.lng === "number") {
    return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
  }
  if (c.gps_url && c.gps_url.trim()) return c.gps_url.trim();
  const text = formatAddress(c);
  if (!text) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text + ", Philippines")}`;
}

/** True when the link points at real tagged coordinates rather than a guess. */
export function hasExactPin(c: Located): boolean {
  return typeof c.lat === "number" && typeof c.lng === "number";
}
