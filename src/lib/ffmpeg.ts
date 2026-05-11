import { buildAssScript } from './ass';
import type {
  CaptionCue,
  ClipTransition,
  ExportPreset,
  InteractionEffect,
  TextOverlay,
  VideoClip,
  VideoDimensions
} from './types';
import {
  buildAtempoChain,
  createDefaultVideoClip,
  formatFilterNumber,
  getClipOutputDuration,
  normalizeTransitionsForClips
} from './video-edit';

import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

interface ExportOptions {
  preset: ExportPreset;
  dimensions: VideoDimensions;
  sourceDuration?: number;
  hasAudio?: boolean;
  fontFiles?: File[];
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onLog?: (message: string) => void;
  onStatus?: (message: string) => void;
}

type FFmpegInstance = import('@ffmpeg/ffmpeg').FFmpeg;
export type ExportFailureKind = 'engine' | 'codec' | 'memory' | 'audio' | 'filter' | 'cancelled' | 'unknown';

export class ExportRenderError extends Error {
  kind: ExportFailureKind;
  cause?: unknown;

  constructor(kind: ExportFailureKind, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ExportRenderError';
    this.kind = kind;
    this.cause = options?.cause;
  }
}

let ffmpegInstancePromise: Promise<FFmpegInstance> | null = null;
let activeFfmpeg: FFmpegInstance | null = null;
let currentCallbacks: Pick<ExportOptions, 'onLog' | 'onProgress' | 'onStatus'> = {};

const ffmpegLoadTimeoutMs = 90_000;
const ffmpegLoadTimeoutMessage =
  'FFmpeg 엔진 로딩이 너무 오래 걸립니다. 취소 후 페이지를 새로고침하고 다시 시도해 주세요.';
const devClassWorkerURL = '/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js';

