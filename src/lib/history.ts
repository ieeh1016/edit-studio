import { defaultCanvasSettings, defaultVideoTransform, type EditorSnapshot } from './types';

type EditorSnapshotInput =
  Omit<EditorSnapshot, 'mediaSources' | 'imageClips' | 'keyframes' | 'canvasSettings'> &
  Partial<Pick<EditorSnapshot, 'mediaSources' | 'imageClips' | 'keyframes' | 'canvasSettings'>>;

export interface EditorHistory {
  past: EditorSnapshot[];
  present: EditorSnapshot;
  future: EditorSnapshot[];
}

export const HISTORY_LIMIT = 80;

export function createEditorHistory(snapshot: EditorSnapshotInput): EditorHistory {
  return {
    past: [],
    present: cloneSnapshot(snapshot),
    future: []
  };
}

export function commitEditorHistory(
  history: EditorHistory,
  nextSnapshot: EditorSnapshotInput,
  options: { merge?: boolean; limit?: number } = {}
): EditorHistory {
  const next = cloneSnapshot(nextSnapshot);
  if (snapshotKey(history.present) === snapshotKey(next)) return history;

  if (options.merge) {
    return {
      ...history,
      present: next
    };
  }

  return {
    past: [...history.past, cloneSnapshot(history.present)].slice(
      -(options.limit ?? HISTORY_LIMIT)
    ),
    present: next,
    future: []
  };
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;

  return {
    past: history.past.slice(0, -1),
    present: cloneSnapshot(previous),
    future: [cloneSnapshot(history.present), ...history.future]
  };
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;

  return {
    past: [...history.past, cloneSnapshot(history.present)],
    present: cloneSnapshot(next),
    future: history.future.slice(1)
  };
}

export function cloneSnapshot(snapshot: EditorSnapshotInput): EditorSnapshot {
  return {
    mediaSources: (snapshot.mediaSources ?? []).map((source) => ({ ...source })),
    cues: snapshot.cues.map((cue) => ({
      ...cue,
      style: { ...cue.style }
    })),
    overlays: snapshot.overlays.map((overlay) => ({ ...overlay })),
    effects: snapshot.effects.map((effect) => ({ ...effect })),
    videoClips: snapshot.videoClips.map((clip) => ({
      ...clip,
      crop: { ...(clip.crop ?? defaultVideoTransform.crop) }
    })),
    imageClips: (snapshot.imageClips ?? []).map((clip) => ({ ...clip })),
    transitions: snapshot.transitions.map((transition) => ({ ...transition })),
    audioSources: snapshot.audioSources.map((source) => ({ ...source })),
    audioClips: snapshot.audioClips.map((clip) => ({ ...clip })),
    keyframes: (snapshot.keyframes ?? []).map((keyframe) => ({ ...keyframe })),
    canvasSettings: { ...(snapshot.canvasSettings ?? defaultCanvasSettings) }
  };
}

function snapshotKey(snapshot: EditorSnapshot) {
  return JSON.stringify(snapshot);
}
