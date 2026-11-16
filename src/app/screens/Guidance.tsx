/**
 * The guidance screen: the next thing to do in large type at the top, the
 * time, distance and arrival left at the bottom, and the map in between,
 * following the traveller.
 */
import { formatDistance, formatDuration, formatTime, plural, t } from "../../i18n";
import type { StepTurn } from "../../providers/types";
import { Icon, type IconName, vehicleIcon } from "../../ui/icons";
import { LineBadge } from "../../ui/ui";
import type { Instruction } from "../course";
import {
  endGuidance,
  following,
  guidance,
  instructionText,
  recentre,
  reroute,
  rerouting,
  setVoice,
  voice,
} from "../guidance";
import { guided, userPosition } from "../state";

const TURN_ICON: Record<StepTurn, IconName> = {
  depart: "straight",
  continue: "straight",
  left: "turnLeft",
  right: "turnRight",
  slightLeft: "slightLeft",
  slightRight: "slightRight",
  hardLeft: "turnLeft",
  hardRight: "turnRight",
  uturn: "uturn",
  roundabout: "roundabout",
  arrive: "flag",
  stairs: "stairs",
  elevator: "straight",
};

function instructionIcon(next: Instruction): IconName {
  switch (next.kind) {
    case "step":
      return next.turn ? TURN_ICON[next.turn] : vehicleIcon(next.vehicle);
    case "board":
    case "ride":
      return vehicleIcon(next.vehicle);
    case "arrive":
      return "flag";
  }
}

function Next() {
  const g = guidance.value;
  const trip = guided.value;
  if (!g || !trip) {
    return (
      <section class="guide-next" aria-live="polite">
        <span class="guide-icon">
          <Icon name="spinner" size={30} class="spin" />
        </span>
        <p class="guide-text">
          {userPosition.value ? t("guide.starting") : t("guide.waitingPosition")}
        </p>
      </section>
    );
  }
  const next = g.arrived ? ({ kind: "arrive", place: "" } as const) : g.next;
  const line = next.kind === "board" || next.kind === "ride" ? next.line : undefined;
  return (
    <section class={g.arrived ? "guide-next arrived" : "guide-next"} aria-live="polite">
      <span class="guide-icon">
        <Icon name={instructionIcon(next)} size={34} />
      </span>
      <div class="guide-words">
        {!g.arrived && next.kind !== "ride" && g.toNext >= 10 && (
          <p class="guide-dist">{formatDistance(g.toNext)}</p>
        )}
        {line && (next.kind === "board" || next.kind === "ride") && (
          <LineBadge line={line} vehicle={next.vehicle} />
        )}
        <p class="guide-text">{instructionText(next)}</p>
        {next.kind === "ride" && (
          <p class="guide-sub">
            {plural(next.stopsLeft, "guide.stopsLeft.one", "guide.stopsLeft.other", {
              n: next.stopsLeft,
            })}
          </p>
        )}
      </div>
    </section>
  );
}

function Status() {
  const state = rerouting.value;
  if (!state) return null;
  return (
    <p class="guide-status" role="status">
      {state === "asking" ? (
        <>
          <Icon name="spinner" size={16} class="spin" />
          {t("guide.rerouting")}
        </>
      ) : (
        <>
          {t("guide.rerouteFailed")}
          <button type="button" class="link-btn" onClick={() => void reroute()}>
            {t("action.retry")}
          </button>
        </>
      )}
    </p>
  );
}

function Bar() {
  const g = guidance.value;
  const trip = guided.value;
  const tz = trip?.it.legs[trip.it.legs.length - 1]?.to.tz;
  return (
    <div class="guide-bar">
      <div class="guide-left">
        {g ? (
          <>
            <strong class="guide-time">
              {formatDuration(Math.max(0, (g.eta - Date.now()) / 1000))}
            </strong>
            <span class="guide-meta">
              {formatDistance(g.remaining)} · {t("guide.eta", { time: formatTime(g.eta, tz) })}
            </span>
          </>
        ) : (
          <strong class="guide-time">{trip ? formatDuration(trip.it.duration) : ""}</strong>
        )}
      </div>
      <button
        type="button"
        class="round-btn"
        aria-label={t("guide.voice")}
        title={t("guide.voice")}
        aria-pressed={voice.value}
        onClick={() => setVoice(!voice.value)}
      >
        <Icon name={voice.value ? "voiceOn" : "voiceOff"} size={21} />
      </button>
      <button type="button" class="btn guide-exit" onClick={endGuidance}>
        {t("guide.exit")}
      </button>
    </div>
  );
}

export function GuidanceScreen() {
  return (
    <div class="guide">
      <h2 class="sr-only">{t("guide.title")}</h2>
      <div class="guide-top">
        <Next />
        <Status />
      </div>
      {!following.value && (
        <button type="button" class="btn guide-recentre" onClick={recentre}>
          <Icon name="locate" size={18} />
          {t("guide.recentre")}
        </button>
      )}
      <Bar />
    </div>
  );
}
