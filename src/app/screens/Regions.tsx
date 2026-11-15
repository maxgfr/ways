/**
 * Offline data: what this device holds to compute trips without a network.
 * It arrives on its own, for the places the user looks at; this screen says
 * what is there, lets the user fetch the area on screen, and remove anything.
 */
import { useState } from "preact/hooks";
import { locale, t } from "../../i18n";
import { downloading, fetchRegion, interestIn } from "../../local/auto";
import { fetchCatalog, installed, isStale, type RegionInfo, remove } from "../../local/packs";
import { toServiceTime } from "../../local/time";
import { mapCenter } from "../../map/MapView";
import { Icon } from "../../ui/icons";
import { Toggle, toast } from "../../ui/ui";
import { autoRegions } from "../prefs";

/** A size as the language writes it: "3.6 MB", "3,6 Mo". */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return new Intl.NumberFormat(locale(), {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: mb < 10 ? 1 : 0,
  }).format(mb);
}

function formatDay(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale(), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(Date.UTC(y, m - 1, d));
}

function Held({ region }: { region: RegionInfo }) {
  const today = toServiceTime(Date.now(), region.timezone).date;
  const last = region.days[region.days.length - 1];
  return (
    <li class="region">
      <div class="region-text">
        <span class="region-name">{region.name}</span>
        <span class="region-meta">
          {last
            ? t("regions.held", { size: formatBytes(region.bytes), date: formatDay(last) })
            : formatBytes(region.bytes)}
        </span>
        {isStale(region, today) && <span class="region-warn">{t("regions.stale")}</span>}
        <span class="region-meta">
          {t("regions.sources", { sources: region.sources.map((s) => s.name).join(", ") })}
        </span>
      </div>
      <div class="region-actions">
        <button
          type="button"
          class="btn"
          onClick={() => {
            void remove(region.id).then(() => toast(t("regions.removed", { name: region.name })));
          }}
        >
          <Icon name="trash" size={18} />
          {t("regions.remove")}
        </button>
      </div>
    </li>
  );
}

export function Regions() {
  const [looking, setLooking] = useState(false);
  const held = installed.value;
  const busy = downloading.value.size > 0;

  /** The region around the centre of the map, fetched now, whatever the automatic setting. */
  const fetchHere = async () => {
    setLooking(true);
    try {
      const [lng, lat] = mapCenter.value;
      const catalog = await fetchCatalog();
      const here = catalog.find((r) => {
        const [w, s, e, n] = r.bbox;
        return lng >= w && lng <= e && lat >= s && lat <= n;
      });
      if (!here) {
        toast(t("regions.noneHere"), undefined, 6000);
        return;
      }
      if (await fetchRegion(here)) toast(t("regions.done", { name: here.name }));
      else if (!installed.value.some((r) => r.id === here.id)) toast(t("regions.failed"));
    } catch {
      toast(t("regions.catalogError"), undefined, 6000);
    } finally {
      setLooking(false);
    }
  };

  return (
    <div class="stack tight">
      <div class="toggles">
        <Toggle
          label={t("regions.auto.label")}
          hint={t("regions.auto.hint")}
          checked={autoRegions.value}
          onChange={(on) => {
            autoRegions.value = on;
            if (on) {
              const [lng, lat] = mapCenter.value;
              void interestIn(lat, lng);
            }
          }}
        />
      </div>
      {held.length > 0 ? (
        <ul class="regions">
          {held.map((r) => (
            <Held key={r.id} region={r} />
          ))}
        </ul>
      ) : (
        <p class="muted small">{t("regions.empty")}</p>
      )}
      <button type="button" class="btn" disabled={looking || busy} onClick={() => void fetchHere()}>
        <Icon
          name={looking || busy ? "spinner" : "keep"}
          size={18}
          {...(looking || busy ? { class: "spin" } : {})}
        />
        {busy ? t("regions.downloadingNow") : t("regions.here")}
      </button>
    </div>
  );
}
