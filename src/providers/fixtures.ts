/**
 * Made-up answers in the shape the services send, for the tests only. Nothing
 * here is real timetable data, and the app never loads this file.
 */

const iso = (ms: number): string => new Date(ms).toISOString();

const STAR = "fr-test-star";

export function fakeStop(name: string, id: string, lat: number, lon: number, extra: object = {}) {
  return {
    name,
    stopId: `${STAR}_${id}`,
    lat,
    lon,
    tz: "Europe/Paris",
    vertexType: "TRANSIT",
    ...extra,
  };
}

/** A trip: three minutes on foot, the metro (running two minutes late), one minute on foot. */
export function fakePlan(now: number) {
  const t = (min: number) => iso(now + min * 60_000);
  const gares = fakeStop("Gares", "5008", 48.1035, -1.6723, { modes: ["SUBWAY"] });
  const kennedy = fakeStop("J.F. Kennedy", "5001", 48.1213, -1.7109, { modes: ["SUBWAY"] });
  return {
    from: { name: "START", lat: 48.1032, lon: -1.6727 },
    to: { name: "END", lat: 48.1214, lon: -1.711 },
    direct: [],
    itineraries: [
      {
        id: "fake-itinerary-1",
        duration: 15 * 60,
        startTime: t(1),
        endTime: t(16),
        transfers: 0,
        legs: [
          {
            mode: "WALK",
            from: {
              name: "START",
              lat: 48.1032,
              lon: -1.6727,
              departure: t(1),
              tz: "Europe/Paris",
            },
            to: { ...gares, arrival: t(4) },
            duration: 180,
            startTime: t(1),
            endTime: t(4),
            scheduledStartTime: t(1),
            scheduledEndTime: t(4),
            realTime: false,
            distance: 210,
            // (48.1032,-1.6727) → (48.1035,-1.6723), precision 6
            legGeometry: { points: "_q~vzAv~aeBwQ_X", precision: 6, length: 2 },
            steps: [
              { relativeDirection: "DEPART", distance: 120, streetName: "Place de la Gare" },
              { relativeDirection: "LEFT", distance: 90, streetName: "" },
            ],
          },
          {
            mode: "SUBWAY",
            from: { ...gares, departure: t(6), scheduledDeparture: t(4), track: "2" },
            to: { ...kennedy, arrival: t(15), scheduledArrival: t(13) },
            duration: 540,
            startTime: t(6),
            endTime: t(15),
            scheduledStartTime: t(4),
            scheduledEndTime: t(13),
            realTime: true,
            headsign: "Kennedy",
            routeShortName: "a",
            displayName: "a",
            routeLongName: "Kennedy <> La Poterie",
            routeColor: "ee1d23",
            routeTextColor: "ffffff",
            agencyName: "STAR",
            tripId: "fake-trip-a",
            intermediateStops: [
              { ...fakeStop("Charles de Gaulle", "5022", 48.1055, -1.677), departure: t(8) },
              { ...fakeStop("République", "5006", 48.1098, -1.6792), departure: t(10) },
            ],
            legGeometry: { points: "", precision: 6, length: 0 },
            alerts: [
              { headerText: "Lift out of service at Gares", descriptionText: "Use the escalator." },
            ],
          },
          {
            mode: "WALK",
            from: { ...kennedy, departure: t(15) },
            to: { name: "END", lat: 48.1214, lon: -1.711, arrival: t(16), tz: "Europe/Paris" },
            duration: 60,
            startTime: t(15),
            endTime: t(16),
            scheduledStartTime: t(15),
            scheduledEndTime: t(16),
            realTime: false,
            distance: 40,
            legGeometry: { points: "", precision: 6, length: 0 },
            steps: [{ relativeDirection: "CONTINUE", distance: 40, streetName: "" }],
          },
        ],
      },
    ],
  };
}

