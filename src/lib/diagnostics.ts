import type { CaptionCue } from './types';
import { MIN_CUE_DURATION } from './time';
import { sortCues } from './subtitle';

export interface CueDiagnostics {
  emptyTextCount: number;
  invalidTimeCount: number;
  overlapCount: number;
}

export function getCueDiagnostics(cues: CaptionCue[]): CueDiagnostics {
  const sorted = sortCues(cues);
  let emptyTextCount = 0;
  let invalidTimeCount = 0;
  let overlapCount = 0;

  sorted.forEach((cue, index) => {
    if (cue.text.trim().length === 0) emptyTextCount += 1;
    if (!Number.isFinite(cue.start) || cue.end - cue.start < MIN_CUE_DURATION) {
      invalidTimeCount += 1;
    }

    const next = sorted[index + 1];
    if (next && cue.end > next.start) overlapCount += 1;
  });

  return { emptyTextCount, invalidTimeCount, overlapCount };
}
