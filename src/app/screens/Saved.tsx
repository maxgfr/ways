/** Saved places and stops, kept in this browser. */
import { useEffect } from "preact/hooks";
import { t } from "../../i18n";
import { saved, unsave } from "../../store/store";
import { IconButton, ScreenHead, toast } from "../../ui/ui";
import { openPlace } from "../nav";
import { requestSnap } from "../Sheet";
import { PlaceRow } from "./Home";

export function Saved() {
  useEffect(() => requestSnap("half"), []);
  return (
    <div class="stack">
      <ScreenHead title={t("saved.title")} />
      {saved.value.length === 0 ? (
        <p class="muted">{t("saved.empty")}</p>
      ) : (
        <ul class="rows">
          {saved.value.map((s) => (
            <li key={s.id} class="row-with-action">
              <PlaceRow
                icon={s.kind === "stop" ? "bus" : "save"}
                label={s.point.name}
                onClick={() => openPlace(s.kind, s.point, s.osm)}
              />
              <IconButton
                icon="trash"
                label={t("saved.remove", { name: s.point.name })}
                onClick={() => {
                  unsave(s.point);
                  toast(t("saved.removed"));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <p class="source-note">{t("saved.note")}</p>
    </div>
  );
}
