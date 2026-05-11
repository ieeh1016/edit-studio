import { buildAssScript } from './ass';
import {
  primaryVideoSourceId,
  type CaptionCue,
  type AudioClip,
  type AudioSourceMeta,
  type ClipTransition,
  type ExportFitMode,
  type ExportPreset,
  type ImageClip,
  type InteractionEffect,
  type TextOverlay,
  type VideoClip,
  type VideoDimensions
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
  fitMode?: ExportFitMode;
  dimensions: VideoDimensions;
  customDimensions?: VideoDimensions;
  sourceDuration?: number;
  hasAudio?: boolean;
  videoFiles?: Record<string, File>;
  audioSources?: AudioSourceMeta[];
  audioClips?: AudioClip[];
  audioFiles?: Record<string, File>;
  imageClips?: ImageClip[];
  imageFiles?: Record<string, File>;
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
  const outputDimensions = getExportDimensions(
    options.dimensions,
    options.preset,
    options.customDimensions
  );
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
  const externalVideoSourceIds = Array.from(
    new Set(
      clips
        .map((clip) => clip.sourceId ?? primaryVideoSourceId)
        .filter((sourceId) => sourceId !== primaryVideoSourceId)
    )
  );
  const externalVideoInputs = externalVideoSourceIds.flatMap((sourceId) => {
    const file = options.videoFiles?.[sourceId];
    return file ? [{ sourceId, file }] : [];
  });
  const externalVideoNames = externalVideoInputs.map(({ file }, index) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'mp4';
    return `video-${index}-${jobId}.${extension}`;
  });
  const externalAudioInputs = (options.audioSources ?? []).flatMap((source) => {
    const file = options.audioFiles?.[source.id];
    return file ? [{ source, file }] : [];
  });
  const externalAudioNames = externalAudioInputs.map(({ file }, index) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'm4a';
    return `audio-${index}-${jobId}.${extension}`;
  });
  const imageSourceIds = Array.from(new Set((options.imageClips ?? []).map((clip) => clip.sourceId)));
  const externalImageInputs = imageSourceIds.flatMap((sourceId) => {
    const file = options.imageFiles?.[sourceId];
    return file ? [{ sourceId, file }] : [];
  });
  const externalImageNames = externalImageInputs.map(({ file }, index) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
    return `image-${index}-${jobId}.${extension}`;
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
      ),
      ...externalVideoInputs.map(async ({ file }, index) =>
        ffmpeg.writeFile(externalVideoNames[index], await fetchFile(file), {
          signal: options.signal
        })
      ),
      ...externalAudioInputs.map(async ({ file }, index) =>
        ffmpeg.writeFile(externalAudioNames[index], await fetchFile(file), {
          signal: options.signal
        })
      ),
      ...externalImageInputs.map(async ({ file }, index) =>
        ffmpeg.writeFile(externalImageNames[index], await fetchFile(file), {
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
        fitMode: options.fitMode ?? 'cover',
        subtitleName,
        fontDirName,
        hasAudio,
        audioClips: options.audioClips ?? [],
        videoInputIndexes: Object.fromEntries(
          externalVideoInputs.map(({ sourceId }, index) => [sourceId, index + 1])
        ),
        audioInputIndexes: Object.fromEntries(
          externalAudioInputs.map(({ source }, index) => [
            source.id,
            index + 1 + externalVideoNames.length
          ])
        ),
        imageClips: options.imageClips ?? [],
        imageInputIndexes: Object.fromEntries(
          externalImageInputs.map(({ sourceId }, index) => [
            sourceId,
            index + 1 + externalVideoNames.length + externalAudioNames.length
          ])
        )
      });

      options.onStatus?.('MP4 렌더링 중');
      return ffmpeg.exec(
        [
          '-i',
          inputName,
          ...externalVideoNames.flatMap((name) => ['-i', name]),
          ...externalAudioNames.flatMap((name) => ['-i', name]),
          ...externalImageNames.flatMap((name) => ['-loop', '1', '-i', name]),
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
      ...externalVideoNames.map((name) => ffmpeg.deleteFile(name)),
      ...externalAudioNames.map((name) => ffmpeg.deleteFile(name)),
      ...externalImageNames.map((name) => ffmpeg.deleteFile(name)),
      ffmpeg.deleteFile(outputName)
    ]);
    await Promise.allSettled([ffmpeg.deleteDir(fontDirName)]);
  }
}

