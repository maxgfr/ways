/**
 * The app: the map, the search field floating over it with category shortcuts
 * under it, the floating controls (layers, my position), and the panel holding
 * the current screen.
 */
import { t } from "../i18n";
import { rentalsStatus } from "../map/layers/rentals";
import { stopsStatus } from "../map/layers/stops";
import { vehiclesStatus } from "../map/layers/vehicles";
import { MapView, sheetInset, showPoint } from "../map/MapView";
import { CATEGORIES } from "../map/places";
import { Icon } from "../ui/icons";
import { Toasts } from "../ui/ui";
import { locate } from "./actions";
import { directionsTo, openHit } from "./nav";
import { PointPicker } from "./PointPicker";
import { layers } from "./prefs";
import { currentSnap, Sheet } from "./Sheet";
import { Category } from "./screens/Category";
import { Directions } from "./screens/Directions";
import { Home } from "./screens/Home";
import { Layers, layerNote } from "./screens/Layers";
import { Place } from "./screens/Place";
import { Saved } from "./screens/Saved";
import { Settings } from "./screens/Settings";
import { Sources } from "./screens/Sources";
import { Stop } from "./screens/Stop";
import { back, go, locating, route, userPosition } from "./state";

function Screen() {
  const r = route.value;
  switch (r.name) {
    case "place":
      return <Place point={r.point} {...(r.osm ? { osm: r.osm } : {})} />;
    case "stop":
      return <Stop point={r.point} />;
    case "dir":
      return <Directions r={r} />;
    case "category":
      return <Category id={r.id} />;
    case "saved":
      return <Saved />;
    case "layers":
      return <Layers />;
    case "settings":
      return <Settings />;
    case "sources":
      return <Sources />;
    default:
      return <Home />;
  }
}

/**
 * Category shortcuts under the search field, as a map app has them. The layer
 * switches live behind the layers button; a layer that is on and has nothing
 * to show at this zoom says so here.
 */
function Chips() {
  const on = layers.value;
  const r = route.value;
  const notes = [
    on.transit ? layerNote(stopsStatus.value) : "",
    on.rentals ? layerNote(rentalsStatus.value) : "",
    on.vehicles ? layerNote(vehiclesStatus.value) : "",
  ].filter(Boolean);
  return (
    <div class="chips-wrap">
      <fieldset class="chips" aria-label={t("cat.title")}>
        {CATEGORIES.map((c) => {
          const active = r.name === "category" && r.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              class="chip"
              aria-pressed={active}
              onClick={() => (active ? back() : go({ name: "category", id: c.id }))}
            >
              <Icon name={c.icon} size={16} />
              {t(c.label)}
            </button>
          );
        })}
      </fieldset>
      {notes[0] && (
        <p class="chips-note" role="status">
          {notes[0]}
        </p>
      )}
    </div>
  );
}

export function App() {
  const r = route.value;
  const wide = sheetInset.value.left > 0;
  // On a wide screen the buttons sit above the zoom buttons and the attribution.
  const floatBottom = wide ? 104 : sheetInset.value.bottom + 14;
  const hideFloat = !wide && sheetInset.value.bottom > window.innerHeight * 0.6;
  // The directions screen has its own two fields; the search steps aside for it.
  const searching = r.name !== "dir";

  return (
    <div class="app" data-sheet={wide ? "side" : currentSnap.value} data-route={r.name}>
      <MapView />
      <div class="top">
        {searching && (
          <div class="search">
            <PointPicker
              id="search"
              label={t("search.label")}
              placeholder={t("search.placeholder")}
              onPick={openHit}
            >
              <button
                type="button"
                class="search-go"
                aria-label={t("action.directions")}
                title={t("action.directions")}
                onClick={() => directionsTo(null)}
              >
                <Icon name="directions" size={20} />
              </button>
            </PointPicker>
          </div>
        )}
        <Chips />
      </div>
      {!hideFloat && (
        <div class="float" style={{ bottom: `${floatBottom}px` }}>
          <button
            type="button"
            class="round-btn"
            aria-label={t("layers.title")}
            title={t("layers.title")}
            aria-pressed={r.name === "layers"}
            onClick={() => (r.name === "layers" ? go({ name: "home" }) : go({ name: "layers" }))}
          >
            <Icon name="layers" size={21} />
          </button>
          <button
            type="button"
            class="round-btn"
            aria-label={t("locate.label")}
            title={t("locate.label")}
            aria-pressed={userPosition.value !== null}
            aria-busy={locating.value}
            onClick={() => locate((pos) => showPoint(pos[0], pos[1], 15))}
          >
            {locating.value ? (
              <Icon name="spinner" size={21} class="spin" />
            ) : (
              <Icon name="locate" size={21} />
            )}
          </button>
        </div>
      )}
      <Sheet>
        <Screen />
      </Sheet>
      <Toasts />
    </div>
  );
}
