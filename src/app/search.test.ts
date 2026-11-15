import { describe, expect, test } from "bun:test";
import type { Recent, Saved } from "../store/store";
import { fold, labelParts, localHits } from "./search";

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