export function buildVideoEditFilterGraph({
  clips,
  transitions,
  outputDimensions,
  fitMode = 'cover',
  subtitleName,
  fontDirName,
  hasAudio = true,
  videoInputIndexes = {},
  audioClips = [],
  audioInputIndexes = {},
  imageClips = [],
  imageInputIndexes = {}
}: {
  clips: VideoClip[];
  transitions: ClipTransition[];
  outputDimensions: VideoDimensions;
  fitMode?: ExportFitMode;
  subtitleName: string;
  fontDirName?: string;
  hasAudio?: boolean;
  videoInputIndexes?: Record<string, number>;
  audioClips?: AudioClip[];
  audioInputIndexes?: Record<string, number>;
  imageClips?: ImageClip[];
  imageInputIndexes?: Record<string, number>;
}) {
  const normalizedTransitions = normalizeTransitionsForClips(clips, transitions);
  const parts: string[] = [];

  clips.forEach((clip, index) => {
    const speed = Math.max(0.25, Math.min(clip.speed, 4));
    const inputIndex = videoInputIndexes[clip.sourceId ?? primaryVideoSourceId] ?? 0;
    const outputDuration = getClipOutputDuration(clip);
    const crop = normalizeCrop(clip.crop);
    const cropWidth = formatFilterNumber(Math.max(0.1, 1 - (crop.left + crop.right) / 100));
    const cropHeight = formatFilterNumber(Math.max(0.1, 1 - (crop.top + crop.bottom) / 100));
    const cropX = formatFilterNumber(crop.left / 100);
    const cropY = formatFilterNumber(crop.top / 100);
    const fitFilters = buildVideoFitFilters(outputDimensions, fitMode);
    const transformScale = formatFilterNumber(clampNumber(clip.scale, 0.1, 8));
    const rotation = formatFilterNumber((clampNumber(clip.rotation, -180, 180) * Math.PI) / 180);
    const opacity = formatFilterNumber(clampNumber(clip.opacity, 0, 1));
    const overlayX = formatFilterNumber(clampNumber(clip.x, 0, 100) / 100);
    const overlayY = formatFilterNumber(clampNumber(clip.y, 0, 100) / 100);
    parts.push(
      `[${inputIndex}:v]trim=start=${formatFilterNumber(clip.sourceStart)}:end=${formatFilterNumber(
        clip.sourceEnd
      )},setpts=(PTS-STARTPTS)/${formatFilterNumber(
        speed
      )},crop=w=iw*${cropWidth}:h=ih*${cropHeight}:x=iw*${cropX}:y=ih*${cropY},${fitFilters.join(
        ','
      )},scale=iw*${transformScale}:-2:flags=lanczos,rotate=${rotation}:ow=rotw(${rotation}):oh=roth(${rotation}):c=black@0,format=rgba,colorchannelmixer=aa=${opacity}[vf${index}]`
    );
    parts.push(
      `color=c=black:s=${outputDimensions.width}x${outputDimensions.height}:d=${formatFilterNumber(
        outputDuration
      )},format=rgba[bg${index}]`
    );
    parts.push(
      `[bg${index}][vf${index}]overlay=x=(W-w)*${overlayX}:y=(H-h)*${overlayY}:shortest=1,format=yuv420p[v${index}]`
    );

    const volume = formatFilterNumber(clampAudioVolume(clip.volume));
    const fadeIn = clampAudioFade(clip.fadeIn, outputDuration);
    const fadeOut = clampAudioFade(clip.fadeOut, outputDuration);
    const audioFilters = [
      `volume=${clip.muted ? '0' : volume}`,
      ...(fadeIn > 0
        ? [`afade=t=in:st=0:d=${formatFilterNumber(fadeIn)}`]
        : []),
      ...(fadeOut > 0
        ? [
            `afade=t=out:st=${formatFilterNumber(
              Math.max(0, outputDuration - fadeOut)
            )}:d=${formatFilterNumber(fadeOut)}`
          ]
        : [])
    ];

    if (!hasAudio) {
      parts.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatFilterNumber(
          outputDuration
        )},asetpts=PTS-STARTPTS,${audioFilters.join(',')}[a${index}]`
      );
    } else {
      parts.push(
        `[${inputIndex}:a]atrim=start=${formatFilterNumber(clip.sourceStart)}:end=${formatFilterNumber(
          clip.sourceEnd
        )},asetpts=PTS-STARTPTS,${buildAtempoChain(speed).join(
          ','
        )},aformat=channel_layouts=stereo,aresample=48000,${audioFilters.join(',')}[a${index}]`
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

  imageClips.forEach((clip, index) => {
    const inputIndex = imageInputIndexes[clip.sourceId];
    if (!inputIndex) return;

    const imageLabel = `im${index}`;
    const outputLabel = `iv${index}`;
    const scale = formatFilterNumber(clampNumber(clip.scale, 0.05, 8));
    const rotation = formatFilterNumber((clampNumber(clip.rotation, -180, 180) * Math.PI) / 180);
    const opacity = formatFilterNumber(clampNumber(clip.opacity, 0, 1));
    const overlayX = formatFilterNumber(clampNumber(clip.x, 0, 100) / 100);
    const overlayY = formatFilterNumber(clampNumber(clip.y, 0, 100) / 100);

    parts.push(
      `[${inputIndex}:v]scale=iw*${scale}:-2:flags=lanczos,rotate=${rotation}:ow=rotw(${rotation}):oh=roth(${rotation}):c=black@0,format=rgba,colorchannelmixer=aa=${opacity}[${imageLabel}]`
    );
    parts.push(
      `[${currentVideoLabel}][${imageLabel}]overlay=x=(W-w)*${overlayX}:y=(H-h)*${overlayY}:enable='between(t,${formatFilterNumber(
        clip.start
      )},${formatFilterNumber(clip.end)})':shortest=0[${outputLabel}]`
    );
    currentVideoLabel = outputLabel;
  });

  parts.push(
    `[${currentVideoLabel}]subtitles=${subtitleName}:fontsdir=${
      fontDirName ?? '.'
    },format=yuv420p[outv]`
  );
  const mixInputs = [`[${currentAudioLabel}]`];
  audioClips.forEach((clip, index) => {
    const inputIndex = audioInputIndexes[clip.sourceId];
    if (!inputIndex) return;

    const duration = Math.max(0.03, clip.end - clip.start);
    const sourceEnd = Math.max(clip.sourceStart + 0.03, clip.sourceEnd);
    const volume = clip.muted ? 0 : clampAudioVolume(clip.volume);
    const fadeIn = clampAudioFade(clip.fadeIn, duration);
    const fadeOut = clampAudioFade(clip.fadeOut, duration);
    const delayMs = Math.max(0, Math.round(clip.start * 1000));
    const outputLabel = `ma${index}`;
    const filters = [
      `[${inputIndex}:a]atrim=start=${formatFilterNumber(
        clip.sourceStart
      )}:end=${formatFilterNumber(sourceEnd)}`,
      'asetpts=PTS-STARTPTS',
      'aformat=channel_layouts=stereo',
      'aresample=48000',
      `volume=${formatFilterNumber(volume)}`,
      ...(fadeIn > 0
        ? [`afade=t=in:st=0:d=${formatFilterNumber(fadeIn)}`]
        : []),
      ...(fadeOut > 0
        ? [
            `afade=t=out:st=${formatFilterNumber(
              Math.max(0, duration - fadeOut)
            )}:d=${formatFilterNumber(fadeOut)}`
          ]
        : []),
      `adelay=${delayMs}|${delayMs}[${outputLabel}]`
    ];
    parts.push(filters.join(','));
    mixInputs.push(`[${outputLabel}]`);
  });

  if (mixInputs.length > 1) {
    parts.push(
      `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0[outa]`
    );
  } else {
    parts.push(`[${currentAudioLabel}]anull[outa]`);
  }

  return parts.join(';');
}

