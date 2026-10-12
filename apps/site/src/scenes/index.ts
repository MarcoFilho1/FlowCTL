// The scenes the page and the launch video play, by id.

import type { Lang } from "../i18n/index.ts";
import { followupScene } from "./followup.ts";
import { idleScene } from "./idle.ts";
import { overlayScene } from "./overlay.ts";
import { subagentsScene } from "./subagents.ts";
import type { Scene, SceneId } from "./types.ts";

export type { Scene, SceneId } from "./types.ts";

export const SCENE_BUILDERS: Record<SceneId, (lang: Lang) => Scene> = {
  overlay: overlayScene,
  subagents: subagentsScene,
  followup: followupScene,
  idle: idleScene
};

export function sceneFor(id: SceneId, lang: Lang): Scene {
  return SCENE_BUILDERS[id](lang);
}
