import { describe, expect, test } from "bun:test";
import { CATEGORIES, type Category, inCategory, pick, placeName } from "./places";

const category = (id: string): Category => CATEGORIES.find((c) => c.id === id) as Category;

const point = (lng: number, lat: number, properties: Record<string, unknown>) => ({
  properties,
  geometry: { type: "Point", coordinates: [lng, lat] },
});
const BOX = { west: 2.3, south: 48.8, east: 2.4, north: 48.9 };
const restaurants = category("restaurant");

describe("placeName", () => {
  test("in the user's language when the map has it", () => {
    expect(placeName({ name: "Kölner Dom", "name:fr": "Cathédrale de Cologne" }, "fr")).toBe(
      "Cathédrale de Cologne",
    );
    expect(placeName({ name: "Kölner Dom", name_en: "Cologne Cathedral" }, "en")).toBe(
      "Cologne Cathedral",
    );
    expect(placeName({ name: " Le Train Bleu " }, "de")).toBe("Le Train Bleu");
    expect(placeName({}, "en")).toBe("");
  });
});

describe("inCategory", () => {
  test("by class or subclass", () => {
    expect(inCategory({ class: "fast_food" }, restaurants)).toBe(true);
    expect(inCategory({ class: "grocery", subclass: "supermarket" }, category("grocery"))).toBe(
      true,
    );
    expect(inCategory({ class: "shop", subclass: "bakery" }, category("grocery"))).toBe(true);
    expect(inCategory({ class: "cafe" }, restaurants)).toBe(false);
  });
});

describe("pick", () => {
  const features = [
    point(2.35, 48.85, { class: "restaurant", name: "Far" }),
    point(2.3501, 48.8501, { class: "restaurant", name: "Near" }),
    point(2.3501, 48.8501, { class: "restaurant", name: "Near" }), // the same, from another tile
    point(2.3502, 48.8502, { class: "restaurant" }), // no name
    point(2.36, 48.86, { class: "cafe", name: "A café" }),
    point(2.5, 48.85, { class: "restaurant", name: "Outside the box" }),
    {
      properties: { class: "restaurant", name: "A polygon" },
      geometry: { type: "Polygon", coordinates: [] },
    },
  ];

  test("named places of the category inside the box, nearest first, each once", () => {
    const found = pick(features, restaurants, BOX, [2.3501, 48.8501], "en");
    expect(found.map((f) => f.name)).toEqual(["Near", "Far"]);
    expect(found[0]?.distance).toBe(0);
    expect(found[0]?.kind).toBe("restaurant");
  });

  test("capped", () => {
    expect(pick(features, restaurants, BOX, [2.35, 48.85], "en", 1)).toHaveLength(1);
  });
});
