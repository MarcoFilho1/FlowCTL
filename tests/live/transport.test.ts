import assert from "node:assert/strict";
import { test } from "node:test";
import { overlayClient, parseOverlayInfo, type OverlayIo, type OverlayRequest } from "../../mod/live/transport.ts";

const DIR = "C:\\Users\\ana\\.flowctl";
const FILE = `${DIR}/overlay.json`;

/** A pretend overlay app: its overlay.json (text and mtime), and the requests it answers. */
function app(initial: { port: number; token: string; mtime?: number } | undefined, answers: (port: number, headers: Record<string, string>) => boolean = () => true) {
  let file: { text: string; mtime: number } | undefined = initial && { text: JSON.stringify({ ...initial, pid: 1, version: "0.1.0" }), mtime: initial.mtime ?? 1 };
  const reads: string[] = [];
  const sent: { url: string; init: OverlayRequest }[] = [];
  const io: OverlayIo = {
    fetch: async (url, init) => {
      sent.push({ url, init });
      const port = Number(new URL(url).port);
      if (url.startsWith("http://127.0.0.1")) return { ok: answers(port, init.headers ?? {}) };
      return { ok: true };
    },
    read: async (path) => {
      reads.push(path);
      if (file === undefined) throw new Error("ENOENT");
      return file.text;
    },
    mtime: async (path) => {
      if (path !== FILE || file === undefined) throw new Error("ENOENT");
      return file.mtime;
    }
  };
  return {
    io,
    reads,
    sent,
    /** The app restarts: a new port and token, written at a later mtime. */
    restart(port: number, token: string) {
      file = { text: JSON.stringify({ port, token, pid: 2, version: "0.1.0" }), mtime: (file?.mtime ?? 0) + 1 };
    },
    /** The file is gone (the app quit). */
    quit() {
      file = undefined;
    }
  };
}

test("on Windows a snapshot goes to 127.0.0.1 on the app's port, with its token", async () => {
  const a = app({ port: 51234, token: "secret" });
  const client = overlayClient(a.io, DIR, "win32");
  assert.equal(await client.request("POST", "/snapshot", "{}"), true);
  assert.deepEqual(a.sent, [{ url: "http://127.0.0.1:51234/snapshot", init: { method: "POST", headers: { "X-FlowCTL-Token": "secret" }, body: "{}" } }]);
});

test("the health check carries the token too, and no body", async () => {
  const a = app({ port: 51234, token: "secret" });
  assert.equal(await overlayClient(a.io, DIR, "win32").request("GET", "/health"), true);
  assert.deepEqual(a.sent[0]?.init, { method: "GET", headers: { "X-FlowCTL-Token": "secret" } });
});

test("a refused token is not sent again with the same file; a restart's new token is used", async () => {
  // The app answers only the token it wrote last.
  let current = "old";
  const a = app({ port: 1111, token: "old" }, (_port, headers) => headers["X-FlowCTL-Token"] === current);
  const client = overlayClient(a.io, DIR, "win32");
  current = "new";
  assert.equal(await client.request("GET", "/health"), false, "the file still holds the old token");
  assert.equal(a.sent.length, 1, "and the same file is not retried");
  a.restart(1111, "new");
  assert.equal(await client.request("GET", "/health"), true, "the new file's token is read and used");
});

test("the file is read once, then only when its mtime changes", async () => {
  const a = app({ port: 1111, token: "t" });
  const client = overlayClient(a.io, DIR, "win32");
  await client.request("POST", "/snapshot", "{}");
  await client.request("POST", "/snapshot", "{}");
  assert.equal(a.reads.length, 1, "the cache answers the second request");
  a.restart(2222, "t2");
  await client.request("POST", "/snapshot", "{}");
  assert.equal(a.reads.length, 2, "a new mtime reads the file again");
  assert.equal(a.sent.at(-1)?.url, "http://127.0.0.1:2222/snapshot");
});

test("a failed request re-reads the file, so an app restarted on another port gets the snapshot", async () => {
  const a = app({ port: 1111, token: "t" }, (port) => port === 2222);
  const client = overlayClient(a.io, DIR, "win32");
  assert.equal(await client.request("POST", "/snapshot", "{}"), false, "the old port answers nothing");
  a.restart(2222, "t2");
  assert.equal(await client.request("POST", "/snapshot", "{}"), true, "the new port is found without an mtime change");
  assert.deepEqual(a.sent.map((s) => s.url), ["http://127.0.0.1:1111/snapshot", "http://127.0.0.1:2222/snapshot"]);
});

test("no overlay.json: the app is not running, so nothing is sent", async () => {
  const a = app(undefined);
  assert.equal(await overlayClient(a.io, DIR, "win32").request("GET", "/health"), false);
  assert.equal(a.sent.length, 0);
});

test("a file that is not the app's info is no info", () => {
  assert.equal(parseOverlayInfo("{\"port\":0,\"token\":\"x\"}"), undefined);
  assert.equal(parseOverlayInfo("{\"port\":5,\"token\":\"\"}"), undefined);
  assert.equal(parseOverlayInfo("{ not json"), undefined);
  assert.deepEqual(parseOverlayInfo("{\"port\":5,\"token\":\"x\",\"pid\":9,\"version\":\"0.1.0\"}"), { port: 5, token: "x", pid: 9, version: "0.1.0" });
});

test("on macOS the snapshot goes over the Unix socket, as before, with no token", async () => {
  const a = app(undefined);
  const client = overlayClient(a.io, "/Users/ana/.flowctl", "darwin");
  assert.equal(await client.request("POST", "/snapshot", "{}"), true);
  assert.deepEqual(a.sent, [{ url: "http://overlay/snapshot", init: { method: "POST", socketPath: "/Users/ana/.flowctl/overlay.sock", body: "{}" } }]);
  assert.equal(await client.request("GET", "/health"), true);
  assert.deepEqual(a.sent[1]?.init, { method: "GET", socketPath: "/Users/ana/.flowctl/overlay.sock" });
  assert.equal(a.reads.length, 0, "no overlay.json on macOS");
});
