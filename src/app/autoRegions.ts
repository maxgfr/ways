/**
 * Where automatic regions are triggered: the places, stops and trip ends the
 * user opens, and their position. Once a region arrives, a trip waiting for it
 * is asked again and a toast says what was downloaded, with an undo.
 */
import { effect } from "@preact/signals";
import { t } from "../i18n";
import { interestIn, refreshHeld } from "../local/auto";
import { type RegionInfo, remove } from "../local/packs";
import { toast } from "../ui/ui";
import { autoRegions } from "./prefs";
import { route, userPosition } from "./state";
import { retryTrips } from "./trips";

function fetched(region: RegionInfo, update: boolean): void {
  if (route.peek().name === "dir") retryTrips();
  if (update) return;
  toast(
    t("regions.auto", { name: region.name }),
    { label: t("action.undo"), run: () => void remove(region.id) },
    7000,
  );
}

/** Starts watching. Returns how to stop. */
export function startAutoRegions(): () => void {
  let lastPosition = "";
  const stopRoute = effect(() => {
    const r = route.value;
    if (!autoRegions.value) return;
    const points =
      r.name === "place" || r.name === "stop"
        ? [r.point]
        : r.name === "dir"
          ? [r.from, r.to].filter((p) => p !== null)
          : [];
    for (const p of points) void interestIn(p.lat, p.lng, { onFetched: fetched });
  });
  const stopPosition = effect(() => {
    const pos = userPosition.value;
    if (!pos || !autoRegions.value) return;
    // The position moves all the time: one look per kilometre or so is enough.
    const key = `${pos[1].toFixed(2)},${pos[0].toFixed(2)}`;
    if (key === lastPosition) return;
    lastPosition = key;
    void interestIn(pos[1], pos[0], { onFetched: fetched });
  });
  if (autoRegions.peek()) void refreshHeld({ onFetched: fetched });
  return () => {
    stopRoute();
    stopPosition();
  };
}
