import type { Lease } from "@flowctl/protocol";
import { copyLease } from "./command-copy.js";
import { readControlPlaneState, type ControlPlane } from "./state.js";

export function getActiveLeaseSnapshotForTest(
  controlPlane: ControlPlane,
  taskId: string
): Lease | undefined {
  const lease = readControlPlaneState(controlPlane).activeLeaseByTaskId.get(taskId);
  return lease === undefined ? undefined : copyLease(lease);
}
