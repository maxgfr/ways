/**
 * Where the map opens. Where the user is, when they already allowed it; else
 * where they last looked; else the main city of the device's time zone. The
 * last guess needs no network and no permission: the time zone is a setting
 * of the device the page can read.
 */

export interface StartView {
  lng: number;
  lat: number;
  zoom: number;
}

/** The main city of common time zones, [lng, lat]. */
const ZONES: Record<string, [number, number]> = {
  "Europe/Paris": [2.3522, 48.8566],
  "Europe/London": [-0.1276, 51.5072],
  "Europe/Dublin": [-6.2603, 53.3498],
  "Europe/Lisbon": [-9.1393, 38.7223],
  "Europe/Madrid": [-3.7038, 40.4168],
  "Europe/Brussels": [4.3517, 50.8503],
  "Europe/Amsterdam": [4.9041, 52.3676],
  "Europe/Luxembourg": [6.1296, 49.6116],
  "Europe/Berlin": [13.405, 52.52],
  "Europe/Zurich": [8.5417, 47.3769],
  "Europe/Vienna": [16.3738, 48.2082],
  "Europe/Rome": [12.4964, 41.9028],
  "Europe/Copenhagen": [12.5683, 55.6761],
  "Europe/Oslo": [10.7522, 59.9139],
  "Europe/Stockholm": [18.0686, 59.3293],
  "Europe/Helsinki": [24.9384, 60.1699],
  "Europe/Warsaw": [21.0122, 52.2297],
  "Europe/Prague": [14.4378, 50.0755],
  "Europe/Budapest": [19.0402, 47.4979],
  "Europe/Bucharest": [26.1025, 44.4268],
  "Europe/Sofia": [23.3219, 42.6977],
  "Europe/Athens": [23.7275, 37.9838],
  "Europe/Istanbul": [28.9784, 41.0082],
  "Europe/Kyiv": [30.5234, 50.4501],
  "Europe/Kiev": [30.5234, 50.4501],
  "Europe/Moscow": [37.6173, 55.7558],
  "Europe/Riga": [24.1052, 56.9496],
  "Europe/Vilnius": [25.2797, 54.6872],
  "Europe/Tallinn": [24.7536, 59.437],
  "Europe/Belgrade": [20.4489, 44.7866],
  "Europe/Zagreb": [15.9819, 45.815],
  "Europe/Ljubljana": [14.5058, 46.0569],
  "Europe/Bratislava": [17.1077, 48.1486],
  "Europe/Monaco": [7.4246, 43.7384],
  "America/New_York": [-74.006, 40.7128],
  "America/Toronto": [-79.3832, 43.6532],
  "America/Montreal": [-73.5673, 45.5017],
  "America/Chicago": [-87.6298, 41.8781],
  "America/Denver": [-104.9903, 39.7392],
  "America/Phoenix": [-112.074, 33.4484],
  "America/Los_Angeles": [-118.2437, 34.0522],
  "America/Vancouver": [-123.1207, 49.2827],
  "America/Anchorage": [-149.9003, 61.2181],
  "America/Halifax": [-63.5752, 44.6488],
  "America/Mexico_City": [-99.1332, 19.4326],
  "America/Bogota": [-74.0721, 4.711],
  "America/Lima": [-77.0428, -12.0464],
  "America/Santiago": [-70.6693, -33.4489],
  "America/Sao_Paulo": [-46.6333, -23.5505],
  "America/Argentina/Buenos_Aires": [-58.3816, -34.6037],
  "America/Caracas": [-66.9036, 10.4806],
  "Pacific/Honolulu": [-157.8583, 21.3069],
  "Asia/Tokyo": [139.6917, 35.6895],
  "Asia/Seoul": [126.978, 37.5665],
  "Asia/Shanghai": [121.4737, 31.2304],
  "Asia/Hong_Kong": [114.1694, 22.3193],
  "Asia/Taipei": [121.5654, 25.033],
  "Asia/Singapore": [103.8198, 1.3521],
  "Asia/Kuala_Lumpur": [101.6869, 3.139],
  "Asia/Bangkok": [100.5018, 13.7563],
  "Asia/Jakarta": [106.8456, -6.2088],
  "Asia/Manila": [120.9842, 14.5995],
  "Asia/Ho_Chi_Minh": [106.6297, 10.8231],
  "Asia/Kolkata": [77.209, 28.6139],
  "Asia/Calcutta": [77.209, 28.6139],
  "Asia/Dubai": [55.2708, 25.2048],
  "Asia/Jerusalem": [35.2137, 31.7683],
  "Asia/Tel_Aviv": [34.7818, 32.0853],
  "Asia/Riyadh": [46.6753, 24.7136],
  "Asia/Tehran": [51.389, 35.6892],
  "Asia/Karachi": [67.0011, 24.8607],
  "Africa/Cairo": [31.2357, 30.0444],
  "Africa/Casablanca": [-7.5898, 33.5731],
  "Africa/Algiers": [3.0588, 36.7538],
  "Africa/Tunis": [10.1815, 36.8065],
  "Africa/Lagos": [3.3792, 6.5244],
  "Africa/Nairobi": [36.8219, -1.2921],
  "Africa/Johannesburg": [28.0473, -26.2041],
  "Africa/Abidjan": [-4.0083, 5.36],
  "Africa/Dakar": [-17.4677, 14.7167],
  "Australia/Sydney": [151.2093, -33.8688],
  "Australia/Melbourne": [144.9631, -37.8136],
  "Australia/Brisbane": [153.026, -27.4698],
  "Australia/Perth": [115.8605, -31.9505],
  "Australia/Adelaide": [138.6007, -34.9285],
  "Pacific/Auckland": [174.7633, -36.8485],
};

