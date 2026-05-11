import {
  defaultCaptionStyle,
  defaultCanvasSettings,
  defaultInteractionEffect,
  defaultTextOverlay,
  defaultVideoTransform,
  builtinPreviewFontFamily,
  type AudioClip,
  type AudioSourceKind,
  type AudioSourceMeta,
  type CanvasAspectPreset,
  type CanvasSettings,
  type CaptionCue,
  type ClipTransition,
  type ClipTransitionKind,
  type CaptionPosition,
  type CaptionStyle,
  type CropSettings,
  type InteractionEffect,
  type InteractionEffectKind,
  type ImageClip,
  type Keyframe,
  type KeyframeEasing,
  type KeyframeProperty,
  type KeyframeTargetKind,
  type MediaSourceKind,
  type MediaSourceMeta,
  type ProjectMediaMeta,
  type ProjectFile,
  type TextAlign,
  type TextOverlay,
  type VideoClip,
  primaryVideoSourceId
} from './types';
import { clamp, coerceCueBounds } from './time';
import { sortCues } from './subtitle';
import {
  normalizeAudioClip,
  normalizeAudioFade,
  normalizeAudioVolume
} from './audio-edit';
import {
  DEFAULT_TRANSITION_DURATION,
  normalizeSpeed,
  normalizeTransitionsForClips
} from './video-edit';

const audioSourceKinds = new Set<AudioSourceKind>(['music', 'effect']);
const mediaSourceKinds = new Set<MediaSourceKind>(['video', 'image', 'audio']);
const canvasPresets = new Set<CanvasAspectPreset>(['source', '16:9', '9:16', '1:1', 'custom']);
const keyframeTargets = new Set<KeyframeTargetKind>(['video', 'overlay', 'effect', 'audio']);
const keyframeProperties = new Set<KeyframeProperty>([
  'x',
  'y',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'size',
  'volume'
]);
const keyframeEasings = new Set<KeyframeEasing>([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out'
]);
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
  const mediaSources = normalizeMediaSources(input);
  const primarySourceId = mediaSources.find((source) => source.kind === 'video')?.id ?? primaryVideoSourceId;
  const videoClips = Array.isArray(input.videoClips)
    ? (input.videoClips
        .map((clip) => normalizeVideoClipInput(clip, primarySourceId))
        .filter(Boolean) as VideoClip[])
    : [];
  const imageClips = Array.isArray(input.imageClips)
    ? (input.imageClips
        .map((clip) => normalizeImageClipInput(clip, mediaSources))
        .filter(Boolean) as ImageClip[])
    : [];
  const transitions = Array.isArray(input.transitions)
    ? normalizeTransitionsForClips(
        videoClips,
        input.transitions.map(normalizeTransition).filter(Boolean) as ClipTransition[]
      )
    : [];
  const audioSources = Array.isArray(input.audioSources)
    ? (input.audioSources.map(normalizeAudioSource).filter(Boolean) as AudioSourceMeta[])
    : [];
  const audioSourceMap = new Map(audioSources.map((source) => [source.id, source]));
  const audioClips = Array.isArray(input.audioClips)
    ? (input.audioClips
        .map((clip) => normalizeAudioClipInput(clip, audioSourceMap))
        .filter(Boolean) as AudioClip[])
    : [];
  const keyframes = Array.isArray(input.keyframes)
    ? (input.keyframes.map(normalizeKeyframe).filter(Boolean) as Keyframe[])
    : [];
  const createdAt = stringOr(input.createdAt, new Date().toISOString());
  const updatedAt = stringOr(input.updatedAt, createdAt);

  return {
    version: 1,
    videoName: typeof input.videoName === 'string' ? input.videoName : undefined,
    mediaMeta: normalizeMediaMeta(input.mediaMeta),
    mediaSources,
    cues,
    overlays,
    effects,
    videoClips,
    imageClips,
    transitions,
    audioSources,
    audioClips,
    keyframes,
    canvasSettings: normalizeCanvasSettings(input.canvasSettings),
    createdAt,
    updatedAt
  };
}

