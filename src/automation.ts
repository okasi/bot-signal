export type AutomationConfidence = "high" | "medium" | "low";

export type AutomationKind =
  | "unknown"
  | "browser-automation"
  | "playwright"
  | "patchright"
  | "puppeteer"
  | "selenium"
  | "phantomjs"
  | "nightmare"
  | "curl"
  | "python"
  | "go"
  | "java";

/** Best-effort attribution. Stealth tools can only be identified probabilistically. */
export interface AutomationAssessment {
  /** Whether automation evidence was found; independent of enforcement threshold. */
  isAutomated: boolean;
  /** Most likely automation family, or `unknown` when no identity evidence was found. */
  kind: AutomationKind;
  confidence: AutomationConfidence;
  /** Human-readable facts used for attribution (not every scoring signal). */
  evidence: string[];
  /** Other plausible families when the available fingerprints overlap. */
  alternatives: AutomationKind[];
}

export function createAutomationAssessment(
  isAutomated: boolean,
  kind: AutomationKind,
  confidence: AutomationConfidence,
  evidence: string[],
  alternatives: AutomationKind[] = [],
): AutomationAssessment {
  return { isAutomated, kind, confidence, evidence, alternatives };
}
