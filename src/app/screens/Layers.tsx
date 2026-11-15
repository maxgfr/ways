/** What the map shows on top of the basemap, each with where it comes from. */
import { useEffect } from "preact/hooks";
import { type MessageKey, t } from "../../i18n";
import { rentalsStatus } from "../../map/layers/rentals";
import { stopsStatus } from "../../map/layers/stops";
import { vehiclesStatus } from "../../map/layers/vehicles";
import { ScreenHead, Toggle } from "../../ui/ui";
import { type Layers as LayerSet, layers, toggleLayer } from "../prefs";
import { requestSnap } from "../Sheet";

type Status = "off" | "far" | "local" | "loading" | "ready" | "error";

const ROWS: { id: keyof LayerSet; label: MessageKey; hint: MessageKey }[] = [
  { id: "places", label: "layer.places", hint: "layer.places.hint" },
  { id: "transit", label: "layer.transit", hint: "layer.transit.hint" },
  { id: "cycling", label: "layer.cycling", hint: "layer.cycling.hint" },
  { id: "rentals", label: "layer.rentals", hint: "layer.rentals.hint" },
  { id: "vehicles", label: "layer.vehicles", hint: "layer.vehicles.hint" },
];

/** What a layer says when it is on and nothing shows. */
export function layerNote(status: Status): string {
  if (status === "far") return t("layer.zoomIn");
  if (status === "local") return t("layer.local");
  if (status === "error") return t("layer.error");
  return "";
}

export function Layers() {
  useEffect(() => requestSnap("half"), []);
  const on = layers.value;
  const status: Record<keyof LayerSet, Status> = {
    places: "ready",
    transit: stopsStatus.value,
    cycling: "ready",
    rentals: rentalsStatus.value,
    vehicles: vehiclesStatus.value,
  };
  return (
    <div class="stack">
      <ScreenHead title={t("layers.title")} />
      <div class="toggles">
        {ROWS.map((row) => {
          const note = on[row.id] ? layerNote(status[row.id]) : "";
          return (
            <Toggle
              key={row.id}
              label={t(row.label)}
              hint={note ? `${t(row.hint)} ${note}` : t(row.hint)}
              checked={on[row.id]}
              onChange={() => toggleLayer(row.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