function normalizeMediaSources(input: Record<string, unknown>): MediaSourceMeta[] {
  const sources = Array.isArray(input.mediaSources)
    ? (input.mediaSources.map(normalizeMediaSource).filter(Boolean) as MediaSourceMeta[])
    : [];

  if (sources.length > 0) return sources;

  const mediaMeta = normalizeMediaMeta(input.mediaMeta);
  const fallbackName = typeof input.videoName === 'string' ? input.videoName : undefined;
  if (!mediaMeta && !fallbackName) return [];

  return [
    {
      id: primaryVideoSourceId,
      kind: 'video',
      name: mediaMeta?.name ?? fallbackName ?? 'source.mp4',
      size: mediaMeta?.size ?? 0,
      lastModified: mediaMeta?.lastModified ?? 0,
      ...(mediaMeta?.duration !== undefined ? { duration: mediaMeta.duration } : {}),
      ...(mediaMeta?.width !== undefined ? { width: mediaMeta.width } : {}),
      ...(mediaMeta?.height !== undefined ? { height: mediaMeta.height } : {})
    }
  ];
}

function normalizeMediaSource(input: unknown): MediaSourceMeta | null {
  if (!isRecord(input) || typeof input.name !== 'string') return null;
  const kind = mediaSourceKinds.has(input.kind as MediaSourceKind)
    ? (input.kind as MediaSourceKind)
    : 'video';
  const duration = optionalFiniteNumber(input.duration);
  const width = optionalFiniteNumber(input.width);
  const height = optionalFiniteNumber(input.height);

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    kind,
    name: input.name,
    size: Math.max(0, finiteNumber(input.size, 0)),
    lastModified: Math.max(0, finiteNumber(input.lastModified, 0)),
    ...(duration !== undefined ? { duration: Math.max(0, duration) } : {}),
    ...(width !== undefined ? { width: Math.max(0, Math.round(width)) } : {}),
    ...(height !== undefined ? { height: Math.max(0, Math.round(height)) } : {})
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
    shadow: booleanOr(input.shadow, defaultTextOverlay.shadow),
    opacity: clamp(finiteNumber(input.opacity, defaultTextOverlay.opacity ?? 1), 0, 1)
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

function normalizeVideoClipInput(input: unknown, fallbackSourceId: string): VideoClip | null {
  if (!isRecord(input)) return null;

  const sourceStart = clamp(finiteNumber(input.sourceStart, 0), 0, Number.MAX_SAFE_INTEGER);
  const sourceEnd = Math.max(
    sourceStart + 0.2,
    finiteNumber(input.sourceEnd, sourceStart + 3)
  );
  const crop = normalizeCrop(input.crop);

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    sourceId: stringOr(input.sourceId, fallbackSourceId),
    sourceStart,
    sourceEnd,
    speed: normalizeSpeed(finiteNumber(input.speed, 1)),
    muted: booleanOr(input.muted, false),
    volume: normalizeAudioVolume(optionalFiniteNumber(input.volume)),
    fadeIn: normalizeAudioFade(optionalFiniteNumber(input.fadeIn), sourceEnd - sourceStart),
    fadeOut: normalizeAudioFade(optionalFiniteNumber(input.fadeOut), sourceEnd - sourceStart),
    x: clamp(finiteNumber(input.x, defaultVideoTransform.x), 0, 100),
    y: clamp(finiteNumber(input.y, defaultVideoTransform.y), 0, 100),
    scale: clamp(finiteNumber(input.scale, defaultVideoTransform.scale), 0.1, 8),
    rotation: clamp(finiteNumber(input.rotation, defaultVideoTransform.rotation), -180, 180),
    opacity: clamp(finiteNumber(input.opacity, defaultVideoTransform.opacity), 0, 1),
    crop
  };
}

function normalizeCrop(input: unknown): CropSettings {
  const source = isRecord(input) ? input : {};
  return {
    left: clamp(finiteNumber(source.left, defaultVideoTransform.crop.left), 0, 90),
    right: clamp(finiteNumber(source.right, defaultVideoTransform.crop.right), 0, 90),
    top: clamp(finiteNumber(source.top, defaultVideoTransform.crop.top), 0, 90),
    bottom: clamp(finiteNumber(source.bottom, defaultVideoTransform.crop.bottom), 0, 90)
  };
}

