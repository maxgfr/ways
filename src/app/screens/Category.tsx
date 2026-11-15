/**
 * A category around here: the restaurants, cafés, pharmacies… in the area the
 * map shows, nearest to its centre first, read from the map's own tiles. The
 * list follows the map as it moves, and each place is a marker on it.
 */
import { useEffect, useState } from "preact/hooks";
import { formatDistance, lang, t } from "../../i18n";
import { categoryResults } from "../../map/layers/pois";
import { mapRef } from "../../map/MapView";
import { type CategoryId, categoryById, type FoundPlace, placesInView } from "../../map/places";
import { ScreenHead } from "../../ui/ui";
import { openPlace } from "../nav";
import { requestSnap } from "../Sheet";
import { PlaceRow } from "./Home";

/** Below this zoom the tiles hold too few places for a useful list: the map comes closer first. */
const LIST_ZOOM = 15;

export function Category({ id }: { id: CategoryId }) {
  const category = categoryById(id);
  const [found, setFound] = useState<FoundPlace[] | null>(null);

  useEffect(() => requestSnap("half"), [id]);

  useEffect(() => {
    const map = mapRef.value;
    if (!map || !category) return;
    const read = () => {
      const list = placesInView(map, category, lang.peek());
      setFound(list);
      categoryResults.value = list;
    };
    // Read once the tiles of the new view are in, and again each time the map settles.
    map.on("idle", read);
    if (map.getZoom() < LIST_ZOOM) {
      map.easeTo({
        zoom: LIST_ZOOM,
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500,
      });
    } else read();
    return () => {
      map.off("idle", read);
      categoryResults.value = [];
    };
  }, [id, mapRef.value]);

  if (!category) return null;
  return (
    <div class="stack">
      <ScreenHead title={t(category.label)} />
      {found === null && (
        <ul class="skeleton-rows" aria-label={t("state.loading")}>
          <li />
          <li />
          <li />
        </ul>
      )}
      {found !== null && found.length === 0 && <p class="muted">{t("cat.none")}</p>}
      {found !== null && found.length > 0 && (
        <ul class="rows">
          {found.map((p) => (
            <li key={`${p.name}${p.lat}${p.lng}`}>
              <PlaceRow
                icon={category.icon}
                label={p.name}
                meta={formatDistance(p.distance)}
                onClick={() => openPlace("place", { lat: p.lat, lng: p.lng, name: p.name })}
              />
            </li>
          ))}
        </ul>
      )}
      <p class="source-note">{t("cat.source")}</p>
    </div>
  );
}
