import { expect, test } from "@playwright/test";
import { fakeServices, GARE, KENNEDY, setUp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await setUp(page);
});

// The made-up drive runs straight from Gare to Kennedy; `along` is the share of the way done.
const at = (along: number) => ({
  latitude: 48.1032 + along * (48.1214 - 48.1032),
  longitude: -1.6727 + along * (-1.711 - -1.6727),
});

test("a trip can be followed: the next turn, what is left, and a new route when lost", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(at(0));
  const fakes = await fakeServices(page);
  await page.goto(`./#/dir/${GARE}/${KENNEDY}/car/0`);
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL(/#\/go$/);
  const next = page.locator(".guide-next");
  await expect(next).toContainText("Bike north on Rue de l'Alma.");
  await expect(page.locator(".guide-bar")).toContainText("arrive");
  await expect(page.getByRole("button", { name: "Spoken directions" })).toBeVisible();

  // A little further, the turn ahead and how far it is.
  await context.setGeolocation(at(0.03));
  await expect(next).toContainText("Turn left onto Boulevard de la Liberté.");
  await expect(page.locator(".guide-dist")).toHaveText(/\d+ m/);

  // Far off the road for three fixes: a new route is asked for.
  const before = fakes.valhalla.length;
  for (const lng of [-1.66, -1.6601, -1.6602, -1.6603]) {
    await context.setGeolocation({ latitude: 48.09, longitude: lng });
    await page.waitForTimeout(150);
  }
  await expect.poll(() => fakes.valhalla.length).toBeGreaterThan(before);

  // Exit goes back to the trip.
  await page.getByRole("button", { name: "Exit" }).click();
  await expect(page).toHaveURL(/#\/dir\//);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
});

test("the guidance address alone, as after a reload, opens the map", async ({ page }) => {
  await fakeServices(page);
  await page.goto("./#/go");
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByPlaceholder("Search a place or a stop")).toBeVisible();
});
