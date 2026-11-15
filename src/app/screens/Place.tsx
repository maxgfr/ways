/**
 * A place: its name and address, how far it is, the way there, and what
 * OpenStreetMap knows about it (opening hours, website, phone), looked up
 * once on Nominatim when the card opens.
 */
import { useEffect, useState } from "preact/hooks";
import { details, type PlaceDetails } from "../../geo/geocode";
import { distance } from "../../geo/polyline";
import { formatDistance, t } from "../../i18n";
import type { Point } from "../../providers/types";
import { isSaved, save, unsave } from "../../store/store";
import { Icon } from "../../ui/icons";
import { ScreenHead, shareLink } from "../../ui/ui";
import { directionsTo } from "../nav";
import { requestSnap } from "../Sheet";
import { labelParts } from "../search";
import { href, userPosition } from "../state";

export function PlaceActions({
  kind,
  point,
  osm,
}: {
  kind: "place" | "stop";
  point: Point;
  osm?: string;
}) {
  const kept = isSaved(point);
  const [name] = labelParts(point.name);
  return (
    <div class="actions">
      <button type="button" class="btn primary" onClick={() => directionsTo(point)}>
        <Icon name="directions" size={18} />
        {t("action.directions")}
      </button>
      <button
        type="button"
        class="btn"
        aria-pressed={kept}
        onClick={() => (kept ? unsave(point) : save(kind, point, osm))}
      >
        <Icon name={kept ? "check" : "save"} size={18} />
        {kept ? t("action.saved") : t("action.save")}
      </button>
      <button
        type="button"
        class="btn"
        onClick={() => {
          const link = new URL(location.href);
          link.hash =
            kind === "stop"
              ? href({ name: "stop", point })
              : href({ name: "place", point, ...(osm ? { osm } : {}) });
          void shareLink(name || "ways", link.href);
        }}
      >
        <Icon name="share" size={18} />
        {t("action.share")}
      </button>
    </div>
  );
}

export function Place({ point, osm }: { point: Point; osm?: string }) {
  const [info, setInfo] = useState<PlaceDetails | null>(null);
  useEffect(() => requestSnap("half"), [point.lat, point.lng]);
  useEffect(() => {
    setInfo(null);
    if (!osm) return;
    const controller = new AbortController();
    details(osm, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setInfo(d);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [osm]);

  const [name, rest] = labelParts(point.name);
  const me = userPosition.value;
  const coords = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  const hasInfo = info && Object.keys(info).length > 0;

  return (
    <div class="stack">
      <ScreenHead title={name || t("place.pinned")} />
      <div>
        {rest && <p class="lead">{rest}</p>}
        <p class="muted small">
          {[me ? formatDistance(distance(me, [point.lng, point.lat])) : "", coords]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <PlaceActions kind="place" point={point} {...(osm ? { osm } : {})} />
      {hasInfo && (
        <dl class="facts">
          {info.openingHours && (
            <>
              <dt>
                <Icon name="clock" size={18} />
                <span class="sr-only">{t("place.hours")}</span>
              </dt>
              <dd>{info.openingHours}</dd>
            </>
          )}
          {info.cuisine && (
            <>
              <dt>
                <Icon name="info" size={18} />
                <span class="sr-only">{t("place.cuisine")}</span>
              </dt>
              <dd>{info.cuisine}</dd>
            </>
          )}
          {info.phone && (
            <>
              <dt>
                <Icon name="phone" size={18} />
                <span class="sr-only">{t("place.phone")}</span>
              </dt>
              <dd>
                <a href={`tel:${info.phone.replace(/[^\d+]/g, "")}`}>{info.phone}</a>
              </dd>
            </>
          )}
          {info.website && (
            <>
              <dt>
                <Icon name="external" size={18} />
                <span class="sr-only">{t("place.website")}</span>
              </dt>
              <dd>
                <a href={info.website} target="_blank" rel="noopener noreferrer">
                  {new URL(info.website).host.replace(/^www\./, "")}
                </a>
              </dd>
            </>
          )}
          {info.wheelchair && (
            <>
              <dt>
                <Icon name="stepfree" size={18} />
                <span class="sr-only">{t("place.wheelchair")}</span>
              </dt>
              <dd>{t(`place.wheelchair.${info.wheelchair}`)}</dd>
            </>
          )}
        </dl>
      )}
      {osm && <p class="source-note">{t("place.source")}</p>}
    </div>
  );
}