export async function exportVideoWithBurnedSubtitles(
  videoFile: File,
  cues: CaptionCue[],
  overlays: TextOverlay[],
  effects: InteractionEffect[],
  videoClips: VideoClip[],
  transitions: ClipTransition[],
  options: ExportOptions
) {
  const outputDimensions = getExportDimensions(options.dimensions, options.preset);
  const assScript = buildAssScript(cues, overlays, outputDimensions, effects);
  const clips =
    videoClips.length > 0
      ? videoClips
      : options.sourceDuration
        ? [createDefaultVideoClip(options.sourceDuration)]
        : [];

  if (clips.length === 0) {
    throw new Error('영상 클립 정보를 만들 수 없습니다.');
  }

  options.onStatus?.('FFmpeg 엔진을 불러오는 중');
  const ffmpeg = await loadFfmpeg(options);
  options.onStatus?.('영상 파일을 브라우저 메모리에 준비하는 중');
  const { fetchFile } = await import('@ffmpeg/util');
  const extension = videoFile.name.split('.').pop()?.toLowerCase() || 'mp4';
  const jobId = crypto.randomUUID();
  const inputName = `input-${jobId}.${extension}`;
  const subtitleName = `captions-${jobId}.ass`;
  const fontDirName = `fonts-${jobId}`;
  const fontName = `${fontDirName}/AppleGothic.ttf`;
  const localFontNames = (options.fontFiles ?? []).map((file, index) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'ttf';
    return `${fontDirName}/local-font-${index}.${extension}`;
  });
  const outputName = `captioned-output-${jobId}.mp4`;

  try {
    options.onProgress?.(0.1);
    await ffmpeg.createDir(fontDirName, { signal: options.signal });
    await Promise.all([
      ffmpeg.writeFile(inputName, await fetchFile(videoFile), {
        signal: options.signal
      }),
      ffmpeg.writeFile(subtitleName, new TextEncoder().encode(assScript), {
        signal: options.signal
      }),
      ffmpeg.writeFile(fontName, await fetchFont(), { signal: options.signal }),
      ...(options.fontFiles ?? []).map(async (file, index) =>
        ffmpeg.writeFile(localFontNames[index], await fetchFile(file), {
          signal: options.signal
        })
      )
    ]);

    const renderWithAudioMode = async (hasAudio: boolean) => {
      options.onStatus?.('컷, 속도, 전환 필터를 구성하는 중');
      options.onProgress?.(0.14);
      const filterGraph = buildVideoEditFilterGraph({
        clips,
        transitions,
        outputDimensions,
        subtitleName,
        fontDirName,
        hasAudio
      });

      options.onStatus?.('MP4 렌더링 중');
      return ffmpeg.exec(
        [
          '-i',
          inputName,
          '-sn',
          '-filter_complex',
          filterGraph,
          '-map',
          '[outv]',
          '-map',
          '[outa]',
          '-c:v',
          'libx264',
          '-preset',
          options.preset === 'fast720' ? 'veryfast' : 'medium',
          '-crf',
          options.preset === 'fast720' ? '24' : '21',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-movflags',
          'faststart',
          outputName
        ],
        -1,
        { signal: options.signal }
      );
    };

    const assumedHasAudio = options.hasAudio ?? true;
    let exitCode = await renderWithAudioMode(assumedHasAudio);

    if (exitCode !== 0 && assumedHasAudio) {
      options.onStatus?.('오디오 스트림을 찾지 못해 무음 트랙으로 다시 시도하는 중');
      options.onLog?.('Retrying render with silent audio fallback.');
      await ffmpeg.deleteFile(outputName).catch(() => undefined);
      exitCode = await renderWithAudioMode(false);
    }

    if (exitCode !== 0) {
      throw new ExportRenderError(
        'filter',
        `FFmpeg 필터 그래프 처리에 실패했습니다. 현재 코덱 또는 편집 구성이 브라우저 렌더러에서 처리되지 않을 수 있습니다. (exit code ${exitCode})`
      );
    }

    options.onStatus?.('렌더 파일을 만드는 중');
    options.onProgress?.(0.96);
    const data = await ffmpeg.readFile(outputName, 'binary', {
      signal: options.signal
    });
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);

    options.onProgress?.(1);
    return new Blob([bytes], { type: 'video/mp4' });
  } catch (error) {
    if (error instanceof ExportRenderError) {
      throw error;
    }
    if (error instanceof Error && /abort|terminate/i.test(error.message)) {
      throw new ExportRenderError('cancelled', 'MP4 내보내기를 취소했습니다.', {
        cause: error
      });
    }
    throw new ExportRenderError(classifyFfmpegError(error), createExportErrorMessage(error), {
      cause: error
    });
  } finally {
    await Promise.allSettled([
      ffmpeg.deleteFile(inputName),
      ffmpeg.deleteFile(subtitleName),
      ffmpeg.deleteFile(fontName),
      ...localFontNames.map((name) => ffmpeg.deleteFile(name)),
      ffmpeg.deleteFile(outputName)
    ]);
    await Promise.allSettled([ffmpeg.deleteDir(fontDirName)]);
  }
}

