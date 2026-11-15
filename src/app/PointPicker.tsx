/**
 * A search field that ends with a point: the top search, and both ends of a
 * trip. Type, move through the results with the arrows, pick one.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { distance } from "../geo/polyline";
import { formatDistance, t } from "../i18n";
import { mapCenter, mapZoom } from "../map/MapView";
import { Icon, type IconName, vehicleIcon } from "../ui/icons";
import { type Hit, MIN_CHARS, useSearch } from "./search";

export interface Extra {
  key: string;
  icon: IconName;
  label: string;
  run: () => void;
}

function hitIcon(h: Hit): IconName {
  if (h.source === "saved") return "save";
  if (h.source === "recent") return "recent";
  if (h.kind === "stop") return h.vehicles?.[0] ? vehicleIcon(h.vehicles[0]) : "bus";
  return "pin";
}

export function PointPicker({
  id,
  label,
  placeholder,
  value = "",
  icon = "search",
  extras = [],
  onPick,
  focusKey,
  children,
}: {
  id: string;
  /** The accessible name of the field. */
  label: string;
  placeholder: string;
  /** What the field shows when it is not being typed in. */
  value?: string;
  icon?: IconName;
  /** Choices listed before the results (such as "My position"). */
  extras?: Extra[];
  onPick: (hit: Hit) => void;
  /** Change it to focus the field from outside. */
  focusKey?: number;
  /** Buttons shown inside the field, after the text. */
  children?: ComponentChildren;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { hits, local, status, failed } = useSearch(open ? q : "", mapCenter.value, mapZoom.value);

  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);

  // The point changed from outside (a link, a swap): what was being typed no longer applies.
  useEffect(() => {
    setOpen(false);
    setQ("");
    setActive(0);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setActive(0);
  };

  const shownExtras = q.trim() ? [] : extras;
  const count = shownExtras.length + hits.length;

  const choose = (index: number) => {
    const extra = shownExtras[index];
    if (extra) {
      close();
      input.current?.blur();
      extra.run();
      return;
    }
    const hit = hits[index - shownExtras.length];
    if (!hit) return;
    close();
    input.current?.blur();
    onPick(hit);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      input.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(count - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(Math.min(active, Math.max(0, count - 1)));
    }
  };

  const typed = q.trim().length;
  const here = mapCenter.value;
  const listId = `${id}-results`;
  const showList = open && (count > 0 || typed > 0);
  let lastSource = "";

  return (
    <div class="picker" ref={root}>
      <label class="picker-field">
        <Icon name={icon} size={18} />
        <span class="sr-only">{label}</span>
        <input
          ref={input}
          id={id}
          type="search"
          role="combobox"
          enterKeyHint="search"
          autoComplete="off"
          spellcheck={false}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={open ? q : value}
          onInput={(e) => {
            setQ(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {status === "loading" && <Icon name="spinner" size={18} class="spin" />}
        {open && q && (
          <button
            type="button"
            class="clear-btn"
            aria-label={t("action.clear")}
            onClick={() => {
              setQ("");
              setActive(0);
              input.current?.focus();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        )}
        {children}
      </label>
      {showList && (
        <ul class="results" id={listId} aria-label={t("search.results")}>
          {shownExtras.map((x, i) => (
            <li key={x.key}>
              <button
                type="button"
                class="result"
                data-active={active === i}
                onClick={() => choose(i)}
              >
                <span class="result-icon">
                  <Icon name={x.icon} size={18} />
                </span>
                <span class="result-text">
                  <span class="result-name">{x.label}</span>
                </span>
              </button>
            </li>
          ))}
          {hits.map((h, i) => {
            const index = i + shownExtras.length;
            const group = h.source === "saved" || h.source === "recent" ? "kept" : h.source;
            const head = group !== lastSource;
            lastSource = group;
            const far = h.source === "place" || h.source === "stop";
            return (
              <li key={h.key}>
                {head && (
                  <span class="results-head">
                    {group === "kept"
                      ? t("search.group.kept")
                      : group === "stop"
                        ? t("search.group.stops")
                        : t("search.group.places")}
                  </span>
                )}
                <button
                  type="button"
                  class="result"
                  data-active={active === index}
                  onClick={() => choose(index)}
                >
                  <span class="result-icon">
                    <Icon name={hitIcon(h)} size={18} />
                  </span>
                  <span class="result-text">
                    <span class="result-name">{h.point.name}</span>
                    <span class="result-meta">
                      {[
                        h.meta,
                        far ? formatDistance(distance(here, [h.point.lng, h.point.lat])) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {status === "error" && <li class="results-note">{t("search.error")}</li>}
          {status === "idle" && failed.length === 1 && (
            <li class="results-note">{t("search.partial", { service: failed[0] ?? "" })}</li>
          )}
          {local && typed > 0 && <li class="results-note">{t("search.local")}</li>}
          {!local &&
            status === "idle" &&
            failed.length === 0 &&
            hits.length === 0 &&
            typed >= MIN_CHARS && <li class="results-note">{t("search.nothing")}</li>}
          {!local && typed > 0 && typed < MIN_CHARS && hits.length === 0 && (
            <li class="results-note">{t("search.keepTyping")}</li>
          )}
        </ul>
      )}
    </div>
  );
}
