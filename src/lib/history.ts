import type { EditorSnapshot } from './types';

export interface EditorHistory {
  past: EditorSnapshot[];
  present: EditorSnapshot;
  future: EditorSnapshot[];
}

export const HISTORY_LIMIT = 80;

export function createEditorHistory(snapshot: EditorSnapshot): EditorHistory {
  return {
    past: [],
    present: cloneSnapshot(snapshot),
    future: []
  };
}

export function commitEditorHistory(
  history: EditorHistory,
  nextSnapshot: EditorSnapshot,
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

export function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    cues: snapshot.cues.map((cue) => ({
      ...cue,
      style: { ...cue.style }
    })),
    overlays: snapshot.overlays.map((overlay) => ({ ...overlay })),
    effects: snapshot.effects.map((effect) => ({ ...effect })),
    videoClips: snapshot.videoClips.map((clip) => ({ ...clip })),
    transitions: snapshot.transitions.map((transition) => ({ ...transition }))
  };
}

function snapshotKey(snapshot: EditorSnapshot) {
  return JSON.stringify(snapshot);
}
