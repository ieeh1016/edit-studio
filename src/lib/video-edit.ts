import type { ClipTransition, ClipTransitionKind, VideoClip } from './types';
import { clamp, MIN_CUE_DURATION } from './time';
import { normalizeVideoClipAudio } from './audio-edit';

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const MIN_CLIP_SOURCE_DURATION = MIN_CUE_DURATION;
export const DEFAULT_CLIP_SPEED = 1;

export interface ClipTimelineRange {
  clip: VideoClip;
  index: number;
  start: number;
  end: number;
  outputDuration: number;
  transitionOut: number;
}

export function createDefaultVideoClip(sourceDuration: number): VideoClip {
  return {
    id: crypto.randomUUID(),
    sourceStart: 0,
    sourceEnd: Math.max(sourceDuration, MIN_CLIP_SOURCE_DURATION),
    speed: DEFAULT_CLIP_SPEED,
    muted: false,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0
  };
}

export function getClipSourceDuration(clip: Pick<VideoClip, 'sourceStart' | 'sourceEnd'>) {
  return Math.max(0, clip.sourceEnd - clip.sourceStart);
}

export function getClipOutputDuration(
  clip: Pick<VideoClip, 'sourceStart' | 'sourceEnd' | 'speed'>
) {
  return getClipSourceDuration(clip) / normalizeSpeed(clip.speed);
}

export function normalizeSpeed(speed: number) {
  return clamp(Number.isFinite(speed) ? speed : DEFAULT_CLIP_SPEED, 0.25, 4);
}

export function normalizeVideoClip(clip: VideoClip, sourceDuration?: number): VideoClip {
  const maxEnd = Math.max(sourceDuration ?? Number.MAX_SAFE_INTEGER, MIN_CLIP_SOURCE_DURATION);
  const sourceStart = clamp(clip.sourceStart, 0, Math.max(0, maxEnd - MIN_CLIP_SOURCE_DURATION));
  const sourceEnd = clamp(
    clip.sourceEnd,
    sourceStart + MIN_CLIP_SOURCE_DURATION,
    maxEnd
  );

  return normalizeVideoClipAudio({
    ...clip,
    sourceStart,
    sourceEnd,
    speed: normalizeSpeed(clip.speed),
    muted: Boolean(clip.muted)
  });
}

export function getTransitionBetween(
  transitions: ClipTransition[],
  fromClipId: string,
  toClipId: string
) {
  return transitions.find(
    (transition) =>
      transition.fromClipId === fromClipId && transition.toClipId === toClipId
  );
}

export function clampTransitionDuration(
  duration: number,
  fromClip: VideoClip,
  toClip: VideoClip
) {
  const maxDuration = Math.max(
    0,
    Math.min(getClipOutputDuration(fromClip), getClipOutputDuration(toClip)) / 2
  );
  return clamp(Number.isFinite(duration) ? duration : DEFAULT_TRANSITION_DURATION, 0, maxDuration);
}

export function normalizeTransitionsForClips(
  clips: VideoClip[],
  transitions: ClipTransition[]
) {
  if (clips.length < 2) return [];

  const normalized: ClipTransition[] = [];

  for (let index = 0; index < clips.length - 1; index += 1) {
    const fromClip = clips[index];
    const toClip = clips[index + 1];
    const transition = getTransitionBetween(transitions, fromClip.id, toClip.id);
    if (!transition) continue;

    const duration = clampTransitionDuration(transition.duration, fromClip, toClip);
    if (duration <= 0.01) continue;

    normalized.push({
      ...transition,
      fromClipId: fromClip.id,
      toClipId: toClip.id,
      duration
    });
  }

  return normalized;
}

export function getClipTimelineRanges(
  clips: VideoClip[],
  transitions: ClipTransition[]
): ClipTimelineRange[] {
  const normalizedTransitions = normalizeTransitionsForClips(clips, transitions);
  let cursor = 0;

  return clips.map((clip, index) => {
    const outputDuration = getClipOutputDuration(clip);
    const start = cursor;
    const end = start + outputDuration;
    const nextClip = clips[index + 1];
    const transitionOut = nextClip
      ? (getTransitionBetween(normalizedTransitions, clip.id, nextClip.id)?.duration ?? 0)
      : 0;

    cursor = end - transitionOut;

    return {
      clip,
      index,
      start,
      end,
      outputDuration,
      transitionOut
    };
  });
}

export function getEditTimelineDuration(
  clips: VideoClip[],
  transitions: ClipTransition[]
) {
  const ranges = getClipTimelineRanges(clips, transitions);
  return Math.max(0, ranges[ranges.length - 1]?.end ?? 0);
}

