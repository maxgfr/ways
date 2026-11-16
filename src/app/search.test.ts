import { describe, expect, test } from "bun:test";
import { biasZoom } from "../geo/geocode";
import type { Recent, Saved } from "../store/store";
import {
  fold,
  type Hit,
  labelParts,
  localHits,
  matchShare,
  nearestFirstByName,
  rankRemote,
  searchOrigin,
} from "./search";

const PARIS: [number, number] = [2.3522, 48.8566];

function stop(name: string, lat: number, lng: number): Hit {
  return {
    kind: "stop",
    source: "stop",
    point: { lat, lng, name, stopId: name },
    meta: "",
    key: `stop:${name}`,
  };
}

function place(name: string, meta: string, lat = 48.856, lng = 2.36): Hit {
  return {
    kind: "place",
    source: "place",
    point: { lat, lng, name },
    meta,
    key: `place:${name}:${meta}:${lat}`,
  };
}

describe("matchShare", () => {
  test("counts the typed words that start a word of the name, short words and numbers aside", () => {
    expect(matchShare("10 rue de rivoli", "Louvre - Rivoli")).toBe(0.5);
    expect(matchShare("chatelet", "Châtelet - Les Halles")).toBe(1);
    expect(matchShare("rue rivoli", "Haute-Rivoire - Rue De L'Ecole")).toBe(0.5);
    expect(matchShare("12", "Anything")).toBe(0);
  });
});

describe("rankRemote", () => {
  test("puts the address first and drops stops that only look alike", () => {
    const ranked = rankRemote(
      "10 rue de rivoli",
      [
        stop("Louvre - Rivoli", 48.861, 2.341),
        stop("Rue des Olivettes", 48.79, 2.32),
        stop("Haute-Rivoire - Rue De L'Ecole", 45.71, 4.39),
      ],
      [place("10 Rue de Rivoli", "75004 Paris"), place("10 Rue de Rivoli", "75004 Paris", 48.8561)],
      PARIS,
    );
    expect(ranked.map((h) => h.point.name)).toEqual(["10 Rue de Rivoli"]);
  });

  test("puts a stop named after the words typed before the places", () => {
    const ranked = rankRemote(
      "chatelet",
      [stop("Châtelet", 48.858, 2.347)],
      [place("Théâtre du Châtelet", "Paris")],
      PARIS,
    );
    expect(ranked.map((h) => h.point.name)).toEqual(["Châtelet", "Théâtre du Châtelet"]);
  });

  test("keeps a stop matching most words only when it is nearby", () => {
    const near = stop("Gare Montparnasse Vaugirard", 48.84, 2.32);
    const far = stop("Gare Montparnasse Vaugirard bis", 45.7, 4.8);
    expect(rankRemote("gare montparnasse sncf", [near, far], [], PARIS)).toEqual([near]);
  });

  test("stops named after the words typed but far away come after the places, two at most", () => {
    const ranked = rankRemote(
      "rue de la paix",
      [
        stop("Rue de la Paix", 48.75, 2.41), // Villeneuve-le-Roi, 12 km
        stop("Rue de la Paix", 49.05, 7.43), // Bitche
        stop("Rue de la Paix", 48.46, 7.48), // Obernai
        stop("Rue de la Paix", 45.79, 4.36), // Panissières
      ],
      [
        place("Rue de la Paix", "94250 Gentilly", 48.814, 2.344),
        place("Rue de la Paix", "75002 Paris", 48.869, 2.331),
      ],
      PARIS,
    );
    expect(ranked.map((h) => h.meta || `${h.point.lat}`)).toEqual([
      "48.75",
      "75002 Paris",
      "94250 Gentilly",
      "49.05",
      "45.79",
    ]);
  });
});

