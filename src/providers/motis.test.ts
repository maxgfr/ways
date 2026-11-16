import { afterEach, describe, expect, test } from "bun:test";
import { lang } from "../i18n";
import {
  fakeGeocode,
  fakeMapStops,
  fakeMapTrips,
  fakePlan,
  fakeRentals,
  fakeStopTimes,
} from "./fixtures";
import {
  groupStops,
  hexColor,
  nameEnds,
  toDeparture,
  toItinerary,
  toLiveTrip,
  toRentals,
  toStop,
  toStopMatch,
  vehicleOf,
} from "./motis";
import type { Stop } from "./types";

const NOW = Date.UTC(2026, 10, 15, 16, 0, 0);
const origin = { name: "Transitous", host: "api.transitous.org" };

afterEach(() => {
  lang.value = "en";
});

describe("vehicleOf", () => {
  test("names what riders see", () => {
    expect(vehicleOf("SUBWAY")).toBe("subway");
    expect(vehicleOf("HIGHSPEED_RAIL")).toBe("rail");
    expect(vehicleOf("COACH")).toBe("bus");
    expect(vehicleOf("WALK")).toBe("foot");
  });

  test("a rental is the vehicle rented", () => {
    expect(vehicleOf("RENTAL", "SCOOTER_STANDING")).toBe("scooter");
    expect(vehicleOf("RENTAL", "BICYCLE")).toBe("bike");
    expect(vehicleOf("RENTAL")).toBe("bike");
  });

  test("a mode this version does not know is still a vehicle", () => {
    expect(vehicleOf("HYPERLOOP")).toBe("other");
    expect(vehicleOf(undefined)).toBe("other");
  });
});

describe("hexColor", () => {
  test("accepts GTFS colours, with or without #", () => {
    expect(hexColor("EE1D23")).toBe("#ee1d23");
    expect(hexColor("#004f9e")).toBe("#004f9e");
  });

  test("rejects anything else, so it never reaches a style", () => {
    expect(hexColor("red")).toBeUndefined();
    expect(hexColor("fff")).toBeUndefined();
    expect(hexColor("ee1d23;background:url(x)")).toBeUndefined();
    expect(hexColor(12)).toBeUndefined();
  });
});

describe("toItinerary", () => {
  const raw = fakePlan(NOW).itineraries[0];
  const it = toItinerary(raw, origin);

  test("times, duration and transfers", () => {
    expect(it.id).toBe("fake-itinerary-1");
    expect(it.start).toBe(NOW + 60_000);
    expect(it.end).toBe(NOW + 16 * 60_000);
    expect(it.duration).toBe(900);
    expect(it.transfers).toBe(0);
    expect(it.origin).toEqual(origin);
  });

  test("a street leg has its path, distance and steps as sentences", () => {
    const walk = it.legs[0];
    expect(walk?.kind).toBe("walk");
    expect(walk?.vehicle).toBe("foot");
    expect(walk?.distance).toBe(210);
    expect(walk?.path).toEqual([
      [-1.6727, 48.1032],
      [-1.6723, 48.1035],
    ]);
    expect(walk?.steps).toEqual([
      { text: "Start onto Place de la Gare", distance: 120, turn: "depart" },
      { text: "Turn left", distance: 90, turn: "left" },
    ]);
  });

  test("steps follow the language", () => {
    lang.value = "fr";
    expect(toItinerary(raw, origin).legs[0]?.steps[1]?.text).toBe("Tourne à gauche");
  });

  test("a transit leg has its line, live times, stops and alerts", () => {
    const ride = it.legs[1];
    expect(ride?.kind).toBe("transit");
    expect(ride?.vehicle).toBe("subway");
    expect(ride?.line).toEqual({
      name: "a",
      longName: "Kennedy <> La Poterie",
      color: "#ee1d23",
      textColor: "#ffffff",
      agency: "STAR",
    });
    expect(ride?.headsign).toBe("Kennedy");
    expect(ride?.tripId).toBe("fake-trip-a");
    expect(ride?.realTime).toBe(true);
    expect((ride?.start ?? 0) - (ride?.scheduledStart ?? 0)).toBe(2 * 60_000);
    expect(ride?.from.track).toBe("2");
    expect(ride?.stops.map((s) => s.name)).toEqual(["Charles de Gaulle", "République"]);
    expect(ride?.alerts).toEqual([
      { title: "Lift out of service at Gares", text: "Use the escalator." },
    ]);
    expect(ride?.steps).toEqual([]);
  });

  test("the ends get the names the user knows", () => {
    const named = nameEnds(
      toItinerary(raw, origin),
      { lat: 0, lng: 0, name: "Home" },
      { lat: 0, lng: 0, name: "Work" },
    );
    expect(named.legs[0]?.from.name).toBe("Home");
    expect(named.legs[2]?.to.name).toBe("Work");
    expect(named.legs[1]?.from.name).toBe("Gares");
  });

  test("an answer missing most fields still gives a usable itinerary", () => {
    const bare = toItinerary({ legs: [{ mode: "TELEPORT" }, null, "junk"] }, origin, 3);
    expect(bare.legs).toHaveLength(3);
    expect(bare.legs[0]?.vehicle).toBe("other");
    expect(bare.legs[0]?.path).toEqual([]);
    expect(bare.id).toBe("api.transitous.org:0:3");
    expect(toItinerary(null, origin).legs).toEqual([]);
  });
});

