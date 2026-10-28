import type {
  EventQuery,
  IdentificationEvent,
  VisitorRecord,
  VisitorStore,
} from "./types.js";

export interface MemoryVisitorStoreOptions {
  /** Drop events older than this. Default 30 days. */
  retentionMs?: number;
  /** Cap on stored events (oldest dropped first). Default 100 000. */
  maxEvents?: number;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(id);
  index.set(key, ids);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key);
  ids?.delete(id);
  if (ids?.size === 0) {
    index.delete(key);
  }
}

/**
 * Single-process store for development, tests and small deployments.
 * Use a shared database implementation of {@link VisitorStore} when you run
 * more than one server instance.
 */
export class MemoryVisitorStore implements VisitorStore {
  private readonly visitors = new Map<string, VisitorRecord>();
  private readonly keyIndex = new Map<string, Set<string>>();
  private readonly tokenIndex = new Map<string, string>();
  private events: IdentificationEvent[] = [];
  private readonly consumed = new Map<string, number>();
  private readonly retentionMs: number;
  private readonly maxEvents: number;
  private readonly now: () => number;

  constructor(options: MemoryVisitorStoreOptions = {}) {
    this.retentionMs = options.retentionMs ?? 30 * DAY_MS;
    this.maxEvents = options.maxEvents ?? 100_000;
    this.now = options.now ?? Date.now;
  }

  async getVisitor(visitorId: string): Promise<VisitorRecord | undefined> {
    return this.visitors.get(visitorId);
  }

  async findVisitorByStorageToken(token: string): Promise<VisitorRecord | undefined> {
    const visitorId = this.tokenIndex.get(token);
    return visitorId === undefined ? undefined : this.visitors.get(visitorId);
  }

  async findCandidates(indexKeys: string[]): Promise<VisitorRecord[]> {
    const ids = new Set<string>();
    for (const key of indexKeys) {
      for (const id of this.keyIndex.get(key) ?? []) {
        ids.add(id);
      }
    }
    return [...ids].map((id) => this.visitors.get(id)!);
  }

  async saveVisitor(record: VisitorRecord): Promise<void> {
    const previous = this.visitors.get(record.visitorId);
    if (previous) {
      previous.indexKeys.forEach((key) => removeFromIndex(this.keyIndex, key, record.visitorId));
      previous.storageTokens.forEach((token) => this.tokenIndex.delete(token));
    }
    this.visitors.set(record.visitorId, record);
    record.indexKeys.forEach((key) => addToIndex(this.keyIndex, key, record.visitorId));
    record.storageTokens.forEach((token) => this.tokenIndex.set(token, record.visitorId));
  }

  async addEvent(event: IdentificationEvent): Promise<void> {
    this.events.push(event);
    this.prune();
  }

  async queryEvents(query: EventQuery): Promise<IdentificationEvent[]> {
    this.prune();
    const matches: IdentificationEvent[] = [];
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index]!;
      if (query.since !== undefined && event.timestamp < query.since) {
        break;
      }
      if (
        (query.visitorId === undefined || event.visitorId === query.visitorId) &&
        (query.ip === undefined || event.ip === query.ip) &&
        (query.linkedId === undefined || event.linkedId === query.linkedId)
      ) {
        matches.push(event);
        if (query.limit !== undefined && matches.length >= query.limit) {
          break;
        }
      }
    }
    return matches;
  }

  async getEvent(eventId: string): Promise<IdentificationEvent | undefined> {
    return this.events.find((event) => event.eventId === eventId);
  }

  async deleteVisitor(visitorId: string): Promise<boolean> {
    const record = this.visitors.get(visitorId);
    this.events = this.events.filter((event) => event.visitorId !== visitorId);
    if (!record) {
      return false;
    }
    record.indexKeys.forEach((key) => removeFromIndex(this.keyIndex, key, visitorId));
    record.storageTokens.forEach((token) => this.tokenIndex.delete(token));
    this.visitors.delete(visitorId);
    return true;
  }

  async consumeOnce(key: string, expiresAt: number): Promise<boolean> {
    const current = this.now();
    for (const [stored, expiry] of this.consumed) {
      if (expiry < current) {
        this.consumed.delete(stored);
      }
    }
    if (this.consumed.has(key)) {
      return false;
    }
    this.consumed.set(key, expiresAt);
    return true;
  }

  private prune(): void {
    const cutoff = this.now() - this.retentionMs;
    let start = 0;
    while (start < this.events.length && this.events[start]!.timestamp < cutoff) {
      start += 1;
    }
    start = Math.max(start, this.events.length - this.maxEvents);
    if (start > 0) {
      this.events = this.events.slice(start);
    }
  }
}
