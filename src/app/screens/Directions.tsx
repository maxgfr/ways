/**
 * Directions: both ends, the mode, when, and the trips found. Opening a trip
 * shows it leg by leg. The stroke beside each leg is the one drawn on the map:
 * solid for a line, dashes by bike, dots on foot.
 */
import { useEffect, useState } from "preact/hooks";
import { formatDistance, formatDuration, formatTime, plural, t } from "../../i18n";
import { strokeOf } from "../../map/layers/route";
import type { Itinerary, Leg, Point } from "../../providers/types";
import { Icon, type IconName, vehicleIcon } from "../../ui/icons";
import { LineBadge, ScreenHead, Segmented, Toggle } from "../../ui/ui";
import { locate } from "../actions";
import { startGuidance } from "../guidance";
import { fullLabel } from "../nav";
import { type Extra, PointPicker } from "../PointPicker";
import { setTravel, TRAVEL_MODES, type TravelMode, travel } from "../prefs";
import { requestSnap } from "../Sheet";
import { labelParts } from "../search";
import { go, locating, type Route, userPosition, type When, when } from "../state";
import { resolveFrom, retryTrips, trips } from "../trips";
import { Alerts } from "./Stop";

type DirRoute = Extract<Route, { name: "dir" }>;

export const MODE_ICON: Record<TravelMode, IconName> = {
  transit: "bus",
  car: "car",
  bike: "bike",
  walk: "foot",
};

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Ends({ r }: { r: DirRoute }) {
  const me = userPosition.value;
  const mine: Extra = {
    key: "me",
    icon: "locate",
    label: t("dir.myPosition"),
    run: () => {
      go({ ...r, from: null, pick: null }, { replace: true });
      if (!userPosition.value) locate(() => {});
    },
  };
  const pick = (end: "from" | "to") => (hit: { point: Point; meta: string }) =>
    go(
      { ...r, [end]: { ...hit.point, name: fullLabel(hit.point.name, hit.meta) }, pick: null },
      { replace: true },
    );
  const fromText = r.from ? labelParts(r.from.name)[0] : me ? t("dir.myPosition") : "";
  return (
    <div class="ends">
      <button
        type="button"
        class="icon-btn"
        aria-label={t("action.back")}
        onClick={() => go({ name: "home" })}
      >
        <Icon name="back" />
      </button>
      <div class="ends-fields">
        <PointPicker
          id="dir-from"
          label={t("dir.from")}
          placeholder={t("dir.from.placeholder")}
          value={fromText}
          icon="locate"
          extras={[mine]}
          onPick={pick("from")}
        />
        <PointPicker
          id="dir-to"
          label={t("dir.to")}
          placeholder={t("dir.to.placeholder")}
          value={r.to ? labelParts(r.to.name)[0] : ""}
          icon="pin"
          onPick={pick("to")}
          {...(r.to ? {} : { focusKey: 1 })}
        />
      </div>
      <button
        type="button"
        class="icon-btn"
        aria-label={t("dir.swap")}
        title={t("dir.swap")}
        onClick={() => {
          const start = resolveFrom(r.from, me);
          go({ ...r, from: r.to, to: start, pick: null }, { replace: true });
        }}
      >
        <Icon name="swap" />
      </button>
    </div>
  );
}

function WhenControl() {
  const w = when.value;
  const set = (next: When) => {
    when.value = next;
  };
  return (
    <div class="when">
      <label class="select">
        <span class="sr-only">{t("dir.when")}</span>
        <select
          value={w.kind}
          onChange={(e) => {
            const kind = e.currentTarget.value as When["kind"];
            set({ kind, time: kind === "now" ? 0 : w.time || Date.now() });
          }}
        >
          <option value="now">{t("dir.when.now")}</option>
          <option value="depart">{t("dir.when.depart")}</option>
          <option value="arrive">{t("dir.when.arrive")}</option>
        </select>
        <Icon name="down" size={16} />
      </label>
      {w.kind !== "now" && (
        <input
          type="datetime-local"
          class="field"
          aria-label={t("dir.when.time")}
          value={toLocalInput(w.time)}
          onChange={(e) => {
            const ms = new Date(e.currentTarget.value).getTime();
            if (Number.isFinite(ms)) set({ kind: w.kind, time: ms });
          }}
        />
      )}
    </div>
  );
}