export function findClipRangeAtTime(
  ranges: ClipTimelineRange[],
  time: number
): ClipTimelineRange | null {
  if (ranges.length === 0) return null;

  return (
    ranges.find((range) => time >= range.start && time < range.end) ??
    ranges[ranges.length - 1]
  );
}

export function timelineToSourceTime(
  ranges: ClipTimelineRange[],
  time: number
) {
  const range = findClipRangeAtTime(ranges, time);
  if (!range) return time;

  const localOutputTime = clamp(time - range.start, 0, range.outputDuration);
  return clamp(
    range.clip.sourceStart + localOutputTime * normalizeSpeed(range.clip.speed),
    range.clip.sourceStart,
    range.clip.sourceEnd
  );
}

function rangeTimelineToSourceTime(range: ClipTimelineRange, time: number) {
  const localOutputTime = clamp(time - range.start, 0, range.outputDuration);
  return clamp(
    range.clip.sourceStart + localOutputTime * normalizeSpeed(range.clip.speed),
    range.clip.sourceStart,
    range.clip.sourceEnd
  );
}

export function getTransitionPreviewAtTime(
  ranges: ClipTimelineRange[],
  transitions: ClipTransition[],
  time: number
) {
  const normalizedTransitions = normalizeTransitionsForClips(
    ranges.map((range) => range.clip),
    transitions
  );

  for (let index = 0; index < ranges.length - 1; index += 1) {
    const fromRange = ranges[index];
    const toRange = ranges[index + 1];
    const transition = getTransitionBetween(
      normalizedTransitions,
      fromRange.clip.id,
      toRange.clip.id
    );

    if (!transition) continue;

    const start = fromRange.end - transition.duration;
    const end = fromRange.end;
    if (time < start || time > end) continue;

    const progress = clamp((time - start) / transition.duration, 0, 1);
    const nextSourceTime = clamp(
      toRange.clip.sourceStart + (time - toRange.start) * normalizeSpeed(toRange.clip.speed),
      toRange.clip.sourceStart,
      toRange.clip.sourceEnd
    );

    return {
      transition,
      progress,
      nextSourceTime
    };
  }

  return null;
}

export function splitClipAtTimelineTime(
  clips: VideoClip[],
  transitions: ClipTransition[],
  time: number
) {
  const ranges = getClipTimelineRanges(clips, transitions);
  const range = findClipRangeAtTime(ranges, time);
  if (!range) return null;

  const sourceTime = timelineToSourceTime(ranges, time);
  if (
    sourceTime - range.clip.sourceStart < MIN_CLIP_SOURCE_DURATION ||
    range.clip.sourceEnd - sourceTime < MIN_CLIP_SOURCE_DURATION
  ) {
    return null;
  }

  const firstClip: VideoClip = {
    ...range.clip,
    sourceEnd: sourceTime
  };
  const secondClip: VideoClip = {
    ...range.clip,
    id: crypto.randomUUID(),
    sourceStart: sourceTime
  };
  const nextClips = [
    ...clips.slice(0, range.index),
    firstClip,
    secondClip,
    ...clips.slice(range.index + 1)
  ];
  const nextTransitions = normalizeTransitionsForClips(
    nextClips,
    transitions.map((transition) => {
      if (transition.fromClipId === range.clip.id) {
        return { ...transition, fromClipId: secondClip.id };
      }
      return transition;
    })
  );

  return {
    clips: nextClips,
    transitions: nextTransitions,
    selectedClipId: secondClip.id
  };
}

export function removeTimelineRange(
  clips: VideoClip[],
  transitions: ClipTransition[],
  start: number,
  end: number
) {
  const ranges = getClipTimelineRanges(clips, transitions);
  const timelineDuration = Math.max(0, ranges[ranges.length - 1]?.end ?? 0);
  const rangeStart = clamp(Math.min(start, end), 0, timelineDuration);
  const rangeEnd = clamp(Math.max(start, end), 0, timelineDuration);

  if (rangeEnd - rangeStart < MIN_CLIP_SOURCE_DURATION) return null;

  const nextClips: VideoClip[] = [];

  ranges.forEach((range) => {
    if (range.end <= rangeStart || range.start >= rangeEnd) {
      nextClips.push(range.clip);
      return;
    }

    const keepBeforeEnd = Math.min(rangeStart, range.end);
    const keepAfterStart = Math.max(rangeEnd, range.start);
    const hasBefore = keepBeforeEnd - range.start >= MIN_CLIP_SOURCE_DURATION;
    const hasAfter = range.end - keepAfterStart >= MIN_CLIP_SOURCE_DURATION;

    if (hasBefore) {
      nextClips.push({
        ...range.clip,
        sourceEnd: rangeTimelineToSourceTime(range, keepBeforeEnd)
      });
    }

    if (hasAfter) {
      nextClips.push({
        ...range.clip,
        id: hasBefore ? crypto.randomUUID() : range.clip.id,
        sourceStart: rangeTimelineToSourceTime(range, keepAfterStart)
      });
    }
  });

  if (nextClips.length === 0) return null;

  const nextTransitions = normalizeTransitionsForClips(nextClips, transitions);
  const nextRanges = getClipTimelineRanges(nextClips, nextTransitions);
  const selectedRange =
    nextRanges.find((range) => range.end > rangeStart) ?? nextRanges[nextRanges.length - 1];

  return {
    clips: nextClips,
    transitions: nextTransitions,
    selectedClipId: selectedRange?.clip.id
  };
}