describe("toDeparture", () => {
  const [late, bus, cancelled] = fakeStopTimes(NOW).stopTimes.map(toDeparture);

  test("a live departure keeps both its real and its timetable time", () => {
    expect(late?.realTime).toBe(true);
    expect(late?.time).toBe(NOW + 4 * 60_000);
    expect(late?.scheduled).toBe(NOW + 2 * 60_000);
    expect(late?.line.name).toBe("a");
    expect(late?.vehicle).toBe("subway");
    expect(late?.headsign).toBe("Kennedy");
    expect(late?.tz).toBe("Europe/Paris");
  });

  test("a timetable departure says it is not live", () => {
    expect(bus?.realTime).toBe(false);
    expect(bus?.vehicle).toBe("bus");
    expect(bus?.line.color).toBe("#004f9e");
  });

  test("cancelled is carried", () => {
    expect(cancelled?.cancelled).toBe(true);
  });

  test("an entry without a time is dropped", () => {
    expect(toDeparture({ place: { name: "x" }, mode: "BUS" })).toBeNull();
    expect(toDeparture(null)).toBeNull();
  });
});

describe("stops", () => {
  const stops = fakeMapStops.map(toStop).filter((s): s is Stop => s !== null);

  test("platforms under one parent are one station, named by the parent id", () => {
    const grouped = groupStops(stops);
    const republique = grouped.find((s) => s.name === "République");
    expect(grouped).toHaveLength(2);
    expect(republique?.id).toBe("fr-test-star_15006");
    expect(republique?.whole).toBe(true);
    expect(republique?.vehicles.sort()).toEqual(["bus", "subway"]);
  });

  test("same-named platforms without a parent merge, and are asked by position", () => {
    const parlement = groupStops(stops).find((s) => s.name === "Parlement");
    expect(parlement?.whole).toBe(false);
    expect(parlement?.lat).toBeCloseTo(48.1126, 4);
  });

  test("two stops of the same name far apart stay two", () => {
    const far: Stop[] = [
      { id: "a", name: "Mairie", lat: 48.1, lng: -1.6, vehicles: ["bus"] },
      { id: "b", name: "Mairie", lat: 48.2, lng: -1.6, vehicles: ["bus"] },
    ];
    expect(groupStops(far)).toHaveLength(2);
  });

  test("a stop without an id or a position is dropped", () => {
    expect(toStop({ name: "x", lat: 1, lon: 2 })).toBeNull();
    expect(toStop({ stopId: "x", lat: "1", lon: 2 })).toBeNull();
  });
});

describe("toStopMatch", () => {
  test("keeps stops, with the town to tell them apart", () => {
    expect(toStopMatch(fakeGeocode[0])).toEqual({
      stopId: "fr-test-star_15006",
      name: "République",
      lat: 48.10976,
      lng: -1.679182,
      area: "Rennes",
      vehicles: ["subway", "bus"],
    });
  });

  test("anything that is not a stop is left to the place search", () => {
    expect(toStopMatch(fakeGeocode[1])).toBeNull();
  });
});

describe("toRentals", () => {
  const { stations, vehicles } = toRentals(fakeRentals);

  test("bike stations with what they hold; car clubs are left out", () => {
    expect(stations.map((s) => s.name)).toEqual(["République", "Mairie"]);
    expect(stations[0]).toMatchObject({
      provider: "LE vélo STAR",
      vehicle: "bike",
      available: 7,
      docks: 12,
      renting: true,
    });
  });

  test("docks are unknown, not zero, when the feed does not report them", () => {
    expect(stations[1]?.available).toBe(0);
    expect(stations[1]?.docks).toBeUndefined();
  });

  test("only loose, usable vehicles are listed", () => {
    expect(vehicles).toEqual([
      {
        id: "fake-bikes:s1",
        lat: 48.1105,
        lng: -1.6801,
        provider: "LE vélo STAR",
        vehicle: "scooter",
      },
    ]);
  });

  test("an empty or broken answer is no rentals", () => {
    expect(toRentals(null)).toEqual({ stations: [], vehicles: [] });
  });
});

describe("toLiveTrip", () => {
  const [metro, broken] = fakeMapTrips(NOW);

  test("a stretch has its ends in time and space", () => {
    const trip = toLiveTrip(metro, 5);
    expect(trip).toMatchObject({
      tripId: "fake-trip-a",
      name: "a",
      vehicle: "subway",
      color: "#ee1d23",
      realTime: true,
      departure: NOW - 30_000,
      arrival: NOW + 30_000,
    });
    expect(trip?.path).toEqual([
      [-1.68, 48.1],
      [-1.68, 48.11],
    ]);
  });

  test("a stretch without a trip is dropped", () => {
    expect(toLiveTrip(broken, 5)).toBeNull();
  });
});
