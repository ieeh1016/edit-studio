import type { AudioClip, AudioSourceKind, AudioSourceMeta, VideoClip } from './types';
import { clamp, MIN_CUE_DURATION } from './time';

export const DEFAULT_AUDIO_VOLUME = 1;
export const MAX_AUDIO_VOLUME = 2;
export const DEFAULT_AUDIO_FADE = 0;

export function normalizeAudioVolume(value: number | undefined) {
  return clamp(
    typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_AUDIO_VOLUME,
    0,
    MAX_AUDIO_VOLUME
  );
}

export function normalizeAudioFade(value: number | undefined, duration = Number.MAX_SAFE_INTEGER) {
  const safeDuration = Math.max(0, duration);
  return clamp(
    typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_AUDIO_FADE,
    0,
    Math.max(0, safeDuration / 2)
  );
}

export function getAudioClipDuration(clip: Pick<AudioClip, 'start' | 'end'>) {
  return Math.max(0, clip.end - clip.start);
}

export function getAudioSourceDuration(source: Pick<AudioSourceMeta, 'duration'>) {
  return Math.max(MIN_CUE_DURATION, source.duration || MIN_CUE_DURATION);
}

export function createAudioSourceMeta(
  file: File,
  kind: AudioSourceKind,
  duration = MIN_CUE_DURATION
): AudioSourceMeta {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    duration: getAudioSourceDuration({ duration }),
    kind
  };
}

export function createAudioClip(
  source: AudioSourceMeta,
  start: number,
  timelineDuration: number
): AudioClip {
  const sourceDuration = getAudioSourceDuration(source);
  const safeStart = Math.max(0, start);
  const maxEnd = Math.max(safeStart + MIN_CUE_DURATION, timelineDuration || sourceDuration);
  const end = clamp(safeStart + sourceDuration, safeStart + MIN_CUE_DURATION, maxEnd);
  const sourceEnd = Math.min(sourceDuration, end - safeStart);

  return {
    id: crypto.randomUUID(),
    sourceId: source.id,
    start: safeStart,
    end,
    sourceStart: 0,
    sourceEnd: Math.max(MIN_CUE_DURATION, sourceEnd),
    volume: DEFAULT_AUDIO_VOLUME,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    label: source.name.replace(/\.[^.]+$/, '')
  };
}

export function normalizeVideoClipAudio(clip: VideoClip): VideoClip {
  const duration = Math.max(MIN_CUE_DURATION, clip.sourceEnd - clip.sourceStart);

  return {
    ...clip,
    volume: normalizeAudioVolume(clip.volume),
    fadeIn: normalizeAudioFade(clip.fadeIn, duration),
    fadeOut: normalizeAudioFade(clip.fadeOut, duration)
  };
}

export function normalizeAudioClip(clip: AudioClip, source?: AudioSourceMeta): AudioClip {
  const sourceDuration = source ? getAudioSourceDuration(source) : Number.MAX_SAFE_INTEGER;
  const start = Math.max(0, clip.start);
  const end = Math.max(start + MIN_CUE_DURATION, clip.end);
  const duration = end - start;
  const sourceStart = clamp(clip.sourceStart, 0, Math.max(0, sourceDuration - MIN_CUE_DURATION));
  const sourceEnd = clamp(
    clip.sourceEnd,
    sourceStart + MIN_CUE_DURATION,
    Math.min(sourceDuration, sourceStart + duration)
  );

  return {
    ...clip,
    start,
    end,
    sourceStart,
    sourceEnd,
    volume: normalizeAudioVolume(clip.volume),
    muted: Boolean(clip.muted),
    fadeIn: normalizeAudioFade(clip.fadeIn, duration),
    fadeOut: normalizeAudioFade(clip.fadeOut, duration),
    label: clip.label || source?.name.replace(/\.[^.]+$/, '') || '오디오'
  };
}

export function moveAudioClipTo(
  clip: AudioClip,
  start: number,
  timelineDuration: number
): AudioClip {
  const duration = getAudioClipDuration(clip);
  const nextStart = clamp(start, 0, Math.max(0, timelineDuration - duration));

  return {
    ...clip,
    start: nextStart,
    end: nextStart + duration
  };
}

export function trimAudioClip(
  clip: AudioClip,
  edge: 'start' | 'end',
  time: number,
  source?: AudioSourceMeta
): AudioClip {
  if (edge === 'start') {
    const nextStart = clamp(time, 0, clip.end - MIN_CUE_DURATION);
    const shift = nextStart - clip.start;
    return normalizeAudioClip(
      {
        ...clip,
        start: nextStart,
        sourceStart: clip.sourceStart + shift
      },
      source
    );
  }

  const maxEnd = source
    ? clip.start + Math.max(MIN_CUE_DURATION, source.duration - clip.sourceStart)
    : Number.MAX_SAFE_INTEGER;
  return normalizeAudioClip(
    {
      ...clip,
      end: clamp(time, clip.start + MIN_CUE_DURATION, maxEnd),
      sourceEnd: clip.sourceStart + clamp(time - clip.start, MIN_CUE_DURATION, maxEnd - clip.start)
    },
    source
  );
}
