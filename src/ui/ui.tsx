/**
 * Shared pieces: screen headers, icon buttons, toasts, a line's badge, and
 * small helpers.
 */
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { back } from "../app/state";
import { t } from "../i18n";
import type { Line, Vehicle } from "../providers/types";
import { Icon, type IconName, vehicleIcon } from "./icons";

export function ScreenHead({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children?: ComponentChildren;
}) {
  return (
    <div class="screen-head">
      <button
        type="button"
        class="icon-btn"
        onClick={onBack ?? (() => back())}
        aria-label={t("action.back")}
      >
        <Icon name="back" />
      </button>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  pressed,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      class="icon-btn"
      onClick={onClick}
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Black or white, whichever reads better on a colour (WCAG relative luminance). */
export function readableOn(hex: string): "#000000" | "#ffffff" {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.179 ? "#000000" : "#ffffff";
}

/**
 * A line as riders know it: its vehicle and its name on the operator's colour.
 * The name is always shown, so the colour is never the only way to tell lines apart.
 */
export function LineBadge({ line, vehicle }: { line: Line; vehicle: Vehicle }) {
  const style = line.color
    ? { background: line.color, color: readableOn(line.color), borderColor: "transparent" }
    : undefined;
  return (
    <span class="line-badge" style={style}>
      <Icon name={vehicleIcon(vehicle)} size={14} />
      {line.name && <span class="line-name">{line.name}</span>}
    </span>
  );
}

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const toasts = signal<Toast[]>([]);
let toastSeq = 0;

/** Shows a short message, with an optional action, for a few seconds. */
export function toast(text: string, action?: Toast["action"], ms = 4500): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value.slice(-2), { id, text, ...(action ? { action } : {}) }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((x) => x.id !== id);
  }, ms);
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((x) => (
        <div class="toast" key={x.id}>
          <span>{x.text}</span>
          {x.action && (
            <button
              type="button"
              onClick={() => {
                x.action?.run();
                toasts.value = toasts.value.filter((y) => y.id !== x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Copies text, with a toast either way. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("toast.copied"));
  } catch {
    toast(t("toast.copyFailed"));
  }
}

/** Shares a link through the system sheet when there is one, otherwise copies it. */
export async function shareLink(title: string, url: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  await copyText(url);
}

/** A switch with its label and an optional line of explanation. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label class="toggle">
      <span class="toggle-text">
        <span class="toggle-label">{label}</span>
        {hint && <span class="toggle-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span class="toggle-track" aria-hidden="true" />
    </label>
  );
}

/** A group of mutually exclusive choices shown side by side. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; icon?: IconName }[];
  onChange: (next: T) => void;
}) {
  return (
    <fieldset class="segmented" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.icon && <Icon name={o.icon} size={18} />}
          <span class="seg-label">{o.label}</span>
        </button>
      ))}
    </fieldset>
  );
}
