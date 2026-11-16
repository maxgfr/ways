import { expect, test } from "@playwright/test";
import { fakeServices, GARE, KENNEDY, REPUBLIQUE, setUp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await setUp(page);
});

test("opens on the map with the search and the category shortcuts", async ({ page }) => {
  await fakeServices(page);
  await page.goto("./");
  await expect(page.getByRole("application", { name: "Map" })).toBeVisible();
  await expect(page.getByPlaceholder("Search a place or a stop")).toBeVisible();
  const shortcuts = page.getByRole("group", { name: "Places nearby" });
  for (const name of ["Restaurants", "Cafés", "Groceries", "Pharmacies", "Hotels"]) {
    await expect(shortcuts.getByRole("button", { name })).toBeVisible();
  }
  // The stops on the map are also a list: platforms of one station appear once.
  await expect(page.getByRole("heading", { name: "Stops around here" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^République/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Parlement/ })).toHaveCount(1);
});

test("search finds stops and places, and opens a stop with its departures", async ({ page }) => {
  await fakeServices(page);
  await page.goto("./");
  await page.getByPlaceholder("Search a place or a stop").fill("republique");
  await page.getByRole("button", { name: /République Rennes/ }).click();

  await expect(page.getByRole("heading", { name: "République" })).toBeVisible();
  const departures = page.locator(".departures > li");
  await expect(departures).toHaveCount(3);
  // Live and late, timetable, cancelled: each says which it is in words.
  await expect(departures.nth(0)).toContainText("Kennedy");
  await expect(departures.nth(0)).toContainText("live");
  await expect(departures.nth(0)).toContainText("2 min late");
  await expect(departures.nth(0)).toContainText("4 min");
  await expect(departures.nth(1)).toContainText("scheduled");
  await expect(departures.nth(2)).toContainText("cancelled");
  await expect(page.getByText("Departures from Transitous (api.transitous.org)")).toBeVisible();

  // Opening a departure lists the rest of its run.
  await departures.nth(0).getByRole("button").click();
  await expect(page.locator(".calls")).toContainText("J.F. Kennedy");
});

test("an address typed in the search comes first, and Enter opens it", async ({ page }) => {
  await fakeServices(page);
  await page.goto("./");
  const field = page.getByPlaceholder("Search a place or a stop");
  await field.fill("10 rue de rivoli");
  const results = page.locator(".results .result");
  await expect(results.first()).toContainText("10 Rue de Rivoli");
  // The stop search answered République as well: it does not match the address, so it is left out.
  await expect(results.filter({ hasText: "République" })).toHaveCount(0);

  // Enter pressed before the results arrive waits for them.
  await field.fill("");
  await field.fill("rivoli 10");
  await field.press("Enter");
  await expect(page.getByRole("heading", { name: "10 Rue de Rivoli" })).toBeVisible();
});

test("a place shows what OpenStreetMap knows and where it came from", async ({ page }) => {
  await fakeServices(page);
  await page.goto("./");
  await page.getByPlaceholder("Search a place or a stop").fill("parlement");
  await page.getByRole("button", { name: /Parlement de Bretagne Place du Parlement/ }).click();

  await expect(page.getByRole("heading", { name: "Parlement de Bretagne" })).toBeVisible();
  await expect(page.getByText("Place du Parlement, 35000 Rennes")).toBeVisible();
  await expect(page.getByText("Mo-Fr 09:00-18:00")).toBeVisible();
  await expect(page.getByRole("link", { name: "example.org" })).toHaveAttribute(
    "href",
    "https://example.org/",
  );
  await expect(page.getByText("Wheelchair accessible")).toBeVisible();
  await expect(page.getByText(/looked up on nominatim\.openstreetmap\.org/)).toBeVisible();
});

