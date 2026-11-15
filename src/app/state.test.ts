import { describe, expect, test } from "bun:test";
import { decodePoint, encodePoint, href, parseRoute, type Route } from "./state";

const republique = {
  lat: 48.10976,
  lng: -1.67918,
  name: "République, Rennes / centre",
  stopId: "fr-star_7-15006",
};

describe("points in the hash", () => {
  test("round-trip, with commas, slashes and accents in the name", () => {
    expect(decodePoint(encodePoint(republique))).toEqual(republique);
  });

  test("a point without a name or stop", () => {
    expect(decodePoint("48.1,-1.6")).toEqual({ lat: 48.1, lng: -1.6, name: "" });
  });

  test("rejects what is not a position", () => {
    expect(decodePoint("-")).toBeNull();
    expect(decodePoint("")).toBeNull();
    expect(decodePoint("abc,def,x")).toBeNull();
    expect(decodePoint("91,0,x")).toBeNull();
    expect(decodePoint(",2,x")).toBeNull();
  });

  test("a badly encoded name is kept as written rather than throwing", () => {
    expect(decodePoint("1,2,%E0%A4%A")?.name).toBe("%E0%A4%A");
  });
});

describe("routes", () => {
  const routes: Route[] = [
    { name: "home" },
    { name: "place", point: { lat: 48.8738, lng: 2.3705, name: "Le Petit Cambodge" }, osm: "N42" },
    { name: "place", point: { lat: 48.8738, lng: 2.3705, name: "" } },
    { name: "stop", point: republique },
    { name: "dir", from: null, to: republique, mode: "bike", pick: null },
    { name: "dir", from: { lat: 1, lng: 2, name: "A" }, to: republique, mode: "transit", pick: 2 },
    { name: "dir", from: null, to: null, mode: "walk", pick: null },
    { name: "saved" },
    { name: "layers" },
    { name: "settings" },
    { name: "sources" },
  ];

  test("every route survives its own link", () => {
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });

  test("unknown or broken links open the map", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/nope")).toEqual({ name: "home" });
    expect(parseRoute("#/place/")).toEqual({ name: "home" });
    expect(parseRoute("#/stop/x,y")).toEqual({ name: "home" });
  });

  test("a trip link with an unknown mode or pick falls back", () => {
    expect(parseRoute("#/dir/-/-/teleport/x")).toEqual({
      name: "dir",
      from: null,
      to: null,
      mode: "transit",
      pick: null,
    });
  });

  test("an OpenStreetMap reference that is not one is dropped", () => {
    expect(parseRoute("#/place/1,2,A/javascript")).toEqual({
      name: "place",
      point: { lat: 1, lng: 2, name: "A" },
    });
  });
});
