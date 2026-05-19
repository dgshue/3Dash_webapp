/**
 * Geocoding via Open-Meteo's free, key-less endpoint. Same vendor we already
 * use for weather, so no new dependency or terms-of-service surface area.
 *
 * https://open-meteo.com/en/docs/geocoding-api
 */

export interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  /** e.g. "United States" */
  country?: string;
  /** State/region/province depending on country. */
  admin1?: string;
  /** Display label combining the above. */
  label: string;
}

interface RawResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

/** Search by city / address. Returns up to `count` ranked results. */
export async function searchLocation(query: string, count = 5): Promise<GeocodingResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Geocoding ${resp.status}`);
  const data = await resp.json() as { results?: RawResult[] };
  if (!data.results) return [];
  return data.results.map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    admin1: r.admin1,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
  }));
}
