import {
  defaultCaptionStyle,
  defaultInteractionEffect,
  defaultTextOverlay,
  builtinPreviewFontFamily,
  type CaptionCue,
  type ClipTransition,
  type ClipTransitionKind,
  type CaptionPosition,
  type CaptionStyle,
  type InteractionEffect,
  type InteractionEffectKind,
  type ProjectMediaMeta,
  type ProjectFile,
  type TextAlign,
  type TextOverlay,
  type VideoClip
} from './types';
import { clamp, coerceCueBounds } from './time';
import { sortCues } from './subtitle';
import {
  DEFAULT_TRANSITION_DURATION,
  normalizeSpeed,
  normalizeTransitionsForClips
} from './video-edit';

const positions = new Set<CaptionPosition>(['bottom', 'middle', 'top']);
const alignments = new Set<TextAlign>(['left', 'center', 'right']);
const transitionKinds = new Set<ClipTransitionKind>([
  'fade',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown'
]);
const effectKinds = new Set<InteractionEffectKind>([
  'tap',
  'click',
  'pulse',
  'spotlight',
  'swipe',
  'target',
  'cursor',
  'finger'
]);

export function normalizeProjectFile(input: unknown): ProjectFile {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.cues)) {
    throw new Error('지원하지 않는 프로젝트 파일입니다.');
  }

  const cues = sortCues(input.cues.map(normalizeCue).filter(Boolean) as CaptionCue[]);
  const overlays = Array.isArray(input.overlays)
    ? (input.overlays.map(normalizeOverlay).filter(Boolean) as TextOverlay[])
    : [];
  const effects = Array.isArray(input.effects)
    ? (input.effects.map(normalizeEffect).filter(Boolean) as InteractionEffect[])
    : [];
  const videoClips = Array.isArray(input.videoClips)
    ? (input.videoClips.map(normalizeVideoClipInput).filter(Boolean) as VideoClip[])
    : [];
  const transitions = Array.isArray(input.transitions)
    ? normalizeTransitionsForClips(
        videoClips,
        input.transitions.map(normalizeTransition).filter(Boolean) as ClipTransition[]
      )
    : [];
  const createdAt = stringOr(input.createdAt, new Date().toISOString());
  const updatedAt = stringOr(input.updatedAt, createdAt);

  return {
    version: 1,
    videoName: typeof input.videoName === 'string' ? input.videoName : undefined,
    mediaMeta: normalizeMediaMeta(input.mediaMeta),
    cues,
    overlays,
    effects,
    videoClips,
    transitions,
    createdAt,
    updatedAt
  };
}

function normalizeMediaMeta(input: unknown): ProjectMediaMeta | undefined {
  if (!isRecord(input) || typeof input.name !== 'string') return undefined;

  const size = finiteNumber(input.size, 0);
  const lastModified = finiteNumber(input.lastModified, 0);
  const duration = optionalFiniteNumber(input.duration);
  const width = optionalFiniteNumber(input.width);
  const height = optionalFiniteNumber(input.height);

  return {
    name: input.name,
    size: Math.max(0, size),
    lastModified: Math.max(0, lastModified),
    ...(duration !== undefined ? { duration: Math.max(0, duration) } : {}),
    ...(width !== undefined ? { width: Math.max(0, Math.round(width)) } : {}),
    ...(height !== undefined ? { height: Math.max(0, Math.round(height)) } : {})
  };
}

function normalizeCue(input: unknown): CaptionCue | null {
  if (!isRecord(input)) return null;

  const start = finiteNumber(input.start, 0);
  const end = finiteNumber(input.end, start + 3);
  const bounds = coerceCueBounds(start, end);
  const style = normalizeCaptionStyle(input.style);
  const position = positions.has(input.position as CaptionPosition)
    ? (input.position as CaptionPosition)
    : 'bottom';

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    start: bounds.start,
    end: bounds.end,
    text: stringOr(input.text, ''),
    style,
    position
  };
}