function Options({ mode }: { mode: TravelMode }) {
  const p = travel.value;
  return (
    <details class="options">
      <summary>
        {t("dir.options")}
        <Icon name="down" size={16} />
      </summary>
      <div class="options-body">
        {mode === "car" ? (
          <>
            <Toggle
              label={t("pref.avoidTolls")}
              checked={p.avoidTolls}
              onChange={(avoidTolls) => setTravel({ avoidTolls })}
            />
            <Toggle
              label={t("pref.avoidMotorways")}
              checked={p.avoidMotorways}
              onChange={(avoidMotorways) => setTravel({ avoidMotorways })}
            />
          </>
        ) : mode === "bike" ? (
          <Toggle
            label={t("pref.avoidHills")}
            hint={t("pref.avoidHills.hint")}
            checked={p.avoidHills}
            onChange={(avoidHills) => setTravel({ avoidHills })}
          />
        ) : (
          <>
            <Toggle
              label={t("pref.stepFree")}
              hint={t("pref.stepFree.hint")}
              checked={p.stepFree}
              onChange={(stepFree) => setTravel({ stepFree })}
            />
            {mode === "walk" && (
              <Segmented
                label={t("pref.pace")}
                value={p.pace}
                options={[
                  { id: "slow", label: t("pref.pace.slow") },
                  { id: "normal", label: t("pref.pace.normal") },
                  { id: "fast", label: t("pref.pace.fast") },
                ]}
                onChange={(pace) => setTravel({ pace })}
              />
            )}
          </>
        )}
        <p class="muted small">{t("pref.kept")}</p>
      </div>
    </details>
  );
}

/** The legs worth showing in a summary: rides, and any stretch on foot over two minutes. */
export function mainLegs(it: Itinerary): Leg[] {
  const legs = it.legs.filter((l) => l.kind !== "walk" || l.duration >= 120);
  return legs.length > 0 ? legs : it.legs.slice(0, 1);
}

function LegChip({ leg }: { leg: Leg }) {
  if (leg.kind === "transit" && leg.line)
    return <LineBadge line={leg.line} vehicle={leg.vehicle} />;
  return (
    <span class="leg-chip">
      <Icon name={vehicleIcon(leg.vehicle)} size={16} />
      {formatDuration(leg.duration)}
    </span>
  );
}

function transfersText(n: number): string {
  return n === 0 ? t("dir.direct") : plural(n, "dir.transfers.one", "dir.transfers.other");
}

function isLive(it: Itinerary): boolean {
  return it.legs.some((l) => l.kind === "transit" && l.realTime);
}

function ItineraryRow({ it, onOpen }: { it: Itinerary; onOpen: () => void }) {
  const tz = it.legs[0]?.from.tz;
  const transit = it.legs.some((l) => l.kind === "transit");
  const distance = it.legs.reduce((sum, l) => sum + (l.distance ?? 0), 0);
  const ascent = it.legs.reduce((sum, l) => sum + (l.ascent ?? 0), 0);
  return (
    <li>
      <button type="button" class="itinerary" onClick={onOpen}>
        <span class="itinerary-main">
          <span class="itinerary-legs">
            {mainLegs(it).map((leg, i) => (
              <span key={`${leg.start}${i}`} class="itinerary-leg">
                {i > 0 && <Icon name="next" size={14} class="sep" />}
                <LegChip leg={leg} />
              </span>
            ))}
          </span>
          <span class="itinerary-meta">
            {formatTime(it.start, tz)} – {formatTime(it.end, tz)}
            {transit ? (
              <>
                {" · "}
                {transfersText(it.transfers)}
                {" · "}
                {isLive(it) ? (
                  <span class="live">
                    <Icon name="live" size={14} />
                    {t("stop.live")}
                  </span>
                ) : (
                  t("stop.scheduled")
                )}
              </>
            ) : (
              <>
                {distance > 0 && ` · ${formatDistance(distance)}`}
                {ascent > 0 && ` · ${t("dir.ascent", { n: ascent })}`}
              </>
            )}
          </span>
        </span>
        <span class="itinerary-duration">{formatDuration(it.duration)}</span>
      </button>
    </li>
  );
}

