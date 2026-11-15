/**
 * Settings: language, theme, how the user likes to travel, who computes trips,
 * the service addresses, and what is kept on the device. All of it stays in
 * this browser.
 */
import { useEffect, useState } from "preact/hooks";
import { LANGS, lang, setLang, t } from "../../i18n";
import { mapRef } from "../../map/MapView";
import { keepArea } from "../../offline/keep";
import { forgetRecents, recents } from "../../store/store";
import { Icon } from "../../ui/icons";
import { ScreenHead, Segmented, Toggle, toast } from "../../ui/ui";
import {
  cleanEndpoint,
  DEFAULT_ENDPOINTS,
  endpoints,
  engine,
  type ServiceId,
  setTravel,
  theme,
  travel,
} from "../prefs";
import { requestSnap } from "../Sheet";
import { go } from "../state";
import { Regions } from "./Regions";

function EndpointField({ id, label }: { id: ServiceId; label: string }) {
  const [text, setText] = useState(endpoints.value[id]);
  const [bad, setBad] = useState(false);
  const commit = () => {
    const clean = cleanEndpoint(text);
    const invalid = text.trim() !== "" && clean === "";
    setBad(invalid);
    if (!invalid) {
      endpoints.value = { ...endpoints.value, [id]: clean };
      setText(clean);
    }
  };
  return (
    <label class="form-field">
      <span class="form-label">{label}</span>
      <input
        class="field"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellcheck={false}
        placeholder={DEFAULT_ENDPOINTS[id]}
        value={text}
        aria-invalid={bad}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      {bad && <span class="form-error">{t("settings.endpoint.invalid")}</span>}
    </label>
  );
}

function Offline() {
  const [progress, setProgress] = useState<string | null>(null);
  const keep = async () => {
    const map = mapRef.value;
    if (!map) return;
    setProgress(t("settings.offline.starting"));
    const result = await keepArea(map, (done, total) =>
      setProgress(t("settings.offline.progress", { done, total })),
    );
    setProgress(null);
    if (result.ok) {
      toast(
        result.failed > 0
          ? t("settings.offline.partial", { n: result.total - result.failed, total: result.total })
          : t("settings.offline.done", { n: result.total }),
      );
    } else {
      toast(
        result.reason === "too-big"
          ? t("settings.offline.tooBig")
          : result.reason === "no-worker"
            ? t("settings.offline.noWorker")
            : t("settings.offline.noSource"),
      );
    }
  };
  return (
    <div class="stack tight">
      <p class="muted small">{t("settings.offline.hint")}</p>
      <button type="button" class="btn" disabled={progress !== null} onClick={() => void keep()}>
        <Icon name="keep" size={18} />
        {progress ?? t("settings.offline.keep")}
      </button>
    </div>
  );
}

export function Settings() {
  useEffect(() => requestSnap("full"), []);
  const p = travel.value;
  return (
    <div class="stack">
      <ScreenHead title={t("settings.title")} />

      <section class="stack tight">
        <h3 class="section-title">{t("settings.language")}</h3>
        <Segmented
          label={t("settings.language")}
          value={lang.value}
          options={LANGS.map((l) => ({ id: l.id, label: l.name }))}
          onChange={setLang}
        />
      </section>

      <section class="stack tight">
        <h3 class="section-title">{t("settings.theme")}</h3>
        <Segmented
          label={t("settings.theme")}
          value={theme.value}
          options={[
            { id: "system", label: t("settings.theme.system") },
            { id: "light", label: t("settings.theme.light") },
            { id: "dark", label: t("settings.theme.dark") },
          ]}
          onChange={(next) => {
            theme.value = next;
          }}
        />
      </section>

      <section class="stack tight">
        <h3 class="section-title">{t("settings.travel")}</h3>
        <Segmented
          label={t("pref.mode")}
          value={p.mode}
          options={[
            { id: "transit", label: t("mode.transit"), icon: "bus" },
            { id: "bike", label: t("mode.bike"), icon: "bike" },
            { id: "walk", label: t("mode.walk"), icon: "foot" },
          ]}
          onChange={(mode) => setTravel({ mode })}
        />
        <div class="toggles">
          <Toggle
            label={t("pref.avoidHills")}
            hint={t("pref.avoidHills.hint")}
            checked={p.avoidHills}
            onChange={(avoidHills) => setTravel({ avoidHills })}
          />
          <Toggle
            label={t("pref.stepFree")}
            hint={t("pref.stepFree.hint")}
            checked={p.stepFree}
            onChange={(stepFree) => setTravel({ stepFree })}
          />
        </div>
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
        <p class="muted small">{t("pref.kept")}</p>
      </section>

      <section class="stack tight">
        <h3 class="section-title">{t("settings.engine")}</h3>
        <Segmented
          label={t("settings.engine")}
          value={engine.value}
          options={[
            { id: "auto", label: t("settings.engine.auto") },
            { id: "online", label: t("settings.engine.online") },
            { id: "device", label: t("settings.engine.device") },
          ]}
          onChange={(next) => {
            engine.value = next;
          }}
        />
        <p class="muted small">{t(`settings.engine.${engine.value}.hint`)}</p>
      </section>

      <section class="stack tight">
        <h3 class="section-title">{t("settings.endpoints")}</h3>
        <p class="muted small">{t("settings.endpoints.hint")}</p>
        <EndpointField id="motis" label={t("settings.endpoint.motis")} />
        <EndpointField id="valhalla" label={t("settings.endpoint.valhalla")} />
      </section>

      <section class="stack tight">
        <h3 class="section-title">{t("regions.title")}</h3>
        <Regions />
      </section>

      <section class="stack tight">
        <h3 class="section-title">{t("settings.offline")}</h3>
        <Offline />
      </section>

      <section class="stack tight">
        <h3 class="section-title">{t("settings.data")}</h3>
        <p class="muted small">{t("settings.data.hint")}</p>
        <button
          type="button"
          class="btn"
          disabled={recents.value.length === 0}
          onClick={() => {
            forgetRecents();
            toast(t("settings.data.cleared"));
          }}
        >
          <Icon name="trash" size={18} />
          {t("settings.data.clear")}
        </button>
      </section>

      <button type="button" class="btn block" onClick={() => go({ name: "sources" })}>
        <Icon name="info" size={18} />
        {t("sources.title")}
      </button>
    </div>
  );
}
