/**
 * A stop: its next departures, refreshed while the card is open and the tab
 * visible. A time from a live feed is marked live; the others are the
 * timetable's and say so. Opening a departure draws its line on the map.
 */
import { useEffect, useState } from "preact/hooks";
import { formatTime, minutesUntil, t } from "../../i18n";
import { departures, SERVICE, trip } from "../../providers/motis";
import type { Alert, Departure, Leg, Point } from "../../providers/types";
import { isAbort } from "../../providers/types";
import { Icon } from "../../ui/icons";
import { LineBadge, ScreenHead } from "../../ui/ui";
import { hostOf, networkAllowed } from "../prefs";
import { requestSnap } from "../Sheet";
import { labelParts } from "../search";
import { shownTrip } from "../trips";
import { PlaceActions } from "./Place";

const REFRESH_MS = 45_000;

/** "now", "4 min", or the clock time when it is more than an hour away. */
export function countdown(ms: number, now: number, tz?: string): string {
  const min = minutesUntil(ms, now);
  if (min <= 0) return t("stop.now");
  if (min < 60) return t("unit.min", { n: min });
  return formatTime(ms, tz);
}

export function Alerts({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  return (
    <ul class="alerts">
      {alerts.map((a) => (
        <li key={`${a.title}${a.text}`}>
          <Icon name="alert" size={18} />
          <div>
            {a.title && <strong>{a.title}</strong>}
            {a.text && a.text !== a.title && <p>{a.text}</p>}
            {a.url && (
              <a href={a.url} target="_blank" rel="noopener noreferrer">
                {t("alert.more")}
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DepartureRow({
  d,
  now,
  open,
  onToggle,
  run,
}: {
  d: Departure;
  now: number;
  open: boolean;
  onToggle: () => void;
  run: Leg | null | "loading" | "error";
}) {
  const late = Math.round((d.time - d.scheduled) / 60000);
  return (
    <li class={d.cancelled ? "departure cancelled" : "departure"}>
      <button type="button" class="departure-btn" aria-expanded={open} onClick={onToggle}>
        <LineBadge line={d.line} vehicle={d.vehicle} />
        <span class="departure-text">
          <span class="departure-headsign">{d.headsign || d.line.longName || d.line.name}</span>
          <span class="departure-meta">
            {d.cancelled ? (
              t("stop.cancelled")
            ) : d.realTime ? (
              <>
                <span class="live">
                  <Icon name="live" size={14} />
                  {t("stop.live")}
                </span>
                {late >= 1 && <span class="late">{t("stop.late", { n: late })}</span>}
                {late <= -1 && <span>{t("stop.early", { n: -late })}</span>}
              </>
            ) : (
              t("stop.scheduled")
            )}
            {d.track && <span>{t("stop.track", { track: d.track })}</span>}
          </span>
        </span>
        <span class="departure-time">
          <span class="departure-in">{countdown(d.time, now, d.tz)}</span>
          <span class="departure-clock">{formatTime(d.time, d.tz)}</span>
        </span>
      </button>
      {open && (
        <div class="departure-run">
          <Alerts alerts={d.alerts} />
          {run === "loading" && <p class="muted small">{t("state.loading")}</p>}
          {run === "error" && <p class="muted small">{t("stop.runError", { service: SERVICE })}</p>}
          {run && typeof run === "object" && (
            <ol class="calls">
              {[run.from, ...run.stops, run.to]
                .filter((c) => (c.departure ?? c.arrival ?? 0) >= d.time - 60_000)
                .map((c, i) => (
                  <li
                    key={`${c.stopId ?? c.name}${i}`}
                    class={c.cancelled ? "cancelled" : undefined}
                  >
                    <span class="call-time">
                      {formatTime(c.departure ?? c.arrival ?? run.start, c.tz)}
                    </span>
                    <span class="call-name">{c.name}</span>
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

export function Stop({ point }: { point: Point }) {
  const [list, setList] = useState<Departure[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [run, setRun] = useState<Leg | null | "loading" | "error">(null);
  const [name, rest] = labelParts(point.name);
  const key = point.stopId ?? `${point.lat},${point.lng}`;

  useEffect(() => requestSnap("half"), [key]);

  useEffect(() => {
    setList(null);
    setFailed(false);
    setOpenKey(null);
    shownTrip.value = null;
    let controller = new AbortController();
    const load = () => {
      if (document.hidden || !networkAllowed()) return;
      controller.abort();
      controller = new AbortController();
      const mine = controller;
      departures(point, { signal: mine.signal })
        .then((found) => {
          if (mine.signal.aborted) return;
          setList(found);
          setFailed(false);
          setNow(Date.now());
        })
        .catch((err) => {
          if (isAbort(err) || mine.signal.aborted) return;
          setFailed(true);
        });
    };
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(refresh);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", load);
      shownTrip.value = null;
    };
  }, [key]);

  const toggle = (d: Departure, k: string) => {
    if (openKey === k) {
      setOpenKey(null);
      shownTrip.value = null;
      return;
    }
    setOpenKey(k);
    shownTrip.value = null;
    if (!d.tripId) {
      setRun(null);
      return;
    }
    setRun("loading");
    trip(d.tripId)
      .then((leg) => {
        setRun(leg);
        shownTrip.value = leg;
      })
      .catch(() => setRun("error"));
  };

  const upcoming = (list ?? []).filter((d) => d.time >= now - 60_000);

  return (
    <div class="stack">
      <ScreenHead title={name} />
      {rest && <p class="lead">{rest}</p>}
      <PlaceActions kind="stop" point={point} />
      <section>
        <h3 class="section-title">{t("stop.departures")}</h3>
        {!networkAllowed() && <p class="notice">{t("stop.local")}</p>}
        {networkAllowed() && list === null && !failed && (
          <ul class="skeleton-rows" aria-label={t("state.loading")}>
            <li />
            <li />
            <li />
          </ul>
        )}
        {failed && list === null && <p class="notice">{t("stop.error", { service: SERVICE })}</p>}
        {list !== null && upcoming.length === 0 && <p class="muted">{t("stop.none")}</p>}
        {upcoming.length > 0 && (
          <ul class="departures">
            {upcoming.map((d) => {
              const k = `${d.tripId ?? d.line.name}:${d.scheduled}`;
              return (
                <DepartureRow
                  key={k}
                  d={d}
                  now={now}
                  open={openKey === k}
                  onToggle={() => toggle(d, k)}
                  run={openKey === k ? run : null}
                />
              );
            })}
          </ul>
        )}
        {failed && list !== null && (
          <p class="muted small">{t("stop.stale", { service: SERVICE })}</p>
        )}
      </section>
      <p class="source-note">{t("stop.source", { service: SERVICE, host: hostOf("motis") })}</p>
    </div>
  );
}