function OriginNote({ it }: { it: Itinerary }) {
  return (
    <p class="source-note">
      {it.origin.host === "device"
        ? t("dir.origin.device")
        : t("dir.origin", { service: it.origin.name, host: it.origin.host })}
    </p>
  );
}

function LegBlock({ leg }: { leg: Leg }) {
  const [open, setOpen] = useState(false);
  const stroke = strokeOf(leg);
  const tz = leg.from.tz;
  const railStyle =
    leg.kind === "transit" && leg.line?.color ? { "--rail": leg.line.color } : undefined;
  const title =
    leg.kind === "transit"
      ? (leg.headsign ?? leg.line?.longName ?? "")
      : leg.kind === "walk"
        ? t("leg.walk")
        : leg.kind === "bike"
          ? t("leg.bike")
          : leg.kind === "rental"
            ? leg.rentalProvider
              ? t("leg.rentalWith", { provider: leg.rentalProvider })
              : t("leg.rental")
            : t("leg.car");
  const late = Math.round((leg.start - leg.scheduledStart) / 60000);
  const hasMore = leg.kind === "transit" ? leg.stops.length > 0 : leg.steps.length > 0;
  return (
    <li class={leg.cancelled ? "leg cancelled" : "leg"}>
      <span class="leg-time">{formatTime(leg.start, tz)}</span>
      <span class={`leg-rail ${stroke}`} style={railStyle as Record<string, string> | undefined} />
      <div class="leg-body">
        <p class="leg-place">{leg.from.name}</p>
        <div class="leg-ride">
          {leg.kind === "transit" && leg.line ? (
            <LineBadge line={leg.line} vehicle={leg.vehicle} />
          ) : (
            <Icon name={vehicleIcon(leg.vehicle)} size={18} />
          )}
          <span class="leg-title">{title}</span>
        </div>
        <p class="leg-meta">
          {formatDuration(leg.duration)}
          {leg.distance !== undefined &&
            leg.kind !== "transit" &&
            ` · ${formatDistance(leg.distance)}`}
          {leg.ascent !== undefined && leg.ascent > 0 && ` · ${t("dir.ascent", { n: leg.ascent })}`}
          {leg.kind === "transit" &&
            leg.from.track &&
            ` · ${t("stop.track", { track: leg.from.track })}`}
          {leg.kind === "transit" &&
            (leg.cancelled ? (
              ` · ${t("stop.cancelled")}`
            ) : leg.realTime ? (
              <>
                {" · "}
                <span class="live">
                  <Icon name="live" size={14} />
                  {t("stop.live")}
                </span>
                {late >= 1 && <span class="late"> {t("stop.late", { n: late })}</span>}
              </>
            ) : (
              ` · ${t("stop.scheduled")}`
            ))}
        </p>
        <Alerts alerts={leg.alerts} />
        {hasMore && (
          <>
            <button
              type="button"
              class="link-btn"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {leg.kind === "transit"
                ? plural(leg.stops.length, "leg.stops.one", "leg.stops.other")
                : plural(leg.steps.length, "leg.steps.one", "leg.steps.other")}
              <Icon name="down" size={14} />
            </button>
            {open &&
              (leg.kind === "transit" ? (
                <ol class="calls">
                  {leg.stops.map((c, i) => (
                    <li key={`${c.stopId ?? c.name}${i}`}>
                      <span class="call-time">
                        {formatTime(c.departure ?? c.arrival ?? leg.start, c.tz)}
                      </span>
                      <span class="call-name">{c.name}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <ol class="steps">
                  {leg.steps.map((s, i) => (
                    <li key={`${s.text}${i}`}>
                      <span>{s.text}</span>
                      {s.distance > 0 && <span class="muted">{formatDistance(s.distance)}</span>}
                    </li>
                  ))}
                </ol>
              ))}
          </>
        )}
      </div>
    </li>
  );
}

function Detail({ it, r }: { it: Itinerary; r: DirRoute }) {
  const last = it.legs[it.legs.length - 1];
  useEffect(() => requestSnap("half"), [it.id]);
  return (
    <div class="stack">
      <ScreenHead
        title={formatDuration(it.duration)}
        onBack={() => go({ ...r, pick: null }, { replace: true })}
      />
      <p class="lead">
        {formatTime(it.start, it.legs[0]?.from.tz)} – {formatTime(it.end, last?.to.tz)}
        {it.legs.some((l) => l.kind === "transit") && ` · ${transfersText(it.transfers)}`}
      </p>
      <button
        type="button"
        class="btn primary block"
        onClick={() => {
          const to =
            r.to ?? (last ? { lat: last.to.lat, lng: last.to.lng, name: last.to.name } : null);
          if (to) startGuidance(it, r.mode, to);
        }}
      >
        <Icon name="start" size={18} />
        {t("guide.start")}
      </button>
      <ol class="legs">
        {it.legs.map((leg, i) => (
          <LegBlock key={`${leg.start}${i}`} leg={leg} />
        ))}
        {last && (
          <li class="leg end">
            <span class="leg-time">{formatTime(it.end, last.to.tz)}</span>
            <span class="leg-rail end" />
            <div class="leg-body">
              <p class="leg-place">{last.to.name}</p>
            </div>
          </li>
        )}
      </ol>
      <OriginNote it={it} />
    </div>
  );
}

function Results({ r }: { r: DirRoute }) {
  const state = trips.value;
  if (!r.to) return <p class="muted">{t("dir.pickDestination")}</p>;
  if (state.status === "need-position") {
    return (
      <div class="stack">
        <p class="muted">{t("dir.needPosition")}</p>
        <button
          type="button"
          class="btn"
          disabled={locating.value}
          onClick={() => locate(() => {})}
        >
          <Icon
            name={locating.value ? "spinner" : "locate"}
            size={18}
            {...(locating.value ? { class: "spin" } : {})}
          />
          {t("dir.usePosition")}
        </button>
        <p class="muted small">{t("dir.positionNote")}</p>
      </div>
    );
  }
  if (state.status === "loading" || state.status === "idle") {
    return (
      <ul class="skeleton-rows tall" aria-label={t("dir.searching")}>
        <li />
        <li />
        <li />
      </ul>
    );
  }
  const { itineraries, failed, noRegion, noDeviceMode } = state.outcome;
  if (itineraries.length === 0) {
    return (
      <div class="stack">
        <p class="notice">
          {noDeviceMode
            ? t("dir.noDeviceMode")
            : noRegion
              ? t("dir.noRegion")
              : failed.length > 0
                ? t("dir.failed", { services: failed.join(", ") })
                : t("dir.none")}
        </p>
        {noRegion || noDeviceMode ? (
          <button type="button" class="btn" onClick={() => go({ name: "settings" })}>
            <Icon name="settings" size={18} />
            {t("home.settings")}
          </button>
        ) : (
          failed.length > 0 && (
            <button type="button" class="btn" onClick={retryTrips}>
              <Icon name="refresh" size={18} />
              {t("action.retry")}
            </button>
          )
        )}
      </div>
    );
  }
  const first = itineraries[0];
  return (
    <>
      {failed.length > 0 && (
        <p class="muted small">{t("dir.fallback", { services: failed.join(", ") })}</p>
      )}
      <ul class="itineraries">
        {itineraries.map((it, i) => (
          <ItineraryRow key={it.id} it={it} onOpen={() => go({ ...r, pick: i })} />
        ))}
      </ul>
      {first && <OriginNote it={first} />}
    </>
  );
}

export function Directions({ r }: { r: DirRoute }) {
  const state = trips.value;
  const picked =
    r.pick !== null && state.status === "done" ? state.outcome.itineraries[r.pick] : null;
  useEffect(() => requestSnap("half"), []);
  if (picked) return <Detail it={picked} r={r} />;
  return (
    <div class="stack">
      <h2 class="sr-only">{t("dir.title")}</h2>
      <Ends r={r} />
      <Segmented
        label={t("dir.mode")}
        value={r.mode}
        options={TRAVEL_MODES.map((id) => ({
          id,
          label: t(`mode.${id}`),
          icon: MODE_ICON[id],
        }))}
        onChange={(mode) => {
          setTravel({ mode });
          go({ ...r, mode, pick: null }, { replace: true });
        }}
      />
      <div class="dir-controls">
        <WhenControl />
        <Options mode={r.mode} />
      </div>
      <Results r={r} />
    </div>
  );
}
