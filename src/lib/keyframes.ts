import type { Keyframe, KeyframeEasing, KeyframeProperty, KeyframeTargetKind } from './types';

export function createKeyframe(
  targetKind: KeyframeTargetKind,
  targetId: string,
  property: KeyframeProperty,
  time: number,
  value: number,
  easing: KeyframeEasing = 'linear'
): Keyframe {
  return {
    id: crypto.randomUUID(),
    targetKind,
    targetId,
    property,
    time: Math.max(0, time),
    value,
    easing
  };
}

export function getKeyframedValue(
  keyframes: Keyframe[],
  targetKind: KeyframeTargetKind,
  targetId: string,
  property: KeyframeProperty,
  time: number,
  fallback: number
) {
  const points = keyframes
    .filter(
      (keyframe) =>
        keyframe.targetKind === targetKind &&
        keyframe.targetId === targetId &&
        keyframe.property === property
    )
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) return fallback;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;

  const next = points.find((point) => point.time >= time);
  if (!next) return fallback;
  const previous = points[Math.max(0, points.indexOf(next) - 1)];
  const span = Math.max(0.001, next.time - previous.time);
  const progress = applyEasing((time - previous.time) / span, next.easing);

  return previous.value + (next.value - previous.value) * progress;
}

function applyEasing(progress: number, easing: KeyframeEasing) {
  const t = Math.max(0, Math.min(progress, 1));
  if (easing === 'ease-in') return t * t;
  if (easing === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (easing === 'ease-in-out') {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  return t;
}
