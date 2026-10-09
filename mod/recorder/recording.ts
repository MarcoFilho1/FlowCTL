// Phase 1 event recorder: pure bookkeeping, no engine calls, so node --test
// covers it. The hooks module feeds it events and writes the files it names.

export interface RecordedEvent {
  seq: number;
  t: number;
  event: string;
  agentId?: string;
  input?: unknown;
  result?: unknown;
}

export interface ChunkWrite {
  file: string;
  text: string;
}

const MAX_STRING = 2000;
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

/**
 * A copy of `value` that is safe to keep: long strings cut, deep or wide
 * structures truncated, functions and other non-JSON values dropped. Tool
 * outputs (file contents, command output) are the bulk of a session and are
 * not what the graph needs.
 */
export function trim(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING} chars]`
      : value;
  }
  if (typeof value !== "object" || value === undefined) {
    return undefined;
  }
  if (depth >= MAX_DEPTH) {
    return "…[depth]";
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => trim(item, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `…[+${value.length - MAX_ITEMS} items]`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const kept = trim(item, depth + 1);
    if (kept !== undefined) {
      out[key] = kept;
    }
  }
  return out;
}

/**
 * Events in numbered JSONL chunks (`rec-0001.jsonl`, ...). The engine's file
 * API has no append, so each flush rewrites only the chunks touched since the
 * last one: the cost of a flush stays bounded by the chunk size.
 */
export class Recording {
  private readonly events: RecordedEvent[] = [];
  private dirtyFrom: number | undefined;
  private readonly directory: string;
  private readonly chunkSize: number;

  constructor(directory: string, chunkSize = 200) {
    this.directory = directory;
    this.chunkSize = chunkSize;
  }

  add(event: Omit<RecordedEvent, "seq">): RecordedEvent {
    const recorded: RecordedEvent = { seq: this.events.length + 1, ...event };
    this.events.push(recorded);
    this.dirtyFrom ??= this.events.length - 1;
    return recorded;
  }

  get size(): number {
    return this.events.length;
  }

  /** The chunk files changed since the last call, whole. */
  flush(): ChunkWrite[] {
    if (this.dirtyFrom === undefined) {
      return [];
    }
    const writes: ChunkWrite[] = [];
    const first = Math.floor(this.dirtyFrom / this.chunkSize);
    const last = Math.floor((this.events.length - 1) / this.chunkSize);
    for (let chunk = first; chunk <= last; chunk += 1) {
      const slice = this.events.slice(chunk * this.chunkSize, (chunk + 1) * this.chunkSize);
      writes.push({
        file: `${this.directory}/rec-${String(chunk + 1).padStart(4, "0")}.jsonl`,
        text: slice.map((event) => JSON.stringify(event)).join("\n") + "\n"
      });
    }
    this.dirtyFrom = undefined;
    return writes;
  }
}