function clampAudioVolume(value: number | undefined) {
  return Math.max(0, Math.min(value ?? 1, 2));
}

function clampAudioFade(value: number | undefined, duration: number) {
  return Math.max(0, Math.min(value ?? 0, Math.max(0, duration / 2)));
}

function buildVideoFitFilters(dimensions: VideoDimensions, fitMode: ExportFitMode) {
  const width = ensureEven(dimensions.width);
  const height = ensureEven(dimensions.height);

  if (fitMode === 'contain') {
    return [
      `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:flags=lanczos`
    ];
  }

  if (fitMode === 'stretch') {
    return [`scale=w=${width}:h=${height}:flags=lanczos`];
  }

  return [
    `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=w=${width}:h=${height}:x=(iw-${width})/2:y=(ih-${height})/2`
  ];
}

export function getExportDimensions(
  dimensions: VideoDimensions,
  preset: ExportPreset,
  customDimensions?: VideoDimensions
): VideoDimensions {
  if (preset === 'shorts1080') {
    return { width: 1080, height: 1920 };
  }

  if (preset === 'custom' && customDimensions) {
    return {
      width: ensureEven(customDimensions.width),
      height: ensureEven(customDimensions.height)
    };
  }

  if (preset === 'source' || dimensions.height <= 720) {
    return {
      width: ensureEven(dimensions.width),
      height: ensureEven(dimensions.height)
    };
  }

  const targetHeight = preset === 'hd1080' ? 1080 : 720;
  if (preset === 'hd1080' && dimensions.height <= 1080) {
    return {
      width: ensureEven(dimensions.width),
      height: ensureEven(dimensions.height)
    };
  }

  const ratio = targetHeight / dimensions.height;

  return {
    width: ensureEven(dimensions.width * ratio),
    height: targetHeight
  };
}

function normalizeCrop(crop: VideoClip['crop'] | undefined) {
  return {
    left: clampNumber(crop?.left ?? 0, 0, 90),
    right: clampNumber(crop?.right ?? 0, 0, 90),
    top: clampNumber(crop?.top ?? 0, 0, 90),
    bottom: clampNumber(crop?.bottom ?? 0, 0, 90)
  };
}

function clampNumber(value: number | undefined, min: number, max: number) {
  return Math.max(min, Math.min(value ?? min, max));
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
  const finiteValue = Number.isFinite(value) ? value : 2;
  return Math.max(2, Math.min(7680, Math.round(finiteValue / 2) * 2));
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
