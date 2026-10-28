export {
  checkChallengeSolution,
  checkToken,
  createChallenge,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  signToken,
} from "./challenge.js";
export type {
  Challenge,
  ChallengeFailure,
  ChallengeSolution,
  TokenClaims,
  TokenFailure,
} from "./challenge.js";
export { challengeDifficulty, decide, DEFAULT_POLICIES, resolvePolicy } from "./decide.js";
export type {
  Decision,
  DecisionPolicy,
  DecisionResult,
  ProtectedAction,
} from "./decide.js";
export { buildRequestContext, createIdentifyHandler } from "./handler.js";
export type { IdentifyHandlerOptions } from "./handler.js";
export { computeSuspectScore, SUSPECT_SCORE_WEIGHTS } from "./identify.js";
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
  ChallengeVerification,
  DeviceIntelligenceOptions,
  EventQuery,
  IdentificationEvent,
  IdentifyInput,
  IdentifyResult,
  MatchMethod,
  SmartSignals,
  TokenVerification,
  VelocitySignals,
  VelocityWindow,
  VisitorRecord,
  VisitorStore,
} from "./types.js";
export { DEVICE_COMPONENT_NAMES } from "../identification/types.js";
export type { DeviceComponents, DeviceSignalsPayload } from "../identification/types.js";