describe("nearestFirstByName", () => {
  test("places of the same name, nearest first, where the name first came", () => {
    const list = [
      place("Rue de la Paix", "Gentilly", 48.814, 2.344),
      place("Chapelle de la Paix", "Paris", 48.84, 2.39),
      place("Rue de la Paix", "Paris", 48.869, 2.331),
    ];
    expect(nearestFirstByName(list, PARIS).map((h) => `${h.point.name}, ${h.meta}`)).toEqual([
      "Rue de la Paix, Paris",
      "Rue de la Paix, Gentilly",
      "Chapelle de la Paix, Paris",
    ]);
  });

  test("a city keeps its rank before a place of its name nearby", () => {
    const city = { ...place("Lyon", "France", 45.76, 4.84), area: true };
    const artwork = place("Lyon", "Paris", 48.85, 2.37);
    expect(nearestFirstByName([city, artwork], PARIS)).toEqual([city, artwork]);
  });

  test("without a point to measure from, the order stays", () => {
    const list = [place("A", "x", 45, 4), place("A", "y", 48.85, 2.35)];
    expect(nearestFirstByName(list, undefined)).toEqual(list);
  });
});

const savedList: Saved[] = [
  {
    id: "1",
    kind: "stop",
    point: { lat: 48.1, lng: -1.6, name: "République, Rennes", stopId: "s1" },
    savedAt: 1,
  },
  {
    id: "2",
    kind: "place",
    point: { lat: 48.8, lng: 2.3, name: "Le Petit Cambodge, Rue Alibert" },
    savedAt: 2,
  },
];
const recentList: Recent[] = [
  {
    kind: "stop",
    point: { lat: 48.1, lng: -1.6, name: "République, Rennes", stopId: "s1" },
    at: 3,
  },
  { kind: "place", point: { lat: 45.7, lng: 4.8, name: "Place Bellecour, Lyon" }, at: 4 },
];

describe("fold", () => {
  test("drops accents and case", () => {
    expect(fold("République")).toBe("republique");
    expect(fold("ÎLE-DE-FRANCE")).toBe("ile-de-france");
  });
});

describe("labelParts", () => {
  test("name first, the rest after the first comma", () => {
    expect(labelParts("Le Petit Cambodge, Rue Alibert, 75010 Paris")).toEqual([
      "Le Petit Cambodge",
      "Rue Alibert, 75010 Paris",
    ]);
    expect(labelParts("République")).toEqual(["République", ""]);
  });
});

describe("localHits", () => {
  test("nothing typed lists what is kept, saved first, each place once", () => {
    const hits = localHits("", savedList, recentList);
    expect(hits.map((h) => [h.source, h.point.name])).toEqual([
      ["saved", "République"],
      ["saved", "Le Petit Cambodge"],
      ["recent", "Place Bellecour"],
    ]);
  });

  test("every typed word must be found, accents aside", () => {
    expect(localHits("republique ren", savedList, recentList).map((h) => h.point.name)).toEqual([
      "République",
    ]);
    expect(localHits("republique lyon", savedList, recentList)).toEqual([]);
  });

  test("the address is kept as the second line", () => {
    expect(localHits("cambodge", savedList, recentList)[0]?.meta).toBe("Rue Alibert");
  });

  test("capped", () => {
    expect(localHits("", savedList, recentList, 2)).toHaveLength(2);
  });
});

describe("searchOrigin", () => {
  const paris: [number, number] = [2.3522, 48.8566];
  const lyon: [number, number] = [4.8357, 45.764];

  test("around the user when the map shows where they are", () => {
    expect(searchOrigin([2.3, 48.85], 13, paris)).toEqual(paris);
  });

  test("around the map when it shows another city", () => {
    expect(searchOrigin(lyon, 13, paris)).toEqual(lyon);
  });

  test("around the user when the map shows a whole country", () => {
    expect(searchOrigin(lyon, 6, paris)).toEqual(paris);
  });

  test("around the map when the position is not known", () => {
    expect(searchOrigin(lyon, 13, null)).toEqual(lyon);
  });
});

describe("biasZoom", () => {
  test("never looser than a district, never tighter than a street", () => {
    expect(biasZoom(4)).toBe(14);
    expect(biasZoom(12)).toBe(14);
    expect(biasZoom(15.4)).toBe(15);
    expect(biasZoom(19)).toBe(16);
  });
});