export function buildVideoEditFilterGraph({
  clips,
  transitions,
  outputDimensions,
  subtitleName,
  fontDirName,
  hasAudio = true
}: {
  clips: VideoClip[];
  transitions: ClipTransition[];
  outputDimensions: VideoDimensions;
  subtitleName: string;
  fontDirName?: string;
  hasAudio?: boolean;
}) {
  const normalizedTransitions = normalizeTransitionsForClips(clips, transitions);
  const parts: string[] = [];

  clips.forEach((clip, index) => {
    const speed = Math.max(0.25, Math.min(clip.speed, 4));
    const outputDuration = getClipOutputDuration(clip);
    parts.push(
      `[0:v]trim=start=${formatFilterNumber(clip.sourceStart)}:end=${formatFilterNumber(
        clip.sourceEnd
      )},setpts=(PTS-STARTPTS)/${formatFilterNumber(speed)},scale=${
        outputDimensions.width
      }:${outputDimensions.height}:flags=lanczos,setsar=1,format=yuv420p[v${index}]`
    );

    if (clip.muted || !hasAudio) {
      parts.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatFilterNumber(
          outputDuration
        )},asetpts=PTS-STARTPTS[a${index}]`
      );
    } else {
      parts.push(
        `[0:a]atrim=start=${formatFilterNumber(clip.sourceStart)}:end=${formatFilterNumber(
          clip.sourceEnd
        )},asetpts=PTS-STARTPTS,${buildAtempoChain(speed).join(
          ','
        )},aformat=channel_layouts=stereo,aresample=48000[a${index}]`
      );
    }
  });

  let currentVideoLabel = 'v0';
  let currentAudioLabel = 'a0';
  let currentDuration = getClipOutputDuration(clips[0]);

  for (let index = 1; index < clips.length; index += 1) {
    const previousClip = clips[index - 1];
    const nextClip = clips[index];
    const transition = normalizedTransitions.find(
      (item) => item.fromClipId === previousClip.id && item.toClipId === nextClip.id
    );
    const nextVideoLabel = `v${index}`;
    const nextAudioLabel = `a${index}`;
    const outputVideoLabel = `vx${index}`;
    const outputAudioLabel = `ax${index}`;

    if (transition) {
      const offset = Math.max(0, currentDuration - transition.duration);
      parts.push(
        `[${currentVideoLabel}][${nextVideoLabel}]xfade=transition=${
          transition.kind
        }:duration=${formatFilterNumber(transition.duration)}:offset=${formatFilterNumber(
          offset
        )}[${outputVideoLabel}]`
      );
      parts.push(
        `[${currentAudioLabel}][${nextAudioLabel}]acrossfade=d=${formatFilterNumber(
          transition.duration
        )}:c1=tri:c2=tri[${outputAudioLabel}]`
      );
      currentDuration += getClipOutputDuration(nextClip) - transition.duration;
    } else {
      parts.push(
        `[${currentVideoLabel}][${nextVideoLabel}]concat=n=2:v=1:a=0[${outputVideoLabel}]`
      );
      parts.push(
        `[${currentAudioLabel}][${nextAudioLabel}]concat=n=2:v=0:a=1[${outputAudioLabel}]`
      );
      currentDuration += getClipOutputDuration(nextClip);
    }

    currentVideoLabel = outputVideoLabel;
    currentAudioLabel = outputAudioLabel;
  }

  parts.push(
    `[${currentVideoLabel}]subtitles=${subtitleName}:fontsdir=${
      fontDirName ?? '.'
    },format=yuv420p[outv]`
  );
  parts.push(`[${currentAudioLabel}]anull[outa]`);

  return parts.join(';');
}

export function getExportDimensions(
  dimensions: VideoDimensions,
  preset: ExportPreset
): VideoDimensions {
  if (preset === 'source' || dimensions.height <= 720) {
    return {
      width: ensureEven(dimensions.width),
      height: ensureEven(dimensions.height)
    };
  }

  const ratio = 720 / dimensions.height;

  return {
    width: ensureEven(dimensions.width * ratio),
    height: 720
  };
}

async function loadFfmpeg(options: ExportOptions) {
  currentCallbacks = {
    onLog: options.onLog,
    onProgress: options.onProgress,
    onStatus: options.onStatus
  };

  if (!ffmpegInstancePromise) {
    ffmpegInstancePromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = new FFmpeg();
      activeFfmpeg = ffmpeg;

      ffmpeg.on('log', ({ message }) => currentCallbacks.onLog?.(message));
      ffmpeg.on('progress', ({ progress }) => {
        currentCallbacks.onProgress?.(0.15 + Math.max(0, Math.min(progress, 1)) * 0.78);
      });

      currentCallbacks.onStatus?.('FFmpeg worker를 준비하는 중');
      currentCallbacks.onProgress?.(0.02);

      await loadWithTimeout(
        ffmpeg.load(
          {
            coreURL,
            wasmURL,
            ...(import.meta.env.DEV ? { classWorkerURL: devClassWorkerURL } : {})
          },
          { signal: options.signal }
        ),
        ffmpeg
      );

      currentCallbacks.onStatus?.('FFmpeg 엔진 준비 완료');
      currentCallbacks.onProgress?.(0.08);
      return ffmpeg;
    })().catch((error) => {
      ffmpegInstancePromise = null;
      activeFfmpeg = null;
      throw error;
    });
  }

  return ffmpegInstancePromise;
}

async function loadWithTimeout(loadPromise: Promise<unknown>, ffmpeg: FFmpegInstance) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  let heartbeatId: ReturnType<typeof globalThis.setInterval> | undefined;
  const startedAt = Date.now();

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      ffmpeg.terminate();
      reject(new Error(ffmpegLoadTimeoutMessage));
    }, ffmpegLoadTimeoutMs);
  });

  heartbeatId = globalThis.setInterval(() => {
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    currentCallbacks.onStatus?.(
      `FFmpeg 엔진 초기화 중 (${elapsed}초 경과, 첫 실행은 31MB wasm 준비가 필요합니다)`
    );
  }, 8_000);

  try {
    await Promise.race([loadPromise, timeoutPromise]);
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
    if (heartbeatId) globalThis.clearInterval(heartbeatId);
  }
}

export function cancelActiveExport() {
  activeFfmpeg?.terminate();
  activeFfmpeg = null;
  ffmpegInstancePromise = null;
  currentCallbacks = {};
}

async function fetchFont() {
  const fontUrl = `${import.meta.env.BASE_URL}fonts/AppleGothic.ttf`;
  const response = await fetch(fontUrl);
  if (!response.ok) {
    throw new Error('한국어 폰트 파일을 불러오지 못했습니다.');
  }

  return new Uint8Array(await response.arrayBuffer());
}

function needsScale(source: VideoDimensions, output: VideoDimensions) {
  return source.width !== output.width || source.height !== output.height;
}

function ensureEven(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function classifyFfmpegError(error: unknown): ExportFailureKind {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (/abort|terminate/.test(lower)) return 'cancelled';
  if (/memory|allocation|out of bounds/.test(lower)) return 'memory';
  if (/stream specifier.*:a|matches no streams|audio/.test(lower)) return 'audio';
  if (/filter|subtitles|xfade|concat|graph/.test(lower)) return 'filter';
  if (/codec|invalid data|could not find|moov atom|demux/.test(lower)) return 'codec';
  if (/ffmpeg|worker|wasm|load|loading/.test(lower)) return 'engine';
  return 'unknown';
}

function createExportErrorMessage(error: unknown) {
  const kind = classifyFfmpegError(error);
  const messages: Record<ExportFailureKind, string> = {
    engine: 'FFmpeg 엔진을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    codec: '현재 코덱을 브라우저 FFmpeg에서 읽지 못했습니다. MP4/H.264 영상으로 변환 후 다시 시도해 주세요.',
    memory: '브라우저 메모리가 부족해 렌더링이 중단되었습니다. 720p 빠른 렌더 또는 짧은 구간 저장을 먼저 시도해 주세요.',
    audio: '원본 오디오 스트림 처리에 실패했습니다. 무음 fallback으로 다시 렌더할 수 있도록 영상을 다시 불러와 시도해 주세요.',
    filter: '컷, 전환, 자막 필터 처리에 실패했습니다. 전환을 줄이거나 짧은 구간으로 먼저 확인해 주세요.',
    cancelled: 'MP4 내보내기를 취소했습니다.',
    unknown: 'MP4 내보내기에 실패했습니다. 마지막 FFmpeg 로그를 확인해 주세요.'
  };

  return messages[kind];
}
