import { describe, expect, test } from "bun:test";
import { lineColours, parseCsv } from "./gtfs";

describe("parseCsv", () => {
  test("reads quoted fields, commas inside them and doubled quotes", () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\n2,,z\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y", c: 'say "hi"' },
      { a: "2", b: "", c: "z" },
    ]);
  });

  test("ignores a byte-order mark, blank lines and a missing final newline", () => {
    expect(parseCsv("﻿id,name\n\n7,Seven")).toEqual([{ id: "7", name: "Seven" }]);
  });

  test("an empty file has no rows", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("lineColours", () => {
  const routes = [
    "route_id,route_short_name,route_long_name,route_type,route_color,route_text_color",
    '0001,a,"Kennedy <> La Poterie",1,EE1D23,FFFFFF',
    "0011,11,La Poterie <> ZI Ouest,3,004f9e,",
    "0099,,Navette,3,00AA00,000000",
    "0012,12,No colour,3,,",
    "0013,13,Bad colour,3,blue,FFF",
    "0001b,a,Second a,1,000000,FFFFFF",
  ].join("\n");

  test("keeps valid colours, keyed by the name riders see", () => {
    expect(lineColours(routes)).toEqual({
      a: { color: "#ee1d23", textColor: "#ffffff" },
      "11": { color: "#004f9e" },
      Navette: { color: "#00aa00", textColor: "#000000" },
    });
  });
});
