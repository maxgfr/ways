/**
 * One way to call a JSON service: a readable error that names the service, an
 * origin-only referrer (the page itself sends none; the community services ask
 * to know which site is calling), and an optional minimum gap between calls
 * for the services whose policy sets one. In local mode nothing is called at all.
 */
import { networkAllowed } from "../app/prefs";
import { LocalOnlyError, ServiceError } from "./types";

const lastCall = new Map<string, number>();

export interface CallOptions {
  /** The name shown to the user when the call fails. */
  service: string;
  signal?: AbortSignal | undefined;
  headers?: Record<string, string>;
  /** Milliseconds to leave between two calls to this service. */
  minGap?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function getJson<T>(url: URL | string, opts: CallOptions): Promise<T> {
  if (!networkAllowed()) throw new LocalOnlyError(opts.service);
  if (opts.minGap) {
    const wait = (lastCall.get(opts.service) ?? 0) + opts.minGap - Date.now();
    if (wait > 0) await sleep(wait, opts.signal);
    lastCall.set(opts.service, Date.now());
  }
  let res: Response;
  try {
    res = await fetch(url, {
      referrerPolicy: "origin",
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ServiceError(opts.service, 0, `${opts.service} could not be reached`);
  }
  if (!res.ok) throw new ServiceError(opts.service, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ServiceError(opts.service, res.status, `${opts.service} sent an unreadable answer`);
  }
}