/** When the zone is not listed, the middle of its part of the world. */
const AREAS: Record<string, StartView> = {
  Europe: { lng: 10, lat: 50, zoom: 3.6 },
  America: { lng: -90, lat: 25, zoom: 2.4 },
  Asia: { lng: 100, lat: 30, zoom: 2.6 },
  Africa: { lng: 20, lat: 5, zoom: 2.6 },
  Australia: { lng: 135, lat: -27, zoom: 3.2 },
  Pacific: { lng: 170, lat: -20, zoom: 2.4 },
  Atlantic: { lng: -30, lat: 35, zoom: 2.4 },
  Indian: { lng: 75, lat: -10, zoom: 2.4 },
};

const WORLD: StartView = { lng: 10, lat: 30, zoom: 1.6 };
const CITY_ZOOM = 11;

/** Where to open for a time zone: its city, its part of the world, or the whole world. */
export function viewForTimezone(zone: string | undefined): StartView {
  if (!zone) return WORLD;
  const city = ZONES[zone];
  if (city) return { lng: city[0], lat: city[1], zoom: CITY_ZOOM };
  return AREAS[zone.split("/")[0] ?? ""] ?? WORLD;
}

/** Below this zoom a saved view shows a continent or more: it says nothing of where the user is. */
const MIN_KEPT_ZOOM = 5;

/** Where the user last looked, unless it was that far out; then their city, from the time zone. */
export function startView(last: StartView | null | undefined, zone: string | undefined): StartView {
  return last && last.zoom >= MIN_KEPT_ZOOM ? last : viewForTimezone(zone);
}

/** The single time zone of the country a language tag names ("fr-FR", or "fr" taken as France). */
function languageZone(language: string): string | undefined {
  try {
    const locale = new Intl.Locale(language).maximize() as Intl.Locale & {
      getTimeZones?: () => string[] | undefined;
      timeZones?: string[];
    };
    const zones = locale.getTimeZones?.() ?? locale.timeZones;
    return zones?.length === 1 ? zones[0] : undefined;
  } catch {
    return undefined;
  }
}

function utcOffset(zone: string, at: Date): string | undefined {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
  } catch {
    return undefined;
  }
}

/**
 * The zone that best tells where the user is. A device is often set to a
 * neighbouring city of the same hour (a Mac in France set to Berlin): when the
 * browser's language names a country with one zone, listed here and on the
 * same hour right now, that country wins. Otherwise the device's zone does.
 */
export function homeZone(
  zone: string | undefined,
  language: string | undefined,
  at = new Date(),
): string | undefined {
  const fromLanguage = language ? languageZone(language) : undefined;
  if (!fromLanguage || fromLanguage === zone || !ZONES[fromLanguage]) return zone;
  if (!zone) return fromLanguage;
  return utcOffset(fromLanguage, at) === utcOffset(zone, at) ? fromLanguage : zone;
}

export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** True when the browser will give the position without asking: the user allowed it before. */
export async function positionAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    return status?.state === "granted";
  } catch {
    return false;
  }
}
