export interface Lease {
  id: string;
  taskId: string;
  workerId: string;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
}
