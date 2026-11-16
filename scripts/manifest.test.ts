import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "..", "public");

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const manifest = (await Bun.file(join(PUBLIC, "manifest.webmanifest")).json()) as {
  icons: Icon[];
  id: string;
  start_url: string;
  display: string;
};

/** Width and height from a PNG's header. */
async function pngSize(file: string): Promise<[number, number]> {
  const head = new DataView(await Bun.file(join(PUBLIC, file)).slice(0, 24).arrayBuffer());
  return [head.getUint32(16), head.getUint32(20)];
}

describe("manifest", () => {
  test("installable: an id, a start, standalone, and the icons a phone asks for", () => {
    expect(manifest.id).toBe("./");
    expect(manifest.start_url).toBe("./");
    expect(manifest.display).toBe("standalone");
    const sizes = manifest.icons.filter((i) => i.type === "image/png").map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  test("every PNG icon exists at the size it is listed with", async () => {
    for (const icon of manifest.icons.filter((i) => i.type === "image/png")) {
      const [w, h] = await pngSize(icon.src);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });

  test("an iPhone has its home screen icon", async () => {
    expect(await pngSize("apple-touch-icon.png")).toEqual([180, 180]);
  });
});
