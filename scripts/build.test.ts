import { describe, expect, test } from "bun:test";
import { auditHtml, CSP, fontsCss, serviceWorker } from "./build";

describe("build", () => {
  test("the CSP loads code, styles and fonts from the site only", () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).toContain("style-src 'self'");
    expect(CSP).toContain("font-src 'self'");
    expect(CSP).not.toContain("unsafe-inline");
    expect(CSP).not.toContain("unsafe-eval");
    expect(CSP).toContain("default-src 'none'");
  });

  test("auditHtml refuses inline code and other origins", () => {
    expect(() => auditHtml("<script>alert(1)</script>")).toThrow();
    expect(() => auditHtml("<style>a{}</style>")).toThrow();
    expect(() => auditHtml('<a onclick="x()">x</a>')).toThrow();
    expect(() => auditHtml('<script src="https://cdn.example/x.js"></script>')).toThrow();
    expect(() => auditHtml('<link href="/abs.css" />')).toThrow();
    expect(() => auditHtml('<script type="module" src="./index.js"></script>')).not.toThrow();
  });

  test("the service worker precaches the files and keeps map tiles", () => {
    const sw = serviceWorker(["assets/a.js", "fonts/f.woff2"], "abc");
    expect(sw).toContain('"ways-abc"');
    expect(sw).toContain('"./assets/a.js"');
    expect(sw).toContain("tiles.openfreemap.org");
    expect(sw).toContain('"ways-tiles-kept"');
  });

  test("the page comes from the network, and from the kept copy when offline", async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const kept = new Response("kept page");
    let online = true;
    const run = new Function("self", "caches", "fetch", "location", serviceWorker([], "abc"));
    run(
      { addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn) },
      { match: async (req: string) => (req === "./" ? kept : undefined) },
      async () => {
        if (!online) throw new TypeError("offline");
        return new Response("fresh page");
      },
      { origin: "https://maxgfr.github.io" },
    );
    const open = async () => {
      let answer: Promise<Response> | undefined;
      listeners.fetch?.({
        request: { url: "https://maxgfr.github.io/ways/", method: "GET", mode: "navigate" },
        respondWith: (r: Promise<Response>) => (answer = r),
      });
      return (await answer)?.text();
    };
    expect(await open()).toBe("fresh page");
    online = false;
    expect(await open()).toBe("kept page");
  });

  test("fonts are served from the site", () => {
    expect(fontsCss()).toContain('url("./fonts/');
    expect(fontsCss()).not.toContain("http");
  });
});