export function insertDuplicateClipAfter(
  clips: VideoClip[],
  transitions: ClipTransition[],
  clipId: string
) {
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return null;

  const clone: VideoClip = {
    ...clips[index],
    id: crypto.randomUUID()
  };
  const nextClips = [...clips.slice(0, index + 1), clone, ...clips.slice(index + 1)];
  const nextClip = clips[index + 1];
  const nextTransitions = transitions.map((transition) => {
    if (nextClip && transition.fromClipId === clips[index].id && transition.toClipId === nextClip.id) {
      return { ...transition, fromClipId: clone.id };
    }
    return transition;
  });

  return {
    clips: nextClips,
    transitions: normalizeTransitionsForClips(nextClips, nextTransitions),
    selectedClipId: clone.id
  };
}

export function deleteClipRipple(
  clips: VideoClip[],
  transitions: ClipTransition[],
  clipId: string
) {
  if (clips.length <= 1) return null;

  const nextClips = clips.filter((clip) => clip.id !== clipId);
  return {
    clips: nextClips,
    transitions: normalizeTransitionsForClips(
      nextClips,
      transitions.filter(
        (transition) =>
          transition.fromClipId !== clipId && transition.toClipId !== clipId
      )
    )
  };
}

export function reorderClipRipple(
  clips: VideoClip[],
  transitions: ClipTransition[],
  clipId: string,
  targetIndex: number
) {
  const fromIndex = clips.findIndex((clip) => clip.id === clipId);
  if (fromIndex < 0 || clips.length <= 1) return null;

  const toIndex = clamp(Math.round(targetIndex), 0, clips.length - 1);
  if (fromIndex === toIndex) return null;

  const nextClips = [...clips];
  const [clip] = nextClips.splice(fromIndex, 1);
  nextClips.splice(toIndex, 0, clip);

  return {
    clips: nextClips,
    transitions: normalizeTransitionsForClips(nextClips, transitions),
    selectedClipId: clip.id,
    fromIndex,
    toIndex
  };
}

export function moveClipByOffset(
  clips: VideoClip[],
  transitions: ClipTransition[],
  clipId: string,
  offset: number
) {
  const fromIndex = clips.findIndex((clip) => clip.id === clipId);
  if (fromIndex < 0) return null;

  return reorderClipRipple(clips, transitions, clipId, fromIndex + offset);
}

export function createOrUpdateTransition(
  clips: VideoClip[],
  transitions: ClipTransition[],
  fromClipId: string,
  kind: ClipTransitionKind,
  duration = DEFAULT_TRANSITION_DURATION
) {
  const fromIndex = clips.findIndex((clip) => clip.id === fromClipId);
  const fromClip = clips[fromIndex];
  const toClip = clips[fromIndex + 1];
  if (!fromClip || !toClip) return normalizeTransitionsForClips(clips, transitions);

  const nextTransition: ClipTransition = {
    id:
      getTransitionBetween(transitions, fromClip.id, toClip.id)?.id ??
      crypto.randomUUID(),
    fromClipId: fromClip.id,
    toClipId: toClip.id,
    kind,
    duration: clampTransitionDuration(duration, fromClip, toClip)
  };

  return normalizeTransitionsForClips(
    clips,
    [
      ...transitions.filter(
        (transition) =>
          transition.fromClipId !== fromClip.id || transition.toClipId !== toClip.id
      ),
      nextTransition
    ]
  );
}

export function removeTransitionAfter(
  clips: VideoClip[],
  transitions: ClipTransition[],
  fromClipId: string
) {
  const fromIndex = clips.findIndex((clip) => clip.id === fromClipId);
  const toClip = clips[fromIndex + 1];
  if (!toClip) return transitions;

  return transitions.filter(
    (transition) =>
      transition.fromClipId !== fromClipId || transition.toClipId !== toClip.id
  );
}

export function buildAtempoChain(speed: number) {
  const factors: number[] = [];
  let remaining = normalizeSpeed(speed);

  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }

  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }

  factors.push(remaining);

  return factors.map((factor) => `atempo=${formatFilterNumber(factor)}`);
}

export function formatFilterNumber(value: number) {
  return Number(value.toFixed(4)).toString();
}
