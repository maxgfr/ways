import { describe, expect, test } from "bun:test";
import { type Candidate, candidates, choose, diagonalKm, measure } from "./discover";

const HEADER =
  "id,data_type,entity_type,location.country_code,location.subdivision_name,location.municipality,provider,is_official,name,note,feed_contact_email,static_reference,urls.direct_download,urls.authentication_type,urls.authentication_info,urls.api_key_parameter_name,urls.latest,urls.license,location.bounding_box.minimum_latitude,location.bounding_box.maximum_latitude,location.bounding_box.minimum_longitude,location.bounding_box.maximum_longitude,location.bounding_box.extracted_on,status,features,redirect.id,redirect.comment";

function row(o: Record<string, string>): string {
  const cols = HEADER.split(",");
  return cols.map((c) => ((o[c] ?? "").includes(",") ? `"${o[c]}"` : (o[c] ?? ""))).join(",");
}

const city = (id: string, lat: number, lng: number, extra: Record<string, string> = {}) => ({
  id,
  data_type: "gtfs",
  "location.country_code": "FR",
  "location.municipality": `City ${id}`,
  provider: `Transit ${id}`,
  "urls.latest": `https://files.example/${id}/latest.zip`,
  "urls.authentication_type": "0",
  "location.bounding_box.minimum_latitude": String(lat - 0.1),
  "location.bounding_box.maximum_latitude": String(lat + 0.1),
  "location.bounding_box.minimum_longitude": String(lng - 0.15),
  "location.bounding_box.maximum_longitude": String(lng + 0.15),
  status: "active",
  ...extra,
});

const CSV = [
  HEADER,
  row(
    city("mdb-1", 48.1, -1.7, {
      provider: "STAR",
      "location.subdivision_name": "Bretagne",
      "location.municipality": "Acigné",
    }),
  ),
  row(city("mdb-2", 45.7, 4.8, { provider: "Bus, Tram & Co" })),
  row(city("mdb-3", 48.12, -1.68)), // same city as mdb-1
  row(city("mdb-4", 50, 2, { status: "deprecated" })),
  row(city("mdb-5", 50, 3, { "urls.authentication_type": "2" })),
  row(city("mdb-6", 50, 4, { data_type: "gbfs" })),
  row(city("mdb-7", 50, 5, { "location.bounding_box.minimum_latitude": "" })),
  row(
    city("mdb-8", 46, 2, {
      "location.bounding_box.minimum_latitude": "42",
      "location.bounding_box.maximum_latitude": "51",
    }),
  ), // a whole country
  row(city("mdb-9", 50, 6, { "redirect.id": "mdb-1" })),
].join("\n");

describe("candidates", () => {
  test("keeps active, keyless, city-sized timetable feeds", () => {
    expect(candidates(CSV).map((c) => c.id)).toEqual(["mdb-1", "mdb-2", "mdb-3"]);
  });

  test("names a region by its city and operator, commas and all", () => {
    const [, lyon] = candidates(CSV);
    expect(lyon?.name).toBe("Bus, Tram & Co");
    // Named by the network and its region, not by the first town of the network.
    expect(candidates(CSV)[0]?.name).toBe("STAR · Bretagne");
    for (const [i, v] of [4.65, 45.6, 4.95, 45.8].entries())
      expect(lyon?.bbox[i]).toBeCloseTo(v, 6);
    expect(lyon?.page).toBe("https://mobilitydatabase.org/feeds/gtfs/mdb-2");
  });
});

describe("choose", () => {
  const list = (): Candidate[] => {
    const c = candidates(CSV);
    const size: Record<string, number> = { "mdb-1": 10, "mdb-2": 30, "mdb-3": 20 };
    for (const x of c) x.bytes = size[x.id] as number;
    return c;
  };

  test("biggest first, and one network per city", () => {
    expect(choose(list(), 10).map((c) => c.id)).toEqual(["mdb-2", "mdb-3"]);
  });

  test("stops at the limit, and skips feeds of unknown size", () => {
    expect(choose(list(), 1).map((c) => c.id)).toEqual(["mdb-2"]);
    const unknown = list().map(({ bytes: _, ...c }) => c);
    expect(choose(unknown, 10)).toEqual([]);
  });
});

describe("measure", () => {
  test("records each size, and survives a feed that fails", async () => {
    const c = candidates(CSV);
    await measure(c, async (url) => {
      if (url.includes("mdb-2")) throw new Error("down");
      return url.length;
    });
    expect(c.map((x) => x.bytes !== undefined)).toEqual([true, false, true]);
  });
});

describe("diagonalKm", () => {
  test("a box of 0.2° by 0.3° near 48° N is about 30 km across", () => {
    expect(Math.round(diagonalKm([-1.85, 48, -1.55, 48.2]))).toBe(31);
  });
});