function normalizeImageClipInput(
  input: unknown,
  mediaSources: MediaSourceMeta[]
): ImageClip | null {
  if (!isRecord(input) || typeof input.sourceId !== 'string') return null;
  const source = mediaSources.find((item) => item.id === input.sourceId && item.kind === 'image');
  if (!source) return null;
  const start = finiteNumber(input.start, 0);
  const end = finiteNumber(input.end, start + 3);
  const bounds = coerceCueBounds(start, end);

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    sourceId: source.id,
    start: bounds.start,
    end: bounds.end,
    x: clamp(finiteNumber(input.x, 50), 0, 100),
    y: clamp(finiteNumber(input.y, 50), 0, 100),
    scale: clamp(finiteNumber(input.scale, 1), 0.05, 8),
    rotation: clamp(finiteNumber(input.rotation, 0), -180, 180),
    opacity: clamp(finiteNumber(input.opacity, 1), 0, 1)
  };
}

function normalizeKeyframe(input: unknown): Keyframe | null {
  if (!isRecord(input)) return null;
  if (typeof input.targetId !== 'string') return null;
  const targetKind = keyframeTargets.has(input.targetKind as KeyframeTargetKind)
    ? (input.targetKind as KeyframeTargetKind)
    : 'video';
  const property = keyframeProperties.has(input.property as KeyframeProperty)
    ? (input.property as KeyframeProperty)
    : 'x';
  const easing = keyframeEasings.has(input.easing as KeyframeEasing)
    ? (input.easing as KeyframeEasing)
    : 'linear';

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    targetId: input.targetId,
    targetKind,
    property,
    time: Math.max(0, finiteNumber(input.time, 0)),
    value: finiteNumber(input.value, 0),
    easing
  };
}

function normalizeCanvasSettings(input: unknown): CanvasSettings {
  if (!isRecord(input)) return defaultCanvasSettings;
  const preset = canvasPresets.has(input.preset as CanvasAspectPreset)
    ? (input.preset as CanvasAspectPreset)
    : defaultCanvasSettings.preset;

  return {
    preset,
    width: clamp(Math.round(finiteNumber(input.width, defaultCanvasSettings.width)), 120, 7680),
    height: clamp(Math.round(finiteNumber(input.height, defaultCanvasSettings.height)), 120, 7680)
  };
}

function normalizeAudioSource(input: unknown): AudioSourceMeta | null {
  if (!isRecord(input) || typeof input.name !== 'string') return null;

  return {
    id: stringOr(input.id, crypto.randomUUID()),
    name: input.name,
    size: Math.max(0, finiteNumber(input.size, 0)),
    lastModified: Math.max(0, finiteNumber(input.lastModified, 0)),
    duration: Math.max(0.2, finiteNumber(input.duration, 0.2)),
    kind: audioSourceKinds.has(input.kind as AudioSourceKind)
      ? (input.kind as AudioSourceKind)
      : 'music'
  };
}

function normalizeAudioClipInput(
  input: unknown,
  audioSourceMap: Map<string, AudioSourceMeta>
): AudioClip | null {
  if (!isRecord(input) || typeof input.sourceId !== 'string') return null;

  const source = audioSourceMap.get(input.sourceId);
  if (!source) return null;
  const start = finiteNumber(input.start, 0);
  const end = finiteNumber(input.end, start + Math.min(source.duration, 3));

  return normalizeAudioClip(
    {
      id: stringOr(input.id, crypto.randomUUID()),
      sourceId: input.sourceId,
      start,
      end,
      sourceStart: finiteNumber(input.sourceStart, 0),
      sourceEnd: finiteNumber(input.sourceEnd, end - start),
      volume: normalizeAudioVolume(optionalFiniteNumber(input.volume)),
      muted: booleanOr(input.muted, false),
      fadeIn: normalizeAudioFade(optionalFiniteNumber(input.fadeIn), end - start),
      fadeOut: normalizeAudioFade(optionalFiniteNumber(input.fadeOut), end - start),
      label: stringOr(input.label, source.name.replace(/\.[^.]+$/, ''))
    },
    source
  );
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
