export type ActorType = "system" | "worker" | "user";

export interface Actor {
  type: ActorType;
  id: string;
}
