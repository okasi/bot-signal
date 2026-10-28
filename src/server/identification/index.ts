export { createIdentifyHandler, buildRequestContext } from "./handler.js";
export type { IdentifyHandlerOptions } from "./handler.js";
export { computeSuspectScore, createDeviceIntelligence, SUSPECT_SCORE_WEIGHTS } from "./identify.js";
export type { DeviceIntelligence } from "./identify.js";
export {
  buildIndexKeys,
  compareDigests,
  COMPONENT_WEIGHTS,
  digestComponents,
  MIN_COMPARABLE_WEIGHT,
} from "./matching.js";
export type { ComponentDigests, Similarity } from "./matching.js";
export { MemoryVisitorStore } from "./memoryStore.js";
export type { MemoryVisitorStoreOptions } from "./memoryStore.js";
export { InvalidPayloadError, parseDevicePayload } from "./payload.js";
export { sealResult, unsealResult } from "./seal.js";
export type {
  BotVerdict,
  DeviceIntelligenceOptions,
  EventQuery,
  IdentificationEvent,
  IdentifyInput,
  IdentifyResult,
  MatchMethod,
  SmartSignals,
  VelocitySignals,
  VelocityWindow,
  VisitorRecord,
  VisitorStore,
} from "./types.js";