test("saving keeps a place in this browser, across a reload", async ({ page }) => {
  await fakeServices(page);
  await page.goto(`./#/stop/${REPUBLIQUE}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto("./#/saved");
  await page.reload();
  await expect(page.getByRole("button", { name: /^République/ })).toBeVisible();
  await page.getByRole("button", { name: "Remove République, Rennes" }).click();
  await expect(page.getByText("Nothing saved yet.")).toBeVisible();
});

test("directions by transit: the list, then the trip leg by leg", async ({ page }) => {
  const fakes = await fakeServices(page);
  await page.goto(`./#/dir/${GARE}/${KENNEDY}/transit`);

  const row = page.locator(".itinerary").first();
  await expect(row).toContainText("15 min");
  await expect(row).toContainText("Direct");
  await expect(row).toContainText("live");
  await expect(page.getByText("Computed by Transitous (api.transitous.org).")).toBeVisible();
  expect(fakes.calls.filter((c) => c.endsWith("/plan"))).toHaveLength(1);

  await row.click();
  await expect(page).toHaveURL(/\/transit\/0$/);
  const legs = page.locator(".legs > li");
  await expect(legs).toHaveCount(4);
  // The ends carry the names the user chose, not the server's placeholders.
  await expect(legs.nth(0)).toContainText("Gare de Rennes");
  await expect(legs.nth(0)).toContainText("Walk");
  await expect(legs.nth(1)).toContainText("Gares");
  await expect(legs.nth(1)).toContainText("Kennedy");
  await expect(legs.nth(1)).toContainText("2 min late");
  await expect(legs.nth(1)).toContainText("platform 2");
  await expect(legs.nth(1)).toContainText("Lift out of service at Gares");
  await expect(legs.nth(3)).toContainText("Dalle Kennedy");

  await legs.nth(1).getByRole("button", { name: "2 stops" }).click();
  await expect(legs.nth(1)).toContainText("Charles de Gaulle");

  // Going back to the list does not ask the service again.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".itinerary").first()).toBeVisible();
  expect(fakes.calls.filter((c) => c.endsWith("/plan"))).toHaveLength(1);
});

test("directions by bike come from Valhalla, and the mode is remembered", async ({ page }) => {
  const fakes = await fakeServices(page);
  await page.goto(`./#/dir/${GARE}/${KENNEDY}/transit`);
  await expect(page.locator(".itinerary").first()).toBeVisible();

  await page.getByRole("button", { name: "Bike", exact: true }).click();
  const rows = page.locator(".itinerary");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("15 min");
  await expect(rows.first()).toContainText("4.4 km");
  await expect(rows.first()).toContainText("11 m climb");
  await expect(page.getByText(/Computed by Valhalla \(FOSSGIS\)/)).toBeVisible();
  expect(fakes.calls).toContain("valhalla /route");

  await rows.first().click();
  await page.getByRole("button", { name: "2 steps" }).click();
  await expect(page.getByText("Turn left onto Boulevard de la Liberté.")).toBeVisible();

  // The next trip opens by bike, after a reload too.
  await page.goto("./");
  await page.reload();
  await page.getByRole("button", { name: "Directions" }).first().click();
  await expect(page.getByRole("button", { name: "Bike", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("directions by car are driven by Valhalla, and can keep off tolls", async ({ page }) => {
  const fakes = await fakeServices(page);
  await page.goto(`./#/dir/${GARE}/${KENNEDY}/transit`);
  await expect(page.locator(".itinerary").first()).toBeVisible();

  await page.getByRole("button", { name: "Car", exact: true }).click();
  await expect(page).toHaveURL(/\/car$/);
  const rows = page.locator(".itinerary");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("4.4 km");
  expect(fakes.valhalla.at(-1)?.costing).toBe("auto");

  await page.getByText("Options").click();
  await page.getByText("Avoid tolls").click();
  await expect.poll(() => fakes.valhalla.at(-1)?.costing_options?.auto?.use_tolls).toBe(0);

  await rows.first().click();
  await expect(page.locator(".leg-title").first()).toHaveText("Drive");
});

test("choosing both ends with the search asks for one trip, not one per keystroke", async ({
  page,
}) => {
  const fakes = await fakeServices(page);
  await page.goto("./#/dir/-/-/walk");
  await expect(page.getByText("Choose a destination to see how to get there.")).toBeVisible();

  await page.getByPlaceholder("Choose a destination").fill("kennedy");
  await page.getByRole("button", { name: /Dalle Kennedy/ }).click();
  // No position and no start yet: the app asks, it does not guess.
  await expect(page.getByText(/Where do you start from\?/)).toBeVisible();
  expect(fakes.calls.filter((c) => c.startsWith("valhalla"))).toHaveLength(0);

  await page.getByPlaceholder("Choose a starting point").fill("gare");
  await page.getByRole("button", { name: /Gare de Rennes/ }).click();
  await expect(page.locator(".itinerary").first()).toContainText("15 min");
  expect(fakes.calls.filter((c) => c.startsWith("valhalla"))).toHaveLength(1);
  expect(fakes.calls.filter((c) => c.endsWith("/plan"))).toHaveLength(0);
});

test("my position can start a trip", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 48.1035, longitude: -1.6723 });
  await fakeServices(page);
  await page.goto(`./#/dir/-/${KENNEDY}/transit`);
  await page.getByRole("button", { name: "Use my position" }).click();
  await expect(page.locator(".itinerary").first()).toContainText("15 min");
  await expect(page.getByPlaceholder("Choose a starting point")).toHaveValue("My position");
});

test("when a service is down the screen names it and offers to try again", async ({ page }) => {
  const fakes = await fakeServices(page);
  fakes.down.add("transitous");
  await page.goto(`./#/dir/${GARE}/${KENNEDY}/transit`);
  await expect(page.getByText("Transitous did not answer.")).toBeVisible();

  fakes.down.delete("transitous");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".itinerary").first()).toContainText("15 min");
});

test("bike routing falls back to Transitous when Valhalla is down, and says so", async ({
  page,
}) => {
  const fakes = await fakeServices(page);
  fakes.down.add("valhalla");
  await page.goto(`./#/dir/${GARE}/${KENNEDY}/bike`);
  await expect(page.locator(".itinerary").first()).toContainText("20 min");
  await expect(
    page.getByText("Valhalla (FOSSGIS) did not answer; these trips come from another service."),
  ).toBeVisible();
  await expect(page.getByText("Computed by Transitous (api.transitous.org).")).toBeVisible();
});

test("when every routing service is down, each one is named", async ({ page }) => {
  const fakes = await fakeServices(page);
  fakes.down.add("valhalla");
  fakes.down.add("transitous");
  await page.goto(`./#/dir/${GARE}/${KENNEDY}/walk`);
  await expect(page.getByText("Valhalla (FOSSGIS), Transitous did not answer.")).toBeVisible();
});

test("settings: language, theme and mode are kept; local mode says no region", async ({ page }) => {
  await fakeServices(page);
  await page.goto("./#/settings");
  await page.getByRole("button", { name: "Français" }).click();
  await expect(page.getByRole("heading", { name: "Réglages" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");

  await page.getByRole("button", { name: "Sombre" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Réglages" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Local", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto(`./#/dir/${GARE}/${KENNEDY}/transit`);
  await expect(page.getByText(/n'a pas de données hors ligne pour ce trajet/)).toBeVisible();
});

test("a custom server address is validated and then used", async ({ page }) => {
  const fakes = await fakeServices(page);
  await page.route("https://motis.example.org/**", (route) => {
    fakes.calls.push("custom motis");
    return route.fulfill({
      json: { itineraries: [], direct: [] },
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("./#/settings");
  const field = page.getByLabel("MOTIS server (transit)");
  await field.fill("not an address");
  await field.blur();
  await expect(
    page.getByText("Enter an address that starts with https:// or http://"),
  ).toBeVisible();
  await field.fill("https://motis.example.org/");
  await field.blur();
  await expect(field).toHaveValue("https://motis.example.org");

  await page.goto(`./#/dir/${GARE}/${KENNEDY}/transit`);
  await expect(page.getByText(/No trip found/)).toBeVisible();
  expect(fakes.calls).toContain("custom motis");
  expect(fakes.calls.filter((c) => c.startsWith("transitous") && c.endsWith("/plan"))).toHaveLength(
    0,
  );
});

test("layers switch from the layers button, and are remembered", async ({ page }) => {
  const fakes = await fakeServices(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Layers", exact: true }).first().click();
  await expect(page.getByRole("switch", { name: /^Places/ })).toBeChecked();
  await expect(page.getByRole("switch", { name: /^Stops/ })).toBeChecked();
  await page.getByRole("switch", { name: /Shared bikes and scooters/ }).check();
  await expect.poll(() => fakes.calls.some((c) => c.endsWith("/rentals"))).toBe(true);

  const vehicles = page.getByRole("switch", { name: /Live vehicles/ });
  await expect(vehicles).not.toBeChecked();
  await vehicles.check();
  await expect.poll(() => fakes.calls.some((c) => c.endsWith("/map/trips"))).toBe(true);

  await page.reload();
  await expect(page.getByRole("switch", { name: /Live vehicles/ })).toBeChecked();
  await expect(page.getByRole("switch", { name: /Shared bikes and scooters/ })).toBeChecked();
});

test("the sources screen names every service the page talks to", async ({ page }) => {
  await fakeServices(page);
  await page.goto("./#/sources");
  for (const host of [
    "tiles.openfreemap.org",
    "api.transitous.org",
    "valhalla1.openstreetmap.de",
    "photon.komoot.io",
    "nominatim.openstreetmap.org",
    "maxgfr.github.io/ways/data",
  ]) {
    await expect(page.getByText(host, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Timetable sources and licences" })).toHaveAttribute(
    "href",
    "https://transitous.org/sources/",
  );
});

test("no request leaves for a routing service before the user asks for a trip", async ({
  page,
}) => {
  const fakes = await fakeServices(page);
  await page.goto("./");
  await page.getByPlaceholder("Search a place or a stop").fill("gare");
  await expect(page.getByRole("button", { name: /Gare de Rennes/ })).toBeVisible();
  expect(fakes.calls.filter((c) => c.endsWith("/plan") || c.startsWith("valhalla"))).toEqual([]);
});

test("the locate button asks for the position, shows it and says when it is refused", async ({
  page,
  context,
}) => {
  await fakeServices(page);
  await page.goto("./");
  // Refused: the message says what to do, and the app goes on working.
  await page.getByRole("button", { name: "Show my position" }).click();
  await expect(page.getByText(/Location is blocked for this site\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show my position" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 48.1105, longitude: -1.6793, accuracy: 40 });
  await page.getByRole("button", { name: "Show my position" }).click();
  await expect(page.locator(".me-dot")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show my position" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the home screen says what stays on the device and links to what leaves it", async ({
  page,
}) => {
  await fakeServices(page);
  await page.goto("./");
  await expect(
    page.getByText(/stay in this browser\. ways has no account and no server\./),
  ).toBeVisible();
  await page.getByRole("button", { name: "What leaves this device" }).click();
  await expect(page.getByRole("heading", { name: "Data sources" })).toBeVisible();
});

test("local mode calls no service at all", async ({ page }) => {
  const fakes = await fakeServices(page);
  await setUp(page, { engine: "device", layers: { transit: true, rentals: true, vehicles: true } });
  await page.goto("./");
  await expect(
    page.getByText("Not available in local mode: no service is called.").first(),
  ).toBeVisible();

  await page.getByPlaceholder("Search a place or a stop").fill("republique");
  await expect(
    page.getByText("Local mode: what you saved and the stops of your regions are searched."),
  ).toBeVisible();

  await page.goto(`./#/stop/${REPUBLIQUE}`);
  await expect(page.getByText(/Local mode: departures are not asked for\./)).toBeVisible();

  await page.goto(`./#/dir/${GARE}/${KENNEDY}/bike`);
  await expect(
    page.getByText(/Local mode: there is no offline data on this device for this trip/),
  ).toBeVisible();

  await page.goto("./#/place/48.11270,-1.67720,Parlement%20de%20Bretagne/N101");
  await expect(page.getByRole("heading", { name: "Parlement de Bretagne" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(fakes.calls).toEqual([]);
});

test("in local mode, the search offers to look addresses up online", async ({ page }) => {
  const fakes = await fakeServices(page);
  await setUp(page, { engine: "device" });
  await page.goto("./");
  const field = page.getByPlaceholder("Search a place or a stop");
  await field.fill("10 rue de rivoli");
  await expect(page.locator(".results .result")).toHaveCount(0);
  expect(fakes.calls).toEqual([]);

  await page.getByRole("button", { name: "Search addresses too (Auto mode)" }).click();
  await expect(page.locator(".results .result").first()).toContainText("10 Rue de Rivoli");
  // The choice is the setting itself: it stays after a reload.
  await page.goto("./#/settings");
  await page.reload();
  await expect(page.getByRole("button", { name: "Auto", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test.describe("a browser set to German", () => {
  test.use({ locale: "de-DE" });

  test("opens in German, and asks the search service in German", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("ways:lang"));
    await fakeServices(page);
    const asked = page.waitForRequest((r) => r.url().startsWith("https://photon.komoot.io/api"));
    await page.goto("./");
    await expect(page.getByPlaceholder("Ort oder Haltestelle suchen")).toBeVisible();
    await page.getByPlaceholder("Ort oder Haltestelle suchen").fill("parlement");
    expect(new URL((await asked).url()).searchParams.get("lang")).toBe("de");
    await page.goto("./#/settings");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deutsch" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test("a category lists what the map shows, from the map itself", async ({ page }) => {
  const fakes = await fakeServices(page);
  // The real map tiles of central Rennes: the list is read from them, not asked of anyone.
  await page.goto("./");
  await page
    .getByRole("group", { name: "Places nearby" })
    .getByRole("button", { name: "Restaurants" })
    .click();
  await expect(page).toHaveURL(/#\/category\/restaurant$/);
  await expect(page.getByRole("heading", { name: "Restaurants" })).toBeVisible();
  const rows = page.locator(".rows .row-btn");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  expect(await rows.count()).toBeGreaterThan(3);
  await expect(
    page.getByText(/read from the map already on screen: nothing is sent/),
  ).toBeVisible();
  // Only the stops layer, which is on, asked anything: the list itself asked no search service.
  expect(fakes.calls.filter((c) => !c.startsWith("transitous /api/v6/map/"))).toEqual([]);

  // A place of the list opens its card, whose details are looked up by name.
  const first = (await rows.first().locator(".row-name").textContent()) ?? "";
  await rows.first().click();
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
  await expect.poll(() => fakes.calls.some((c) => c.startsWith("photon"))).toBe(true);
});
