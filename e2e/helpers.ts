import type { Page, Route } from "@playwright/test";
import {
  fakeDirect,
  fakeGeocode,
  fakeMapStops,
  fakeMapTrips,
  fakePlan,
  fakeRentals,
  fakeStopTimes,
  fakeTrip,
  fakeValhalla,
} from "../src/providers/fixtures";

export interface Fakes {
  /** Every request the page made to a routing or data service, as "service path". */
  calls: string[];
  /** Services that answer 503 until taken out of the set. */
  down: Set<"transitous" | "valhalla" | "photon">;
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ json: body, headers: { "access-control-allow-origin": "*" } });

/**
 * Every service the page talks to, answered locally with made-up data, so the
 * tests depend on none of them and send them nothing. Map tiles are the one
 * thing left to the network.
 */
export async function fakeServices(page: Page): Promise<Fakes> {
  const fakes: Fakes = { calls: [], down: new Set() };

  await page.route("https://api.transitous.org/**", (route) => {
    const url = new URL(route.request().url());
    fakes.calls.push(`transitous ${url.pathname}`);
    if (fakes.down.has("transitous")) return route.fulfill({ status: 503 });
    const now = Date.now();
    if (url.pathname.endsWith("/plan")) {
      // A street-only request gets no ride, only a direct route, as the real server answers.
      if (url.searchParams.get("transitModes") === "") {
        return json(
          route,
          fakeDirect(now, url.searchParams.get("directModes") === "BIKE" ? "BIKE" : "WALK"),
        );
      }
      return json(route, fakePlan(now));
    }
    if (url.pathname.endsWith("/stoptimes")) return json(route, fakeStopTimes(now));
    if (url.pathname.endsWith("/trip")) return json(route, fakeTrip(now));
    if (url.pathname.endsWith("/map/stops")) return json(route, fakeMapStops);
    if (url.pathname.endsWith("/map/trips")) return json(route, fakeMapTrips(now));
    if (url.pathname.endsWith("/rentals")) return json(route, fakeRentals);
    if (url.pathname.endsWith("/geocode")) {
      const text = (url.searchParams.get("text") ?? "").toLowerCase();
      return json(
        route,
        "république".startsWith(text.slice(0, 3)) || text.includes("rep") ? fakeGeocode : [],
      );
    }
    return route.fulfill({ status: 404 });
  });

  await page.route("https://valhalla1.openstreetmap.de/**", (route) => {
    fakes.calls.push("valhalla /route");
    if (fakes.down.has("valhalla")) return route.fulfill({ status: 503 });
    return json(route, fakeValhalla);
  });

  await page.route("https://photon.komoot.io/**", (route) => {
    const url = new URL(route.request().url());
    fakes.calls.push(`photon ${url.pathname}`);
    if (fakes.down.has("photon")) return route.fulfill({ status: 503 });
    const reverse = url.pathname.includes("reverse");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const known: Record<string, [string, number, number, string, number]> = {
      parlement: ["Parlement de Bretagne", 48.1127, -1.6772, "Place du Parlement", 101],
      gare: ["Gare de Rennes", 48.1035, -1.6723, "Place de la Gare", 102],
      kennedy: ["Dalle Kennedy", 48.1214, -1.711, "Cours Kennedy", 103],
    };
    const hit = Object.entries(known).find(([k]) => q.includes(k))?.[1];
    if (!reverse && !hit) return json(route, { type: "FeatureCollection", features: [] });
    const [name, lat, lng, street, id] = hit ?? [
      "Parlement de Bretagne",
      0,
      0,
      "Place du Parlement",
      101,
    ];
    const at = reverse
      ? [Number(url.searchParams.get("lon")), Number(url.searchParams.get("lat"))]
      : [lng, lat];
    return json(route, {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: at },
          properties: {
            osm_type: "N",
            osm_id: id,
            osm_key: "tourism",
            osm_value: "attraction",
            name,
            street,
            postcode: "35000",
            city: "Rennes",
          },
        },
      ],
    });
  });

  await page.route("https://nominatim.openstreetmap.org/**", (route) => {
    const url = new URL(route.request().url());
    fakes.calls.push(`nominatim ${url.pathname}`);
    if (url.pathname.includes("lookup")) {
      return json(route, [
        {
          extratags: {
            opening_hours: "Mo-Fr 09:00-18:00",
            website: "example.org",
            wheelchair: "yes",
          },
        },
      ]);
    }
    return route.fulfill({ status: 503 });
  });

  return fakes;
}

/**
 * English, and a map over a city, whatever the machine's settings. Preferences given here are
 * written once, before the app first loads; what the app saves afterwards is left alone, so a
 * reload shows what a user would see. When a test calls this twice, the later call wins.
 */
export async function setUp(page: Page, prefs: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((extra) => {
    if (!localStorage.getItem("ways:lang")) localStorage.setItem("ways:lang", "en");
    const seeded = `ways-test:${JSON.stringify(extra)}`;
    if (localStorage.getItem(seeded)) return;
    localStorage.setItem(seeded, "1");
    localStorage.setItem(
      "ways:prefs",
      JSON.stringify({ view: { lng: -1.6793, lat: 48.1105, zoom: 15.2 }, ...extra }),
    );
  }, prefs);
}

export const GARE = "48.10350,-1.67230,Gare%20de%20Rennes";
export const KENNEDY = "48.12140,-1.71100,Dalle%20Kennedy";
export const REPUBLIQUE = "48.10976,-1.67918,R%C3%A9publique%2C%20Rennes,fr-test-star_15006";
