/** Free reverse geocode — BigDataCloud client endpoint (no API key). */

export interface ReverseGeocodeCity {
  city: string;
  region: string | null;
  country: string | null;
  fullLabel: string;
}

const TIMEOUT_MS = 8_000;

export async function reverseGeocodeCity(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeCity | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('localityLanguage', 'en');
    const res = await fetch(url.toString(), { signal: controller.signal, credentials: 'omit' });
    if (!res.ok) return null;
    const data = await res.json() as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    const city = (data.city || data.locality)?.trim();
    if (!city) return null;
    const region = data.principalSubdivision?.trim() || null;
    const country = data.countryName?.trim() || null;
    const parts = [city, region, country].filter(Boolean);
    return {
      city,
      region,
      country,
      fullLabel: parts.join(', ').slice(0, 256),
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
