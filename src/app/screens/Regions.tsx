/**
 * Regions: the areas whose timetables and streets can be kept on the device,
 * so that trips there are computed without any service. The list comes from
 * this site's own files; what is downloaded stays in the browser's storage.
 */
import { useEffect, useState } from "preact/hooks";
import { locale, t } from "../../i18n";
import {
  fetchCatalog,
  install,
  installed,
  isStale,
  type RegionInfo,
  remove,
} from "../../local/packs";
import { toServiceTime } from "../../local/time";
import { Icon } from "../../ui/icons";
import { toast } from "../../ui/ui";

export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toLocaleString(locale(), { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

function formatDay(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale(), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(Date.UTC(y, m - 1, d));
}

function Region({
  held,
  offered,
}: {
  held: RegionInfo | undefined;
  offered: RegionInfo | undefined;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const region = (held ?? offered) as RegionInfo;
  const today = toServiceTime(Date.now(), region.timezone).date;
  const stale = held ? isStale(held, today) : false;
  const newer = held !== undefined && offered !== undefined && offered.built > held.built;

  const download = async () => {
    if (!offered) return;
    setProgress(t("regions.downloading", { done: 0, total: offered.files.length }));
    try {
      await install(offered, (done, total) =>
        setProgress(t("regions.downloading", { done, total })),
      );
      toast(t("regions.done", { name: offered.name }));
    } catch {
      toast(t("regions.failed"), undefined, 7000);
    } finally {
      setProgress(null);
    }
  };

  const last = held?.days[held.days.length - 1];
  return (
    <li class="region">
      <div class="region-text">
        <span class="region-name">{region.name}</span>
        <span class="region-meta">
          {held && last
            ? t("regions.held", { size: formatBytes(held.bytes), date: formatDay(last) })
            : formatBytes(region.bytes)}
        </span>
        {stale && <span class="region-warn">{t("regions.stale")}</span>}
        <span class="region-meta">
          {t("regions.sources", { sources: region.sources.map((s) => s.name).join(", ") })}
        </span>
      </div>
      <div class="region-actions">
        {(!held || newer || stale) && offered && (
          <button
            type="button"
            class="btn"
            disabled={progress !== null}
            onClick={() => void download()}
          >
            <Icon
              name={progress ? "spinner" : "keep"}
              size={18}
              {...(progress ? { class: "spin" } : {})}
            />
            {progress ?? (held ? t("regions.update") : t("regions.download"))}
          </button>
        )}
        {held && progress === null && (
          <button
            type="button"
            class="btn"
            onClick={() => {
              void remove(held.id).then(() => toast(t("regions.removed", { name: held.name })));
            }}
          >
            <Icon name="trash" size={18} />
            {t("regions.remove")}
          </button>
        )}
      </div>
    </li>
  );
}

export function Regions() {
  const [catalog, setCatalog] = useState<RegionInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCatalog(controller.signal)
      .then(setCatalog)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const held = installed.value;
  const ids = [...new Set([...held.map((r) => r.id), ...(catalog ?? []).map((r) => r.id)])];
  return (
    <div class="stack tight">
      <p class="muted small">{t("regions.hint")}</p>
      {ids.length > 0 && (
        <ul class="regions">
          {ids.map((id) => (
            <Region
              key={id}
              held={held.find((r) => r.id === id)}
              offered={catalog?.find((r) => r.id === id)}
            />
          ))}
        </ul>
      )}
      {failed && <p class="muted small">{t("regions.catalogError")}</p>}
      {!failed && catalog === null && <p class="muted small">{t("state.loading")}</p>}
      {catalog !== null && ids.length === 0 && <p class="muted small">{t("regions.none")}</p>}
    </div>
  );
}