function normalizeOverlay(input: unknown): TextOverlay | null {
  if (!isRecord(input)) return null;

  const start = finiteNumber(input.start, 0);
  const end = finiteNumber(input.end, start + 3);
  const bounds = coerceCueBounds(start, end);

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    start: bounds.start,
    end: bounds.end,
    text: stringOr(input.text, defaultTextOverlay.text),
    x: clamp(finiteNumber(input.x, defaultTextOverlay.x), 0, 100),
    y: clamp(finiteNumber(input.y, defaultTextOverlay.y), 0, 100),
    fontFamily: stringOr(input.fontFamily, defaultTextOverlay.fontFamily),
    fontSize: clamp(finiteNumber(input.fontSize, defaultTextOverlay.fontSize), 10, 180),
    fontWeight: clamp(finiteNumber(input.fontWeight, defaultTextOverlay.fontWeight), 100, 900),
    italic: booleanOr(input.italic, defaultTextOverlay.italic),
    underline: booleanOr(input.underline, defaultTextOverlay.underline),
    align: alignments.has(input.align as TextAlign)
      ? (input.align as TextAlign)
      : defaultTextOverlay.align,
    scaleX: clamp(finiteNumber(input.scaleX, defaultTextOverlay.scaleX), 0.25, 4),
    scaleY: clamp(finiteNumber(input.scaleY, defaultTextOverlay.scaleY), 0.25, 4),
    color: colorOr(input.color, defaultTextOverlay.color),
    background: cssColorOr(input.background, defaultTextOverlay.background),
    outlineColor: colorOr(input.outlineColor, defaultTextOverlay.outlineColor),
    outlineWidth: clamp(
      finiteNumber(input.outlineWidth, defaultTextOverlay.outlineWidth),
      0,
      24
    ),
    shadow: booleanOr(input.shadow, defaultTextOverlay.shadow)
  };
}

function normalizeEffect(input: unknown): InteractionEffect | null {
  if (!isRecord(input)) return null;

  const start = finiteNumber(input.start, 0);
  const end = finiteNumber(input.end, start + 0.9);
  const bounds = coerceCueBounds(start, end);
  const kind = effectKinds.has(input.kind as InteractionEffectKind)
    ? (input.kind as InteractionEffectKind)
    : defaultInteractionEffect.kind;

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    start: bounds.start,
    end: bounds.end,
    kind,
    x: clamp(finiteNumber(input.x, defaultInteractionEffect.x), 0, 100),
    y: clamp(finiteNumber(input.y, defaultInteractionEffect.y), 0, 100),
    size: clamp(finiteNumber(input.size, defaultInteractionEffect.size), 24, 260),
    color: colorOr(input.color, defaultInteractionEffect.color),
    label: stringOr(input.label, defaultInteractionEffect.label)
  };
}

function normalizeVideoClipInput(input: unknown): VideoClip | null {
  if (!isRecord(input)) return null;

  const sourceStart = clamp(finiteNumber(input.sourceStart, 0), 0, Number.MAX_SAFE_INTEGER);
  const sourceEnd = Math.max(
    sourceStart + 0.2,
    finiteNumber(input.sourceEnd, sourceStart + 3)
  );

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    sourceStart,
    sourceEnd,
    speed: normalizeSpeed(finiteNumber(input.speed, 1)),
    muted: booleanOr(input.muted, false)
  };
}

function normalizeTransition(input: unknown): ClipTransition | null {
  if (!isRecord(input)) return null;
  if (typeof input.fromClipId !== 'string' || typeof input.toClipId !== 'string') {
    return null;
  }

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    fromClipId: input.fromClipId,
    toClipId: input.toClipId,
    kind: transitionKinds.has(input.kind as ClipTransitionKind)
      ? (input.kind as ClipTransitionKind)
      : 'fade',
    duration: clamp(finiteNumber(input.duration, DEFAULT_TRANSITION_DURATION), 0, 10)
  };
}

function normalizeCaptionStyle(input: unknown): CaptionStyle {
  const source = isRecord(input) ? input : {};

  return {
    fontFamily: stringOr(source.fontFamily, builtinPreviewFontFamily),
    fontSize: clamp(finiteNumber(source.fontSize, defaultCaptionStyle.fontSize), 10, 180),
    fontWeight: clamp(
      finiteNumber(source.fontWeight, defaultCaptionStyle.fontWeight),
      100,
      900
    ),
    color: colorOr(source.color, defaultCaptionStyle.color),
    background: cssColorOr(source.background, defaultCaptionStyle.background),
    outlineColor: colorOr(source.outlineColor, defaultCaptionStyle.outlineColor),
    outlineWidth: clamp(
      finiteNumber(source.outlineWidth, defaultCaptionStyle.outlineWidth),
      0,
      24
    ),
    shadow: booleanOr(source.shadow, defaultCaptionStyle.shadow),
    align: alignments.has(source.align as TextAlign)
      ? (source.align as TextAlign)
      : defaultCaptionStyle.align
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function colorOr(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function cssColorOr(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.test(value)) {
    return value;
  }

  return fallback;
}
