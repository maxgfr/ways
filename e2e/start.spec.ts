import { expect, type Page, test } from "@playwright/test";
import { fakeServices } from "./helpers";

/** The view the app saved, once the map has settled. */
async function savedView(page: Page): Promise<{ lng: number; lat: number; zoom: number }> {
  let view: { lng: number; lat: number; zoom: number } | null = null;
  await expect
    .poll(async () => {
      view = await page.evaluate(() => JSON.parse(localStorage.getItem("ways:prefs") ?? "{}").view);
      return view !== null;
    })
    .toBe(true);
  return view as unknown as { lng: number; lat: number; zoom: number };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("ways:lang")) localStorage.setItem("ways:lang", "en");
  });
  await fakeServices(page);
});

test.describe("a first visit from Berlin", () => {
  test.use({ timezoneId: "Europe/Berlin" });

  test("opens on Berlin, and offers the position", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("button", { name: /See what is around you/ })).toBeVisible();
    // The search ranks results near the centre of the map, and says where that is.
    const asked = page.waitForRequest((r) => r.url().startsWith("https://photon.komoot.io/api"));
    await page.getByPlaceholder("Search a place or a stop").fill("gare");
    const url = new URL((await asked).url());
    expect(Number(url.searchParams.get("lat"))).toBeCloseTo(52.52, 1);
    expect(Number(url.searchParams.get("lon"))).toBeCloseTo(13.4, 1);
  });
});

test.describe("a visit with the position already allowed", () => {
  test.use({
    timezoneId: "Europe/Berlin",
    permissions: ["geolocation"],
    geolocation: { latitude: 45.764, longitude: 4.8357 },
  });

  test("opens on where the user is", async ({ page }) => {
    await page.goto("./");
    await expect(page.locator(".me-dot")).toBeVisible();
    await expect
      .poll(async () => (await savedView(page)).lat, { timeout: 10_000 })
      .toBeCloseTo(45.76, 1);
    await expect(page.getByRole("button", { name: /See what is around you/ })).toHaveCount(0);
  });

  test("a link to a place keeps its own view", async ({ page }) => {
    await page.goto("./#/place/48.85840,2.29450,Tour%20Eiffel");
    await expect(page.getByRole("heading", { name: "Tour Eiffel" })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator(".me-dot")).toHaveCount(0);
  });
});
