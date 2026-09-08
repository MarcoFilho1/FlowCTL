import type { ControlPlaneOptions } from "@flowctl/control-plane";

const DEMO_EPOCH_MILLISECONDS = Date.parse("2026-09-08T00:00:00.000Z");
const LEASE_DURATION_MILLISECONDS = 60 * 60 * 1000;

export function createDemoControlPlaneOptions(): ControlPlaneOptions {
  let eventCounter = 0;
  let leaseCounter = 0;
  let timeCounter = 0;

  return {
    now: () => new Date(DEMO_EPOCH_MILLISECONDS + ++timeCounter * 1000).toISOString(),
    nextLeaseId: () => `demo-lease-${++leaseCounter}`,
    nextEventId: () => `demo-event-${++eventCounter}`,
    leaseExpiresAt: (acquiredAt) =>
      new Date(Date.parse(acquiredAt) + LEASE_DURATION_MILLISECONDS).toISOString()
  };
}
