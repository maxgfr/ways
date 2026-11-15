/**
 * Things the map and several screens do: find where the user is, and open
 * what is at a point pressed on the map.
 */
import { reverse } from "../geo/geocode";
import { t } from "../i18n";
import { toast } from "../ui/ui";
import { go, locating, pin, route, userAccuracy, userPosition } from "./state";

let watching = false;

/**
 * Asks for the user's position; `then` receives it, as [lng, lat]. The first
 * call is what makes the browser ask for permission, so it only ever follows a
 * press on a button that says so. Once allowed, the position is followed and
 * later calls answer at once.
 */
export function locate(then: (pos: [number, number]) => void): void {
  if (!navigator.geolocation) {
    toast(t("locate.unsupported"));
    return;
  }
  const known = userPosition.value;
  if (watching && known) {
    then(known);
    return;
  }
  if (locating.value) return;
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      locating.value = false;
      const pos: [number, number] = [p.coords.longitude, p.coords.latitude];
      userPosition.value = pos;
      userAccuracy.value = p.coords.accuracy;
      then(pos);
      if (!watching) {
        watching = true;
        navigator.geolocation.watchPosition(
          (w) => {
            userPosition.value = [w.coords.longitude, w.coords.latitude];
            userAccuracy.value = w.coords.accuracy;
          },
          (err) => {
            // Permission taken back while the app is open: stop showing a position that no
            // longer moves.
            if (err.code === err.PERMISSION_DENIED) {
              watching = false;
              userPosition.value = null;
              userAccuracy.value = null;
            }
          },
          { enableHighAccuracy: true, maximumAge: 15000 },
        );
      }
    },
    (err) => {
      locating.value = false;
      toast(
        err.code === err.PERMISSION_DENIED
          ? t("locate.denied")
          : err.code === err.TIMEOUT
            ? t("locate.timeout")
            : t("locate.failed"),
        undefined,
        7000,
      );
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

/** Opens the card of a point pressed on the map, then fills in what is found there. */
export async function openPointAt(lat: number, lng: number): Promise<void> {
  pin.value = { lat, lng };
  go({ name: "place", point: { lat, lng, name: "" } });
  try {
    const found = await reverse(lat, lng);
    const r = route.value;
    // Still on the same card: give it the name and the place found there.
    if (!found || r.name !== "place" || r.point.lat !== lat || r.point.lng !== lng) return;
    go(
      {
        name: "place",
        point: { lat, lng, name: found.address ? `${found.name}, ${found.address}` : found.name },
        ...(found.osm ? { osm: found.osm } : {}),
      },
      { replace: true },
    );
  } catch {}
}
