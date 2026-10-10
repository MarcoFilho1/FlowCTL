// How the mod reaches the overlay app. On macOS the app listens on a Unix
// socket in ~/.flowctl. On Windows it listens on 127.0.0.1 on a port it
// picks, and writes that port with a token to ~/.flowctl/overlay.json; every
// request carries the token. The file is cached until its modification time
// changes, and a failed request re-reads it: the app may have restarted on
// another port.

import type { Platform } from "./platform.ts";

export interface OverlayInfo {
  port: number;
  token: string;
  pid: number;
  version: string;
}

export interface OverlayRequest {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  socketPath?: string;
}

/** The host's HTTP and files, as a hook has them ($.http, $.fs). */
export interface OverlayIo {
  fetch: (url: string, init: OverlayRequest) => Promise<{ ok: boolean }>;
  read: (path: string) => Promise<string>;
  mtime: (path: string) => Promise<number>;
}

export interface OverlayClient {
  /** One request to the app; true when it answered (on Windows, with a 2xx). */
  request: (method: "GET" | "POST", path: string, body?: string) => Promise<boolean>;
}

/** What the app wrote to overlay.json, or undefined when it is not that. */
export function parseOverlayInfo(text: string): OverlayInfo | undefined {
  try {
    const info = JSON.parse(text) as Partial<OverlayInfo>;
    const valid = Number.isInteger(info.port) && (info.port ?? 0) > 0 && typeof info.token === "string" && info.token !== "";
    return valid ? (info as OverlayInfo) : undefined;
  } catch {
    // Not JSON yet: the app is still writing it.
    return undefined;
  }
}

/** The client for one session's ~/.flowctl folder. */
export function overlayClient(io: OverlayIo, dir: string, platform: Platform): OverlayClient {
  const file = `${dir}/overlay.json`;
  let cached: { mtime: number; info: OverlayInfo } | undefined;

  // The app's port and token: the cache while the file keeps its mtime, else
  // the file as it is now (`fresh` skips the cache).
  async function infoOf(fresh: boolean): Promise<OverlayInfo | undefined> {
    const mtime = await io.mtime(file).catch(() => undefined);
    if (mtime === undefined) {
      cached = undefined;
      return undefined;
    }
    if (!fresh && cached?.mtime === mtime) return cached.info;
    const info = parseOverlayInfo(await io.read(file).catch(() => ""));
    cached = info === undefined ? undefined : { mtime, info };
    return info;
  }

  function send(info: OverlayInfo, method: string, path: string, body: string | undefined): Promise<boolean> {
    return io
      .fetch(`http://127.0.0.1:${info.port}${path}`, {
        method,
        headers: { "X-FlowCTL-Token": info.token },
        ...(body !== undefined ? { body } : {})
      })
      .then((response) => response.ok)
      .catch(() => false);
  }

  async function sendWindows(method: string, path: string, body: string | undefined): Promise<boolean> {
    const first = await infoOf(false);
    if (first === undefined) return false;
    if (await send(first, method, path, body)) return true;
    // Retry only when the app wrote a new port or token: the same one failed.
    const second = await infoOf(true);
    if (second === undefined || (second.port === first.port && second.token === first.token)) return false;
    return send(second, method, path, body);
  }

  return {
    async request(method, path, body) {
      if (platform !== "win32") {
        // macOS: any answer counts, as the health check always did.
        return io
          .fetch(`http://overlay${path}`, { method, socketPath: `${dir}/overlay.sock`, ...(body !== undefined ? { body } : {}) })
          .then(
            () => true,
            () => false
          );
      }
      return sendWindows(method, path, body);
    }
  };
}
