/**
 * The resting screen: shortcuts, what the user kept, and the stops around the
 * centre of the map as a list (everything on the map is also reachable here).
 */
import { useEffect } from "preact/hooks";
import { distance } from "../../geo/polyline";
import { formatDistance, t } from "../../i18n";
import { stopsInView, stopsStatus } from "../../map/layers/stops";
import { mapCenter, showPoint } from "../../map/MapView";
import { recents, saved, storageError } from "../../store/store";
import { Icon, type IconName, vehicleIcon } from "../../ui/icons";
import { locate } from "../actions";
import { directionsTo, openPlace } from "../nav";
import { requestSnap } from "../Sheet";
import { labelParts } from "../search";
import { go, locating, userPosition } from "../state";

function Shortcut({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" class="shortcut" onClick={onClick}>
      <span class="shortcut-icon">
        <Icon name={icon} size={20} />
      </span>
      {label}
    </button>
  );
}

export function PlaceRow({
  icon,
  label,
  meta,
  onClick,
}: {
  icon: IconName;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  const [name, rest] = labelParts(label);
  const second = [rest, meta].filter(Boolean).join(" · ");
  return (
    <button type="button" class="row-btn" onClick={onClick}>
      <span class="row-icon">
        <Icon name={icon} size={18} />
      </span>
      <span class="row-text">
        <span class="row-name">{name}</span>
        {second && <span class="row-meta">{second}</span>}
      </span>
    </button>
  );
}

export function Home() {
  useEffect(() => requestSnap("peek"), []);
  const here = mapCenter.value;
  const near = [...stopsInView.value]
    .map((s) => ({ stop: s, d: distance(here, [s.lng, s.lat]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  const status = stopsStatus.value;

  return (
    <div class="stack">
      <div class="shortcuts">
        <Shortcut
          icon="directions"
          label={t("home.directions")}
          onClick={() => directionsTo(null)}
        />
        <Shortcut icon="save" label={t("home.saved")} onClick={() => go({ name: "saved" })} />
        <Shortcut icon="layers" label={t("home.layers")} onClick={() => go({ name: "layers" })} />
        <Shortcut
          icon="settings"
          label={t("home.settings")}
          onClick={() => go({ name: "settings" })}
        />
      </div>

      {storageError.value && <p class="notice">{t("store.error")}</p>}

      {!userPosition.value && (
        <button
          type="button"
          class="row-btn locate-row"
          disabled={locating.value}
          onClick={() => locate((pos) => showPoint(pos[0], pos[1], 15))}
        >
          <span class="row-icon">
            <Icon
              name={locating.value ? "spinner" : "locate"}
              size={18}
              {...(locating.value ? { class: "spin" } : {})}
            />
          </span>
          <span class="row-text">
            <span class="row-name">{t("home.locate")}</span>
            <span class="row-meta">{t("home.locate.hint")}</span>
          </span>
        </button>
      )}

      {saved.value.length > 0 && (
        <section>
          <h3 class="section-title">{t("home.savedTitle")}</h3>
          <ul class="rows">
            {saved.value.slice(0, 4).map((s) => (
              <li key={s.id}>
                <PlaceRow
                  icon={s.kind === "stop" ? "bus" : "save"}
                  label={s.point.name}
                  onClick={() => openPlace(s.kind, s.point, s.osm)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {recents.value.length > 0 && (
        <section>
          <h3 class="section-title">{t("home.recent")}</h3>
          <ul class="rows">
            {recents.value.slice(0, 5).map((r) => (
              <li key={`${r.point.lat},${r.point.lng},${r.at}`}>
                <PlaceRow
                  icon="recent"
                  label={r.point.name}
                  onClick={() => openPlace(r.kind, r.point, r.osm)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 class="section-title">{t("home.nearby")}</h3>
        {near.length > 0 ? (
          <ul class="rows">
            {near.map(({ stop, d }) => (
              <li key={stop.id}>
                <PlaceRow
                  icon={vehicleIcon(stop.vehicles[0] ?? "bus")}
                  label={stop.name}
                  meta={formatDistance(d)}
                  onClick={() =>
                    openPlace("stop", {
                      lat: stop.lat,
                      lng: stop.lng,
                      name: stop.name,
                      ...(stop.whole ? { stopId: stop.id } : {}),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">
            {status === "off"
              ? t("home.nearby.off")
              : status === "local"
                ? t("layer.local")
                : status === "far"
                  ? t("home.nearby.far")
                  : status === "error"
                    ? t("home.nearby.error")
                    : status === "loading"
                      ? t("state.loading")
                      : t("home.nearby.none")}
          </p>
        )}
      </section>

      <p class="source-note">
        {t("home.local")}{" "}
        <button type="button" class="text-link" onClick={() => go({ name: "sources" })}>
          {t("home.local.more")}
        </button>
      </p>
    </div>
  );
}
