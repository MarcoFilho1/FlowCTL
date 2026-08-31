import type { GraphValidationIssue } from "@flowctl/core";
import type { ControlPlane } from "./state.js";

export interface ControlPlaneOptions {
  now: () => string;
  nextLeaseId: () => string;
  nextEventId: () => string;
  leaseExpiresAt: (acquiredAt: string) => string;
}

export type ControlPlaneCreationResult =
  | { ok: true; controlPlane: ControlPlane }
  | { ok: false; code: "INVALID_GRAPH"; issues: readonly GraphValidationIssue[] };