/** A street-only answer: one route in the "direct" list, as the server sends for bike or foot. */
export function fakeDirect(now: number, mode: "BIKE" | "WALK") {
  const t = (min: number) => iso(now + min * 60_000);
  return {
    itineraries: [],
    direct: [
      {
        duration: 20 * 60,
        startTime: t(0),
        endTime: t(20),
        transfers: 0,
        legs: [
          {
            mode,
            from: {
              name: "START",
              lat: 48.1032,
              lon: -1.6727,
              departure: t(0),
              tz: "Europe/Paris",
            },
            to: { name: "END", lat: 48.1214, lon: -1.711, arrival: t(20), tz: "Europe/Paris" },
            duration: 20 * 60,
            startTime: t(0),
            endTime: t(20),
            scheduledStartTime: t(0),
            scheduledEndTime: t(20),
            realTime: false,
            distance: 4700,
            legGeometry: { points: "_q~vzAv~aeBopb@vxiA", precision: 6, length: 2 },
            steps: [
              {
                relativeDirection: "DEPART",
                distance: 4700,
                streetName: "Rue de l'Alma",
                elevationUp: 40,
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Departures at a stop: one live and late, one from the timetable, one cancelled. */
export function fakeStopTimes(now: number) {
  const t = (min: number) => iso(now + min * 60_000);
  const place = (dep: number, sched: number) =>
    fakeStop("République", "5006", 48.1098, -1.6792, {
      departure: t(dep),
      scheduledDeparture: t(sched),
    });
  const base = { routeColor: "ee1d23", routeTextColor: "ffffff", agencyName: "STAR" };
  return {
    stopTimes: [
      {
        ...base,
        place: place(4, 2),
        mode: "SUBWAY",
        realTime: true,
        headsign: "Kennedy",
        displayName: "a",
        routeShortName: "a",
        tripId: "fake-trip-a",
      },
      {
        place: place(9, 9),
        mode: "BUS",
        realTime: false,
        headsign: "ZI Ouest",
        displayName: "11",
        routeShortName: "11",
        routeColor: "004f9e",
        routeTextColor: "ffffff",
        tripId: "fake-trip-11",
      },
      {
        ...base,
        place: place(12, 12),
        mode: "SUBWAY",
        realTime: false,
        cancelled: true,
        headsign: "La Poterie",
        displayName: "a",
        routeShortName: "a",
        tripId: "fake-trip-a2",
      },
    ],
  };
}

export function fakeTrip(now: number) {
  const leg = fakePlan(now).itineraries[0]?.legs[1];
  return { duration: 540, legs: leg ? [leg] : [] };
}

export const fakeMapStops = [
  fakeStop("République", "5006", 48.1098, -1.6792, {
    parentId: `${STAR}_15006`,
    modes: ["SUBWAY"],
  }),
  fakeStop("République", "1167", 48.1094, -1.6788, { parentId: `${STAR}_15006`, modes: ["BUS"] }),
  fakeStop("Parlement", "1201", 48.1125, -1.6773, { modes: ["BUS"] }),
  fakeStop("Parlement", "1202", 48.1127, -1.6771, { modes: ["BUS"] }),
];

export const fakeGeocode = [
  {
    type: "STOP",
    name: "République",
    id: `${STAR}_15006`,
    lat: 48.10976,
    lon: -1.679182,
    modes: ["SUBWAY", "BUS"],
    areas: [
      { name: "France", adminLevel: 2, matched: false, default: false },
      { name: "Rennes", adminLevel: 8, matched: true, default: true },
    ],
  },
  { type: "PLACE", name: "Not a stop", id: "node/1", lat: 48.1, lon: -1.6, areas: [] },
];

export const fakeRentals = {
  providers: [{ id: "fake-bikes", name: "LE vélo STAR", groupId: "LE vélo STAR" }],
  stations: [
    {
      id: "5501",
      providerId: "fake-bikes",
      name: "République",
      lat: 48.110026,
      lon: -1.678037,
      isRenting: true,
      isReturning: true,
      numVehiclesAvailable: 7,
      formFactors: ["BICYCLE"],
      vehicleDocksAvailable: { "": 12 },
    },
    {
      id: "5502",
      providerId: "fake-bikes",
      name: "Mairie",
      lat: 48.1114,
      lon: -1.6795,
      isRenting: true,
      isReturning: true,
      numVehiclesAvailable: 0,
      formFactors: ["BICYCLE"],
      vehicleDocksAvailable: {},
    },
    {
      id: "car-1",
      providerId: "fake-cars",
      name: "Car club",
      lat: 48.11,
      lon: -1.68,
      numVehiclesAvailable: 2,
      formFactors: ["CAR"],
    },
  ],
  vehicles: [
    {
      id: "s1",
      providerId: "fake-bikes",
      lat: 48.1105,
      lon: -1.6801,
      formFactor: "SCOOTER_STANDING",
    },
    {
      id: "docked",
      providerId: "fake-bikes",
      lat: 48.11,
      lon: -1.678,
      formFactor: "BICYCLE",
      stationId: "5501",
    },
    {
      id: "reserved",
      providerId: "fake-bikes",
      lat: 48.11,
      lon: -1.678,
      formFactor: "BICYCLE",
      isReserved: true,
    },
  ],
};

/** One stretch of a metro run, as the live map endpoint sends it. */
export function fakeMapTrips(now: number) {
  return [
    {
      trips: [{ tripId: "fake-trip-a", displayName: "a" }],
      mode: "SUBWAY",
      routeColor: "ee1d23",
      realTime: true,
      departure: iso(now - 30_000),
      arrival: iso(now + 30_000),
      // (48.1,-1.68) → (48.11,-1.68), precision 5
      polyline: "_pqdH~bgIo}@?",
    },
    {
      trips: [],
      mode: "BUS",
      departure: iso(now),
      arrival: iso(now + 1),
      polyline: "_pqdH~bgIo}@?",
    },
  ];
}

/** A bike route with one alternative, as Valhalla sends it. */
export const fakeValhalla = {
  trip: {
    summary: { time: 912.4, length: 4.41 },
    legs: [
      {
        // (48.1032,-1.6727) → (48.1214,-1.711), precision 6
        shape: "_q~vzAv~aeBopb@vxiA",
        maneuvers: [
          { instruction: "Bike north on Rue de l'Alma.", length: 0.3, type: 2 },
          { instruction: "Turn left onto Boulevard de la Liberté.", length: 4.11, type: 15 },
          { instruction: "", length: 0 },
        ],
        elevation: [30, 31, 36, 35.6, 41, 38, 30],
      },
    ],
  },
  alternates: [
    {
      trip: {
        summary: { time: 1010, length: 4.9 },
        legs: [{ shape: "_q~vzAv~aeBopb@vxiA", maneuvers: [] }],
      },
    },
  ],
};
