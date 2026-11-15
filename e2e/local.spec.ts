import { expect, type Page, test } from "@playwright/test";
import { fakeServices, setUp } from "./helpers";

/**
 * Local mode, end to end, on Testville: a made-up region built by
 * data/fixture.ts and served beside the site like a real one. The trips below
 * are computed in the browser; the fake services are there to prove that none
 * of them is asked anything.
 */
const GARE = "48.00000,-1.02000,Gare";
const PLAGE = "48.02000,-1.00000,Plage";

test.beforeEach(async ({ page }) => {
  await setUp(page, { view: { lng: -1.01, lat: 48.01, zoom: 13 } });
});

async function download(page: Page): Promise<void> {
  await page.goto("./#/settings");
  const region = page.locator(".region", { hasText: "Testville" });
  await expect(region).toContainText("Testville Transit (made up), OpenStreetMap contributors");
  await region.getByRole("button", { name: "Download" }).click();
  await expect(page.getByText("Testville is on this device.")).toBeVisible();
  await expect(region).toContainText(/on this device · timetables until/);
}

/** Tomorrow at 09:00: the timetable runs all day, so the trips are known. */
async function leaveTomorrowAtNine(page: Page): Promise<void> {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await page.getByLabel("When").selectOption("depart");
  await page
    .getByLabel("Date and time")
    .fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`);
}

test("a region is downloaded, used with no service at all, then removed", async ({ page }) => {
  const fakes = await fakeServices(page);
  await download(page);
  await page.getByRole("button", { name: "Local", exact: true }).click();

  // Public transport, from the timetable on the device.
  await page.goto(`./#/dir/${GARE}/${PLAGE}/transit`);
  await leaveTomorrowAtNine(page);
  const first = page.locator(".itinerary").first();
  await expect(first).toContainText("09:00 – 09:17");
  await expect(first).toContainText("1 change");
  await expect(first).toContainText("scheduled");
  await expect(first).not.toContainText("live");
  await expect(page.getByText("Computed on this device. Nothing was sent.")).toBeVisible();

  await first.click();
  const legs = page.locator(".legs > li");
  await expect(legs.nth(0)).toContainText("Gare");
  await expect(legs.nth(0).locator(".line-name")).toHaveText("1");
  await expect(legs.nth(1)).toContainText("Mairie");
  await expect(legs.nth(1).locator(".line-name")).toHaveText("T");
  await expect(legs.nth(2)).toContainText("Plage");
  await page.getByRole("button", { name: "Back" }).click();

  // By bike, on the streets on the device.
  await page.getByRole("button", { name: "Bike", exact: true }).click();
  const ride = page.locator(".itinerary").first();
  await expect(ride).toContainText("10 min");
  await expect(ride).toContainText("2.7 km");
  await ride.click();
  await page.getByRole("button", { name: /steps?$/ }).click();
  await expect(page.getByText("Start onto Voie verte")).toBeVisible();

  // The stops of the region can be searched.
  await page.goto("./");
  await page.getByPlaceholder("Search a place or a stop").fill("plag");
  await expect(page.getByRole("button", { name: /^Plage/ })).toBeVisible();

  expect(fakes.calls).toEqual([]);

  await page.goto("./#/settings");
  await page
    .locator(".region", { hasText: "Testville" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText("Testville removed.")).toBeVisible();
  await page.goto(`./#/dir/${GARE}/${PLAGE}/bike`);
  await expect(
    page.getByText(/Local mode: no region on this device covers this trip\./),
  ).toBeVisible();
});

test("in Auto, the device answers when the services do not", async ({ page }) => {
  const fakes = await fakeServices(page);
  await download(page);
  fakes.down.add("transitous");
  fakes.down.add("valhalla");

  await page.goto(`./#/dir/${GARE}/${PLAGE}/transit`);
  await leaveTomorrowAtNine(page);
  await expect(page.locator(".itinerary").first()).toContainText("09:00 – 09:17");
  await expect(
    page.getByText("Transitous did not answer; these trips come from another service."),
  ).toBeVisible();
  await expect(page.getByText("Computed on this device. Nothing was sent.")).toBeVisible();
});

test("in Auto, the services are asked first, and a trip outside the region is theirs", async ({
  page,
}) => {
  const fakes = await fakeServices(page);
  await download(page);
  await page.goto(`./#/dir/${GARE}/${PLAGE}/transit`);
  await expect(page.getByText("Computed by Transitous (api.transitous.org).")).toBeVisible();
  expect(fakes.calls.filter((c) => c.endsWith("/plan"))).toHaveLength(1);
});

test("a downloaded region survives a reload", async ({ page }) => {
  await fakeServices(page);
  await download(page);
  await page.reload();
  const region = page.locator(".region", { hasText: "Testville" });
  await expect(region).toContainText(/on this device/);
  await expect(region.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(region.getByRole("button", { name: "Download" })).toHaveCount(0);
});
