import type { AutomationKind } from "../../automation.js";
import type { PrivacyBrowserKind } from "../../identification/types.js";
import type {
  ServerClientContext,
  ServerDetectorOptions,
} from "../types.js";
import type { ComponentDigests } from "./matching.js";

export interface VisitorRecord {
  visitorId: string;
  digests: ComponentDigests;
  /** Candidate-lookup keys this visitor has been seen with (capped). */
  indexKeys: string[];
  /** First-party tokens issued to this visitor (capped). */
  storageTokens: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  visitCount: number;
}

export type BotVerdict = "bad" | "good" | "notDetected";
export type MatchMethod = "storage" | "fingerprint" | "new";

export interface VelocityWindow {
  "5m": number;
  "1h": number;
  "24h": number;
}

export interface VelocitySignals {
  /** Events for this visitor. */
  events: VelocityWindow;
  /** Distinct IPs used by this visitor. */
  distinctIp: VelocityWindow;
  /** Distinct GeoIP countries used by this visitor. */
  distinctCountry: VelocityWindow;
  /** Distinct `linkedId`s (accounts) this visitor has touched. */
  distinctLinkedId: VelocityWindow;
  /** Distinct visitors seen on this IP. */
  ipDistinctVisitors: VelocityWindow;
}

export interface SmartSignals {
  bot: {
    result: BotVerdict;
    automationKind: AutomationKind;
    /** Server-side suspicion score (authoritative inputs). */
    serverScore: number;
    /** In-page score reported by the client (advisory: client can lie). */
    clientScore: number;
    signals: string[];
  };
  vpn: {
    detected: boolean;
    methods: { timezoneMismatch: boolean; privateRelay: boolean; datacenter: boolean };
  };
  proxy: boolean;
  ipBlocklist: boolean;
  incognito: boolean | null;
  privacyBrowser: PrivacyBrowserKind | null;
  virtualMachine: boolean;
  tampering: { detected: boolean; signals: string[] };
  /** Visitor exceeded `highActivityThreshold` events in 24 h. */
  highActivity: boolean;
  velocity: VelocitySignals;
  ipInfo: { ip: string | null; country: string | null; timezone: string | null; datacenterProvider: string | null };
  /** 0–100 additive risk score in the spirit of Fingerprint's Suspect Score. */
  suspectScore: number;
}

export interface IdentificationEvent {
  eventId: string;
  visitorId: string;
  timestamp: number;
  /** Confidence the visitorId belongs to this device, 0–1. */
  confidence: number;
  matchedBy: MatchMethod;
  isNewVisitor: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  visitCount: number;
  ip: string | null;
  country: string | null;
  url: string | null;
  linkedId: string | null;
  tag: Record<string, string | number | boolean> | null;
  smartSignals: SmartSignals;
}

export interface EventQuery {
  visitorId?: string;
  ip?: string;
  linkedId?: string;
  /** Inclusive lower bound, epoch ms. */
  since?: number;
  limit?: number;
}

/**
 * Persistence for visitors and events. All methods may be async so any
 * database can back it; `MemoryVisitorStore` is the reference implementation.
 */
export interface VisitorStore {
  getVisitor(visitorId: string): Promise<VisitorRecord | undefined>;
  findVisitorByStorageToken(token: string): Promise<VisitorRecord | undefined>;
  findCandidates(indexKeys: string[]): Promise<VisitorRecord[]>;
  saveVisitor(record: VisitorRecord): Promise<void>;
  addEvent(event: IdentificationEvent): Promise<void>;
  /** Newest first. */
  queryEvents(query: EventQuery): Promise<IdentificationEvent[]>;
  getEvent(eventId: string): Promise<IdentificationEvent | undefined>;
  /** Removes the visitor and all their events. */
  deleteVisitor(visitorId: string): Promise<boolean>;
}

export interface DeviceIntelligenceOptions {
  /**
   * Secret, deployment-specific salt (≥ 32 chars). Component digests and
   * therefore visitor identities cannot be correlated across deployments
   * that use different salts.
   */
  salt: string;
  store?: VisitorStore;
  /** Minimum similarity for a fingerprint-only match. Default 0.85. */
  matchThreshold?: number;
  /** Minimum similarity when a stored first-party token is presented. Default 0.5. */
  tokenMatchThreshold?: number;
  /** Events per visitor in 24 h that count as high activity. Default 200. */
  highActivityThreshold?: number;
  /** Options forwarded to `detectServerClientAsync`. */
  serverDetection?: ServerDetectorOptions;
  /** 32-byte key (base64 or Buffer). When set, results include an AES-256-GCM sealed copy. */
  sealKey?: string | Uint8Array;
  /** Called after each event is stored, e.g. to forward to a webhook or queue. */
  onEvent?: (event: IdentificationEvent) => void | Promise<void>;
  /** Clock override for tests. */
  now?: () => number;
}

export interface IdentifyInput {
  /** Untrusted body from the browser (`collectDeviceSignals()` output). */
  payload: unknown;
  /** Trusted request metadata gathered by your server/edge. */
  request: ServerClientContext;
  linkedId?: string;
  tag?: Record<string, string | number | boolean>;
  url?: string;
}

export interface IdentifyResult {
  event: IdentificationEvent;
  /** New or refreshed first-party token to store in the browser. */
  storageToken: string;
  /** AES-256-GCM sealed event when `sealKey` is configured, else `null`. */
  sealedResult: string | null;
}
