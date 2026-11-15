import { expect, type Page, test } from "@playwright/test";
import { fakeServices, setUp } from "./helpers";

/**
 * Offline data, end to end, on Testville: a made-up area built by
 * data/fixture.ts and served at /ways-data/ like the real data. It arrives on
 * its own when the user looks something up there; trips are then computed in
 * the browser. The fake services prove that local mode asks them nothing.
 */
const GARE = "48.00000,-1.02000,Gare";
const PLAGE = "48.02000,-1.00000,Plage";
const ARRIVED = "Offline data for Testville is now on this device.";

test.beforeEach(async ({ page }) => {
  await setUp(page, { view: { lng: -1.01, lat: 48.01, zoom: 13 } });
});

/** Tomorrow at 09:00: the timetable runs all day, so the trips are known. */
async function leaveTomorrowAtNine(page: Page): Promise<void> {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await page.getByLabel("When").selectOption("depart");
  await page
    .getByLabel("Date and time")
    .fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`);
}

test("looking a place up downloads its area, which then works with no service", async ({
  page,
}) => {
  const fakes = await fakeServices(page);
  await page.goto(`./#/place/${PLAGE}`);
  await expect(page.getByText(ARRIVED)).toBeVisible();

  await page.goto("./#/settings");
  const held = page.locator(".region", { hasText: "Testville" });
  await expect(held).toContainText(/on this device · timetables until/);
  await expect(held).toContainText("Testville Transit (made up), OpenStreetMap contributors");
  await page.getByRole("button", { name: "Local", exact: true }).click();
  fakes.calls.length = 0;

  // Public transport, from the timetable on the device.
  await page.goto(`./#/dir/${GARE}/${PLAGE}/transit`);
  await leaveTomorrowAtNine(page);
  const first = page.locator(".itinerary").first();
  await expect(first).toContainText("09:00 – 09:17");
  await expect(first).toContainText("1 change");
  await expect(first).toContainText("scheduled");
  await expect(page.getByText("Computed on this device. Nothing was sent.")).toBeVisible();

  await first.click();
  const legs = page.locator(".legs > li");
  await expect(legs.nth(0)).toContainText("Gare");
  await expect(legs.nth(0).locator(".line-name")).toHaveText("1");
  await expect(legs.nth(1)).toContainText("Mairie");
  await expect(legs.nth(1).locator(".line-name")).toHaveText("T");
  await page.getByRole("button", { name: "Back" }).click();

  // By bike, on the streets on the device.
  await page.getByRole("button", { name: "Bike", exact: true }).click();
  const ride = page.locator(".itinerary").first();
  await expect(ride).toContainText("10 min");
  await expect(ride).toContainText("2.7 km");

  // The stops held offline can be searched.
  await page.goto("./");
  await page.getByPlaceholder("Search a place or a stop").fill("plag");
  await expect(page.getByRole("button", { name: /^Plage/ })).toBeVisible();

  expect(fakes.calls).toEqual([]);

  await page.goto("./#/settings");
  await held.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Testville removed.")).toBeVisible();
  await page.goto(`./#/dir/${GARE}/${PLAGE}/bike`);
  await expect(page.getByText(/there is no offline data on this device/)).toBeVisible();
});

test("the download can be undone at once", async ({ page }) => {
  await fakeServices(page);
  await page.goto(`./#/stop/${PLAGE}`);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.goto("./#/settings");
  await expect(page.getByText(/^Nothing yet\./)).toBeVisible();
});

test("with automatic downloads off, nothing arrives until asked for", async ({ page }) => {
  await setUp(page, { autoRegions: false, view: { lng: -1.01, lat: 48.01, zoom: 13 } });
  await fakeServices(page);
  await page.goto(`./#/place/${PLAGE}`);
  await page.waitForTimeout(1500);
  await expect(page.getByText(ARRIVED)).toHaveCount(0);

  await page.goto("./#/settings");
  await expect(page.getByRole("switch", { name: /Download automatically/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Download the area on screen" }).click();
  await expect(page.getByText("Testville is on this device.")).toBeVisible();
  await expect(page.locator(".region", { hasText: "Testville" })).toBeVisible();
});

test("where no data exists, the area button says so", async ({ page }) => {
  await setUp(page, { view: { lng: 2.35, lat: 48.86, zoom: 13 } });
  await fakeServices(page);
  await page.goto("./#/settings");
  await page.getByRole("button", { name: "Download the area on screen" }).click();
  await expect(page.getByText(/No offline data exists for this area yet\./)).toBeVisible();
});

test("in Auto, the device answers when the services do not", async ({ page }) => {
  const fakes = await fakeServices(page);
  fakes.down.add("transitous");
  fakes.down.add("valhalla");
  await page.goto(`./#/dir/${GARE}/${PLAGE}/transit`);
  await expect(page.getByText(ARRIVED)).toBeVisible();
  await leaveTomorrowAtNine(page);
  await expect(page.locator(".itinerary").first()).toContainText("09:00 – 09:17");
  await expect(page.getByText("Computed on this device. Nothing was sent.")).toBeVisible();
});

test("offline data survives a reload", async ({ page }) => {
  await fakeServices(page);
  await page.goto(`./#/place/${PLAGE}`);
  await expect(page.getByText(ARRIVED)).toBeVisible();
  await page.goto("./#/settings");
  await page.reload();
  await expect(page.locator(".region", { hasText: "Testville" })).toContainText(/on this device/);
});
