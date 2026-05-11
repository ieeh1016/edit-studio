import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Captions,
  CircleHelp,
  Clapperboard,
  Copy,
  Download,
  FileDown,
  FileJson,
  Film,
  Gauge,
  Hand,
  Maximize2,
  MousePointerClick,
  Music,
  Pause,
  Play,
  Plus,
  Save,
  Scissors,
  Trash2,
  Type,
  Redo2,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent
} from 'react';
import {
  cancelActiveExport,
  ExportRenderError,
  exportVideoWithBurnedSubtitles,
  getExportDimensions
} from './lib/ffmpeg';
import { createExportPreflightResult } from './lib/export-preflight';
import { buildAssScript } from './lib/ass';
import {
  createCue,
  cuesToSrt,
  cuesToVtt,
  parseSubtitleFile,
  sortAndResolveCueOverlaps,
  sortCues
} from './lib/subtitle';
import { getCueDiagnostics } from './lib/diagnostics';
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory
} from './lib/history';
import {
  builtinFontAsset,
  fontDownloadLinks,
  fontWeightOptions,
  getFontMetadataFromFile,
  getFontWeightLabel,
  isSupportedFontFile,
  type AppFontAsset
} from './lib/fonts';
import { normalizeProjectFile } from './lib/project';
import {
  createAudioClip,
  createAudioSourceMeta,
  getAudioClipDuration,
  normalizeAudioClip,
  normalizeAudioFade,
  normalizeAudioVolume,
  trimAudioClip
} from './lib/audio-edit';
import {
  DEFAULT_TRANSITION_DURATION,
  createDefaultVideoClip,
  createOrUpdateTransition,
  deleteClipRipple,
  findClipRangeAtTime,
  getClipTimelineRanges,
  getEditTimelineDuration,
  getTransitionBetween,
  getTransitionPreviewAtTime,
  insertDuplicateClipAfter,
  reorderClipRipple,
  normalizeSpeed,
  normalizeTransitionsForClips,
  removeTimelineRange,
  removeTransitionAfter,
  splitClipAtTimelineTime,
  timelineToSourceTime
} from './lib/video-edit';
import {
  defaultCaptionStyle,
  defaultInteractionEffect,
  defaultTextOverlay,
  interactionEffectPresets,
  builtinPreviewFontFamily,
  type AudioClip,
  type AudioSourceKind,
  type AudioSourceMeta,
  type CaptionCue,
  type CaptionPosition,
  type CaptionStyle,
  type ClipTransition,
  type ClipTransitionKind,
  type EditorSnapshot,
  type ExportPreset,
  type InteractionEffect,
  type InteractionEffectKind,
  type ProjectMediaMeta,
  type ProjectFile,
  type TextAlign,
  type TextOverlay,
  type VideoClip,
  type VideoDimensions
} from './lib/types';
import { clamp, coerceCueBounds, formatClock, MIN_CUE_DURATION } from './lib/time';
import {
  TIMELINE_DEFAULT_PX_PER_SECOND,
  TIMELINE_MAX_PX_PER_SECOND,
  TIMELINE_MIN_PX_PER_SECOND,
  TIMELINE_MIN_ITEM_WIDTH,
  chooseThumbnailStepForPxPerSecond,
  clampTimelineScrollLeft,
  createTimelineTicks,
  fitTimelinePxPerSecond,
  getTimelineContentWidth,
  getVisibleTimelineRange,
  getVisibleThumbnailTimes,
  isCompactTimelineItem,
  layoutTimelineItems,
  timeToTimelineX,
  timelineItemStyle,
  timelineXToTime,
  zoomTimelineAroundAnchor,
  type TimelineItemLayout,
  type TimelineThumbnailWindow
} from './lib/timeline';

type Selection =
  | { kind: 'clip'; id: string }
  | { kind: 'sourceAudio'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'cue'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'effect'; id: string }
  | null;

type PanelMode = 'video' | 'audio' | 'captions' | 'texts' | 'effects';
type CutRange = { start: number | null; end: number | null };
type TimelineTool = 'select' | 'pan';
type TimelineItemKind = 'audio' | 'cue' | 'overlay' | 'effect';
type TimelineTrackKind = 'video' | 'audio' | 'cue' | 'overlay' | 'effect';
type TimelineTrackHeights = Record<TimelineTrackKind, number>;
type TimelineThumbnail = { time: number; url: string };
type AudioWaveform = number[];
type AudioFileMap = Record<string, File>;
type AudioUrlMap = Record<string, string>;
type TimelineThumbnailRequest = TimelineThumbnailWindow;
type PreviewGuideState = {
  vertical?: number;
  horizontal?: number;
  label: string;
} | null;
type PreviewSize = 'small' | 'medium' | 'large' | 'fill';
type VideoImportMode = 'normal' | 'relink';
type PendingResetAction =
  | { kind: 'reset-project' }
  | { kind: 'replace-video'; file: File };
type GuideStep = {
  id: string;
  title: string;
  body: string;
  target: string;
};
type GuideRect = { top: number; left: number; width: number; height: number };
type TextOverlayStylePreset = {
  id: string;
  name: string;
  tone: string;
  patch: Pick<
    TextOverlay,
    | 'fontSize'
    | 'fontWeight'
    | 'italic'
    | 'underline'
    | 'align'
    | 'color'
    | 'background'
    | 'outlineColor'
    | 'outlineWidth'
    | 'shadow'
  >;
};
type TextPositionPreset = {
  id: string;
  label: string;
  x: number;
  y: number;
  align: TextAlign;
};
type Mp4SaveTarget =
  | {
      kind: 'file-system';
      fileName: string;
      handle: FileSystemFileHandleLike;
    }
  | {
      kind: 'download';
      fileName: string;
    };
type FileSystemWritableFileStreamLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};
type FileSystemFileHandleLike = {
  name: string;
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};
type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandleLike>;
};
type AutosaveVideoRecord = {
  file: File;
  savedAt: string;
};
type ExportPhase =
  | 'idle'
  | 'engine'
  | 'prepare'
  | 'filters'
  | 'render'
  | 'finalize'
  | 'done'
  | 'error'
  | 'cancelled';

const defaultDimensions: VideoDimensions = { width: 1920, height: 1080 };
const AUTOSAVE_KEY = 'local-caption-studio:auto-save:v1';
const AUTOSAVE_VIDEO_DB_NAME = 'edit-studio:auto-save-video:v1';
const AUTOSAVE_VIDEO_STORE_NAME = 'media';
const AUTOSAVE_VIDEO_KEY = 'current-video';
const ONBOARDING_KEY = 'edit-studio:onboarding-complete:v1';
const PREVIEW_SIZE_KEY = 'edit-studio:preview-size:v1';
const HISTORY_GROUP_WINDOW_MS = 900;
const ONE_SHOT_EFFECT_DURATION = 0.72;
const TIMELINE_THUMBNAIL_WIDTH = 224;
const TIMELINE_THUMBNAIL_HEIGHT = 126;
const TIMELINE_THUMBNAIL_QUALITY = 0.86;
const TIMELINE_THUMBNAIL_TARGET_CELL_WIDTH = 72;
const TIMELINE_MAX_THUMBNAILS = 96;
const exportPhaseLabels: Record<ExportPhase, string> = {
  idle: '대기',
  engine: '엔진 준비',
  prepare: '파일 준비',
  filters: '편집 구성',
  render: '렌더링',
  finalize: '파일 생성',
  done: '완료',
  error: '오류',
  cancelled: '취소됨'
};
const guideSteps: GuideStep[] = [
  {
    id: 'import-video',
    title: '1. 영상 가져오기',
    body: '여기서 영상 파일을 선택하거나 화면에 드래그 앤 드롭하세요. 영상은 서버로 올라가지 않고 브라우저 안에서만 처리됩니다.',
    target: 'import-video'
  },
  {
    id: 'preview',
    title: '2. 미리보기와 위치 조정',
    body: '자막, 텍스트, 클릭/터치 효과가 실제 영상 위에 어떻게 보이는지 확인합니다. 텍스트와 효과는 미리보기에서 직접 이동하거나 크기를 조절할 수 있습니다.',
    target: 'preview'
  },
  {
    id: 'editor-panel',
    title: '3. 우측 편집 패널',
    body: '선택한 영상 조각, 자막, 텍스트, 효과의 세부 속성을 여기서 조정합니다. 탭을 바꾸면 편집 대상도 빠르게 전환됩니다.',
    target: 'editor-panel'
  },
  {
    id: 'timeline',
    title: '4. 타임라인',
    body: '영상 조각, 자막, 텍스트, 효과를 시간 기준으로 배치합니다. 휠로 좌우 이동, Ctrl/Cmd+휠로 줌, 트랙 경계 드래그로 높이 조절이 가능합니다.',
    target: 'timeline'
  },
  {
    id: 'cut-tools',
    title: '5. 컷 편집 도구',
    body: '조각 분할은 현재 위치에서 영상을 나누고, IN/OUT과 구간 삭제는 필요 없는 구간을 제거해 뒤 조각을 자동으로 붙입니다.',
    target: 'cut-tools'
  },
  {
    id: 'project-tools',
    title: '6. 저장과 초기화',
    body: '편집 내용은 자동 저장됩니다. 다음에 들어왔을 때 영상이 자동으로 연결되지 않으면 같은 원본 영상을 다시 연결하면 이어서 작업할 수 있습니다.',
    target: 'project-tools'
  },
  {
    id: 'export',
    title: '7. MP4 내보내기',
    body: '720p 빠른 렌더는 확인용으로 빠르고, 원본 해상도는 최종 저장에 적합합니다. 첫 MP4 렌더는 FFmpeg WASM 엔진 준비 때문에 시간이 걸릴 수 있습니다.',
    target: 'export'
  },
  {
    id: 'help',
    title: '8. 도움말 다시 보기',
    body: '나중에 사용법이 헷갈리면 도움말을 열어 설명을 읽거나 이 튜토리얼을 다시 실행할 수 있습니다.',
    target: 'help'
  }
];
const helpSections = [
  {
    title: '빠른 시작',
    body: '영상 가져오기 → 자막/텍스트/효과 추가 → 타임라인에서 위치 조정 → MP4 저장 순서로 작업하면 됩니다.'
  },
  {
    title: '컷 편집',
    body: '조각 분할은 영상을 둘로 나누는 기능이고, IN/OUT 후 구간 삭제는 필요 없는 구간을 제거한 뒤 남은 조각을 자동으로 이어 붙입니다.'
  },
  {
    title: '타임라인',
    body: '휠/트랙패드로 좌우 이동, Ctrl 또는 Cmd+휠로 커서 기준 확대/축소, Fit으로 전체 보기, 트랙 경계 드래그로 높이 조절을 할 수 있습니다. Space 재생, S 분할, I/O 구간 지정, Delete 삭제도 지원합니다.'
  },
  {
    title: '자막/텍스트/효과',
    body: '자막은 시간과 스타일을, 텍스트와 효과는 미리보기 위치/크기와 타임라인 시작·종료 시간을 함께 조절합니다. 미리보기에서 이동할 때 중앙선과 안전 영역에 가까우면 스냅 가이드가 표시됩니다.'
  },
  {
    title: '저장/초기화',
    body: '편집 내용은 자동 저장되고, 브라우저가 허용하면 원본 영상도 다음 방문에 자동 복구됩니다. 자동 복구가 안 되면 상단 안내에서 같은 원본 영상을 다시 연결하면 됩니다.'
  },
  {
    title: '내보내기',
    body: '첫 MP4 렌더는 31MB급 FFmpeg WASM 준비가 필요합니다. 긴 영상은 720p 빠른 렌더로 먼저 확인하는 흐름이 좋고, 원본 파일은 서버로 업로드되지 않습니다.'
  }
];
const textOverlayStylePresets: TextOverlayStylePreset[] = [
  {
    id: 'clean-title',
    name: '클린 타이틀',
    tone: '굵고 선명한 기본형',
    patch: {
      fontSize: 58,
      fontWeight: 800,
      italic: false,
      underline: false,
      align: 'center',
      color: '#ffffff',
      background: 'rgba(8, 11, 16, 0.24)',
      outlineColor: '#05070a',
      outlineWidth: 2,
      shadow: true
    }
  },
  {
    id: 'caption-chip',
    name: '캡션 박스',
    tone: '읽기 좋은 반투명 박스',
    patch: {
      fontSize: 42,
      fontWeight: 700,
      italic: false,
      underline: false,
      align: 'center',
      color: '#f8fbff',
      background: 'rgba(6, 9, 14, 0.72)',
      outlineColor: '#000000',
      outlineWidth: 0,
      shadow: false
    }
  },
  {
    id: 'neon-pop',
    name: '네온 포인트',
    tone: '짧은 강조 문구용',
    patch: {
      fontSize: 56,
      fontWeight: 900,
      italic: false,
      underline: false,
      align: 'center',
      color: '#b8f7ff',
      background: 'rgba(4, 17, 24, 0.28)',
      outlineColor: '#00d5ff',
      outlineWidth: 3,
      shadow: true
    }
  },
  {
    id: 'editor-label',
    name: '에디터 라벨',
    tone: '정보 태그처럼 정돈',
    patch: {
      fontSize: 34,
      fontWeight: 800,
      italic: false,
      underline: false,
      align: 'left',
      color: '#d7f7ef',
      background: 'rgba(8, 18, 22, 0.74)',
      outlineColor: '#0c2f35',
      outlineWidth: 1,
      shadow: false
    }
  }
];
const textPositionPresets: TextPositionPreset[] = [
  { id: 'top-left', label: '좌측 상단', x: 9, y: 14, align: 'left' },
  { id: 'top-center', label: '상단 중앙', x: 50, y: 14, align: 'center' },
  { id: 'top-right', label: '우측 상단', x: 91, y: 14, align: 'right' },
  { id: 'middle-left', label: '좌측 중앙', x: 9, y: 50, align: 'left' },
  { id: 'middle-center', label: '정중앙', x: 50, y: 50, align: 'center' },
  { id: 'middle-right', label: '우측 중앙', x: 91, y: 50, align: 'right' },
  { id: 'bottom-left', label: '좌측 하단', x: 9, y: 86, align: 'left' },
  { id: 'bottom-center', label: '하단 중앙', x: 50, y: 86, align: 'center' },
  { id: 'bottom-right', label: '우측 하단', x: 91, y: 86, align: 'right' }
];
const previewSizeOptions: Array<{ value: PreviewSize; label: string }> = [
  { value: 'small', label: '작게' },
  { value: 'medium', label: '기본' },
  { value: 'large', label: '크게' },
  { value: 'fill', label: '맞춤' }
];

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const transitionVideoRef = useRef<HTMLVideoElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const lastHistoryGroupRef = useRef<{ key: string; time: number } | null>(null);
  const importedFontUrlsRef = useRef<string[]>([]);
  const playbackClockRef = useRef<number | null>(null);
  const videoImportModeRef = useRef<VideoImportMode>('normal');
  const audioImportKindRef = useRef<AudioSourceKind>('music');
  const audioPreviewRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<AudioUrlMap>({});
  const videoCacheVersionRef = useRef(0);
  const thumbnailCacheRef = useRef<Map<number, TimelineThumbnail>>(new Map());
  const thumbnailVideoUrlRef = useRef<string | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<VideoDimensions>(defaultDimensions);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editorHistory, setEditorHistory] = useState(() =>
    createEditorHistory({
      cues: [],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: [],
      audioSources: [],
      audioClips: []
    })
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('video');
  const [exportPreset, setExportPreset] = useState<ExportPreset>('fast720');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportDownloadName, setExportDownloadName] = useState('captioned-output.mp4');
  const [exportLastLog, setExportLastLog] = useState('');
  const [exportPreflightNote, setExportPreflightNote] = useState('');
  const [cutRange, setCutRange] = useState<CutRange>({ start: null, end: null });
  const [fontAssets, setFontAssets] = useState<AppFontAsset[]>([builtinFontAsset]);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null);
  const [restoredVideoName, setRestoredVideoName] = useState<string | null>(null);
  const [mediaMeta, setMediaMeta] = useState<ProjectMediaMeta | null>(null);
  const [isRestoringVideo, setIsRestoringVideo] = useState(false);
  const [status, setStatus] = useState('영상 파일을 선택하면 편집을 시작할 수 있습니다.');
  const [projectCreatedAt, setProjectCreatedAt] = useState(new Date().toISOString());
  const [effectReplayTokens, setEffectReplayTokens] = useState<Record<string, number>>({});
  const [timelineThumbnails, setTimelineThumbnails] = useState<TimelineThumbnail[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFileMap>({});
  const [audioUrls, setAudioUrls] = useState<AudioUrlMap>({});
  const [audioWaveforms, setAudioWaveforms] = useState<Record<string, AudioWaveform>>({});
  const [thumbnailRequest, setThumbnailRequest] = useState<TimelineThumbnailRequest | null>(null);
  const [pendingResetAction, setPendingResetAction] = useState<PendingResetAction | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isGuideActive, setIsGuideActive] = useState(false);
  const [guideStepIndex, setGuideStepIndex] = useState(0);
  const [guideTargetRect, setGuideTargetRect] = useState<GuideRect | null>(null);
  const [previewGuide, setPreviewGuide] = useState<PreviewGuideState>(null);
  const [previewSize, setPreviewSize] = useState<PreviewSize>(() => getStoredPreviewSize());

  const cues = editorHistory.present.cues;
  const overlays = editorHistory.present.overlays;
  const effects = editorHistory.present.effects;
  const videoClips = editorHistory.present.videoClips;
  const transitions = editorHistory.present.transitions;
  const audioSources = editorHistory.present.audioSources;
  const audioClips = editorHistory.present.audioClips;
  const canUndo = editorHistory.past.length > 0;
  const canRedo = editorHistory.future.length > 0;

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    audioUrlsRef.current = audioUrls;
  }, [audioUrls]);

  useEffect(() => {
    let cancelled = false;

    if (!videoUrl || duration <= 0) {
      thumbnailCacheRef.current.clear();
      thumbnailVideoUrlRef.current = videoUrl;
      setTimelineThumbnails([]);
      return;
    }

    if (thumbnailVideoUrlRef.current !== videoUrl) {
      thumbnailCacheRef.current.clear();
      thumbnailVideoUrlRef.current = videoUrl;
    }

    const request = thumbnailRequest ?? {
      start: 0,
      end: Math.min(duration, 90),
      step: getThumbnailStepForRange(0, Math.min(duration, 90))
    };
    const desiredTimes = getVisibleThumbnailTimes(duration, request, TIMELINE_MAX_THUMBNAILS);
    const missingTimes = desiredTimes.filter(
      (time) => !thumbnailCacheRef.current.has(getThumbnailCacheKey(time))
    );

    if (missingTimes.length === 0) {
      setTimelineThumbnails(
        desiredTimes
          .map((time) => thumbnailCacheRef.current.get(getThumbnailCacheKey(time)))
          .filter((thumbnail): thumbnail is TimelineThumbnail => Boolean(thumbnail))
      );
      return;
    }

    generateTimelineThumbnails(videoUrl, missingTimes)
      .then((thumbnails) => {
        if (!cancelled) {
          thumbnails.forEach((thumbnail) => {
            thumbnailCacheRef.current.set(getThumbnailCacheKey(thumbnail.time), thumbnail);
          });
          pruneThumbnailCache(thumbnailCacheRef.current, desiredTimes);
          setTimelineThumbnails(
            desiredTimes
              .map((time) => thumbnailCacheRef.current.get(getThumbnailCacheKey(time)))
              .filter((thumbnail): thumbnail is TimelineThumbnail => Boolean(thumbnail))
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTimelineThumbnails(
            desiredTimes
              .map((time) => thumbnailCacheRef.current.get(getThumbnailCacheKey(time)))
              .filter((thumbnail): thumbnail is TimelineThumbnail => Boolean(thumbnail))
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [duration, thumbnailRequest, videoUrl]);

  useEffect(() => {
    return () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    };
  }, [exportUrl]);

  useEffect(() => {
    return () => {
      exportControllerRef.current?.abort();
      cancelActiveExport();
      importedFontUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      Object.values(audioUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const selectedCue =
    selection?.kind === 'cue' ? cues.find((cue) => cue.id === selection.id) : null;
  const selectedOverlay =
    selection?.kind === 'overlay'
      ? overlays.find((overlay) => overlay.id === selection.id)
      : null;
  const selectedEffect =
    selection?.kind === 'effect'
      ? effects.find((effect) => effect.id === selection.id)
      : null;
  const selectedClip =
    selection?.kind === 'clip'
      ? videoClips.find((clip) => clip.id === selection.id)
      : null;
  const selectedSourceAudioClip =
    selection?.kind === 'sourceAudio'
      ? videoClips.find((clip) => clip.id === selection.id)
      : null;
  const selectedAudioClip =
    selection?.kind === 'audio'
      ? audioClips.find((clip) => clip.id === selection.id)
      : null;
  const audioSourceMap = useMemo(
    () => new Map(audioSources.map((source) => [source.id, source])),
    [audioSources]
  );
  const clipRanges = useMemo(
    () => getClipTimelineRanges(videoClips, transitions),
    [transitions, videoClips]
  );
  const mediaTimelineDuration = useMemo(() => {
    const editDuration = getEditTimelineDuration(videoClips, transitions);
    return videoClips.length > 0 ? editDuration : duration;
  }, [duration, transitions, videoClips]);
  const activeClipRange = useMemo(
    () => findClipRangeAtTime(clipRanges, currentTime),
    [clipRanges, currentTime]
  );
  const transitionPreview = useMemo(
    () => getTransitionPreviewAtTime(clipRanges, transitions, currentTime),
    [clipRanges, currentTime, transitions]
  );
  const activeCues = cues.filter(
    (cue) => cue.start <= currentTime && cue.end >= currentTime
  );
  const activeOverlays = overlays.filter(
    (overlay) => overlay.start <= currentTime && overlay.end >= currentTime
  );
  const activeEffects = effects.filter(
    (effect) => effect.start <= currentTime && effect.end >= currentTime
  );
  const timelineDuration = useMemo(() => {
    const maxCueEnd = Math.max(0, ...cues.map((cue) => cue.end));
    const maxOverlayEnd = Math.max(0, ...overlays.map((overlay) => overlay.end));
    const maxEffectEnd = Math.max(0, ...effects.map((effect) => effect.end));
    const maxAudioEnd = Math.max(0, ...audioClips.map((clip) => clip.end));
    return Math.max(
      mediaTimelineDuration,
      maxCueEnd,
      maxOverlayEnd,
      maxEffectEnd,
      maxAudioEnd,
      10
    );
  }, [audioClips, cues, effects, mediaTimelineDuration, overlays]);
  const outputDimensions = getExportDimensions(dimensions, exportPreset);
  const cueDiagnostics = useMemo(() => getCueDiagnostics(cues), [cues]);
  const hasExportableLayers = cues.length + overlays.length + effects.length + audioClips.length > 0;
  const hasVideoEdit = videoClips.length > 0;
  const selectedClipIndex = selectedClip
    ? videoClips.findIndex((clip) => clip.id === selectedClip.id)
    : -1;
  const selectedClipNext = selectedClipIndex >= 0 ? videoClips[selectedClipIndex + 1] : null;
  const selectedClipTransition =
    selectedClip && selectedClipNext
      ? getTransitionBetween(transitions, selectedClip.id, selectedClipNext.id)
      : null;
  const cutRangeStart =
    cutRange.start !== null && cutRange.end !== null
      ? Math.min(cutRange.start, cutRange.end)
      : null;
  const cutRangeEnd =
    cutRange.start !== null && cutRange.end !== null
      ? Math.max(cutRange.start, cutRange.end)
      : null;
  const hasCutRange =
    cutRangeStart !== null &&
    cutRangeEnd !== null &&
    cutRangeEnd - cutRangeStart >= MIN_CUE_DURATION;
  const cutRangeDuration = hasCutRange ? cutRangeEnd - cutRangeStart : 0;
  const hasResettableProject =
    Boolean(videoFile) ||
    Boolean(restoredVideoName) ||
    cues.length > 0 ||
    overlays.length > 0 ||
    effects.length > 0 ||
    videoClips.length > 0 ||
    transitions.length > 0 ||
    audioSources.length > 0 ||
    audioClips.length > 0 ||
    Object.keys(audioFiles).length > 0 ||
    fontAssets.length > 1 ||
    exportUrl !== null;
  const needsVideoRelink = Boolean(restoredVideoName && !videoFile);
  const needsAudioRelink = audioSources.some((source) => !audioFiles[source.id]);
  const projectVideoLabel = videoFile?.name ?? restoredVideoName ?? mediaMeta?.name ?? '새 프로젝트';
  const shouldWarnBeforeUnload = hasResettableProject || isExporting;
  const selectionSummary = useMemo(
    () =>
      getTimelineSelectionSummary(
        selection,
        clipRanges,
        audioClips,
        audioSourceMap,
        cues,
        overlays,
        effects
      ),
    [audioClips, audioSourceMap, clipRanges, cues, effects, overlays, selection]
  );
  const cutRangeStateLabel = hasCutRange
    ? `${formatClock(cutRangeStart ?? 0)} - ${formatClock(cutRangeEnd ?? 0)}`
    : cutRange.start !== null || cutRange.end !== null
      ? '범위 미완성'
      : '없음';
  const activeGuideStep = isGuideActive ? guideSteps[guideStepIndex] : null;

  useEffect(() => {
    document.title = 'Edit Studio';
  }, []);

  useEffect(() => {
    localStorage.setItem(PREVIEW_SIZE_KEY, previewSize);
  }, [previewSize]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldWarnBeforeUnload) return;

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldWarnBeforeUnload]);

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY) === 'true') return;

    const timer = window.setTimeout(() => startGuideTour(), 650);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isGuideActive || !activeGuideStep) return;

    let frameId = 0;
    const updateTargetRect = () => {
      const target = document.querySelector<HTMLElement>(
        `[data-guide-target="${activeGuideStep.target}"]`
      );

      if (!target) {
        setGuideTargetRect(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setGuideTargetRect(null);
        return;
      }

      setGuideTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateTargetRect);
    };

    document
      .querySelector<HTMLElement>(`[data-guide-target="${activeGuideStep.target}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [activeGuideStep, isGuideActive]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (isGuideActive) {
        event.preventDefault();
        finishGuideTour('튜토리얼을 닫았습니다.');
        return;
      }

      if (isHelpOpen) {
        event.preventDefault();
        setIsHelpOpen(false);
        return;
      }

      if (selection || cutRange.start !== null || cutRange.end !== null || previewGuide) {
        event.preventDefault();
        setSelection(null);
        setPreviewGuide(null);
        setCutRange({ start: null, end: null });
        setStatus('선택과 제거 범위를 해제했습니다.');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [cutRange.end, cutRange.start, isGuideActive, isHelpOpen, previewGuide, selection]);

  function openVideoPicker(mode: VideoImportMode = 'normal') {
    videoImportModeRef.current = mode;
    videoInputRef.current?.click();
  }

  function handleSelectedVideoFile(file: File) {
    const mode = videoImportModeRef.current;
    videoImportModeRef.current = 'normal';

    if (mode === 'relink') {
      relinkVideoFile(file);
      return;
    }

    handleVideoFile(file);
  }

  function handleVideoFile(file: File) {
    if (!isVideoFile(file)) {
      setStatus('영상 파일만 불러올 수 있습니다.');
      return;
    }

    if (needsVideoRelink && !videoFile) {
      relinkVideoFile(file);
      return;
    }

    if (hasResettableProject) {
      setPendingResetAction({ kind: 'replace-video', file });
      return;
    }

    loadVideoFile(file);
  }

  function loadVideoFile(file: File) {
    attachVideoFile(file, {
      preserveProject: false,
      statusMessage: `${file.name} 불러옴`
    });
  }

  function relinkVideoFile(file: File, statusMessage?: string) {
    if (!isVideoFile(file)) {
      setStatus('영상 파일만 다시 연결할 수 있습니다.');
      return;
    }

    const mismatchMessage = getMediaRelinkMessage(file, mediaMeta, restoredVideoName);

    attachVideoFile(file, {
      preserveProject: true,
      statusMessage: statusMessage ?? mismatchMessage ?? `${file.name} 원본 영상 다시 연결됨`
    });
  }

  function attachVideoFile(
    file: File,
    options: { preserveProject: boolean; statusMessage: string }
  ) {
    resetExportState();
    if (!options.preserveProject) {
      resetImportedFonts();
    }
    setVideoFile(file);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    if (!options.preserveProject) {
      resetEditor({
        cues: [],
        overlays: [],
        effects: [],
        videoClips: [],
        transitions: [],
        audioSources: [],
        audioClips: []
      });
      clearAudioRuntimeState();
    }
    setCurrentTime(0);
    setDuration(0);
    setDimensions(defaultDimensions);
    setMediaMeta(createProjectMediaMeta(file));
    setIsPlaying(false);
    setCutRange({ start: null, end: null });
    setTimelineThumbnails([]);
    setThumbnailRequest(null);
    thumbnailCacheRef.current.clear();
    setRestoredVideoName(null);
    setIsRestoringVideo(false);
    rememberVideoForAutosave(file);

    if (!options.preserveProject) {
      setSelection(null);
      setPanelMode('video');
      setEffectReplayTokens({});
      setProjectCreatedAt(new Date().toISOString());
      setLastAutosavedAt(null);
      localStorage.removeItem(AUTOSAVE_KEY);
    }

    setStatus(options.statusMessage);
  }

  function rememberVideoForAutosave(file: File) {
    const cacheVersion = ++videoCacheVersionRef.current;

    void writeAutosaveVideoFile(file).catch(() => {
      if (cacheVersion !== videoCacheVersionRef.current) return;
      setStatus(
        `${file.name} 불러옴. 단, 브라우저 저장공간 제한으로 다음 방문 자동 영상 복구는 어려울 수 있습니다.`
      );
    });
  }

  async function importFonts(files: File[]) {
    const supportedFiles = files.filter(isSupportedFontFile);
    if (supportedFiles.length === 0) {
      setStatus('TTF 또는 OTF 폰트 파일만 가져올 수 있습니다.');
      return;
    }

    if (typeof FontFace === 'undefined') {
      setStatus('현재 브라우저에서 폰트 가져오기를 지원하지 않습니다.');
      return;
    }

    const imported: AppFontAsset[] = [];
    let failedCount = 0;

    for (const file of supportedFiles) {
      const url = URL.createObjectURL(file);

      try {
        const meta = await getFontMetadataFromFile(file);
        const face = new FontFace(meta.family, `url(${url})`, {
          style: meta.style,
          weight: String(meta.weight)
        });
        await face.load();
        document.fonts.add(face);
        importedFontUrlsRef.current.push(url);
        imported.push({
          id: crypto.randomUUID(),
          ...meta,
          source: 'local',
          file
        });
      } catch {
        failedCount += 1;
        URL.revokeObjectURL(url);
      }
    }

    if (imported.length === 0) {
      setStatus('폰트 파일을 읽지 못했습니다.');
      return;
    }

    setFontAssets((previous) => mergeFontAssets(previous, imported));

    const preferredFont = choosePreferredImportedFont(imported);

    if (selectedCue) {
      updateCueStyle(selectedCue.id, {
        fontFamily: preferredFont.family,
        fontWeight: preferredFont.weight
      });
    } else if (selectedOverlay) {
      updateOverlay(selectedOverlay.id, {
        fontFamily: preferredFont.family,
        fontWeight: preferredFont.weight,
        italic: preferredFont.style === 'italic'
      });
    }

    const familyCount = new Set(imported.map((font) => font.family)).size;
    setStatus(
      failedCount > 0
        ? `폰트 ${imported.length}개 가져옴, ${failedCount}개 실패`
        : `폰트 ${imported.length}개 가져옴 · ${familyCount}개 패밀리`
    );
  }

  function openAudioPicker(kind: AudioSourceKind) {
    audioImportKindRef.current = kind;
    audioInputRef.current?.click();
  }

  async function importAudioFiles(files: File[], kind: AudioSourceKind) {
    const supportedFiles = files.filter(isAudioFile);
    if (supportedFiles.length === 0) {
      setStatus('오디오 파일만 가져올 수 있습니다.');
      return;
    }

    const newSources: AudioSourceMeta[] = [];
    const newClips: AudioClip[] = [];
    const nextFiles: AudioFileMap = {};
    const nextUrls: AudioUrlMap = {};
    const nextWaveforms: Record<string, AudioWaveform> = {};
    let relinkedCount = 0;

    for (const file of supportedFiles) {
      const existingSource = audioSources.find(
        (source) => !audioFiles[source.id] && doesFileMatchAudioSource(file, source)
      );
      const duration = await readAudioDuration(file).catch(() => existingSource?.duration ?? 3);
      const source = existingSource ?? createAudioSourceMeta(file, kind, duration);

      nextFiles[source.id] = file;
      nextUrls[source.id] = URL.createObjectURL(file);
      nextWaveforms[source.id] = await generateAudioWaveform(file).catch(() => []);

      if (existingSource) {
        relinkedCount += 1;
      } else {
        const clip = createAudioClip(source, currentTime, Math.max(timelineDuration, currentTime + duration));
        newSources.push(source);
        newClips.push(clip);
      }
    }

    setAudioFiles((previous) => ({ ...previous, ...nextFiles }));
    setAudioUrls((previous) => {
      Object.keys(nextUrls).forEach((sourceId) => {
        if (previous[sourceId]) URL.revokeObjectURL(previous[sourceId]);
      });
      return { ...previous, ...nextUrls };
    });
    setAudioWaveforms((previous) => ({ ...previous, ...nextWaveforms }));

    if (newSources.length > 0 || newClips.length > 0) {
      commitEditor((snapshot) => ({
        ...snapshot,
        audioSources: [...snapshot.audioSources, ...newSources],
        audioClips: [...snapshot.audioClips, ...newClips]
      }));
      const firstClip = newClips[0];
      if (firstClip) {
        setSelection({ kind: 'audio', id: firstClip.id });
        setPanelMode('audio');
        seek(firstClip.start);
      }
    } else {
      setPanelMode('audio');
    }

    setStatus(
      [
        newClips.length ? `오디오 ${newClips.length}개 추가` : '',
        relinkedCount ? `파일 ${relinkedCount}개 다시 연결` : ''
      ]
        .filter(Boolean)
        .join(' · ') || '오디오 파일을 연결했습니다.'
    );
  }

  function updateAudioClip(id: string, patch: Partial<AudioClip>, groupKey?: string) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        audioClips: snapshot.audioClips.map((clip) => {
          if (clip.id !== id) return clip;
          const source = snapshot.audioSources.find((item) => item.id === clip.sourceId);
          return normalizeAudioClip({ ...clip, ...patch }, source);
        })
      }),
      { groupKey }
    );
  }

  function moveAudioClip(id: string, start: number, end: number, groupKey?: string) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        audioClips: snapshot.audioClips.map((clip) => {
          if (clip.id !== id) return clip;
          const source = snapshot.audioSources.find((item) => item.id === clip.sourceId);
          const duration = Math.max(MIN_CUE_DURATION, end - start);
          return normalizeAudioClip(
            {
              ...clip,
              start,
              end,
              sourceEnd: clip.sourceStart + duration
            },
            source
          );
        })
      }),
      { groupKey }
    );
  }

  function trimAudioClipOnTimeline(
    id: string,
    edge: 'start' | 'end',
    time: number,
    groupKey?: string
  ) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        audioClips: snapshot.audioClips.map((clip) => {
          if (clip.id !== id) return clip;
          const source = snapshot.audioSources.find((item) => item.id === clip.sourceId);
          return trimAudioClip(clip, edge, time, source);
        })
      }),
      { groupKey }
    );
  }

  function commitEditor(
    updater: (snapshot: EditorSnapshot) => EditorSnapshot,
    options: { groupKey?: string } = {}
  ) {
    const now = Date.now();
    const lastGroup = lastHistoryGroupRef.current;
    const shouldMerge =
      options.groupKey !== undefined &&
      lastGroup !== null &&
      lastGroup.key === options.groupKey &&
      now - lastGroup.time < HISTORY_GROUP_WINDOW_MS;

    setEditorHistory((previous) =>
      commitEditorHistory(previous, updater(previous.present), {
        merge: shouldMerge
      })
    );

    lastHistoryGroupRef.current = options.groupKey
      ? { key: options.groupKey, time: now }
      : null;
  }

  function resetEditor(snapshot: EditorSnapshot) {
    lastHistoryGroupRef.current = null;
    setEditorHistory(createEditorHistory(snapshot));
  }

  function resetExportState() {
    exportControllerRef.current?.abort();
    cancelActiveExport();
    exportControllerRef.current = null;
    setIsExporting(false);
    setExportProgress(0);
    setExportPhase('idle');
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl(null);
    setExportDownloadName('captioned-output.mp4');
    setExportLastLog('');
    setExportPreflightNote('');
  }

  function resetImportedFonts() {
    importedFontUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    importedFontUrlsRef.current = [];
    setFontAssets([builtinFontAsset]);
  }

  function clearAudioRuntimeState() {
    Object.values(audioUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    audioUrlsRef.current = {};
    Object.values(audioPreviewRefs.current).forEach((audio) => audio?.pause());
    audioPreviewRefs.current = {};
    setAudioFiles({});
    setAudioUrls({});
    setAudioWaveforms({});
  }

  function resetProjectState() {
    resetExportState();
    resetImportedFonts();
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    if (transitionVideoRef.current) {
      transitionVideoRef.current.pause();
      transitionVideoRef.current.removeAttribute('src');
      transitionVideoRef.current.load();
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl(null);
    setDimensions(defaultDimensions);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    resetEditor({
      cues: [],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: [],
      audioSources: [],
      audioClips: []
    });
    clearAudioRuntimeState();
    setSelection(null);
    setPanelMode('video');
    setCutRange({ start: null, end: null });
    setEffectReplayTokens({});
    setTimelineThumbnails([]);
    setThumbnailRequest(null);
    thumbnailCacheRef.current.clear();
    setRestoredVideoName(null);
    setMediaMeta(null);
    setIsRestoringVideo(false);
    setProjectCreatedAt(new Date().toISOString());
    setLastAutosavedAt(null);
    localStorage.removeItem(AUTOSAVE_KEY);
    videoCacheVersionRef.current += 1;
    void clearAutosaveVideoFile().catch(() => undefined);
    setStatus('새 프로젝트로 초기화했습니다.');
  }

  function requestProjectReset() {
    if (!hasResettableProject) {
      setStatus('초기화할 프로젝트 내용이 없습니다.');
      return;
    }

    setPendingResetAction({ kind: 'reset-project' });
  }

  function confirmPendingResetAction() {
    const action = pendingResetAction;
    if (!action) return;

    setPendingResetAction(null);
    if (action.kind === 'replace-video') {
      loadVideoFile(action.file);
      return;
    }

    resetProjectState();
  }

  function cancelPendingResetAction() {
    setPendingResetAction(null);
    setStatus('초기화를 취소했습니다.');
  }

  function startGuideTour() {
    setIsHelpOpen(false);
    setGuideStepIndex(0);
    setGuideTargetRect(null);
    setIsGuideActive(true);
  }

  function finishGuideTour(message = '튜토리얼을 완료했습니다.') {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsGuideActive(false);
    setGuideStepIndex(0);
    setGuideTargetRect(null);
    setStatus(message);
  }

  function nextGuideStep() {
    if (guideStepIndex >= guideSteps.length - 1) {
      finishGuideTour();
      return;
    }

    setGuideStepIndex((index) => Math.min(index + 1, guideSteps.length - 1));
  }

  function previousGuideStep() {
    setGuideStepIndex((index) => Math.max(0, index - 1));
  }

  function undoEdit() {
    if (!canUndo) {
      setStatus('되돌릴 편집이 없습니다.');
      return;
    }

    lastHistoryGroupRef.current = null;
    setEditorHistory((previous) => undoEditorHistory(previous));
    setStatus('되돌렸습니다.');
  }

  function redoEdit() {
    if (!canRedo) {
      setStatus('다시 적용할 편집이 없습니다.');
      return;
    }

    lastHistoryGroupRef.current = null;
    setEditorHistory((previous) => redoEditorHistory(previous));
    setStatus('다시 적용했습니다.');
  }

  function addCaption() {
    const start = currentTime;
    const end = duration ? Math.min(duration, start + 3) : start + 3;
    const cue = createCue(start, end, '새 자막을 입력하세요');
    commitEditor((snapshot) => ({
      ...snapshot,
      cues: sortCues([...snapshot.cues, cue])
    }));
    setSelection({ kind: 'cue', id: cue.id });
    setPanelMode('captions');
  }

  function addTextOverlay() {
    const start = currentTime;
    const end = duration ? Math.min(duration, start + 4) : start + 4;
    const overlay: TextOverlay = {
      id: crypto.randomUUID(),
      start,
      end: Math.max(end, start + MIN_CUE_DURATION),
      ...defaultTextOverlay
    };

    commitEditor((snapshot) => ({
      ...snapshot,
      overlays: [...snapshot.overlays, overlay]
    }));
    setSelection({ kind: 'overlay', id: overlay.id });
    setPanelMode('texts');
  }

  function addInteractionEffect(kind: InteractionEffectKind = 'tap') {
    const start = currentTime;
    const defaultDuration = isArtworkEffect(kind) ? ONE_SHOT_EFFECT_DURATION : 0.9;
    const end = duration ? Math.min(duration, start + defaultDuration) : start + defaultDuration;
    const effect: InteractionEffect = {
      id: crypto.randomUUID(),
      start,
      end: Math.max(end, start + MIN_CUE_DURATION),
      ...defaultInteractionEffect,
      ...interactionEffectPresets[kind],
      kind
    };

    commitEditor((snapshot) => ({
      ...snapshot,
      effects: [...snapshot.effects, effect]
    }));
    setSelection({ kind: 'effect', id: effect.id });
    setPanelMode('effects');
  }

  function replayEffectAnimation(id: string) {
    setEffectReplayTokens((tokens) => ({
      ...tokens,
      [id]: (tokens[id] ?? 0) + 1
    }));
  }

  function selectEffect(id: string) {
    setSelection({ kind: 'effect', id });
    setPanelMode('effects');
    replayEffectAnimation(id);
  }

  function selectTimelineItem(nextSelection: NonNullable<Selection>) {
    setSelection(nextSelection);
    setPanelMode(
      nextSelection.kind === 'clip'
        ? 'video'
        : nextSelection.kind === 'audio' || nextSelection.kind === 'sourceAudio'
          ? 'audio'
        : nextSelection.kind === 'cue'
        ? 'captions'
        : nextSelection.kind === 'overlay'
          ? 'texts'
          : 'effects'
    );
    if (nextSelection.kind === 'effect') {
      replayEffectAnimation(nextSelection.id);
    }
  }

  function updateCue(id: string, patch: Partial<CaptionCue>, groupKey?: string) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        cues: sortCues(
          snapshot.cues.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue))
        )
      }),
      { groupKey }
    );
  }

  function updateCueStyle(id: string, patch: Partial<CaptionStyle>, groupKey?: string) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        cues: snapshot.cues.map((cue) =>
          cue.id === id ? { ...cue, style: { ...cue.style, ...patch } } : cue
        )
      }),
      { groupKey }
    );
  }

  function updateCueTime(id: string, key: 'start' | 'end', value: number) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        cues: sortCues(
          snapshot.cues.map((cue) => {
            if (cue.id !== id) return cue;
            const bounds = coerceCueBounds(
              key === 'start' ? value : cue.start,
              key === 'end' ? value : cue.end,
              duration || undefined
            );
            return { ...cue, ...bounds };
          })
        )
      }),
      { groupKey: `cue-time:${id}:${key}` }
    );
  }

  function updateOverlay(id: string, patch: Partial<TextOverlay>, groupKey?: string) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        overlays: snapshot.overlays.map((overlay) =>
          overlay.id === id ? { ...overlay, ...patch } : overlay
        )
      }),
      { groupKey }
    );
  }

  function updateOverlayTime(id: string, key: 'start' | 'end', value: number) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        overlays: snapshot.overlays.map((overlay) => {
          if (overlay.id !== id) return overlay;
          const bounds = coerceCueBounds(
            key === 'start' ? value : overlay.start,
            key === 'end' ? value : overlay.end,
            duration || undefined
          );
          return { ...overlay, ...bounds };
        })
      }),
      { groupKey: `overlay-time:${id}:${key}` }
    );
  }

  function updateEffect(id: string, patch: Partial<InteractionEffect>, groupKey?: string) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        effects: snapshot.effects.map((effect) =>
          effect.id === id ? { ...effect, ...patch } : effect
        )
      }),
      { groupKey }
    );
  }

  function updateEffectTime(id: string, key: 'start' | 'end', value: number) {
    commitEditor(
      (snapshot) => ({
        ...snapshot,
        effects: snapshot.effects.map((effect) => {
          if (effect.id !== id) return effect;
          const bounds = coerceCueBounds(
            key === 'start' ? value : effect.start,
            key === 'end' ? value : effect.end,
            duration || undefined
          );
          return { ...effect, ...bounds };
        })
      }),
      { groupKey: `effect-time:${id}:${key}` }
    );
  }

  function ensureDefaultClip(sourceDuration: number) {
    if (!sourceDuration || sourceDuration <= 0) return;

    let createdClipId: string | null = null;
    commitEditor((snapshot) => {
      if (snapshot.videoClips.length > 0) {
        const nextClips = snapshot.videoClips.map((clip) => ({
          ...clip,
          sourceStart: clamp(clip.sourceStart, 0, Math.max(0, sourceDuration - MIN_CUE_DURATION)),
          sourceEnd: clamp(clip.sourceEnd, MIN_CUE_DURATION, sourceDuration)
        }));

        return {
          ...snapshot,
          videoClips: nextClips,
          transitions: normalizeTransitionsForClips(nextClips, snapshot.transitions)
        };
      }

      return {
        ...snapshot,
        videoClips: [
          (() => {
            const clip = createDefaultVideoClip(sourceDuration);
            createdClipId = clip.id;
            return clip;
          })()
        ],
        transitions: []
      };
    });

    if (createdClipId) {
      setSelection({ kind: 'clip', id: createdClipId });
      setPanelMode('video');
    }
  }

  function splitClipAtPlayhead() {
    const result = splitClipAtTimelineTime(videoClips, transitions, currentTime);
    if (!result) {
      setStatus('영상 조각 끝부분에서는 나눌 수 없습니다.');
      return;
    }

    commitEditor((snapshot) => ({
      ...snapshot,
      videoClips: result.clips,
      transitions: result.transitions
    }));
    setSelection({ kind: 'clip', id: result.selectedClipId });
    setPanelMode('video');
    setStatus('현재 위치에서 영상 조각을 나눴습니다.');
  }

  function markCutRangeStart() {
    setCutRange((previous) => ({
      start: currentTime,
      end: previous.end !== null && previous.end > currentTime ? previous.end : null
    }));
    setStatus(`제거할 구간 시작점 ${formatClock(currentTime)} 설정`);
  }

  function markCutRangeEnd() {
    setCutRange((previous) => ({
      start: previous.start !== null && previous.start < currentTime ? previous.start : null,
      end: currentTime
    }));
    setStatus(`제거할 구간 끝점 ${formatClock(currentTime)} 설정`);
  }

  function clearCutRange() {
    setCutRange({ start: null, end: null });
    setStatus('구간 제거 선택을 해제했습니다.');
  }

  function removeMarkedCutRange() {
    if (cutRangeStart === null || cutRangeEnd === null) {
      setStatus('제거할 시작점과 끝점을 먼저 지정하세요.');
      return;
    }

    const result = removeTimelineRange(videoClips, transitions, cutRangeStart, cutRangeEnd);
    if (!result) {
      setStatus('전체 영상 또는 너무 짧은 구간은 제거할 수 없습니다.');
      return;
    }

    commitEditor((snapshot) => ({
      ...snapshot,
      videoClips: result.clips,
      transitions: result.transitions,
      cues: sortCues(removeTimedRangeItems(snapshot.cues, cutRangeStart, cutRangeEnd)),
      overlays: removeTimedRangeItems(snapshot.overlays, cutRangeStart, cutRangeEnd),
      effects: removeTimedRangeItems(snapshot.effects, cutRangeStart, cutRangeEnd),
      audioClips: removeAudioRangeItems(snapshot.audioClips, cutRangeStart, cutRangeEnd)
    }));
    setSelection(null);
    setPanelMode('video');
    setCutRange({ start: null, end: null });
    seek(cutRangeStart);
    setStatus(
      `${formatClock(cutRangeStart)} - ${formatClock(
        cutRangeEnd
      )} 구간을 제거하고 남은 영상 조각을 이어 붙였습니다.`
    );
  }

  function updateVideoClip(id: string, patch: Partial<VideoClip>, groupKey?: string) {
    commitEditor(
      (snapshot) => {
        const nextClips = snapshot.videoClips.map((clip) => {
          if (clip.id !== id) return clip;
          const nextClip = {
            ...clip,
            ...patch,
            speed: patch.speed !== undefined ? normalizeSpeed(patch.speed) : clip.speed
          };
          const sourceStart = clamp(
            nextClip.sourceStart,
            0,
            Math.max(0, duration - MIN_CUE_DURATION)
          );
          const sourceEnd = clamp(
            nextClip.sourceEnd,
            sourceStart + MIN_CUE_DURATION,
            duration || nextClip.sourceEnd
          );

          return {
            ...nextClip,
            sourceStart,
            sourceEnd,
            volume: normalizeAudioVolume(nextClip.volume),
            fadeIn: normalizeAudioFade(nextClip.fadeIn, sourceEnd - sourceStart),
            fadeOut: normalizeAudioFade(nextClip.fadeOut, sourceEnd - sourceStart)
          };
        });

        return {
          ...snapshot,
          videoClips: nextClips,
          transitions: normalizeTransitionsForClips(nextClips, snapshot.transitions)
        };
      },
      { groupKey }
    );
  }

  function trimVideoClip(
    id: string,
    edge: 'start' | 'end',
    sourceTime: number,
    groupKey?: string
  ) {
    const clip = videoClips.find((item) => item.id === id);
    if (!clip) return;

    updateVideoClip(
      id,
      edge === 'start'
        ? { sourceStart: Math.min(sourceTime, clip.sourceEnd - MIN_CUE_DURATION) }
        : { sourceEnd: Math.max(sourceTime, clip.sourceStart + MIN_CUE_DURATION) },
      groupKey
    );
  }

  function updateTransitionAfterSelected(
    kind: ClipTransitionKind | 'none',
    durationValue = selectedClipTransition?.duration ?? DEFAULT_TRANSITION_DURATION
  ) {
    if (!selectedClip) return;

    commitEditor((snapshot) => ({
      ...snapshot,
      transitions:
        kind === 'none'
          ? removeTransitionAfter(snapshot.videoClips, snapshot.transitions, selectedClip.id)
          : createOrUpdateTransition(
              snapshot.videoClips,
              snapshot.transitions,
              selectedClip.id,
              kind,
              durationValue
            )
    }));
  }

  function reorderVideoClip(clipId: string, targetIndex: number) {
    const result = reorderClipRipple(videoClips, transitions, clipId, targetIndex);
    if (!result) {
      setStatus('조각 위치가 이미 그 자리입니다.');
      return;
    }

    commitEditor((snapshot) => ({
      ...snapshot,
      videoClips: result.clips,
      transitions: result.transitions
    }));
    setSelection({ kind: 'clip', id: result.selectedClipId });
    setPanelMode('video');

    const nextRange = getClipTimelineRanges(result.clips, result.transitions).find(
      (range) => range.clip.id === result.selectedClipId
    );
    if (nextRange) seek(nextRange.start);

    const removedTransitionCount = Math.max(0, transitions.length - result.transitions.length);
    setStatus(
      `조각 ${result.fromIndex + 1}을 ${result.toIndex + 1}번째 위치로 이동했습니다.${
        removedTransitionCount
          ? ` 인접하지 않게 된 전환 ${removedTransitionCount}개는 정리했습니다.`
          : ''
      }`
    );
  }

  function moveSelectedClip(offset: number) {
    if (!selectedClip) return;
    reorderVideoClip(selectedClip.id, selectedClipIndex + offset);
  }

  function duplicateSelection() {
    if (selectedSourceAudioClip) {
      setStatus('원본 오디오는 영상 조각과 묶여 있어 별도 복제할 수 없습니다.');
      return;
    }

    if (selectedClip) {
      if (panelMode === 'audio') {
        setStatus('원본 오디오는 영상 조각과 묶여 있어 별도 복제할 수 없습니다.');
        return;
      }
      const result = insertDuplicateClipAfter(videoClips, transitions, selectedClip.id);
      if (result) {
        commitEditor((snapshot) => ({
          ...snapshot,
          videoClips: result.clips,
          transitions: result.transitions
        }));
        setSelection({ kind: 'clip', id: result.selectedClipId });
        setPanelMode('video');
      }
      return;
    }

    if (selectedCue) {
      const clone = {
        ...selectedCue,
        id: crypto.randomUUID(),
        start: selectedCue.start + 0.25,
        end: selectedCue.end + 0.25
      };
      commitEditor((snapshot) => ({
        ...snapshot,
        cues: sortCues([...snapshot.cues, clone])
      }));
      setSelection({ kind: 'cue', id: clone.id });
    }

    if (selectedOverlay) {
      const clone = {
        ...selectedOverlay,
        id: crypto.randomUUID(),
        start: selectedOverlay.start + 0.25,
        end: selectedOverlay.end + 0.25
      };
      commitEditor((snapshot) => ({
        ...snapshot,
        overlays: [...snapshot.overlays, clone]
      }));
      setSelection({ kind: 'overlay', id: clone.id });
    }

    if (selectedEffect) {
      const clone = {
        ...selectedEffect,
        id: crypto.randomUUID(),
        start: selectedEffect.start + 0.25,
        end: selectedEffect.end + 0.25
      };
      commitEditor((snapshot) => ({
        ...snapshot,
        effects: [...snapshot.effects, clone]
      }));
      setSelection({ kind: 'effect', id: clone.id });
    }

    if (selectedAudioClip) {
      const clone = {
        ...selectedAudioClip,
        id: crypto.randomUUID(),
        start: selectedAudioClip.start + 0.25,
        end: selectedAudioClip.end + 0.25
      };
      commitEditor((snapshot) => ({
        ...snapshot,
        audioClips: [...snapshot.audioClips, clone]
      }));
      setSelection({ kind: 'audio', id: clone.id });
      setPanelMode('audio');
    }
  }

  function deleteSelection() {
    if (selectedSourceAudioClip) {
      updateVideoClip(
        selectedSourceAudioClip.id,
        { muted: true },
        `video-audio:${selectedSourceAudioClip.id}:muted`
      );
      setStatus('선택한 원본 오디오를 음소거했습니다.');
      return;
    }

    if (selectedClip) {
      if (panelMode === 'audio') {
        updateVideoClip(selectedClip.id, { muted: true }, `video-audio:${selectedClip.id}:muted`);
        setStatus('선택한 원본 오디오를 음소거했습니다.');
        return;
      }
      const result = deleteClipRipple(videoClips, transitions, selectedClip.id);
      if (!result) {
        setStatus('마지막 영상 조각은 삭제할 수 없습니다.');
        return;
      }
      commitEditor((snapshot) => ({
        ...snapshot,
        videoClips: result.clips,
        transitions: result.transitions
      }));
      setSelection(null);
      setStatus('선택한 영상 조각을 삭제하고 뒤 조각을 앞으로 붙였습니다.');
      return;
    }
    if (selectedCue) {
      commitEditor((snapshot) => ({
        ...snapshot,
        cues: snapshot.cues.filter((cue) => cue.id !== selectedCue.id)
      }));
      setSelection(null);
      setStatus('선택한 자막을 삭제했습니다.');
      return;
    }
    if (selectedOverlay) {
      commitEditor((snapshot) => ({
        ...snapshot,
        overlays: snapshot.overlays.filter(
          (overlay) => overlay.id !== selectedOverlay.id
        )
      }));
      setSelection(null);
      setPreviewGuide(null);
      setStatus('선택한 텍스트를 삭제했습니다.');
      return;
    }
    if (selectedEffect) {
      commitEditor((snapshot) => ({
        ...snapshot,
        effects: snapshot.effects.filter((effect) => effect.id !== selectedEffect.id)
      }));
      setSelection(null);
      setPreviewGuide(null);
      setStatus('선택한 효과를 삭제했습니다.');
      return;
    }
    if (selectedAudioClip) {
      commitEditor((snapshot) => ({
        ...snapshot,
        audioClips: snapshot.audioClips.filter((clip) => clip.id !== selectedAudioClip.id)
      }));
      setSelection(null);
      setStatus('선택한 오디오 클립을 삭제했습니다.');
      return;
    }
    setSelection(null);
  }

  function moveSelectionToPlayhead() {
    if (selectedSourceAudioClip) {
      const range = clipRanges.find((item) => item.clip.id === selectedSourceAudioClip.id);
      if (range) seek(range.start);
      return;
    }

    if (selectedClip) {
      const range = clipRanges.find((item) => item.clip.id === selectedClip.id);
      if (range) seek(range.start);
      return;
    }

    if (selectedCue) {
      const length = selectedCue.end - selectedCue.start;
      updateCue(selectedCue.id, {
        start: currentTime,
        end: currentTime + Math.max(length, MIN_CUE_DURATION)
      });
    }

    if (selectedOverlay) {
      const length = selectedOverlay.end - selectedOverlay.start;
      updateOverlay(selectedOverlay.id, {
        start: currentTime,
        end: currentTime + Math.max(length, MIN_CUE_DURATION)
      });
    }

    if (selectedEffect) {
      const length = selectedEffect.end - selectedEffect.start;
      updateEffect(selectedEffect.id, {
        start: currentTime,
        end: currentTime + Math.max(length, MIN_CUE_DURATION)
      });
    }

    if (selectedAudioClip) {
      const length = selectedAudioClip.end - selectedAudioClip.start;
      moveAudioClip(
        selectedAudioClip.id,
        currentTime,
        currentTime + Math.max(length, MIN_CUE_DURATION),
        `audio-move:${selectedAudioClip.id}`
      );
    }
  }

  function moveOverlayWithPreviewGuides(id: string, x: number, y: number) {
    const next = snapPreviewPosition(x, y);
    setPreviewGuide(next.guide);
    updateOverlay(id, { x: next.x, y: next.y }, `overlay-position:${id}`);
  }

  function moveEffectWithPreviewGuides(id: string, x: number, y: number) {
    const next = snapPreviewPosition(x, y);
    setPreviewGuide(next.guide);
    updateEffect(id, { x: next.x, y: next.y }, `effect-position:${id}`);
  }

  function clearPreviewGuides() {
    setPreviewGuide(null);
  }

  async function importSubtitles(file: File) {
    try {
      const text = await file.text();
      const imported = parseSubtitleFile(text, file.name);
      commitEditor((snapshot) => ({
        ...snapshot,
        cues: imported
      }));
      setSelection(imported[0] ? { kind: 'cue', id: imported[0].id } : null);
      setPanelMode('captions');
      setStatus(`${imported.length}개 자막 불러옴`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '자막 파일을 읽지 못했습니다.');
    }
  }

  async function importProject(file: File) {
    try {
      const project = normalizeProjectFile(JSON.parse(await file.text()));
      const projectVideoName = project.mediaMeta?.name ?? project.videoName ?? null;
      const requiresVideoRelink = Boolean(
        projectVideoName &&
          !doesFileMatchProjectMedia(videoFile, project.mediaMeta, projectVideoName)
      );

      resetEditor({
        cues: project.cues,
        overlays: project.overlays ?? [],
        effects: project.effects ?? [],
        videoClips: project.videoClips ?? [],
        transitions: project.transitions ?? [],
        audioSources: project.audioSources ?? [],
        audioClips: project.audioClips ?? []
      });
      clearAudioRuntimeState();
      resetExportState();
      if (requiresVideoRelink) {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        }
        if (transitionVideoRef.current) {
          transitionVideoRef.current.pause();
          transitionVideoRef.current.removeAttribute('src');
          transitionVideoRef.current.load();
        }
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        setVideoFile(null);
        setVideoUrl(null);
        setDuration(0);
        setDimensions(defaultDimensions);
        setCurrentTime(0);
        setIsPlaying(false);
        setTimelineThumbnails([]);
        setThumbnailRequest(null);
        thumbnailCacheRef.current.clear();
        setRestoredVideoName(projectVideoName);
      } else {
        setRestoredVideoName(null);
      }
      setMediaMeta(project.mediaMeta ?? (videoFile ? createProjectMediaMeta(videoFile, { duration, ...dimensions }) : null));
      setIsRestoringVideo(false);
      setCutRange({ start: null, end: null });
      setProjectCreatedAt(project.createdAt ?? new Date().toISOString());
      const firstSelection =
        project.videoClips?.[0]
          ? ({ kind: 'clip', id: project.videoClips[0].id } as const)
          : project.cues[0]
          ? ({ kind: 'cue', id: project.cues[0].id } as const)
          : project.overlays[0]
            ? ({ kind: 'overlay', id: project.overlays[0].id } as const)
            : project.effects[0]
              ? ({ kind: 'effect', id: project.effects[0].id } as const)
              : project.audioClips?.[0]
                ? ({ kind: 'audio', id: project.audioClips[0].id } as const)
              : null;
      setSelection(firstSelection);
      setPanelMode(
        firstSelection?.kind === 'overlay'
          ? 'texts'
          : firstSelection?.kind === 'effect'
            ? 'effects'
            : firstSelection?.kind === 'audio'
              ? 'audio'
            : firstSelection?.kind === 'clip'
              ? 'video'
              : 'captions'
      );
      setStatus(
        requiresVideoRelink
          ? `프로젝트 불러옴. 원본 영상 "${projectVideoName}"을 다시 연결하세요.`
          : project.audioSources?.length
            ? '프로젝트 불러옴. 오디오 파일은 오디오 패널에서 다시 연결하세요.'
            : '프로젝트 불러옴'
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '프로젝트 파일을 읽지 못했습니다.');
    }
  }

  function saveProject() {
    const now = new Date().toISOString();
    const project: ProjectFile = {
      version: 1,
      videoName: videoFile?.name ?? restoredVideoName ?? undefined,
      mediaMeta: mediaMeta ?? undefined,
      cues,
      overlays,
      effects,
      videoClips,
      transitions,
      audioSources,
      audioClips,
      createdAt: projectCreatedAt,
      updatedAt: now
    };
    downloadText(JSON.stringify(project, null, 2), 'caption-project.json', 'application/json');
    setStatus('프로젝트 JSON 저장 완료');
  }

  function exportSrt() {
    downloadText(cuesToSrt(cues), 'captions.srt', 'text/plain;charset=utf-8');
    setStatus('SRT 내보내기 완료');
  }

  function exportVtt() {
    downloadText(cuesToVtt(cues), 'captions.vtt', 'text/vtt;charset=utf-8');
    setStatus('WebVTT 내보내기 완료');
  }

  function exportAss() {
    downloadText(
      buildAssScript(cues, overlays, outputDimensions, effects),
      'captions.ass',
      'text/plain;charset=utf-8'
    );
    setStatus('ASS 내보내기 완료');
  }

	  async function renderMp4Job({
    jobLabel,
	    doneMessage,
	    saveTarget,
	    jobCues,
	    jobOverlays,
    jobEffects,
    jobClips,
    jobTransitions,
    jobAudioClips
  }: {
    jobLabel: string;
	    doneMessage: string;
	    saveTarget: Mp4SaveTarget;
	    jobCues: CaptionCue[];
    jobOverlays: TextOverlay[];
    jobEffects: InteractionEffect[];
    jobClips: VideoClip[];
    jobTransitions: ClipTransition[];
    jobAudioClips: AudioClip[];
  }) {
    if (!videoFile) {
      setStatus('먼저 영상 파일을 선택하세요.');
      return;
    }

    const controller = new AbortController();
    exportControllerRef.current = controller;
    setIsExporting(true);
    setExportProgress(0);
    setExportPhase('engine');
    setExportLastLog('');
    setExportPreflightNote('');
    setStatus(`${jobLabel} 준비 중`);

    try {
      const detectedAudio = await detectVideoHasAudio(videoFile);
      const preflight = createExportPreflightResult({
        sourceDuration: duration,
        dimensions,
        preset: exportPreset,
        clips: jobClips,
        transitions: jobTransitions,
        hasAudio: detectedAudio,
        fileSize: videoFile.size
      });
      const missingAudioCount = jobAudioClips.filter((clip) => !audioFiles[clip.sourceId]).length;
      const preflightMessages = [
        ...preflight.messages,
        ...(missingAudioCount > 0
          ? [`재연결되지 않은 오디오 ${missingAudioCount}개는 제외됩니다.`]
          : [])
      ];
      setExportPreflightNote(formatExportPreflightNote(preflightMessages, preflight.risk));

      const blob = await exportVideoWithBurnedSubtitles(
        videoFile,
        jobCues,
        jobOverlays,
        jobEffects,
        jobClips,
        jobTransitions,
        {
          preset: exportPreset,
          dimensions,
          sourceDuration: duration,
          hasAudio: preflight.hasAudio !== false,
          audioSources,
          audioClips: jobAudioClips,
          audioFiles,
          fontFiles: fontAssets
            .map((asset) => asset.file)
            .filter((file): file is File => Boolean(file)),
          signal: controller.signal,
          onProgress: setExportProgress,
          onStatus: (message) => {
            setExportPhase(getExportPhaseFromStatus(message));
            setStatus(`${jobLabel}: ${message}`);
          },
          onLog: (message) => {
            setExportLastLog(compactFfmpegLog(message));
            if (message.toLowerCase().includes('error')) {
              setExportPhase('error');
              setStatus(message);
            }
          }
        }
      );

	      if (exportUrl) URL.revokeObjectURL(exportUrl);
	      const objectUrl = URL.createObjectURL(blob);
	      setExportUrl(objectUrl);
	      setExportDownloadName(saveTarget.fileName);

	      if (saveTarget.kind === 'file-system') {
	        setExportPhase('finalize');
	        setStatus(`${jobLabel}: 선택한 위치에 저장하는 중`);
	        await writeBlobToFileHandle(saveTarget.handle, blob);
	      } else {
	        triggerBlobDownload(objectUrl, saveTarget.fileName);
	      }

	      setExportPhase('done');
	      setStatus(
	        saveTarget.kind === 'file-system'
	          ? `${saveTarget.fileName} 저장 완료`
	          : doneMessage
	      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (
        error instanceof ExportRenderError
          ? error.kind === 'cancelled'
          : message.includes('terminate') || message.includes('aborted')
      ) {
        setExportPhase('cancelled');
        setStatus('MP4 내보내기를 취소했습니다.');
      } else {
        setExportPhase('error');
        setStatus(error instanceof Error ? error.message : 'MP4 내보내기에 실패했습니다.');
      }
    } finally {
      if (exportControllerRef.current === controller) {
        exportControllerRef.current = null;
      }
	      setIsExporting(false);
	    }
	  }

	  async function chooseMp4SaveTargetSafely(defaultFileName: string) {
	    try {
	      return await chooseMp4SaveTarget(defaultFileName);
	    } catch (error) {
	      setStatus(
	        error instanceof Error
	          ? `저장 위치를 선택하지 못했습니다: ${error.message}`
	          : '저장 위치를 선택하지 못했습니다.'
	      );
	      return null;
	    }
	  }

	  async function exportMp4() {
    if (!videoFile) {
      setStatus('먼저 영상 파일을 선택하세요.');
      return;
    }

	    if (!hasVideoEdit && !hasExportableLayers) {
	      setStatus('영상 파일을 불러온 뒤 MP4를 내보내세요.');
	      return;
	    }

	    const saveTarget = await chooseMp4SaveTargetSafely('edit-studio-output.mp4');
	    if (!saveTarget) {
	      setStatus('MP4 저장을 취소했습니다.');
	      return;
	    }

	    await renderMp4Job({
	      jobLabel: '전체 MP4',
	      doneMessage: `${saveTarget.fileName} 다운로드 준비 완료`,
	      saveTarget,
	      jobCues: cues,
	      jobOverlays: overlays,
      jobEffects: effects,
      jobClips: videoClips,
      jobTransitions: transitions,
      jobAudioClips: audioClips
    });
  }

  async function exportSelectedClipMp4() {
    if (!selectedClip) {
      setStatus('먼저 영상 트랙에서 저장할 조각을 선택하세요.');
      return;
    }

    const selectedRange = clipRanges.find((range) => range.clip.id === selectedClip.id);
    if (!selectedRange) {
      setStatus('선택한 조각의 타임라인 위치를 찾지 못했습니다.');
      return;
    }

	    const clipIndex = selectedRange.index + 1;
	    const rangeStart = selectedRange.start;
	    const rangeEnd = selectedRange.end;
	    const saveTarget = await chooseMp4SaveTargetSafely(`edit-studio-clip-${clipIndex}.mp4`);
	    if (!saveTarget) {
	      setStatus('조각 MP4 저장을 취소했습니다.');
	      return;
	    }

	    await renderMp4Job({
	      jobLabel: `조각 ${clipIndex} MP4`,
	      doneMessage: `${saveTarget.fileName} 다운로드 준비 완료`,
	      saveTarget,
	      jobCues: shiftTimelineItemsToClip(cues, rangeStart, rangeEnd),
      jobOverlays: shiftTimelineItemsToClip(overlays, rangeStart, rangeEnd),
      jobEffects: shiftTimelineItemsToClip(effects, rangeStart, rangeEnd),
      jobClips: [selectedClip],
      jobTransitions: [],
      jobAudioClips: shiftAudioClipsToClip(audioClips, rangeStart, rangeEnd)
    });
  }

  function cancelExport() {
    exportControllerRef.current?.abort();
    cancelActiveExport();
    setExportProgress(0);
    setExportPhase('cancelled');
    setIsExporting(false);
    setStatus('MP4 내보내기를 취소했습니다.');
  }

  function cleanCueOverlaps() {
    const cleaned = sortAndResolveCueOverlaps(cues);
    commitEditor((snapshot) => ({
      ...snapshot,
      cues: cleaned
    }));
    setStatus('자막 겹침을 정리했습니다.');
  }

  function seek(value: number) {
    const nextTime = clamp(value, 0, timelineDuration);
    setCurrentTime(nextTime);
    syncPreviewVideo(nextTime);
  }

  async function togglePlayback() {
    if (!videoRef.current) return;

    if (!isPlaying) {
      if (currentTime >= timelineDuration) {
        seek(0);
      }
      setIsPlaying(true);
      syncPreviewVideo(currentTime, true);
      await videoRef.current.play();
    } else {
      videoRef.current.pause();
      transitionVideoRef.current?.pause();
      pauseExternalAudioPreview();
      setIsPlaying(false);
    }
  }

  function syncPreviewVideo(time: number, shouldPlay = isPlaying) {
    const sourceTime = timelineToSourceTime(clipRanges, time);
    const nextClipRange = findClipRangeAtTime(clipRanges, time);

    if (videoRef.current && Number.isFinite(sourceTime)) {
      if (Math.abs(videoRef.current.currentTime - sourceTime) > (shouldPlay ? 0.2 : 0.02)) {
        videoRef.current.currentTime = sourceTime;
      }
      videoRef.current.playbackRate = nextClipRange?.clip.speed ?? 1;
      videoRef.current.muted = false;
      videoRef.current.volume = nextClipRange
        ? getVideoClipPreviewVolume(nextClipRange, time)
        : 1;
      if (shouldPlay && videoRef.current.paused) {
        void videoRef.current.play();
      }
    }

    if (transitionVideoRef.current && transitionPreview) {
      if (
        Math.abs(transitionVideoRef.current.currentTime - transitionPreview.nextSourceTime) >
        (shouldPlay ? 0.2 : 0.02)
      ) {
        transitionVideoRef.current.currentTime = transitionPreview.nextSourceTime;
      }
      transitionVideoRef.current.playbackRate =
        videoClips.find((clip) => clip.id === transitionPreview.transition.toClipId)
          ?.speed ?? 1;
      if (shouldPlay && transitionVideoRef.current.paused) {
        void transitionVideoRef.current.play();
      }
    }

    syncExternalAudioPreview(time, shouldPlay);
  }

  function syncExternalAudioPreview(time: number, shouldPlay = isPlaying) {
    audioClips.forEach((clip) => {
      const audio = audioPreviewRefs.current[clip.id];
      if (!audio) return;

      const active = time >= clip.start && time <= clip.end && Boolean(audioUrls[clip.sourceId]);
      if (!active || clip.muted) {
        audio.pause();
        return;
      }

      const localTime = clamp(time - clip.start, 0, getAudioClipDuration(clip));
      const sourceTime = clip.sourceStart + localTime;
      if (Math.abs(audio.currentTime - sourceTime) > (shouldPlay ? 0.2 : 0.03)) {
        audio.currentTime = sourceTime;
      }
      audio.volume = getAudioClipPreviewVolume(clip, time);

      if (shouldPlay && audio.paused) {
        void audio.play().catch(() => undefined);
      } else if (!shouldPlay) {
        audio.pause();
      }
    });
  }

  function pauseExternalAudioPreview() {
    Object.values(audioPreviewRefs.current).forEach((audio) => audio?.pause());
  }

  useEffect(() => {
    if (!isPlaying) {
      playbackClockRef.current = null;
      videoRef.current?.pause();
      transitionVideoRef.current?.pause();
      pauseExternalAudioPreview();
      return;
    }

    let frameId = 0;
    const tick = (timestamp: number) => {
      const previous = playbackClockRef.current ?? timestamp;
      const delta = (timestamp - previous) / 1000;
      playbackClockRef.current = timestamp;

      setCurrentTime((previousTime) => {
        const nextTime = clamp(previousTime + delta, 0, timelineDuration);
        if (nextTime >= timelineDuration) {
          videoRef.current?.pause();
          transitionVideoRef.current?.pause();
          pauseExternalAudioPreview();
          setIsPlaying(false);
        }
        return nextTime;
      });

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlaying, timelineDuration]);

  useEffect(() => {
    syncPreviewVideo(currentTime);
  }, [audioClips, audioUrls, clipRanges, currentTime, isPlaying, transitionPreview]);

  useEffect(() => {
    let cancelled = false;
    const rawAutosave = localStorage.getItem(AUTOSAVE_KEY);
    if (!rawAutosave) return undefined;

    try {
      const project = normalizeProjectFile(JSON.parse(rawAutosave));
      if (
        project.cues.length === 0 &&
        project.overlays.length === 0 &&
        project.effects.length === 0 &&
        (project.videoClips?.length ?? 0) === 0 &&
        (project.audioClips?.length ?? 0) === 0
      ) {
        return;
      }

      resetEditor({
        cues: project.cues,
        overlays: project.overlays,
        effects: project.effects,
        videoClips: project.videoClips ?? [],
        transitions: project.transitions ?? [],
        audioSources: project.audioSources ?? [],
        audioClips: project.audioClips ?? []
      });
      clearAudioRuntimeState();
      setProjectCreatedAt(project.createdAt);
      setLastAutosavedAt(project.updatedAt);
      const projectVideoName = project.mediaMeta?.name ?? project.videoName ?? null;
      setMediaMeta(project.mediaMeta ?? null);
      setRestoredVideoName(projectVideoName);
      const firstSelection =
        project.videoClips?.[0]
          ? ({ kind: 'clip', id: project.videoClips[0].id } as const)
          : project.cues[0]
          ? ({ kind: 'cue', id: project.cues[0].id } as const)
          : project.overlays[0]
            ? ({ kind: 'overlay', id: project.overlays[0].id } as const)
            : project.effects[0]
              ? ({ kind: 'effect', id: project.effects[0].id } as const)
              : project.audioClips?.[0]
                ? ({ kind: 'audio', id: project.audioClips[0].id } as const)
              : null;
      setSelection(firstSelection);
      setPanelMode(
        firstSelection?.kind === 'overlay'
          ? 'texts'
          : firstSelection?.kind === 'effect'
            ? 'effects'
            : firstSelection?.kind === 'audio'
              ? 'audio'
            : firstSelection?.kind === 'clip'
              ? 'video'
              : 'captions'
      );
      if (projectVideoName) {
        setIsRestoringVideo(true);
        setStatus(`자동 저장된 프로젝트를 복구했습니다. ${projectVideoName} 자동 연결을 확인하는 중입니다.`);
        void readAutosaveVideoFile()
          .then((file) => {
            if (cancelled) return;

            if (!file) {
              setStatus(
                `자동 저장된 프로젝트를 복구했습니다. 원본 영상 "${projectVideoName}"을 다시 연결하세요.`
              );
              return;
            }

            if (!doesFileMatchProjectMedia(file, project.mediaMeta, projectVideoName)) {
              setStatus(
                `자동 저장된 프로젝트를 복구했습니다. 저장된 원본과 파일명/크기/수정일이 맞는 "${projectVideoName}"을 다시 연결하세요.`
              );
              return;
            }

            relinkVideoFile(file, `${file.name}까지 자동으로 복구했습니다.`);
          })
          .catch(() => {
            if (cancelled) return;
            setStatus(
              `자동 저장된 프로젝트를 복구했습니다. 원본 영상 "${projectVideoName}"을 다시 연결하세요.`
            );
          })
          .finally(() => {
            if (!cancelled) setIsRestoringVideo(false);
          });
      } else {
        setStatus('자동 저장된 프로젝트를 복구했습니다.');
      }
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      cues.length === 0 &&
      overlays.length === 0 &&
      effects.length === 0 &&
      videoClips.length === 0 &&
      audioClips.length === 0
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const now = new Date().toISOString();
      const project: ProjectFile = {
        version: 1,
        videoName: videoFile?.name ?? restoredVideoName ?? undefined,
        mediaMeta: mediaMeta ?? undefined,
        cues,
        overlays,
        effects,
        videoClips,
        transitions,
        audioSources,
        audioClips,
        createdAt: projectCreatedAt,
        updatedAt: now
      };

      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
      setLastAutosavedAt(now);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    cues,
    effects,
    audioClips,
    audioSources,
    overlays,
    projectCreatedAt,
    mediaMeta,
    restoredVideoName,
    transitions,
    videoClips,
    videoFile?.name
  ]);

  useEffect(() => {
    if (selection?.kind === 'cue' && !cues.some((cue) => cue.id === selection.id)) {
      setSelection(null);
    }

    if (
      selection?.kind === 'overlay' &&
      !overlays.some((overlay) => overlay.id === selection.id)
    ) {
      setSelection(null);
    }

    if (
      selection?.kind === 'effect' &&
      !effects.some((effect) => effect.id === selection.id)
    ) {
      setSelection(null);
    }

    if (
      selection?.kind === 'clip' &&
      !videoClips.some((clip) => clip.id === selection.id)
    ) {
      setSelection(null);
    }

    if (
      selection?.kind === 'sourceAudio' &&
      !videoClips.some((clip) => clip.id === selection.id)
    ) {
      setSelection(null);
    }

    if (
      selection?.kind === 'audio' &&
      !audioClips.some((clip) => clip.id === selection.id)
    ) {
      setSelection(null);
    }
  }, [audioClips, cues, effects, overlays, selection, videoClips]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isGuideActive || isHelpOpen || pendingResetAction) return;

      const key = event.key.toLowerCase();
      const withCommand = event.metaKey || event.ctrlKey;

      if (withCommand && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoEdit();
        else undoEdit();
        return;
      }

      if (withCommand && key === 'y') {
        event.preventDefault();
        redoEdit();
        return;
      }

      if (isEditableTarget(event.target)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlayback();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection || hasCutRange) {
          event.preventDefault();
          if (selection) deleteSelection();
          else removeMarkedCutRange();
        }
        return;
      }

      if (!withCommand && event.altKey && selectedClip) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          moveSelectedClip(-1);
          return;
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault();
          moveSelectedClip(1);
          return;
        }
      }

      if (withCommand || event.altKey) return;

      if (key === 'a') {
        event.preventDefault();
        addCaption();
      }

      if (key === 't') {
        event.preventDefault();
        addTextOverlay();
      }

      if (key === 'e') {
        event.preventDefault();
        addInteractionEffect('tap');
      }

      if (key === 's') {
        event.preventDefault();
        splitClipAtPlayhead();
      }

      if (key === 'i') {
        event.preventDefault();
        markCutRangeStart();
      }

      if (key === 'o') {
        event.preventDefault();
        markCutRangeEnd();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = [...event.dataTransfer.files].find((item) => isVideoFile(item));
        if (file) handleVideoFile(file);
      }}
    >
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleSelectedVideoFile(file);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length > 0) {
            void importAudioFiles(files, audioImportKindRef.current);
          }
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".srt,.vtt,text/vtt,text/plain"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importSubtitles(file);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importProject(file);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={fontInputRef}
        type="file"
        multiple
        accept=".ttf,.otf,font/ttf,font/otf"
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void importFonts(files);
          event.currentTarget.value = '';
        }}
      />

      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-project">
            <div className="brand">
              <span className="brand-mark">
                <Clapperboard size={22} strokeWidth={2.2} />
              </span>
              <div>
                <strong>Edit Studio</strong>
                <span>{projectVideoLabel}</span>
              </div>
            </div>
            <div className="project-meta" aria-label="프로젝트 요약">
              <span>
                {videoFile
                  ? `${dimensions.width}x${dimensions.height}`
                  : needsVideoRelink
                    ? '영상 미연결'
                    : `${dimensions.width}x${dimensions.height}`}
              </span>
              <span>조각 {videoClips.length}</span>
              <span>레이어 {cues.length + overlays.length + effects.length}</span>
            </div>
          </div>

          <div className="header-status" aria-label="현재 재생 위치">
            <span>PLAYHEAD</span>
            <strong>{formatClock(currentTime)}</strong>
          </div>

          <div className="toolbar-section export" data-guide-target="export">
            <span className="toolbar-section-label">내보내기</span>
            <div className="toolbar-group export">
              <button
                type="button"
                className="export-format-button"
                onClick={exportSrt}
                disabled={cues.length === 0}
              >
                <FileDown size={17} />
                SRT
              </button>
              <button
                type="button"
                className="export-format-button"
                onClick={exportVtt}
                disabled={cues.length === 0}
              >
                <FileDown size={17} />
                VTT
              </button>
              <button
                type="button"
                className="export-format-button"
                onClick={exportAss}
                disabled={!hasExportableLayers}
              >
                <FileDown size={17} />
                ASS
              </button>
              <select
                className="export-preset-select"
                value={exportPreset}
                onChange={(event) => setExportPreset(event.target.value as ExportPreset)}
                aria-label="MP4 export preset"
              >
                <option value="fast720">720p 빠른 렌더</option>
                <option value="source">원본 해상도</option>
              </select>
              <button
                type="button"
                className="primary mp4-export-button"
                onClick={isExporting ? cancelExport : () => void exportMp4()}
                disabled={!videoFile || (!isExporting && !hasVideoEdit && !hasExportableLayers)}
                title="전체 MP4 내보내기"
              >
                <span className="mp4-export-icon">
                  {isExporting ? <X size={15} /> : <Download size={15} />}
                </span>
                <span className="mp4-export-copy">
                  <strong>{isExporting ? '취소' : 'MP4'}</strong>
                  <small>{isExporting ? '중지' : '저장'}</small>
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="toolbar topbar-tools" aria-label="상단 편집 도구">
          <div className="toolbar-section">
            <span className="toolbar-section-label">가져오기</span>
            <div className="toolbar-group">
              <button
                type="button"
                data-guide-target="import-video"
                onClick={() => openVideoPicker(needsVideoRelink ? 'relink' : 'normal')}
              >
                <Upload size={17} />
                영상
              </button>
              <button type="button" onClick={() => subtitleInputRef.current?.click()}>
                <Captions size={17} />
                자막
              </button>
              <button type="button" onClick={() => projectInputRef.current?.click()}>
                <FileJson size={17} />
                열기
              </button>
            </div>
          </div>
          <div className="toolbar-section" data-guide-target="project-tools">
            <span className="toolbar-section-label">프로젝트</span>
            <div className="toolbar-group compact">
              <button type="button" onClick={saveProject}>
                <Save size={17} />
                저장
              </button>
              <button
                type="button"
                className="reset-project-button"
                onClick={requestProjectReset}
                disabled={!hasResettableProject || isExporting}
                title="현재 영상, 자막, 텍스트, 효과, 컷 편집과 가져온 폰트 설정을 비웁니다."
              >
                <Trash2 size={17} />
                초기화
              </button>
              <button
                type="button"
                className="help-button"
                data-guide-target="help"
                onClick={() => setIsHelpOpen(true)}
              >
                <CircleHelp size={17} />
                도움말
              </button>
              <button
                type="button"
                className="icon-only"
                onClick={undoEdit}
                disabled={!canUndo}
                title="되돌리기"
                aria-label="되돌리기"
              >
                <Undo2 size={17} />
              </button>
              <button
                type="button"
                className="icon-only"
                onClick={redoEdit}
                disabled={!canRedo}
                title="다시 적용"
                aria-label="다시 적용"
              >
                <Redo2 size={17} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {pendingResetAction && (
        <div
          className="reset-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              cancelPendingResetAction();
            }
          }}
        >
          <section
            className="reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
          >
            <span className="reset-dialog-kicker">
              {pendingResetAction.kind === 'replace-video' ? '영상 교체' : '프로젝트 초기화'}
            </span>
            <h2 id="reset-dialog-title">현재 편집 내용을 초기화할까요?</h2>
            <p>
              자막, 텍스트, 효과, 영상 조각, 전환, 가져온 폰트와 내보내기 결과가 비워집니다.
              필요한 내용은 먼저 프로젝트 JSON으로 저장하세요.
            </p>
            {pendingResetAction.kind === 'replace-video' && (
              <div className="reset-dialog-target">
                <span>새 영상</span>
                <strong>{pendingResetAction.file.name}</strong>
              </div>
            )}
            <div className="reset-dialog-actions">
              <button type="button" onClick={cancelPendingResetAction}>
                취소
              </button>
              <button type="button" className="danger" onClick={confirmPendingResetAction}>
                {pendingResetAction.kind === 'replace-video' ? '초기화 후 교체' : '전체 초기화'}
              </button>
            </div>
          </section>
        </div>
      )}

      {isHelpOpen && (
        <HelpPanel
          onClose={() => setIsHelpOpen(false)}
          onStartGuide={startGuideTour}
        />
      )}

      {activeGuideStep && (
        <GuideOverlay
          step={activeGuideStep}
          stepIndex={guideStepIndex}
          stepCount={guideSteps.length}
          targetRect={guideTargetRect}
          onPrevious={previousGuideStep}
          onNext={nextGuideStep}
          onSkip={() => finishGuideTour('튜토리얼을 건너뛰었습니다.')}
        />
      )}

      <main className="workspace">
        <section className="preview-column">
          {needsVideoRelink && (
            <div className="restore-banner" role="status">
              <span className="restore-banner-icon">
                <AlertTriangle size={18} />
              </span>
              <div>
                <strong>
                  {isRestoringVideo ? '원본 영상을 자동으로 찾는 중' : '원본 영상 연결 필요'}
                </strong>
                <span>
                  프로젝트 내용은 복구됐습니다. 이어서 편집하려면
                  {restoredVideoName ? ` "${restoredVideoName}"` : ' 원본 영상'}을 다시 선택하세요.
                </span>
              </div>
              <button
                type="button"
                onClick={() => openVideoPicker('relink')}
                disabled={isExporting}
              >
                <Upload size={15} />
                다시 연결
              </button>
            </div>
          )}

          <div className={`stage-card preview-size-${previewSize}`} data-guide-target="preview">
            <div className="preview-viewbar">
              <div>
                <strong>미리보기</strong>
                <span>{dimensions.width}x{dimensions.height}</span>
              </div>
              <div className="preview-size-controls" aria-label="미리보기 크기">
                {previewSizeOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={previewSize === option.value ? 'active' : ''}
                    onClick={() => setPreviewSize(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {videoUrl ? (
              <div className="video-stage" onClick={() => void togglePlayback()}>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  onLoadedMetadata={(event) => {
                    const element = event.currentTarget;
                    const sourceDuration = element.duration || 0;
                    setDuration(sourceDuration);
                    setDimensions({
                      width: element.videoWidth || defaultDimensions.width,
                      height: element.videoHeight || defaultDimensions.height
                    });
                    setMediaMeta((current) =>
                      videoFile
                        ? createProjectMediaMeta(videoFile, {
                            duration: sourceDuration,
                            width: element.videoWidth || defaultDimensions.width,
                            height: element.videoHeight || defaultDimensions.height
                          })
                        : current
                    );
                    ensureDefaultClip(sourceDuration);
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
                {transitionPreview && (
                  <video
                    ref={transitionVideoRef}
                    src={videoUrl}
                    className={`transition-preview-video transition-${transitionPreview.transition.kind}`}
                    muted
                    aria-hidden="true"
                    style={transitionPreviewStyle(
                      transitionPreview.transition.kind,
                      transitionPreview.progress
                    )}
                  />
                )}
                <div className="overlay-layer">
                  {(selectedCue || selectedOverlay || selectedEffect) && (
                    <span className="preview-safe-frame" aria-hidden="true" />
                  )}
                  {previewGuide?.vertical !== undefined && (
                    <span
                      className="preview-align-guide vertical"
                      style={{ left: `${previewGuide.vertical}%` }}
                      aria-hidden="true"
                    />
                  )}
                  {previewGuide?.horizontal !== undefined && (
                    <span
                      className="preview-align-guide horizontal"
                      style={{ top: `${previewGuide.horizontal}%` }}
                      aria-hidden="true"
                    />
                  )}
                  {previewGuide && <span className="preview-guide-label">{previewGuide.label}</span>}
                  {activeCues.map((cue) => (
                    <CaptionPreview
                      key={cue.id}
                      cue={cue}
                      selected={selection?.kind === 'cue' && selection.id === cue.id}
                      onSelect={() => {
                        setSelection({ kind: 'cue', id: cue.id });
                        setPanelMode('captions');
                      }}
                      onTextChange={(text, groupKey) =>
                        updateCue(cue.id, { text }, groupKey ?? `preview-cue-text:${cue.id}`)
                      }
                    />
                  ))}
                  {activeOverlays.map((overlay) => (
                    <TextPreview
                      key={overlay.id}
                      overlay={overlay}
                      selected={selection?.kind === 'overlay' && selection.id === overlay.id}
                      onSelect={() => {
                        setSelection({ kind: 'overlay', id: overlay.id });
                        setPanelMode('texts');
                      }}
                      onMove={(x, y) => moveOverlayWithPreviewGuides(overlay.id, x, y)}
                      onMoveEnd={clearPreviewGuides}
                      onResize={(scaleX, scaleY) =>
                        updateOverlay(
                          overlay.id,
                          { scaleX, scaleY },
                          `overlay-scale:${overlay.id}`
                        )
                      }
                      onTextChange={(text, groupKey) =>
                        updateOverlay(
                          overlay.id,
                          { text },
                          groupKey ?? `preview-overlay-text:${overlay.id}`
                        )
                      }
                    />
                  ))}
                  {activeEffects.map((effect) => (
                    <InteractionEffectPreview
                      key={effect.id}
                      effect={effect}
                      selected={selection?.kind === 'effect' && selection.id === effect.id}
                      replayToken={effectReplayTokens[effect.id] ?? 0}
                      onSelect={() => {
                        selectEffect(effect.id);
                      }}
                      onMove={(x, y) => moveEffectWithPreviewGuides(effect.id, x, y)}
                      onMoveEnd={clearPreviewGuides}
                      onResize={(size) =>
                        updateEffect(effect.id, { size }, `effect-size:${effect.id}`)
                      }
                    />
                  ))}
                </div>
                <div className="audio-preview-layer" aria-hidden="true">
                  {audioClips.map((clip) => {
                    const url = audioUrls[clip.sourceId];
                    if (!url) return null;
                    return (
                      <audio
                        key={clip.id}
                        ref={(node) => {
                          audioPreviewRefs.current[clip.id] = node;
                        }}
                        src={url}
                        preload="auto"
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="empty-stage"
                onClick={() => openVideoPicker(needsVideoRelink ? 'relink' : 'normal')}
              >
                <Upload size={34} />
                <strong>{needsVideoRelink ? '원본 영상 다시 연결' : '영상 선택'}</strong>
                <span>{needsVideoRelink ? restoredVideoName : 'MP4, MOV, WebM'}</span>
              </button>
            )}
          </div>

          <div className="transport">
            <button type="button" className="icon-button" onClick={() => void togglePlayback()}>
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <span className="timecode">{formatClock(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={timelineDuration}
              step={0.01}
              value={currentTime}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="timecode">{formatClock(timelineDuration)}</span>
          </div>

          <div className="edit-context-strip">
            <div className="context-chip">
              <span>현재 선택</span>
              <strong>{selectionSummary}</strong>
            </div>
            <div
              className={`context-chip ${
                hasCutRange ? 'danger' : cutRange.start !== null || cutRange.end !== null ? 'pending' : ''
              }`}
            >
              <span>삭제 예정</span>
              <strong>{cutRangeStateLabel}</strong>
              {hasCutRange && <em>{formatClock(cutRangeDuration)} 제거</em>}
            </div>
            <div className="context-chip">
              <span>출력</span>
              <strong>
                {outputDimensions.width}x{outputDimensions.height}
              </strong>
            </div>
          </div>

          <div className="timeline-toolbar">
            <div className="timeline-toolbar-group">
              <span className="timeline-toolbar-label">상태</span>
              <div className="diagnostic-pills">
                {cueDiagnostics.overlapCount > 0 && (
                  <span className="warning-pill">
                    <AlertTriangle size={14} />
                    겹침 {cueDiagnostics.overlapCount}
                  </span>
                )}
                {cueDiagnostics.emptyTextCount > 0 && (
                  <span className="warning-pill">
                    <AlertTriangle size={14} />
                    빈 자막 {cueDiagnostics.emptyTextCount}
                  </span>
                )}
                {cueDiagnostics.invalidTimeCount > 0 && (
                  <span className="warning-pill">
                    <AlertTriangle size={14} />
                    시간 오류 {cueDiagnostics.invalidTimeCount}
                  </span>
                )}
                {cueDiagnostics.overlapCount === 0 &&
                  cueDiagnostics.emptyTextCount === 0 &&
                  cueDiagnostics.invalidTimeCount === 0 && (
                    <span className="ok-pill">자막 정상</span>
                  )}
              </div>
            </div>
            <div className="timeline-toolbar-group timeline-toolbar-group-grow">
              <span className="timeline-toolbar-label">편집</span>
              <div className="timeline-controls" data-guide-target="cut-tools">
                <button
                  type="button"
                  onClick={splitClipAtPlayhead}
                  disabled={videoClips.length === 0}
                  title="현재 위치에서 영상 조각을 둘로 나눕니다."
                >
                  <Scissors size={14} />
                  조각 분할
                </button>
                <button type="button" onClick={markCutRangeStart} disabled={videoClips.length === 0}>
                  IN
                </button>
                <button type="button" onClick={markCutRangeEnd} disabled={videoClips.length === 0}>
                  OUT
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={removeMarkedCutRange}
                  disabled={!hasCutRange}
                  title="IN/OUT 사이의 필요 없는 구간을 삭제하고 뒤 영상 조각을 앞으로 붙입니다."
                >
                  <Trash2 size={14} />
                  구간 삭제
                </button>
                <button
                  type="button"
                  onClick={clearCutRange}
                  disabled={cutRange.start === null && cutRange.end === null}
                >
                  범위 해제
                </button>
                <button
                  type="button"
                  onClick={cleanCueOverlaps}
                  disabled={cueDiagnostics.overlapCount === 0}
                >
                  겹침 정리
                </button>
              </div>
            </div>
          </div>
          <div className="shortcut-hints" aria-label="편집 단축키">
            <span><kbd>Space</kbd>재생</span>
            <span><kbd>S</kbd>분할</span>
            <span><kbd>I</kbd>IN</span>
            <span><kbd>O</kbd>OUT</span>
            <span><kbd>Del</kbd>삭제</span>
            <span><kbd>Esc</kbd>해제</span>
          </div>
          {(cutRange.start !== null || cutRange.end !== null) && (
            <div className={`cut-range-status ${hasCutRange ? 'ready' : 'pending'}`}>
              <span>{hasCutRange ? '삭제 예정' : '삭제 범위'}</span>
              <strong>{cutRange.start !== null ? formatClock(cutRange.start) : 'IN 없음'}</strong>
              <span>-</span>
              <strong>{cutRange.end !== null ? formatClock(cutRange.end) : 'OUT 없음'}</strong>
              <em>{hasCutRange ? `${formatClock(cutRangeDuration)} 제거` : 'IN/OUT 필요'}</em>
            </div>
          )}

            <Timeline
              videoClips={videoClips}
              transitions={transitions}
              audioSources={audioSources}
              audioClips={audioClips}
              audioWaveforms={audioWaveforms}
              cues={cues}
            overlays={overlays}
            effects={effects}
	            thumbnails={timelineThumbnails}
	            duration={timelineDuration}
	            sourceDuration={duration}
	            currentTime={currentTime}
            selection={selection}
            cutRange={cutRange}
            onSeek={seek}
            onTrimClip={trimVideoClip}
            onReorderClip={reorderVideoClip}
            onSelectSourceAudio={(clipId) => {
              setSelection({ kind: 'sourceAudio', id: clipId });
              setPanelMode('audio');
            }}
            onMoveAudioClip={moveAudioClip}
            onMoveCue={(id, start, end, groupKey) =>
              updateCue(id, { start, end }, groupKey)
            }
            onMoveOverlay={(id, start, end, groupKey) =>
              updateOverlay(id, { start, end }, groupKey)
            }
            onMoveEffect={(id, start, end, groupKey) =>
              updateEffect(id, { start, end }, groupKey)
            }
            onThumbnailRequest={setThumbnailRequest}
            onSelect={selectTimelineItem}
          />

          <div className="status-row">
            <span>{status}</span>
            <span>
              출력 {outputDimensions.width}x{outputDimensions.height}
            </span>
            {isExporting && (
              <span className="export-stage-pill">{exportPhaseLabels[exportPhase]}</span>
            )}
            {isExporting && (
              <span className="progress-pill">{Math.round(exportProgress * 100)}%</span>
            )}
            {(isExporting || exportPhase === 'error') && exportPreflightNote && (
              <span className="export-note-pill">{exportPreflightNote}</span>
            )}
            {(isExporting || exportPhase === 'error') && exportLastLog && (
              <span className="export-log-pill" title={exportLastLog}>
                로그: {exportLastLog}
              </span>
            )}
            {exportUrl && (
              <a href={exportUrl} download={exportDownloadName}>
                {exportDownloadName} 받기
              </a>
            )}
            {needsVideoRelink && <span className="video-link-pill">영상 연결 필요</span>}
            {needsAudioRelink && <span className="video-link-pill">오디오 연결 필요</span>}
            {lastAutosavedAt && (
              <span className="autosave-pill">
                자동 저장 {new Date(lastAutosavedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </section>

        <aside className="editor-panel" data-guide-target="editor-panel">
          <FontManager
            fonts={fontAssets}
            onImport={() => fontInputRef.current?.click()}
          />

          <div className="panel-tabs">
            <button
              type="button"
              className={panelMode === 'video' ? 'active' : ''}
              onClick={() => setPanelMode('video')}
            >
              <Film size={17} />
              영상
            </button>
            <button
              type="button"
              className={panelMode === 'audio' ? 'active' : ''}
              onClick={() => setPanelMode('audio')}
            >
              <Music size={17} />
              오디오
            </button>
            <button
              type="button"
              className={panelMode === 'captions' ? 'active' : ''}
              onClick={() => setPanelMode('captions')}
            >
              <Captions size={17} />
              자막
            </button>
            <button
              type="button"
              className={panelMode === 'texts' ? 'active' : ''}
              onClick={() => setPanelMode('texts')}
            >
              <Type size={17} />
              텍스트
            </button>
            <button
              type="button"
              className={panelMode === 'effects' ? 'active' : ''}
              onClick={() => setPanelMode('effects')}
            >
              <MousePointerClick size={17} />
              효과
            </button>
          </div>

          <div className="panel-actions">
            <button
              type="button"
              onClick={
                panelMode === 'video'
                  ? splitClipAtPlayhead
                  : panelMode === 'audio'
                    ? () => openAudioPicker('music')
                  : panelMode === 'captions'
                  ? addCaption
                  : panelMode === 'texts'
                    ? addTextOverlay
                    : () => addInteractionEffect('tap')
              }
            >
              {panelMode === 'video' ? <Scissors size={17} /> : <Plus size={17} />}
              {panelMode === 'video'
                ? '조각 분할'
                : panelMode === 'audio'
                  ? '음악 추가'
                  : '추가'}
            </button>
            <button type="button" onClick={duplicateSelection} disabled={!selection}>
              <Copy size={17} />
              {panelMode === 'video'
                ? '조각 복제'
                : panelMode === 'audio'
                  ? '오디오 복제'
                  : '복제'}
            </button>
            <button type="button" onClick={moveSelectionToPlayhead} disabled={!selection}>
              <Play size={17} />
              {panelMode === 'video'
                ? '조각 시작'
                : panelMode === 'audio'
                  ? '현재 위치'
                  : '현재'}
            </button>
            <button type="button" onClick={deleteSelection} disabled={!selection}>
              <Trash2 size={17} />
              {panelMode === 'video'
                ? '조각 삭제'
                : panelMode === 'audio'
                  ? selectedSourceAudioClip
                    ? '음소거'
                    : '삭제'
                  : '삭제'}
            </button>
          </div>

          {panelMode === 'video' ? (
            <VideoPanel
              clips={videoClips}
              ranges={clipRanges}
              transitions={transitions}
              selectedClip={selectedClip}
              selectedTransition={selectedClipTransition}
              sourceDuration={duration}
              isExporting={isExporting}
              onSelect={(id) => setSelection({ kind: 'clip', id })}
              onSeek={seek}
              onMoveClip={moveSelectedClip}
              onUpdateClip={updateVideoClip}
              onUpdateTransition={updateTransitionAfterSelected}
              onExportSelectedClip={() => void exportSelectedClipMp4()}
            />
          ) : panelMode === 'audio' ? (
            <AudioPanel
              sources={audioSources}
              clips={audioClips}
              sourceFiles={audioFiles}
              videoRanges={clipRanges}
              selectedAudioClip={selectedAudioClip}
              selectedVideoClip={selectedSourceAudioClip}
              onImportMusic={() => openAudioPicker('music')}
              onImportEffect={() => openAudioPicker('effect')}
              onSelectAudio={(id) => setSelection({ kind: 'audio', id })}
              onSelectVideoAudio={(id) => setSelection({ kind: 'sourceAudio', id })}
              onSeek={seek}
              onUpdateAudioClip={updateAudioClip}
              onUpdateVideoClip={updateVideoClip}
            />
          ) : panelMode === 'captions' ? (
            <CaptionPanel
              cues={cues}
              selectedCue={selectedCue}
              fonts={fontAssets}
              onSelect={(id) => setSelection({ kind: 'cue', id })}
              onSeek={seek}
              onUpdate={updateCue}
              onUpdateStyle={updateCueStyle}
              onUpdateTime={updateCueTime}
            />
          ) : panelMode === 'texts' ? (
            <OverlayPanel
              overlays={overlays}
              selectedOverlay={selectedOverlay}
              fonts={fontAssets}
              onSelect={(id) => setSelection({ kind: 'overlay', id })}
              onSeek={seek}
              onUpdate={updateOverlay}
              onUpdateTime={updateOverlayTime}
            />
          ) : (
            <EffectPanel
              effects={effects}
              selectedEffect={selectedEffect}
              onSelect={selectEffect}
              onSeek={seek}
              onUpdate={updateEffect}
              onUpdateTime={updateEffectTime}
            />
          )}
        </aside>
      </main>
    </div>
  );
}

function HelpPanel({
  onClose,
  onStartGuide
}: {
  onClose: () => void;
  onStartGuide: () => void;
}) {
  return (
    <div
      className="help-panel-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-panel-title">
        <div className="help-panel-head">
          <span>HELP</span>
          <button type="button" onClick={onClose} aria-label="도움말 닫기">
            <X size={17} />
          </button>
        </div>
        <h2 id="help-panel-title">Edit Studio 사용법</h2>
        <p>
          영상 파일을 브라우저에서만 처리하면서 컷 편집, 자막, 텍스트, 클릭/터치 효과를
          만들고 MP4로 저장하는 기본 흐름입니다. GitHub Pages에서 열어도 영상은 각 사용자
          컴퓨터의 브라우저 안에서만 처리됩니다.
        </p>
        <button type="button" className="help-tour-button" onClick={onStartGuide}>
          <CircleHelp size={16} />
          튜토리얼 다시보기
        </button>
        <div className="help-section-list">
          {helpSections.map((section) => (
            <section key={section.title} className="help-section">
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

function GuideOverlay({
  step,
  stepIndex,
  stepCount,
  targetRect,
  onPrevious,
  onNext,
  onSkip
}: {
  step: GuideStep;
  stepIndex: number;
  stepCount: number;
  targetRect: GuideRect | null;
  onPrevious: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const isLast = stepIndex >= stepCount - 1;

  return (
    <div className="guide-overlay" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      {targetRect ? (
        <span className="guide-highlight" style={getGuideHighlightStyle(targetRect)} />
      ) : (
        <span className="guide-dim" />
      )}
      <section className="guide-card" style={getGuideCardStyle(targetRect)}>
        <div className="guide-progress">
          <span>튜토리얼</span>
          <strong>
            {stepIndex + 1}/{stepCount}
          </strong>
        </div>
        <h2 id="guide-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="guide-actions">
          <button type="button" onClick={onSkip}>
            건너뛰기
          </button>
          <span>
            <button type="button" onClick={onPrevious} disabled={stepIndex === 0}>
              이전
            </button>
            <button type="button" className="primary" onClick={onNext}>
              {isLast ? '완료' : '다음'}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}

function getGuideHighlightStyle(rect: GuideRect): CSSProperties {
  const padding = 8;

  return {
    top: `${Math.max(8, rect.top - padding)}px`,
    left: `${Math.max(8, rect.left - padding)}px`,
    width: `${rect.width + padding * 2}px`,
    height: `${rect.height + padding * 2}px`
  };
}

function getGuideCardStyle(rect: GuideRect | null): CSSProperties {
  if (!rect || typeof window === 'undefined') {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)'
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardWidth = Math.min(360, viewportWidth - 32);
  const cardHeight = 230;
  const gap = 14;
  const belowTop = rect.top + rect.height + gap;
  const aboveTop = rect.top - cardHeight - gap;
  const top =
    belowTop + cardHeight <= viewportHeight - 16
      ? belowTop
      : Math.max(16, aboveTop);
  const left = clamp(
    rect.left + rect.width / 2 - cardWidth / 2,
    16,
    Math.max(16, viewportWidth - cardWidth - 16)
  );

  return {
    top: `${top}px`,
    left: `${left}px`,
    width: `${cardWidth}px`
  };
}

function FontManager({
  fonts,
  onImport
}: {
  fonts: AppFontAsset[];
  onImport: () => void;
}) {
  const fontGroups = getFontFamilyGroups(fonts);

  return (
    <div className="font-manager">
      <div className="font-manager-head">
        <div>
          <strong>폰트</strong>
          <small>
            {fontGroups.length} 패밀리 · {fonts.length} variants
          </small>
        </div>
        <button type="button" onClick={onImport}>
          <Upload size={15} />
          가져오기
        </button>
      </div>
      <div className="font-family-list">
        {fontGroups.map((group) => (
          <article key={group.family} className="font-family-card">
            <div className="font-family-title">
              <strong style={{ fontFamily: group.family }}>{group.displayName}</strong>
              <small>
                {group.variants.length} variant{group.variants.length > 1 ? 's' : ''}
              </small>
            </div>
            <div className="font-variant-row">
              {group.variants.map((font) => (
                <span
                  key={font.id}
                  style={{
                    fontFamily: font.family,
                    fontWeight: font.weight,
                    fontStyle: font.style
                  }}
                  title={font.displayName}
                >
                  {font.weight}
                  <small>
                    {getFontWeightLabel(font.weight)}
                    {font.style === 'italic' ? ' Italic' : ''}
                  </small>
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <div className="font-downloads">
        {fontDownloadLinks.map((font) => (
          <a key={font.name} href={font.href} target="_blank" rel="noreferrer">
            <Download size={14} />
            {font.name}
          </a>
        ))}
      </div>
    </div>
  );
}

function PreviewInlineTextEditor({
  value,
  ariaLabel,
  onChange,
  onCommit,
  onCancel
}: {
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    resizePreviewTextarea(input);
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    resizePreviewTextarea(input);
  }, [value]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  return (
    <textarea
      ref={inputRef}
      className="preview-inline-input"
      aria-label={ariaLabel}
      value={value}
      rows={1}
      spellCheck={false}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onChange={(event) => {
        resizePreviewTextarea(event.currentTarget);
        onChange(event.currentTarget.value);
      }}
      onBlur={onCommit}
    />
  );
}

function resizePreviewTextarea(input: HTMLTextAreaElement) {
  input.style.height = 'auto';
  input.style.height = `${clamp(input.scrollHeight, 34, 180)}px`;
}

function CaptionPreview({
  cue,
  selected,
  onSelect,
  onTextChange
}: {
  cue: CaptionCue;
  selected: boolean;
  onSelect: () => void;
  onTextChange: (text: string, groupKey?: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const initialTextRef = useRef(cue.text);

  function startEditing() {
    onSelect();
    initialTextRef.current = cue.text;
    setIsEditing(true);
  }

  return (
    <div
      className={`caption-preview caption-${cue.position} ${selected ? 'selected' : ''} ${
        isEditing ? 'editing' : ''
      } ${cue.text.trim() ? '' : 'is-empty'}`}
      role="button"
      tabIndex={0}
      aria-label="미리보기 자막"
      style={{
        fontFamily: cue.style.fontFamily,
        fontWeight: cue.style.fontWeight ?? defaultCaptionStyle.fontWeight,
        color: cue.style.color,
        background: cue.style.background,
        fontSize: cue.style.fontSize,
        textAlign: cue.style.align,
        textShadow: cue.style.shadow
          ? `0 2px 8px ${cue.style.outlineColor}, 0 0 ${cue.style.outlineWidth}px ${cue.style.outlineColor}`
          : `0 0 ${cue.style.outlineWidth}px ${cue.style.outlineColor}`
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
      onKeyDown={(event) => {
        if (isEditing) return;
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          startEditing();
        }
      }}
    >
      {isEditing ? (
        <PreviewInlineTextEditor
          value={cue.text}
          ariaLabel="자막 내용 직접 편집"
          onChange={(text) => onTextChange(text, `preview-cue-text:${cue.id}`)}
          onCommit={() => setIsEditing(false)}
          onCancel={() => {
            onTextChange(initialTextRef.current, `preview-cue-text:${cue.id}`);
            setIsEditing(false);
          }}
        />
      ) : (
        <>
          {cue.text || '자막 입력'}
          {selected && <span className="preview-edit-hint">더블클릭 편집</span>}
        </>
      )}
    </div>
  );
}

type TextResizeHandle =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

const textResizeHandles: TextResizeHandle[] = [
  'left',
  'right',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
];

function TextPreview({
  overlay,
  selected,
  onSelect,
  onMove,
  onMoveEnd,
  onResize,
  onTextChange
}: {
  overlay: TextOverlay;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onMoveEnd: () => void;
  onResize: (scaleX: number, scaleY: number) => void;
  onTextChange: (text: string, groupKey?: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const initialTextRef = useRef(overlay.text);
  const dragStartRef = useRef<{
    bounds: { left: number; top: number; width: number; height: number };
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const resizeStartRef = useRef<{
    handle: TextResizeHandle;
    scaleX: number;
    scaleY: number;
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);

  const scaleX = clamp(overlay.scaleX ?? 1, 0.25, 4);
  const scaleY = clamp(overlay.scaleY ?? 1, 0.25, 4);
  const align = overlay.align ?? defaultTextOverlay.align;
  const anchorTranslateX = align === 'left' ? '0%' : align === 'right' ? '-100%' : '-50%';
  const transformOriginX = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';

  function startEditing() {
    onSelect();
    initialTextRef.current = overlay.text;
    setIsEditing(true);
  }

  function startMove(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;

    const centerX = bounds.left + (overlay.x / 100) * bounds.width;
    const centerY = bounds.top + (overlay.y / 100) * bounds.height;
    dragStartRef.current = {
      bounds: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      },
      offsetX: event.clientX - centerX,
      offsetY: event.clientY - centerY
    };
  }

  function moveToPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start) return;

    onMove(
      clamp(
        ((event.clientX - start.offsetX - start.bounds.left) / start.bounds.width) * 100,
        0,
        100
      ),
      clamp(
        ((event.clientY - start.offsetY - start.bounds.top) / start.bounds.height) * 100,
        0,
        100
      )
    );
  }

  function resizeToPointer(event: ReactPointerEvent<HTMLSpanElement>) {
    const start = resizeStartRef.current;
    if (!start) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    let nextScaleX = start.scaleX;
    let nextScaleY = start.scaleY;

    if (start.handle.includes('left') || start.handle.includes('right')) {
      const outwardDelta = start.handle.includes('left') ? -deltaX : deltaX;
      nextScaleX = clamp(
        start.scaleX * ((Math.max(1, start.width) + outwardDelta * 2) / Math.max(1, start.width)),
        0.25,
        4
      );
    }

    if (start.handle.includes('top') || start.handle.includes('bottom')) {
      const outwardDelta = start.handle.includes('top') ? -deltaY : deltaY;
      nextScaleY = clamp(
        start.scaleY * ((Math.max(1, start.height) + outwardDelta * 2) / Math.max(1, start.height)),
        0.25,
        4
      );
    }

    onResize(nextScaleX, nextScaleY);
  }

  return (
    <div
      className={`text-preview ${selected ? 'selected' : ''} ${isEditing ? 'editing' : ''} ${
        overlay.text.trim() ? '' : 'is-empty'
      }`}
      role="button"
      tabIndex={0}
      aria-label="미리보기 텍스트"
      style={{
        left: `${overlay.x}%`,
        top: `${overlay.y}%`,
        fontFamily: overlay.fontFamily,
        fontWeight: overlay.fontWeight ?? defaultTextOverlay.fontWeight,
        fontStyle: overlay.italic ? 'italic' : 'normal',
        textDecorationLine: overlay.underline ? 'underline' : 'none',
        textAlign: align,
        color: overlay.color,
        background: overlay.background,
        fontSize: overlay.fontSize,
        transformOrigin: `${transformOriginX} center`,
        '--text-anchor-x': anchorTranslateX,
        '--text-scale-x': scaleX,
        '--text-scale-y': scaleY,
        '--text-handle-scale-x': 1 / scaleX,
        '--text-handle-scale-y': 1 / scaleY,
        textShadow: overlay.shadow
          ? `0 2px 8px ${overlay.outlineColor}, 0 0 ${overlay.outlineWidth}px ${overlay.outlineColor}`
          : `0 0 ${overlay.outlineWidth}px ${overlay.outlineColor}`
      } as CSSProperties}
      onClick={(event) => {
        if (isTextEditingElement(event.target)) return;
        event.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
      onKeyDown={(event) => {
        if (isEditing) return;
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          startEditing();
        }
      }}
      onPointerDown={(event) => {
        if (isEditing || isTextEditingElement(event.target)) return;
        event.stopPropagation();
        onSelect();
        event.currentTarget.setPointerCapture(event.pointerId);
        startMove(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation();
          moveToPointer(event);
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        dragStartRef.current = null;
        onMoveEnd();
      }}
      onPointerCancel={() => {
        dragStartRef.current = null;
        onMoveEnd();
      }}
    >
      {isEditing ? (
        <PreviewInlineTextEditor
          value={overlay.text}
          ariaLabel="텍스트 내용 직접 편집"
          onChange={(text) => onTextChange(text, `preview-overlay-text:${overlay.id}`)}
          onCommit={() => setIsEditing(false)}
          onCancel={() => {
            onTextChange(initialTextRef.current, `preview-overlay-text:${overlay.id}`);
            setIsEditing(false);
          }}
        />
      ) : (
        <>
          {overlay.text || '텍스트 입력'}
          {selected && <span className="preview-edit-hint">더블클릭 편집</span>}
        </>
      )}
      {selected && !isEditing && (
        <>
          {textResizeHandles.map((handle) => (
            <span
              key={handle}
              className={`text-resize-handle text-resize-${handle}`}
              aria-hidden="true"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect();
                const box = event.currentTarget
                  .closest<HTMLElement>('.text-preview')
                  ?.getBoundingClientRect();
                resizeStartRef.current = {
                  handle,
                  scaleX,
                  scaleY,
                  width: box?.width ?? 1,
                  height: box?.height ?? 1,
                  x: event.clientX,
                  y: event.clientY
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.stopPropagation();
                  resizeToPointer(event);
                }
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.stopPropagation();
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                resizeStartRef.current = null;
              }}
              onPointerCancel={() => {
                resizeStartRef.current = null;
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function InteractionEffectPreview({
  effect,
  selected,
  replayToken,
  onSelect,
  onMove,
  onMoveEnd,
  onResize
}: {
  effect: InteractionEffect;
  selected: boolean;
  replayToken: number;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onMoveEnd: () => void;
  onResize: (size: number) => void;
}) {
  const resizeStartRef = useRef<{
    centerX: number;
    centerY: number;
    distance: number;
    size: number;
  } | null>(null);

  function moveToPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;

    onMove(
      clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100),
      clamp(((event.clientY - bounds.top) / bounds.height) * 100, 0, 100)
    );
  }

  function startResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const bounds = event.currentTarget
      .closest<HTMLElement>('.overlay-layer')
      ?.getBoundingClientRect();
    if (!bounds) return;

    const centerX = bounds.left + (effect.x / 100) * bounds.width;
    const centerY = bounds.top + (effect.y / 100) * bounds.height;
    const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);

    resizeStartRef.current = {
      centerX,
      centerY,
      distance: Math.max(1, distance),
      size: effect.size
    };
  }

  function resizeToPointer(event: ReactPointerEvent<HTMLSpanElement>) {
    const start = resizeStartRef.current;
    if (!start) return;

    const distance = Math.hypot(event.clientX - start.centerX, event.clientY - start.centerY);
    const delta = distance - start.distance;
    onResize(clamp(start.size + delta * 2, 24, 260));
  }

  return (
    <button
      type="button"
      className={`effect-preview effect-${effect.kind} ${selected ? 'selected' : ''}`}
      style={{
        left: `${effect.x}%`,
        top: `${effect.y}%`,
        '--effect-color': effect.color,
        '--effect-size': `${effect.size}px`
      } as CSSProperties}
      title={effect.label || effectName(effect.kind)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
        event.currentTarget.setPointerCapture(event.pointerId);
        moveToPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation();
          moveToPointer(event);
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onMoveEnd();
      }}
      onPointerCancel={() => {
        onMoveEnd();
      }}
    >
      {isArtworkEffect(effect.kind) && (
        <EffectArtwork
          key={`${effect.kind}-${replayToken}`}
          kind={effect.kind}
          color={effect.color}
        />
      )}
      {effect.label && <span className="effect-label">{effect.label}</span>}
      {selected && (
        <span
          className="effect-resize-handle"
          aria-hidden="true"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelect();
            event.currentTarget.setPointerCapture(event.pointerId);
            startResize(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.stopPropagation();
              resizeToPointer(event);
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.stopPropagation();
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            resizeStartRef.current = null;
          }}
          onPointerCancel={() => {
            resizeStartRef.current = null;
          }}
        />
      )}
    </button>
  );
}

function EffectArtwork({
  kind,
  color
}: {
  kind: Extract<InteractionEffectKind, 'cursor' | 'finger'>;
  color: string;
}) {
  const artId = useId().replace(/:/g, '');
  const fingerColor = '#0f0f0f';

  if (kind === 'cursor') {
    return (
      <svg
        className="effect-art cursor-art"
        viewBox="0 0 180 180"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${artId}-cursor-fill`} x1="30" y1="18" x2="122" y2="158">
            <stop stopColor="#ffffff" />
            <stop offset="0.52" stopColor={color} />
            <stop offset="1" stopColor="#d5dfe9" />
          </linearGradient>
          <linearGradient id={`${artId}-cursor-bevel`} x1="43" y1="31" x2="112" y2="139">
            <stop stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.16" />
          </linearGradient>
          <radialGradient id={`${artId}-cursor-aura`} cx="50%" cy="50%" r="50%">
            <stop stopColor={color} stopOpacity="0.35" />
            <stop offset="0.58" stopColor={color} stopOpacity="0.14" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${artId}-cursor-tip`} cx="50%" cy="50%" r="50%">
            <stop stopColor="#ffffff" stopOpacity="0.98" />
            <stop offset="0.34" stopColor={color} stopOpacity="0.74" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <filter id={`${artId}-cursor-shadow`} x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="9" stdDeviation="7" floodColor="#000000" floodOpacity="0.36" />
            <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000000" floodOpacity="0.28" />
          </filter>
        </defs>
        <g className="cursor-click-aura">
          <circle cx="132" cy="102" r="45" fill={`url(#${artId}-cursor-aura)`} />
          <circle cx="132" cy="102" r="18" fill={`url(#${artId}-cursor-tip)`} />
          <circle className="cursor-ring cursor-ring-a" cx="132" cy="102" r="22" />
          <circle className="cursor-ring cursor-ring-b" cx="132" cy="102" r="34" />
          <circle className="cursor-click-dot" cx="132" cy="102" r="5.8" />
        </g>
        <g className="cursor-vector" filter={`url(#${artId}-cursor-shadow)`}>
          <path
            className="cursor-body"
            d="M35 20 C33 18 30 20 30 24 L33 143 C33 149 40 151 44 146 L72 116 L90 157 C92 163 99 165 104 162 L119 155 C124 153 126 147 123 142 L106 105 L147 103 C153 103 156 96 151 92 Z"
            fill={`url(#${artId}-cursor-fill)`}
          />
          <path
            className="cursor-edge"
            d="M35 20 C33 18 30 20 30 24 L33 143 C33 149 40 151 44 146 L72 116 L90 157 C92 163 99 165 104 162 L119 155 C124 153 126 147 123 142 L106 105 L147 103 C153 103 156 96 151 92 Z"
          />
          <path className="cursor-bevel" d="M43 40 L45 119 L69 94 L92 146" stroke={`url(#${artId}-cursor-bevel)`} />
          <path className="cursor-inner" d="M48 48 L50 104 L69 84 L84 119" />
          <path className="cursor-shine" d="M47 35 L101 79" />
          <path className="cursor-tail-shadow" d="M72 116 L88 104 L105 145" />
        </g>
        <g className="cursor-sparks" stroke={color}>
          <path d="M141 58 L154 42" />
          <path d="M154 93 L171 90" />
          <path d="M139 128 L153 145" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      className="effect-art finger-art"
      viewBox="0 0 265 250"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={`${artId}-finger-shadow`} x="-35%" y="-30%" width="170%" height="170%">
          <feDropShadow dx="0" dy="10" stdDeviation="8" floodColor="#000000" floodOpacity="0.3" />
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000000" floodOpacity="0.22" />
        </filter>
      </defs>
      <g className="finger-vector" filter={`url(#${artId}-finger-shadow)`}>
        <path
          className="finger-hand-fill"
          d="M84 213 C61 195 42 174 41 153 C40 137 51 125 66 124 C73 124 80 128 86 135 L64 62 C60 47 68 34 82 31 C96 28 108 36 112 51 L131 119 C137 110 146 106 157 108 C167 110 174 117 177 128 C183 121 193 118 204 122 C216 126 223 136 224 150 C230 145 238 145 245 149 C253 154 257 164 255 176 L253 187 C250 204 239 217 222 223 L149 238 C126 243 105 232 84 213 Z"
          fill="#ffffff"
        />
        <path
          className="finger-hand-outline"
          d="M84 213 C61 195 42 174 41 153 C40 137 51 125 66 124 C73 124 80 128 86 135 L64 62 C60 47 68 34 82 31 C96 28 108 36 112 51 L131 119 C137 110 146 106 157 108 C167 110 174 117 177 128 C183 121 193 118 204 122 C216 126 223 136 224 150 C230 145 238 145 245 149 C253 154 257 164 255 176 L253 187 C250 204 239 217 222 223 L149 238 C126 243 105 232 84 213 Z"
          fill="none"
          stroke={fingerColor}
        />
        <path
          className="finger-hand-seams"
          d="M132 120 C137 134 141 147 144 159 M177 129 C181 140 184 152 185 163 M224 151 C229 162 231 174 229 185 M86 135 C92 149 99 162 111 172"
          stroke={fingerColor}
        />
      </g>
      <g className="finger-click-flash">
        <circle className="finger-flash-ring" cx="81" cy="42" r="18" />
        <path
          className="finger-flash-star"
          d="M81 17 L86 35 L104 42 L86 49 L81 67 L76 49 L58 42 L76 35 Z"
        />
        <circle className="finger-flash-dot finger-flash-dot-a" cx="109" cy="28" r="4.2" />
        <circle className="finger-flash-dot finger-flash-dot-b" cx="53" cy="28" r="3.4" />
      </g>
    </svg>
  );
}

function isArtworkEffect(
  kind: InteractionEffectKind
): kind is Extract<InteractionEffectKind, 'cursor' | 'finger'> {
  return kind === 'cursor' || kind === 'finger';
}

type TimelineDragState =
  | {
      kind: 'pan';
      pointerId: number;
      startX: number;
      startScrollLeft: number;
    }
  | {
      kind: 'playhead';
      pointerId: number;
    }
  | {
      kind: 'scrub';
      pointerId: number;
      hasMoved: boolean;
    }
  | {
      kind: 'clip-reorder';
      pointerId: number;
      clipId: string;
      startX: number;
      originalIndex: number;
      targetIndex: number;
      hasMoved: boolean;
    }
  | {
      kind: 'timed-item';
      pointerId: number;
      itemKind: TimelineItemKind;
      id: string;
      startX: number;
      originalStart: number;
      originalEnd: number;
      groupKey: string;
      hasMoved: boolean;
    }
  | {
      kind: 'timed-trim';
      pointerId: number;
      itemKind: TimelineItemKind;
      edge: 'start' | 'end';
      id: string;
      startX: number;
      originalStart: number;
      originalEnd: number;
      groupKey: string;
    }
  | null;
type ClipTrimPreviewState = {
  id: string;
  edge: 'start' | 'end';
  sourceStart: number;
  sourceEnd: number;
  currentSourceTime: number;
  stripCount: number;
};

const TIMELINE_RULER_HEIGHT = 34;
const TIMELINE_VIDEO_TRACK_HEIGHT = 72;
const TIMELINE_VIDEO_TRACK_MIN_HEIGHT = 56;
const TIMELINE_VIDEO_TRACK_MAX_HEIGHT = 180;
const TIMELINE_TIMED_TRACK_MAX_HEIGHT = 220;
const TIMELINE_ITEM_LANE_HEIGHT = 30;
const TIMELINE_ITEM_TOP_PADDING = 8;
const TIMELINE_VISIBLE_BUFFER_PX = 360;
const TIMELINE_EDGE_PADDING = 18;

function Timeline({
  videoClips,
  transitions,
  audioSources,
  audioClips,
  audioWaveforms,
  cues,
  overlays,
  effects,
  thumbnails,
  duration,
  sourceDuration,
  currentTime,
  selection,
  cutRange,
  onSeek,
  onTrimClip,
  onReorderClip,
  onSelectSourceAudio,
  onMoveAudioClip,
  onMoveCue,
  onMoveOverlay,
  onMoveEffect,
  onThumbnailRequest,
  onSelect
}: {
  videoClips: VideoClip[];
  transitions: ClipTransition[];
  audioSources: AudioSourceMeta[];
  audioClips: AudioClip[];
  audioWaveforms: Record<string, AudioWaveform>;
  cues: CaptionCue[];
  overlays: TextOverlay[];
  effects: InteractionEffect[];
  thumbnails: TimelineThumbnail[];
  duration: number;
  sourceDuration: number;
  currentTime: number;
  selection: Selection;
  cutRange: CutRange;
  onSeek: (time: number) => void;
  onTrimClip: (
    id: string,
    edge: 'start' | 'end',
    sourceTime: number,
    groupKey?: string
  ) => void;
  onReorderClip: (clipId: string, targetIndex: number) => void;
  onSelectSourceAudio: (clipId: string) => void;
  onMoveAudioClip: (id: string, start: number, end: number, groupKey?: string) => void;
  onMoveCue: (id: string, start: number, end: number, groupKey?: string) => void;
  onMoveOverlay: (id: string, start: number, end: number, groupKey?: string) => void;
  onMoveEffect: (id: string, start: number, end: number, groupKey?: string) => void;
  onThumbnailRequest: (request: TimelineThumbnailRequest) => void;
  onSelect: (selection: Exclude<Selection, null>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timefieldRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<TimelineDragState>(null);
  const trackResizeRef = useRef<{
    track: TimelineTrackKind;
    pointerId: number;
    startY: number;
    startHeight: number;
    minHeight: number;
    maxHeight: number;
  } | null>(null);
  const itemClickSuppressRef = useRef(false);
  const initializedDurationRef = useRef(0);

  const [pxPerSecond, setPxPerSecond] = useState(TIMELINE_DEFAULT_PX_PER_SECOND);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [tool, setTool] = useState<TimelineTool>('select');
  const [followPlayhead, setFollowPlayhead] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [resizingTrack, setResizingTrack] = useState<TimelineTrackKind | null>(null);
  const [clipTrimPreview, setClipTrimPreview] = useState<ClipTrimPreviewState | null>(null);
  const [trackHeights, setTrackHeights] = useState<TimelineTrackHeights>({
    video: TIMELINE_VIDEO_TRACK_HEIGHT,
    audio: getTimelineTrackHeight(2),
    cue: getTimelineTrackHeight(1),
    overlay: getTimelineTrackHeight(1),
    effect: getTimelineTrackHeight(1)
  });
  const [dragGuide, setDragGuide] = useState<{ time: number; label: string } | null>(null);
  const [clipReorderGuide, setClipReorderGuide] = useState<{
    x: number;
    label: string;
  } | null>(null);
  const [reorderingClipId, setReorderingClipId] = useState<string | null>(null);

  const safeDuration = Math.max(duration, MIN_CUE_DURATION);
  const timelineWidth = getTimelineContentWidth(
    safeDuration,
    pxPerSecond,
    viewportWidth,
    TIMELINE_EDGE_PADDING
  );
  const visibleRange = getVisibleTimelineRange(
    { pxPerSecond, scrollLeft, viewportWidth },
    safeDuration,
    TIMELINE_EDGE_PADDING
  );
  const renderBufferSeconds = Math.max(2, TIMELINE_VISIBLE_BUFFER_PX / Math.max(pxPerSecond, 0.1));
  const visibleStart = Math.max(0, visibleRange.start - renderBufferSeconds);
  const visibleEnd = Math.min(safeDuration, visibleRange.end + renderBufferSeconds);
  const ticks = createTimelineTicks(safeDuration, pxPerSecond, visibleStart, visibleEnd);
  const timelineX = (time: number) => TIMELINE_EDGE_PADDING + timeToTimelineX(time, pxPerSecond);
  const playheadLeft = `${timelineX(currentTime)}px`;
  const clipRanges = getClipTimelineRanges(videoClips, transitions);
  const timelineAudioSourceMap = useMemo(
    () => new Map(audioSources.map((source) => [source.id, source])),
    [audioSources]
  );
  const normalizedTransitions = normalizeTransitionsForClips(videoClips, transitions);
  const hasCutSelection = cutRange.start !== null && cutRange.end !== null;
  const cutStart = hasCutSelection ? Math.min(cutRange.start ?? 0, cutRange.end ?? 0) : null;
  const cutEnd = hasCutSelection ? Math.max(cutRange.start ?? 0, cutRange.end ?? 0) : null;
  const cueLayout = useMemo(
    () => layoutTimelineItems(cues, (cue) => ({ start: cue.start, end: cue.end })),
    [cues]
  );
  const audioLayout = useMemo(
    () => layoutTimelineItems(audioClips, (clip) => ({ start: clip.start, end: clip.end })),
    [audioClips]
  );
  const overlayLayout = useMemo(
    () => layoutTimelineItems(overlays, (overlay) => ({ start: overlay.start, end: overlay.end })),
    [overlays]
  );
  const effectLayout = useMemo(
    () => layoutTimelineItems(effects, (effect) => ({ start: effect.start, end: effect.end })),
    [effects]
  );
  const cueTrackBaseHeight = getTimelineTrackHeight(cueLayout.laneCount);
  const audioTrackBaseHeight = getTimelineTrackHeight(Math.max(2, audioLayout.laneCount + 1));
  const overlayTrackBaseHeight = getTimelineTrackHeight(overlayLayout.laneCount);
  const effectTrackBaseHeight = getTimelineTrackHeight(effectLayout.laneCount);
  const trackDefaultHeights: TimelineTrackHeights = {
    video: TIMELINE_VIDEO_TRACK_HEIGHT,
    audio: audioTrackBaseHeight,
    cue: cueTrackBaseHeight,
    overlay: overlayTrackBaseHeight,
    effect: effectTrackBaseHeight
  };
  const trackMinimumHeights: TimelineTrackHeights = {
    video: TIMELINE_VIDEO_TRACK_MIN_HEIGHT,
    audio: audioTrackBaseHeight,
    cue: cueTrackBaseHeight,
    overlay: overlayTrackBaseHeight,
    effect: effectTrackBaseHeight
  };
  const trackMaximumHeights: TimelineTrackHeights = {
    video: TIMELINE_VIDEO_TRACK_MAX_HEIGHT,
    audio: Math.max(audioTrackBaseHeight, TIMELINE_TIMED_TRACK_MAX_HEIGHT),
    cue: Math.max(cueTrackBaseHeight, TIMELINE_TIMED_TRACK_MAX_HEIGHT),
    overlay: Math.max(overlayTrackBaseHeight, TIMELINE_TIMED_TRACK_MAX_HEIGHT),
    effect: Math.max(effectTrackBaseHeight, TIMELINE_TIMED_TRACK_MAX_HEIGHT)
  };
  const videoTrackHeight = clamp(
    trackHeights.video,
    trackMinimumHeights.video,
    trackMaximumHeights.video
  );
  const cueTrackHeight = clamp(
    Math.max(trackHeights.cue, cueTrackBaseHeight),
    trackMinimumHeights.cue,
    trackMaximumHeights.cue
  );
  const audioTrackHeight = clamp(
    Math.max(trackHeights.audio, audioTrackBaseHeight),
    trackMinimumHeights.audio,
    trackMaximumHeights.audio
  );
  const overlayTrackHeight = clamp(
    Math.max(trackHeights.overlay, overlayTrackBaseHeight),
    trackMinimumHeights.overlay,
    trackMaximumHeights.overlay
  );
  const effectTrackHeight = clamp(
    Math.max(trackHeights.effect, effectTrackBaseHeight),
    trackMinimumHeights.effect,
    trackMaximumHeights.effect
  );
  const resolvedTrackHeights: TimelineTrackHeights = {
    video: videoTrackHeight,
    audio: audioTrackHeight,
    cue: cueTrackHeight,
    overlay: overlayTrackHeight,
    effect: effectTrackHeight
  };
  const gridTemplateRows = `${TIMELINE_RULER_HEIGHT}px ${videoTrackHeight}px ${audioTrackHeight}px ${cueTrackHeight}px ${overlayTrackHeight}px ${effectTrackHeight}px`;
  const videoItemLaneHeight = Math.max(44, videoTrackHeight - 8);
  const videoClipMetrics = getVideoClipMetrics(videoItemLaneHeight);
  const viewportThumbWidth = timelineWidth > 0 ? clamp((viewportWidth / timelineWidth) * 100, 2, 100) : 100;
  const viewportThumbLeft = timelineWidth > 0 ? clamp((scrollLeft / timelineWidth) * 100, 0, 100) : 0;
  const zoomPercent = Math.round((pxPerSecond / TIMELINE_DEFAULT_PX_PER_SECOND) * 100);
  const selectedSummary = getTimelineSelectionSummary(
    selection,
    clipRanges,
    audioClips,
    timelineAudioSourceMap,
    cues,
    overlays,
    effects
  );
  const selectedTrack: TimelineTrackKind | null = selection
    ? selection.kind === 'clip'
      ? 'video'
      : selection.kind === 'audio' || selection.kind === 'sourceAudio'
        ? 'audio'
      : selection.kind === 'cue'
        ? 'cue'
      : selection.kind === 'overlay'
        ? 'overlay'
        : 'effect'
    : null;
  const timelineCursorClass =
    tool === 'pan' || isSpacePanning ? 'timeline-scroll-pan-mode' : '';

  const snapPoints = useMemo(() => {
    const points = [
      0,
      safeDuration,
      currentTime,
      cutRange.start,
      cutRange.end,
      ...clipRanges.flatMap((range) => [range.start, range.end]),
      ...audioClips.flatMap((clip) => [clip.start, clip.end]),
      ...cues.flatMap((cue) => [cue.start, cue.end]),
      ...overlays.flatMap((overlay) => [overlay.start, overlay.end]),
      ...effects.flatMap((effect) => [effect.start, effect.end])
    ];

    return Array.from(
      new Set(
        points
          .filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
          .map((point) => Number(clamp(point, 0, safeDuration).toFixed(3)))
      )
    ).sort((a, b) => a - b);
  }, [audioClips, clipRanges, cues, currentTime, cutRange.end, cutRange.start, effects, overlays, safeDuration]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateWidth = () => setViewportWidth(element.clientWidth);
    updateWidth();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setViewportWidth(entry?.contentRect.width ?? element.clientWidth);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pxPerSecond <= TIMELINE_MAX_PX_PER_SECOND) return;

    setPxPerSecond(TIMELINE_MAX_PX_PER_SECOND);
    requestAnimationFrame(() => syncScrollLeft(scrollLeft, TIMELINE_MAX_PX_PER_SECOND));
  }, [pxPerSecond, scrollLeft, viewportWidth]);

  useEffect(() => {
    if (!duration || !viewportWidth) return;
    if (initializedDurationRef.current === duration) return;

    const nextPxPerSecond = fitTimelinePxPerSecond(
      duration,
      viewportWidth,
      TIMELINE_MIN_PX_PER_SECOND,
      TIMELINE_MAX_PX_PER_SECOND,
      TIMELINE_EDGE_PADDING
    );
    initializedDurationRef.current = duration;
    setPxPerSecond(nextPxPerSecond);
    syncScrollLeft(0, nextPxPerSecond);
  }, [duration, viewportWidth]);

  useEffect(() => {
    if (!sourceDuration || !viewportWidth) return;

    onThumbnailRequest({
      start: visibleStart,
      end: visibleEnd,
      step: chooseThumbnailStepForPxPerSecond(pxPerSecond)
    });
  }, [onThumbnailRequest, pxPerSecond, sourceDuration, viewportWidth, visibleEnd, visibleStart]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTextEditingElement(event.target)) return;
      event.preventDefault();
      setIsSpacePanning(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setIsSpacePanning(false);
      setIsPanning(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!followPlayhead || !viewportWidth) return;

    const playheadX = timelineX(currentTime);
    const visibleLeft = scrollLeft;
    const visibleRight = scrollLeft + viewportWidth;
    const guard = Math.min(160, viewportWidth * 0.2);

    if (playheadX < visibleLeft + guard || playheadX > visibleRight - guard) {
      syncScrollLeft(playheadX - viewportWidth / 2);
    }
  }, [currentTime, followPlayhead, pxPerSecond, scrollLeft, viewportWidth]);

  function syncScrollLeft(nextScrollLeft: number, nextPxPerSecond = pxPerSecond) {
    const clamped = clampTimelineScrollLeft(
      nextScrollLeft,
      safeDuration,
      nextPxPerSecond,
      viewportWidth,
      TIMELINE_EDGE_PADDING
    );

    if (scrollRef.current) {
      scrollRef.current.scrollLeft = clamped;
    }
    setScrollLeft(clamped);
  }

  function handleFitTimeline() {
    const nextPxPerSecond = fitTimelinePxPerSecond(
      safeDuration,
      viewportWidth,
      TIMELINE_MIN_PX_PER_SECOND,
      TIMELINE_MAX_PX_PER_SECOND,
      TIMELINE_EDGE_PADDING
    );
    setPxPerSecond(nextPxPerSecond);
    syncScrollLeft(0, nextPxPerSecond);
  }

  function handleZoom(nextPxPerSecond: number, anchorX = viewportWidth / 2) {
    const next = zoomTimelineAroundAnchor({
      duration: safeDuration,
      currentPxPerSecond: pxPerSecond,
      nextPxPerSecond,
      scrollLeft,
      anchorX,
      viewportWidth,
      edgePadding: TIMELINE_EDGE_PADDING
    });

    setPxPerSecond(next.pxPerSecond);
    requestAnimationFrame(() => syncScrollLeft(next.scrollLeft, next.pxPerSecond));
  }

  function timeFromClientX(clientX: number) {
    const bounds = timefieldRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return timelineXToTime(clientX - bounds.left - TIMELINE_EDGE_PADDING, pxPerSecond, safeDuration);
  }

  function snapTime(time: number) {
    const threshold = Math.min(0.35, Math.max(0.025, 9 / Math.max(pxPerSecond, 0.1)));
    let nearest = time;
    let nearestDistance = Number.POSITIVE_INFINITY;

    snapPoints.forEach((point) => {
      const distance = Math.abs(point - time);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    });

    if (nearestDistance <= threshold) {
      return { time: nearest, snapped: true };
    }

    return { time: clamp(time, 0, safeDuration), snapped: false };
  }

  function snapTimedRange(start: number, end: number) {
    const itemDuration = Math.max(MIN_CUE_DURATION, end - start);
    const safeStart = clamp(start, 0, Math.max(0, safeDuration - itemDuration));
    const safeEnd = safeStart + itemDuration;
    const snappedStart = snapTime(safeStart);
    const snappedEnd = snapTime(safeEnd);
    const startDistance = Math.abs(snappedStart.time - safeStart);
    const endDistance = Math.abs(snappedEnd.time - safeEnd);

    if (snappedEnd.snapped && (!snappedStart.snapped || endDistance < startDistance)) {
      const nextStart = clamp(snappedEnd.time - itemDuration, 0, Math.max(0, safeDuration - itemDuration));
      return {
        start: nextStart,
        end: nextStart + itemDuration,
        snapped: true,
        snapTime: snappedEnd.time
      };
    }

    if (snappedStart.snapped) {
      const nextStart = clamp(snappedStart.time, 0, Math.max(0, safeDuration - itemDuration));
      return {
        start: nextStart,
        end: nextStart + itemDuration,
        snapped: true,
        snapTime: snappedStart.time
      };
    }

    return { start: safeStart, end: safeEnd, snapped: false, snapTime: safeStart };
  }

  function seekFromPointer(event: ReactPointerEvent<HTMLElement>) {
    const next = event.altKey ? { time: timeFromClientX(event.clientX), snapped: false } : snapTime(timeFromClientX(event.clientX));
    onSeek(next.time);
    setDragGuide(next.snapped ? { time: next.time, label: formatClock(next.time) } : null);
  }

  function beginTrackResize(event: ReactPointerEvent<HTMLElement>, track: TimelineTrackKind) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    trackResizeRef.current = {
      track,
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: resolvedTrackHeights[track],
      minHeight: trackMinimumHeights[track],
      maxHeight: trackMaximumHeights[track]
    };
    setResizingTrack(track);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateTrackResize(event: ReactPointerEvent<HTMLElement>) {
    const resize = trackResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const nextHeight = clamp(
      resize.startHeight + event.clientY - resize.startY,
      resize.minHeight,
      resize.maxHeight
    );
    setTrackHeights((current) => ({ ...current, [resize.track]: nextHeight }));
  }

  function endTrackResize(event: ReactPointerEvent<HTMLElement>) {
    const resize = trackResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    trackResizeRef.current = null;
    setResizingTrack(null);
  }

  function resetTrackHeight(track: TimelineTrackKind) {
    setTrackHeights((current) => ({ ...current, [track]: trackDefaultHeights[track] }));
  }

  function handleTimelineClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (itemClickSuppressRef.current || tool === 'pan' || isSpacePanning) return;
    if (isTimelineInteractiveTarget(event.target)) return;
    const next = snapTime(timeFromClientX(event.clientX));
    onSeek(next.time);
  }

  function handleTimelineWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!viewportWidth) return;

    const scrollBounds = scrollRef.current?.getBoundingClientRect();
    const anchorX = scrollBounds
      ? clamp(event.clientX - scrollBounds.left, 0, viewportWidth)
      : viewportWidth / 2;

    if (event.ctrlKey || event.metaKey) {
      const direction = event.deltaY > 0 ? -1 : 1;
      const multiplier = direction > 0 ? 1.16 : 1 / 1.16;
      handleZoom(pxPerSecond * multiplier, anchorX);
      return;
    }

    const rawDelta =
      event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX || event.deltaY
        : event.deltaY;
    const speed = event.shiftKey ? 1.6 : 1;
    syncScrollLeft(scrollLeft + rawDelta * speed);
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    const shouldPan = tool === 'pan' || isSpacePanning || event.button === 1;
    if (!shouldPan) return;

    event.preventDefault();
    dragRef.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scrollLeft
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updatePan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'pan' || drag.pointerId !== event.pointerId) return;

    syncScrollLeft(drag.startScrollLeft - (event.clientX - drag.startX));
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'pan' || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsPanning(false);
  }

  function beginTimelineScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (tool === 'pan' || isSpacePanning || event.button !== 0) return;
    if (isTimelineInteractiveTarget(event.target)) return;

    event.preventDefault();
    dragRef.current = { kind: 'scrub', pointerId: event.pointerId, hasMoved: false };
    seekFromPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateTimelineScrub(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'scrub' || drag.pointerId !== event.pointerId) return;

    drag.hasMoved = true;
    seekFromPointer(event);
  }

  function endTimelineScrub(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'scrub' || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.hasMoved) {
      itemClickSuppressRef.current = true;
      window.setTimeout(() => {
        itemClickSuppressRef.current = false;
      }, 0);
    }

    dragRef.current = null;
    setDragGuide(null);
  }

  function beginOverviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    seekOverview(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function seekOverview(clientX: number) {
    const bounds = overviewRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width) return;

    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1);
    const time = ratio * safeDuration;
    onSeek(time);
    syncScrollLeft(timelineX(time) - viewportWidth / 2);
  }

  function beginPlayheadDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    dragRef.current = { kind: 'playhead', pointerId: event.pointerId };
    seekFromPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updatePlayheadDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'playhead' || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    seekFromPointer(event);
  }

  function endPlayheadDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'playhead' || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragGuide(null);
  }

  function getClipReorderTarget(clientX: number, clipId: string) {
    const time = timeFromClientX(clientX);
    const movingIndex = clipRanges.findIndex((range) => range.clip.id === clipId);
    if (movingIndex < 0) return null;

    const otherRanges = clipRanges.filter((range) => range.clip.id !== clipId);
    const targetIndex = clamp(
      otherRanges.filter((range) => time >= range.start + range.outputDuration / 2).length,
      0,
      videoClips.length - 1
    );
    const guideX =
      targetIndex <= 0
        ? timelineX(0)
        : targetIndex >= otherRanges.length
          ? timelineX(safeDuration)
          : timelineX(otherRanges[targetIndex].start);

    return {
      targetIndex,
      x: guideX,
      label: `${targetIndex + 1}번째 위치`
    };
  }

  function beginClipReorder(
    event: ReactPointerEvent<HTMLButtonElement>,
    range: (typeof clipRanges)[number]
  ) {
    if (event.button !== 0 || tool === 'pan' || isSpacePanning) return;

    event.stopPropagation();
    onSelect({ kind: 'clip', id: range.clip.id });
    dragRef.current = {
      kind: 'clip-reorder',
      pointerId: event.pointerId,
      clipId: range.clip.id,
      startX: event.clientX,
      originalIndex: range.index,
      targetIndex: range.index,
      hasMoved: false
    };
    setReorderingClipId(range.clip.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveClipReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'clip-reorder' || drag.pointerId !== event.pointerId) return;

    const distance = Math.abs(event.clientX - drag.startX);
    if (distance < 6 && !drag.hasMoved) return;

    event.preventDefault();
    event.stopPropagation();
    drag.hasMoved = true;

    const target = getClipReorderTarget(event.clientX, drag.clipId);
    if (!target) return;

    drag.targetIndex = target.targetIndex;
    setClipReorderGuide({
      x: target.x,
      label: target.label
    });
  }

  function endClipReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'clip-reorder' || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.hasMoved) {
      event.preventDefault();
      event.stopPropagation();
      itemClickSuppressRef.current = true;
      window.setTimeout(() => {
        itemClickSuppressRef.current = false;
      }, 0);

      if (drag.targetIndex !== drag.originalIndex) {
        onReorderClip(drag.clipId, drag.targetIndex);
      }
    }

    dragRef.current = null;
    setClipReorderGuide(null);
    setReorderingClipId(null);
  }

  function startTimedItemDrag<T extends { id: string; start: number; end: number }>(
    event: ReactPointerEvent<HTMLButtonElement>,
    itemKind: TimelineItemKind,
    item: T
  ) {
    event.stopPropagation();
    const selectionKind = itemKind === 'cue' ? 'cue' : itemKind;
    onSelect({ kind: selectionKind, id: item.id });
    dragRef.current = {
      kind: 'timed-item',
      pointerId: event.pointerId,
      itemKind,
      id: item.id,
      startX: event.clientX,
      originalStart: item.start,
      originalEnd: item.end,
      groupKey: `timeline-move:${itemKind}:${item.id}`,
      hasMoved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTimedItem(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'timed-item' || drag.pointerId !== event.pointerId) return;

    const delta = (event.clientX - drag.startX) / Math.max(pxPerSecond, 0.1);
    if (Math.abs(event.clientX - drag.startX) > 2) {
      drag.hasMoved = true;
    }

    const next = event.altKey
      ? clampTimedRange(drag.originalStart + delta, drag.originalEnd + delta, safeDuration)
      : snapTimedRange(drag.originalStart + delta, drag.originalEnd + delta);

    setDragGuide(next.snapped ? { time: next.snapTime, label: formatClock(next.snapTime) } : null);

    applyTimedItemRange(drag.itemKind, drag.id, next.start, next.end, drag.groupKey);
  }

  function endTimedItemDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'timed-item' || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.hasMoved) {
      itemClickSuppressRef.current = true;
      window.setTimeout(() => {
        itemClickSuppressRef.current = false;
      }, 0);
    }

    dragRef.current = null;
    setDragGuide(null);
  }

  function applyTimedItemRange(
    itemKind: TimelineItemKind,
    id: string,
    start: number,
    end: number,
    groupKey?: string
  ) {
    if (itemKind === 'audio') {
      onMoveAudioClip(id, start, end, groupKey);
    } else if (itemKind === 'cue') {
      onMoveCue(id, start, end, groupKey);
    } else if (itemKind === 'overlay') {
      onMoveOverlay(id, start, end, groupKey);
    } else {
      onMoveEffect(id, start, end, groupKey);
    }
  }

  function startTimedItemTrim<T extends { id: string; start: number; end: number }>(
    event: ReactPointerEvent<HTMLSpanElement>,
    itemKind: TimelineItemKind,
    edge: 'start' | 'end',
    item: T
  ) {
    event.stopPropagation();
    onSelect({ kind: itemKind, id: item.id });
    dragRef.current = {
      kind: 'timed-trim',
      pointerId: event.pointerId,
      itemKind,
      edge,
      id: item.id,
      startX: event.clientX,
      originalStart: item.start,
      originalEnd: item.end,
      groupKey: `timeline-trim:${itemKind}:${item.id}:${edge}`
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function trimTimedItem(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'timed-trim' || drag.pointerId !== event.pointerId) return;

    const delta = (event.clientX - drag.startX) / Math.max(pxPerSecond, 0.1);
    const rawTime = drag.edge === 'start' ? drag.originalStart + delta : drag.originalEnd + delta;
    const snapped = event.altKey ? { time: rawTime, snapped: false } : snapTime(rawTime);
    const nextStart =
      drag.edge === 'start'
        ? clamp(snapped.time, 0, drag.originalEnd - MIN_CUE_DURATION)
        : drag.originalStart;
    const nextEnd =
      drag.edge === 'end'
        ? clamp(snapped.time, drag.originalStart + MIN_CUE_DURATION, safeDuration)
        : drag.originalEnd;

    setDragGuide(
      snapped.snapped
        ? { time: drag.edge === 'start' ? nextStart : nextEnd, label: formatClock(drag.edge === 'start' ? nextStart : nextEnd) }
        : null
    );
    applyTimedItemRange(drag.itemKind, drag.id, nextStart, nextEnd, drag.groupKey);
  }

  function endTimedItemTrim(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'timed-trim' || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    itemClickSuppressRef.current = true;
    window.setTimeout(() => {
      itemClickSuppressRef.current = false;
    }, 0);

    dragRef.current = null;
    setDragGuide(null);
  }

  function isRangeVisible(start: number, end: number) {
    return end >= visibleStart && start <= visibleEnd;
  }

  function renderTimedItem<T extends { id: string; start: number; end: number }>(
    layout: TimelineItemLayout<T>,
    itemKind: TimelineItemKind,
    className: string,
    icon: string,
    label: string,
    title: string
  ) {
    const item = layout.item;
    const selected =
      selection?.kind === itemKind && selection.id === item.id;

    return (
      <button
        type="button"
        key={item.id}
        className={`timeline-item ${className} ${selected ? 'selected' : ''} ${
          isCompactTimelineItem(item.start, item.end, pxPerSecond) ? 'compact' : ''
        }`}
        style={timelineItemStyle(
          item.start,
          item.end,
          pxPerSecond,
          layout.lane,
          TIMELINE_ITEM_LANE_HEIGHT,
          TIMELINE_ITEM_TOP_PADDING,
          TIMELINE_MIN_ITEM_WIDTH,
          TIMELINE_EDGE_PADDING
        )}
        title={title}
        aria-label={title}
        onPointerDown={(event) => startTimedItemDrag(event, itemKind, item)}
        onPointerMove={moveTimedItem}
        onPointerUp={endTimedItemDrag}
        onPointerCancel={endTimedItemDrag}
        onClick={(event) => {
          event.stopPropagation();
          if (itemClickSuppressRef.current) return;
          onSelect({ kind: itemKind, id: item.id });
          onSeek(item.start);
        }}
      >
        <span
          className="timed-trim-handle timed-trim-start"
          aria-hidden="true"
          onPointerDown={(event) => startTimedItemTrim(event, itemKind, 'start', item)}
          onPointerMove={trimTimedItem}
          onPointerUp={endTimedItemTrim}
          onPointerCancel={endTimedItemTrim}
        />
        <span className="clip-icon">{icon}</span>
        <span className="clip-title">{label}</span>
        <span className="clip-meta">{formatClock(item.start)}</span>
        <span
          className="timed-trim-handle timed-trim-end"
          aria-hidden="true"
          onPointerDown={(event) => startTimedItemTrim(event, itemKind, 'end', item)}
          onPointerMove={trimTimedItem}
          onPointerUp={endTimedItemTrim}
          onPointerCancel={endTimedItemTrim}
        />
      </button>
    );
  }

  return (
    <div className="timeline" data-guide-target="timeline" onWheel={handleTimelineWheel}>
      <div className="timeline-navigation">
        <div className="timeline-view-readout">
          <span>{formatClock(visibleRange.start)} - {formatClock(visibleRange.end)}</span>
          <strong>{selectedSummary}</strong>
        </div>
        <div className="timeline-view-controls">
          <button
            type="button"
            className={tool === 'select' ? 'active' : ''}
            onClick={() => setTool('select')}
            title="선택 도구"
          >
            <MousePointerClick size={14} />
            선택
          </button>
          <button
            type="button"
            className={tool === 'pan' ? 'active' : ''}
            onClick={() => setTool((previous) => (previous === 'pan' ? 'select' : 'pan'))}
            title="드래그로 타임라인 이동"
          >
            <Hand size={14} />
            이동
          </button>
          <button
            type="button"
            className={followPlayhead ? 'active' : ''}
            onClick={() => setFollowPlayhead((previous) => !previous)}
            title="재생 헤드를 따라 보기"
          >
            Follow
          </button>
          <button type="button" onClick={handleFitTimeline} title="전체 길이를 화면에 맞춤">
            <Maximize2 size={14} />
            Fit
          </button>
          <button
            type="button"
            onClick={() => handleZoom(pxPerSecond / 1.22)}
            title="줌 아웃"
          >
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={TIMELINE_MIN_PX_PER_SECOND}
            max={TIMELINE_MAX_PX_PER_SECOND}
            step="0.1"
            value={pxPerSecond}
            aria-label="타임라인 확대"
            onChange={(event) => handleZoom(Number(event.target.value))}
          />
          <button
            type="button"
            onClick={() => handleZoom(pxPerSecond * 1.22)}
            title="줌 인"
          >
            <ZoomIn size={14} />
          </button>
          <span className="timeline-zoom-readout">{zoomPercent}%</span>
        </div>
      </div>
      <div className="timeline-overview-layout">
        <div className="timeline-overview-label">전체</div>
        <div
          ref={overviewRef}
          className="timeline-overview"
          onPointerDown={beginOverviewDrag}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              seekOverview(event.clientX);
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          {clipRanges.map((range) => (
            <span
              key={range.clip.id}
              className="timeline-overview-segment"
              style={{
                left: `${(range.start / safeDuration) * 100}%`,
                width: `${Math.max(0.25, ((range.end - range.start) / safeDuration) * 100)}%`
              }}
            />
          ))}
          <span
            className="timeline-overview-playhead"
            style={{ left: `${(currentTime / safeDuration) * 100}%` }}
          />
          <span
            className="timeline-overview-window"
            style={{ left: `${viewportThumbLeft}%`, width: `${viewportThumbWidth}%` }}
          />
        </div>
      </div>
      <div className="timeline-layout">
        <div className="timeline-track-headers" style={{ gridTemplateRows }}>
          <div className="timeline-corner">
            <strong>트랙</strong>
            <span>높이 조절</span>
          </div>
          <TimelineTrackHeader
            track="video"
            label="영상"
            count={videoClips.length}
            detail="비디오 조각"
            selected={selectedTrack === 'video'}
            resizing={resizingTrack === 'video'}
            onResizeStart={beginTrackResize}
            onResizeMove={updateTrackResize}
            onResizeEnd={endTrackResize}
            onResetHeight={resetTrackHeight}
          />
          <TimelineTrackHeader
            track="audio"
            label="오디오"
            count={videoClips.length + audioClips.length}
            detail={`${Math.max(1, audioLayout.laneCount + 1)}줄 레이어`}
            selected={selectedTrack === 'audio'}
            resizing={resizingTrack === 'audio'}
            onResizeStart={beginTrackResize}
            onResizeMove={updateTrackResize}
            onResizeEnd={endTrackResize}
            onResetHeight={resetTrackHeight}
          />
          <TimelineTrackHeader
            track="cue"
            label="자막"
            count={cues.length}
            detail={`${Math.max(1, cueLayout.laneCount)}줄 레이어`}
            selected={selectedTrack === 'cue'}
            resizing={resizingTrack === 'cue'}
            onResizeStart={beginTrackResize}
            onResizeMove={updateTrackResize}
            onResizeEnd={endTrackResize}
            onResetHeight={resetTrackHeight}
          />
          <TimelineTrackHeader
            track="overlay"
            label="텍스트"
            count={overlays.length}
            detail={`${Math.max(1, overlayLayout.laneCount)}줄 레이어`}
            selected={selectedTrack === 'overlay'}
            resizing={resizingTrack === 'overlay'}
            onResizeStart={beginTrackResize}
            onResizeMove={updateTrackResize}
            onResizeEnd={endTrackResize}
            onResetHeight={resetTrackHeight}
          />
          <TimelineTrackHeader
            track="effect"
            label="효과"
            count={effects.length}
            detail={`${Math.max(1, effectLayout.laneCount)}줄 레이어`}
            selected={selectedTrack === 'effect'}
            resizing={resizingTrack === 'effect'}
            onResizeStart={beginTrackResize}
            onResizeMove={updateTrackResize}
            onResizeEnd={endTrackResize}
            onResetHeight={resetTrackHeight}
          />
        </div>
        <div
          ref={scrollRef}
          className={`timeline-scroll ${timelineCursorClass} ${isPanning ? 'is-panning' : ''}`}
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          onPointerDown={beginPan}
          onPointerMove={updatePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          <div
            ref={timefieldRef}
            className="timeline-timefield"
            style={{ width: `${timelineWidth}px`, gridTemplateRows }}
            onPointerDown={beginTimelineScrub}
            onPointerMove={updateTimelineScrub}
            onPointerUp={endTimelineScrub}
            onPointerCancel={endTimelineScrub}
            onClick={handleTimelineClick}
          >
            <div className="timeline-ruler">
              {ticks.map((tick) => (
                <div
                  key={`${tick.time}-${tick.major ? 'major' : 'minor'}`}
                  className={`ruler-tick ${tick.major ? 'major' : ''}`}
                  style={{ left: `${timelineX(tick.time)}px` }}
                >
                  {tick.major && <span>{formatTimelineTick(tick.time)}</span>}
                </div>
              ))}
            </div>
            {cutStart !== null && cutEnd !== null && cutEnd > cutStart && (
              <div
                className="timeline-cut-range"
                style={{
                  left: `${timelineX(cutStart)}px`,
                  width: `${Math.max(1, (cutEnd - cutStart) * pxPerSecond)}px`
                }}
              />
            )}
            {cutRange.start !== null && (
              <div
                className="timeline-cut-marker cut-marker-in"
                style={{ left: `${timelineX(cutRange.start)}px` }}
              >
                <span>IN</span>
              </div>
            )}
            {cutRange.end !== null && (
              <div
                className="timeline-cut-marker cut-marker-out"
                style={{ left: `${timelineX(cutRange.end)}px` }}
              >
                <span>OUT</span>
              </div>
            )}
            {dragGuide && (
              <div
                className="timeline-snap-guide"
                style={{ left: `${timelineX(dragGuide.time)}px` }}
              >
                <span>{dragGuide.label}</span>
              </div>
            )}
            {clipReorderGuide && (
              <div
                className="clip-reorder-guide"
                style={{ left: `${clipReorderGuide.x}px` }}
              >
                <span>{clipReorderGuide.label}</span>
              </div>
            )}
            <div
              className="playhead"
              style={{ left: playheadLeft }}
              onPointerDown={beginPlayheadDrag}
              onPointerMove={updatePlayheadDrag}
              onPointerUp={endPlayheadDrag}
              onPointerCancel={endPlayheadDrag}
            />
            <TimelineLane
              track="video"
              height={videoTrackHeight}
              className="video-lane"
              selected={selectedTrack === 'video'}
              resizing={resizingTrack === 'video'}
              onResizeStart={beginTrackResize}
              onResizeMove={updateTrackResize}
              onResizeEnd={endTrackResize}
              onResetHeight={resetTrackHeight}
            >
              {clipRanges.map((range) => {
                if (!isRangeVisible(range.start, range.end)) return null;
                const transitionOut = normalizedTransitions.find(
                  (transition) => transition.fromClipId === range.clip.id
                );
                const title = timelineClipTitle(
                  '영상',
                  `${range.index + 1}번 조각 · ${range.clip.speed}x`,
                  range.start,
                  range.end
                );
	                const stripCount = getClipThumbnailCount(
	                  range.start,
	                  range.end,
	                  pxPerSecond,
	                  videoClipMetrics.thumbnailHeight
	                );
	                const activeTrim =
	                  clipTrimPreview?.id === range.clip.id ? clipTrimPreview : null;
	                const thumbnailClip = activeTrim
	                  ? {
	                      ...range.clip,
	                      sourceStart: activeTrim.sourceStart,
	                      sourceEnd: activeTrim.sourceEnd
	                    }
	                  : range.clip;
	                const thumbnailStripCount = activeTrim?.stripCount ?? stripCount;
	                const clipThumbnails = getClipThumbnailStrip(
	                  thumbnails,
	                  thumbnailClip,
	                  thumbnailStripCount
	                );
	                const fallbackStripCount = Math.max(2, Math.min(8, thumbnailStripCount || 4));
	                return (
	                  <button
	                    type="button"
	                    key={range.clip.id}
	                    className={`timeline-item video-item ${
	                      selection?.kind === 'clip' && selection.id === range.clip.id
	                        ? 'selected'
	                        : ''
	                    } ${
	                      isCompactTimelineItem(range.start, range.end, pxPerSecond) ? 'compact' : ''
	                    } ${activeTrim ? `is-trimming is-trimming-${activeTrim.edge}` : ''} ${
                        reorderingClipId === range.clip.id ? 'is-reordering' : ''
                      }`}
                    style={
                      {
                        ...timelineItemStyle(
                          range.start,
                          range.end,
                          pxPerSecond,
                          0,
                          videoItemLaneHeight,
                          4,
                          TIMELINE_MIN_ITEM_WIDTH,
                          TIMELINE_EDGE_PADDING
                        ),
                        '--video-thumbnail-row': `${videoClipMetrics.thumbnailHeight}px`,
                        '--video-meta-row': `${videoClipMetrics.metaHeight}px`,
                        '--video-wave-row': `${videoClipMetrics.waveHeight}px`
                      } as CSSProperties
                    }
                    title={title}
                    aria-label={title}
                    onPointerDown={(event) => beginClipReorder(event, range)}
                    onPointerMove={moveClipReorder}
                    onPointerUp={endClipReorder}
                    onPointerCancel={endClipReorder}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (itemClickSuppressRef.current) return;
                      onSelect({ kind: 'clip', id: range.clip.id });
                      onSeek(range.start);
                    }}
                  >
                    <span
	                      className={`video-clip-strip ${
	                        clipThumbnails.length ? 'has-thumbnails' : 'is-empty'
	                      } ${activeTrim ? 'is-frozen' : ''}`}
                      aria-hidden="true"
                      style={
                        {
                          '--thumbnail-count': Math.max(
                            1,
                            clipThumbnails.length || fallbackStripCount
                          )
                        } as CSSProperties
                      }
                    >
                      {clipThumbnails.length
                        ? clipThumbnails.map((thumbnail, thumbnailIndex) => (
                            <img
                              key={`${thumbnail.time}-${thumbnailIndex}`}
                              src={thumbnail.url}
                              alt=""
                              draggable={false}
                            />
                          ))
                        : Array.from({ length: fallbackStripCount }).map((_, stripIndex) => (
                            <span key={stripIndex} />
                          ))}
                    </span>
                    <span className="video-clip-main">
                      <span className="video-clip-index">
                        {String(range.index + 1).padStart(2, '0')}
                      </span>
	                      <span className="video-clip-text">
	                        <strong>조각 {range.index + 1}</strong>
	                        <small>
	                          원본 {formatClock(range.clip.sourceStart)} -{' '}
	                          {formatClock(range.clip.sourceEnd)}
	                        </small>
	                      </span>
                      <span className="video-clip-badges">
                        <span>{formatClock(range.outputDuration)}</span>
                        {range.clip.speed !== 1 && <span>{range.clip.speed}x</span>}
                        {range.clip.muted && <span>M</span>}
                        {transitionOut && <span>FX</span>}
                      </span>
                    </span>
	                    <span className="video-clip-wave" aria-hidden="true">
	                      {Array.from({ length: 14 }).map((_, waveIndex) => (
	                        <span key={waveIndex} style={{ height: `${6 + ((waveIndex * 7) % 13)}px` }} />
	                      ))}
	                    </span>
	                    <span className="video-clip-source-range" aria-hidden="true">
	                      <span>IN {formatClock(range.clip.sourceStart)}</span>
	                      <span>OUT {formatClock(range.clip.sourceEnd)}</span>
	                    </span>
	                    {activeTrim && (
	                      <span className={`video-trim-readout video-trim-readout-${activeTrim.edge}`}>
	                        {activeTrim.edge === 'start' ? 'IN' : 'OUT'}{' '}
	                        {formatClock(activeTrim.currentSourceTime)}
	                      </span>
	                    )}
	                    <ClipTrimHandle
	                      edge="start"
	                      clip={range.clip}
	                      pxPerSecond={pxPerSecond}
	                      sourceDuration={sourceDuration}
	                      stripCount={stripCount}
	                      onSelect={() => onSelect({ kind: 'clip', id: range.clip.id })}
	                      onPreviewChange={setClipTrimPreview}
	                      onTrim={onTrimClip}
	                    />
	                    <ClipTrimHandle
	                      edge="end"
	                      clip={range.clip}
	                      pxPerSecond={pxPerSecond}
	                      sourceDuration={sourceDuration}
	                      stripCount={stripCount}
	                      onSelect={() => onSelect({ kind: 'clip', id: range.clip.id })}
	                      onPreviewChange={setClipTrimPreview}
	                      onTrim={onTrimClip}
	                    />
                  </button>
                );
              })}
              {normalizedTransitions.map((transition) => {
                const fromRange = clipRanges.find(
                  (range) => range.clip.id === transition.fromClipId
                );
                if (!fromRange) return null;
                if (!isRangeVisible(fromRange.end - transition.duration, fromRange.end)) return null;

                const label = transition.kind === 'fade' ? 'Fade' : 'Slide';
                return (
                  <span
                    key={transition.id}
                    className="timeline-transition"
                    style={timelineItemStyle(
                      fromRange.end - transition.duration,
                      fromRange.end,
                      pxPerSecond,
                      0,
                      30,
                      13,
                      46,
                      TIMELINE_EDGE_PADDING
                    )}
                    title={`${label} ${transition.duration.toFixed(2)}s`}
                  >
                    {label}
                  </span>
                );
              })}
            </TimelineLane>
            <TimelineLane
              track="audio"
              height={audioTrackHeight}
              className="audio-lane"
              selected={selectedTrack === 'audio'}
              resizing={resizingTrack === 'audio'}
              onResizeStart={beginTrackResize}
              onResizeMove={updateTrackResize}
              onResizeEnd={endTrackResize}
              onResetHeight={resetTrackHeight}
            >
              {clipRanges.map((range) => {
                if (!isRangeVisible(range.start, range.end)) return null;
                const volume = normalizeAudioVolume(range.clip.volume);
                const title = timelineClipTitle(
                  '원본 오디오',
                  `조각 ${range.index + 1} · ${Math.round(volume * 100)}%`,
                  range.start,
                  range.end
                );

                return (
                  <button
                    type="button"
                    key={`source-audio-${range.clip.id}`}
                    className={`timeline-item audio-item source-audio-item ${
                      selection?.kind === 'sourceAudio' && selection.id === range.clip.id
                        ? 'selected'
                        : ''
                    } ${range.clip.muted ? 'is-muted' : ''} ${
                      isCompactTimelineItem(range.start, range.end, pxPerSecond) ? 'compact' : ''
                    }`}
                    style={timelineItemStyle(
                      range.start,
                      range.end,
                      pxPerSecond,
                      0,
                      TIMELINE_ITEM_LANE_HEIGHT,
                      TIMELINE_ITEM_TOP_PADDING,
                      TIMELINE_MIN_ITEM_WIDTH,
                      TIMELINE_EDGE_PADDING
                    )}
                    title={title}
                    aria-label={title}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectSourceAudio(range.clip.id);
                      onSeek(range.start);
                    }}
                  >
                    <span className="clip-icon">{range.clip.muted ? 'M' : 'A'}</span>
                    <span className="clip-title">원본 오디오 {range.index + 1}</span>
                    <span className="clip-meta">{Math.round(volume * 100)}%</span>
                  </button>
                );
              })}
              {audioLayout.layouts.map((layout) => {
                const clip = layout.item;
                if (!isRangeVisible(clip.start, clip.end)) return null;
                const source = timelineAudioSourceMap.get(clip.sourceId);
                const label = clip.label || source?.name || '오디오';
                const title = timelineClipTitle('오디오', label, clip.start, clip.end);
                const waveform = audioWaveforms[clip.sourceId] ?? [];
                const sourceKindClass =
                  source?.kind === 'effect' ? 'is-sound-effect' : 'is-music';

                return (
                  <button
                    type="button"
                    key={clip.id}
                    className={`timeline-item audio-item external-audio-item ${sourceKindClass} ${
                      selection?.kind === 'audio' && selection.id === clip.id ? 'selected' : ''
                    } ${clip.muted ? 'is-muted' : ''} ${
                      isCompactTimelineItem(clip.start, clip.end, pxPerSecond) ? 'compact' : ''
                    }`}
                    style={timelineItemStyle(
                      clip.start,
                      clip.end,
                      pxPerSecond,
                      layout.lane + 1,
                      TIMELINE_ITEM_LANE_HEIGHT,
                      TIMELINE_ITEM_TOP_PADDING,
                      TIMELINE_MIN_ITEM_WIDTH,
                      TIMELINE_EDGE_PADDING
                    )}
                    title={title}
                    aria-label={title}
                    onPointerDown={(event) => startTimedItemDrag(event, 'audio', clip)}
                    onPointerMove={moveTimedItem}
                    onPointerUp={endTimedItemDrag}
                    onPointerCancel={endTimedItemDrag}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (itemClickSuppressRef.current) return;
                      onSelect({ kind: 'audio', id: clip.id });
                      onSeek(clip.start);
                    }}
                  >
                    <span
                      className="timed-trim-handle timed-trim-start"
                      aria-hidden="true"
                      onPointerDown={(event) => startTimedItemTrim(event, 'audio', 'start', clip)}
                      onPointerMove={trimTimedItem}
                      onPointerUp={endTimedItemTrim}
                      onPointerCancel={endTimedItemTrim}
                    />
                    <span className="clip-icon">{source?.kind === 'effect' ? 'SFX' : 'BGM'}</span>
                    <span className="clip-title">{label}</span>
                    <span className="clip-meta">{Math.round(clip.volume * 100)}%</span>
                    <span className="audio-waveform" aria-hidden="true">
                      {renderAudioWaveformBars(waveform)}
                    </span>
                    <span
                      className="timed-trim-handle timed-trim-end"
                      aria-hidden="true"
                      onPointerDown={(event) => startTimedItemTrim(event, 'audio', 'end', clip)}
                      onPointerMove={trimTimedItem}
                      onPointerUp={endTimedItemTrim}
                      onPointerCancel={endTimedItemTrim}
                    />
                  </button>
                );
              })}
            </TimelineLane>
            <TimelineLane
              track="cue"
              height={cueTrackHeight}
              selected={selectedTrack === 'cue'}
              resizing={resizingTrack === 'cue'}
              onResizeStart={beginTrackResize}
              onResizeMove={updateTrackResize}
              onResizeEnd={endTrackResize}
              onResetHeight={resetTrackHeight}
            >
              {cueLayout.layouts.map((layout) => {
                const cue = layout.item;
                if (!isRangeVisible(cue.start, cue.end)) return null;
                const title = timelineClipTitle('자막', cue.text || '빈 자막', cue.start, cue.end);
                return renderTimedItem(layout, 'cue', 'cue-item', 'CC', cue.text || '자막', title);
              })}
            </TimelineLane>
            <TimelineLane
              track="overlay"
              height={overlayTrackHeight}
              selected={selectedTrack === 'overlay'}
              resizing={resizingTrack === 'overlay'}
              onResizeStart={beginTrackResize}
              onResizeMove={updateTrackResize}
              onResizeEnd={endTrackResize}
              onResetHeight={resetTrackHeight}
            >
              {overlayLayout.layouts.map((layout) => {
                const overlay = layout.item;
                if (!isRangeVisible(overlay.start, overlay.end)) return null;
                const title = timelineClipTitle(
                  '텍스트',
                  overlay.text || '빈 텍스트',
                  overlay.start,
                  overlay.end
                );
                return renderTimedItem(layout, 'overlay', 'overlay-item', 'T', overlay.text || '텍스트', title);
              })}
            </TimelineLane>
            <TimelineLane
              track="effect"
              height={effectTrackHeight}
              selected={selectedTrack === 'effect'}
              resizing={resizingTrack === 'effect'}
              onResizeStart={beginTrackResize}
              onResizeMove={updateTrackResize}
              onResizeEnd={endTrackResize}
              onResetHeight={resetTrackHeight}
            >
              {effectLayout.layouts.map((layout) => {
                const effect = layout.item;
                if (!isRangeVisible(effect.start, effect.end)) return null;
                const label = effect.label || effectName(effect.kind);
                const title = timelineClipTitle('효과', label, effect.start, effect.end);
                return renderTimedItem(layout, 'effect', 'effect-item', 'FX', label, title);
              })}
            </TimelineLane>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClipTrimHandle({
  edge,
  clip,
  pxPerSecond,
  sourceDuration,
  stripCount,
  onSelect,
  onPreviewChange,
  onTrim
}: {
  edge: 'start' | 'end';
  clip: VideoClip;
  pxPerSecond: number;
  sourceDuration: number;
  stripCount: number;
  onSelect: () => void;
  onPreviewChange: (preview: ClipTrimPreviewState | null) => void;
  onTrim: (
    id: string,
    edge: 'start' | 'end',
    sourceTime: number,
    groupKey?: string
  ) => void;
}) {
  const dragStartRef = useRef<{
    x: number;
    sourceStart: number;
    sourceEnd: number;
    pxPerSecond: number;
  } | null>(null);

  function trimToPointer(event: ReactPointerEvent<HTMLSpanElement>) {
    const start = dragStartRef.current;
    if (!start) return;

    const deltaTimeline = (event.clientX - start.x) / Math.max(start.pxPerSecond, 0.1);
    const deltaSource = deltaTimeline * normalizeSpeed(clip.speed);
    const rawSourceTime =
      edge === 'start'
        ? start.sourceStart + deltaSource
        : start.sourceEnd + deltaSource;
    const nextSourceTime =
      edge === 'start'
        ? Math.min(Math.max(0, rawSourceTime), start.sourceEnd - MIN_CUE_DURATION)
        : clamp(
            rawSourceTime,
            start.sourceStart + MIN_CUE_DURATION,
            Math.max(start.sourceStart + MIN_CUE_DURATION, sourceDuration || start.sourceEnd)
          );

    onPreviewChange({
      id: clip.id,
      edge,
      sourceStart: start.sourceStart,
      sourceEnd: start.sourceEnd,
      currentSourceTime: nextSourceTime,
      stripCount
    });
    onTrim(clip.id, edge, nextSourceTime, `clip-trim:${clip.id}:${edge}`);
  }

  return (
    <span
      className={`clip-trim-handle clip-trim-${edge}`}
      aria-label={edge === 'start' ? '클립 시작점 트림' : '클립 종료점 트림'}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
        dragStartRef.current = {
          x: event.clientX,
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
          pxPerSecond
        };
        onPreviewChange({
          id: clip.id,
          edge,
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
          currentSourceTime: edge === 'start' ? clip.sourceStart : clip.sourceEnd,
          stripCount
        });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation();
          trimToPointer(event);
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        dragStartRef.current = null;
        onPreviewChange(null);
      }}
      onPointerCancel={() => {
        dragStartRef.current = null;
        onPreviewChange(null);
      }}
    >
      <span className="clip-trim-label">{edge === 'start' ? 'IN' : 'OUT'}</span>
      <span className="clip-trim-grip" aria-hidden="true" />
    </span>
  );
}

function TimelineTrackHeader({
  track,
  label,
  count,
  detail,
  selected,
  resizing,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onResetHeight
}: {
  track: TimelineTrackKind;
  label: string;
  count: number;
  detail?: string;
  selected: boolean;
  resizing: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>, track: TimelineTrackKind) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onResetHeight: (track: TimelineTrackKind) => void;
}) {
  return (
    <div
      className={`timeline-track-header ${selected ? 'is-selected' : ''} ${
        resizing ? 'is-resizing' : ''
      }`}
      data-track={track}
    >
      <span className="timeline-track-code" aria-hidden="true">
        {getTimelineTrackCode(track)}
      </span>
      <span className="timeline-track-copy">
        <strong>{label}</strong>
        {detail && <em>{detail}</em>}
      </span>
      <small aria-label={`${count}개`}>{count}</small>
      <button
        type="button"
        className="timeline-track-resize-handle"
        aria-label={`${label} 트랙 높이 조절`}
        title="드래그해서 트랙 높이 조절, 더블클릭으로 초기화"
        onPointerDown={(event) => onResizeStart(event, track)}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onResetHeight(track);
        }}
      />
    </div>
  );
}

function getTimelineTrackCode(track: TimelineTrackKind) {
  const codes: Record<TimelineTrackKind, string> = {
    video: 'V1',
    audio: 'A1',
    cue: 'CC',
    overlay: 'T',
    effect: 'FX'
  };

  return codes[track];
}

function TimelineLane({
  children,
  height,
  className,
  track,
  selected,
  resizing,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onResetHeight
}: {
  children: ReactNode;
  height: number;
  className?: string;
  track: TimelineTrackKind;
  selected: boolean;
  resizing: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>, track: TimelineTrackKind) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onResetHeight: (track: TimelineTrackKind) => void;
}) {
  return (
    <div
      className={`timeline-lane ${className ?? ''} ${selected ? 'is-selected' : ''} ${
        resizing ? 'is-resizing' : ''
      }`}
      style={{ height }}
    >
      {children}
      <button
        type="button"
        className="timeline-lane-resize-handle"
        aria-label="트랙 높이 조절"
        title="드래그해서 트랙 높이 조절, 더블클릭으로 초기화"
        onPointerDown={(event) => onResizeStart(event, track)}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onResetHeight(track);
        }}
      />
    </div>
  );
}

function VideoPanel({
  clips,
  ranges,
  transitions,
  selectedClip,
  selectedTransition,
  sourceDuration,
  isExporting,
  onSelect,
  onSeek,
  onMoveClip,
  onUpdateClip,
  onUpdateTransition,
  onExportSelectedClip
}: {
  clips: VideoClip[];
  ranges: ReturnType<typeof getClipTimelineRanges>;
  transitions: ClipTransition[];
  selectedClip: VideoClip | null | undefined;
  selectedTransition: ClipTransition | null | undefined;
  sourceDuration: number;
  isExporting: boolean;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onMoveClip: (offset: number) => void;
  onUpdateClip: (id: string, patch: Partial<VideoClip>, groupKey?: string) => void;
  onUpdateTransition: (
    kind: ClipTransitionKind | 'none',
    duration?: number
  ) => void;
  onExportSelectedClip: () => void;
}) {
  const selectedRange = selectedClip
    ? ranges.find((range) => range.clip.id === selectedClip.id)
    : null;
  const canTransitionOut =
    Boolean(selectedClip) &&
    clips.findIndex((clip) => clip.id === selectedClip?.id) < clips.length - 1;
  const selectedClipIndex = selectedClip
    ? clips.findIndex((clip) => clip.id === selectedClip.id)
    : -1;
  const canMoveEarlier = selectedClipIndex > 0;
  const canMoveLater =
    selectedClipIndex >= 0 && selectedClipIndex < clips.length - 1;

  return (
    <div className="panel-body video-panel-body">
      <div className="clip-concept-card">
        <strong>타임라인 조각</strong>
        <span>최종 MP4에 순서대로 이어 붙일 편집 구간</span>
      </div>

      <div className="item-list video-clip-list">
        {clips.length === 0 && <p className="empty-copy">영상 조각 없음</p>}
        {ranges.map((range) => {
          const nextClip = clips[range.index + 1];
          const transition = nextClip
            ? getTransitionBetween(transitions, range.clip.id, nextClip.id)
            : null;

          return (
            <button
              type="button"
              key={range.clip.id}
              className={
                selectedClip?.id === range.clip.id
                  ? 'item-card clip-card active'
                  : 'item-card clip-card'
              }
              onClick={() => {
                onSelect(range.clip.id);
                onSeek(range.start);
              }}
            >
              <span className="clip-card-index">{range.index + 1}</span>
              <div className="clip-card-main">
                <strong>조각 {String(range.index + 1).padStart(2, '0')}</strong>
                <small>
                  {formatClock(range.start)} - {formatClock(range.end)}
                </small>
              </div>
              <div className="clip-card-badges">
                <span className="clip-badge-speed">{range.clip.speed}x</span>
                {range.clip.muted && <span className="clip-badge-muted">Mute</span>}
                {transition && (
                  <span className="clip-badge-transition">
                    {transition.kind === 'fade' ? 'Fade' : 'Slide'}
                  </span>
                )}
              </div>
              <div className="clip-card-meta">
                <span>길이 {formatClock(range.outputDuration)}</span>
                <span>
                  원본 {formatClock(range.clip.sourceStart)} - {formatClock(range.clip.sourceEnd)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {selectedClip && (
        <div className="inspector">
          <div className="field-grid two">
            <NumberField
              label="원본 시작"
              value={selectedClip.sourceStart}
              min={0}
              max={Math.max(0, sourceDuration - MIN_CUE_DURATION)}
              step={0.05}
              onChange={(value) =>
                onUpdateClip(
                  selectedClip.id,
                  { sourceStart: value },
                  `clip-trim:${selectedClip.id}:start`
                )
              }
            />
            <NumberField
              label="원본 종료"
              value={selectedClip.sourceEnd}
              min={MIN_CUE_DURATION}
              max={sourceDuration || selectedClip.sourceEnd}
              step={0.05}
              onChange={(value) =>
                onUpdateClip(
                  selectedClip.id,
                  { sourceEnd: value },
                  `clip-trim:${selectedClip.id}:end`
                )
              }
            />
          </div>

          <label>
            속도
            <select
              value={selectedClip.speed}
              onChange={(event) =>
                onUpdateClip(
                  selectedClip.id,
                  { speed: Number(event.target.value) },
                  `clip-speed:${selectedClip.id}`
                )
              }
            >
              {[0.25, 0.5, 1, 1.5, 2, 4].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
          </label>

          <div className="field-grid two">
            <NumberField
              label="속도 직접"
              value={selectedClip.speed}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(value) =>
                onUpdateClip(
                  selectedClip.id,
                  { speed: value },
                  `clip-speed:${selectedClip.id}`
                )
              }
            />
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={selectedClip.muted}
                onChange={(event) =>
                  onUpdateClip(selectedClip.id, { muted: event.target.checked })
                }
              />
              음소거
            </label>
          </div>

          {selectedRange && (
            <div className="clip-summary">
              <span>
                조각 {selectedRange.index + 1}: 원본 {formatClock(selectedClip.sourceStart)} -{' '}
                {formatClock(selectedClip.sourceEnd)}
              </span>
              <span>
                저장 시 길이 {formatClock(selectedRange.outputDuration)}
              </span>
              <span>
                전체 영상 안 위치 {formatClock(selectedRange.start)} - {formatClock(selectedRange.end)}
              </span>
            </div>
          )}

          <div className="clip-order-card">
            <div>
              <strong>조각 순서</strong>
              <span>최종 영상에서 이어 붙는 위치를 변경</span>
            </div>
            <div className="clip-order-actions">
              <button
                type="button"
                onClick={() => onMoveClip(-1)}
                disabled={!canMoveEarlier}
                title="Alt + ←"
              >
                <ArrowLeft size={15} />
                앞쪽
              </button>
              <button
                type="button"
                onClick={() => onMoveClip(1)}
                disabled={!canMoveLater}
                title="Alt + →"
              >
                뒤쪽
                <ArrowRight size={15} />
              </button>
            </div>
            <small>타임라인의 영상 조각을 드래그해도 순서를 바꿀 수 있습니다.</small>
          </div>

          <div className="clip-export-card">
            <strong>선택 조각 MP4 내보내기</strong>
            <span>선택한 조각만 별도 MP4로 생성</span>
            <button
              type="button"
              onClick={onExportSelectedClip}
              disabled={!selectedClip || isExporting}
            >
              <FileDown size={16} />
              조각 MP4 내보내기
            </button>
          </div>

          <label>
            다음 조각 전환
            <select
              value={selectedTransition?.kind ?? 'none'}
              disabled={!canTransitionOut}
              onChange={(event) =>
                onUpdateTransition(
                  event.target.value as ClipTransitionKind | 'none',
                  selectedTransition?.duration ?? DEFAULT_TRANSITION_DURATION
                )
              }
            >
              <option value="none">없음</option>
              <option value="fade">Fade</option>
              <option value="slideleft">Slide Left</option>
              <option value="slideright">Slide Right</option>
              <option value="slideup">Slide Up</option>
              <option value="slidedown">Slide Down</option>
            </select>
          </label>

          <NumberField
            label="전환 길이"
            value={selectedTransition?.duration ?? DEFAULT_TRANSITION_DURATION}
            min={0.05}
            max={5}
            step={0.05}
            onChange={(value) =>
              onUpdateTransition(selectedTransition?.kind ?? 'fade', value)
            }
          />
        </div>
      )}
    </div>
  );
}

function AudioPanel({
  sources,
  clips,
  sourceFiles,
  videoRanges,
  selectedAudioClip,
  selectedVideoClip,
  onImportMusic,
  onImportEffect,
  onSelectAudio,
  onSelectVideoAudio,
  onSeek,
  onUpdateAudioClip,
  onUpdateVideoClip
}: {
  sources: AudioSourceMeta[];
  clips: AudioClip[];
  sourceFiles: AudioFileMap;
  videoRanges: ReturnType<typeof getClipTimelineRanges>;
  selectedAudioClip: AudioClip | null | undefined;
  selectedVideoClip: VideoClip | null | undefined;
  onImportMusic: () => void;
  onImportEffect: () => void;
  onSelectAudio: (id: string) => void;
  onSelectVideoAudio: (id: string) => void;
  onSeek: (time: number) => void;
  onUpdateAudioClip: (id: string, patch: Partial<AudioClip>, groupKey?: string) => void;
  onUpdateVideoClip: (id: string, patch: Partial<VideoClip>, groupKey?: string) => void;
}) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const selectedSource = selectedAudioClip ? sourceMap.get(selectedAudioClip.sourceId) : null;
  const selectedVideoRange = selectedVideoClip
    ? videoRanges.find((range) => range.clip.id === selectedVideoClip.id)
    : null;
  const missingCount = sources.filter((source) => !sourceFiles[source.id]).length;

  return (
    <div className="panel-body audio-panel-body">
      <div className="clip-concept-card">
        <strong>오디오 트랙</strong>
        <span>원본 소리, 배경음악, 효과음을 볼륨과 페이드 중심으로 조절합니다.</span>
      </div>

      <div className="audio-import-actions">
        <button type="button" onClick={onImportMusic}>
          <Music size={16} />
          음악 추가
        </button>
        <button type="button" onClick={onImportEffect}>
          <Volume2 size={16} />
          효과음 추가
        </button>
      </div>

      {missingCount > 0 && (
        <div className="audio-relink-note">
          <strong>오디오 파일 {missingCount}개 재연결 필요</strong>
          <span>프로젝트에는 정보만 저장됩니다. 같은 파일을 다시 가져오면 자동 연결됩니다.</span>
        </div>
      )}

      <div className="item-list video-clip-list">
        {videoRanges.length === 0 && clips.length === 0 && (
          <p className="empty-copy">오디오 트랙 없음</p>
        )}
        {videoRanges.length > 0 && <div className="audio-list-section-title">원본 오디오</div>}
        {videoRanges.map((range) => {
          const volume = normalizeAudioVolume(range.clip.volume);

          return (
            <button
              type="button"
              key={`video-audio-${range.clip.id}`}
              className={
                selectedVideoClip?.id === range.clip.id
                  ? 'item-card clip-card audio-card source-audio-card active'
                  : 'item-card clip-card audio-card source-audio-card'
              }
              onClick={() => {
                onSelectVideoAudio(range.clip.id);
                onSeek(range.start);
              }}
            >
              <span className="clip-card-index">{range.clip.muted ? 'M' : 'A'}</span>
              <div className="clip-card-main">
                <strong>원본 오디오 {String(range.index + 1).padStart(2, '0')}</strong>
                <small>
                  {formatClock(range.start)} - {formatClock(range.end)}
                </small>
              </div>
              <div className="clip-card-badges">
                <span>{Math.round(volume * 100)}%</span>
                {range.clip.fadeIn ? <span>In {range.clip.fadeIn.toFixed(1)}s</span> : null}
                {range.clip.fadeOut ? <span>Out {range.clip.fadeOut.toFixed(1)}s</span> : null}
                {range.clip.muted && <span className="clip-badge-muted">Mute</span>}
              </div>
            </button>
          );
        })}
        {clips.length > 0 && <div className="audio-list-section-title">추가 오디오</div>}
        {clips.map((clip, index) => {
          const source = sourceMap.get(clip.sourceId);
          const isMissing = !sourceFiles[clip.sourceId];

          return (
            <button
              type="button"
              key={clip.id}
              className={
                selectedAudioClip?.id === clip.id
                  ? 'item-card clip-card audio-card external-audio-card active'
                  : 'item-card clip-card audio-card external-audio-card'
              }
              onClick={() => {
                onSelectAudio(clip.id);
                onSeek(clip.start);
              }}
            >
              <span className="clip-card-index">{source?.kind === 'effect' ? 'S' : 'M'}</span>
              <div className="clip-card-main">
                <strong>{clip.label || `오디오 ${index + 1}`}</strong>
                <small>
                  {formatClock(clip.start)} - {formatClock(clip.end)}
                </small>
              </div>
              <div className="clip-card-badges">
                <span>{Math.round(clip.volume * 100)}%</span>
                {clip.fadeIn ? <span>In {clip.fadeIn.toFixed(1)}s</span> : null}
                {clip.fadeOut ? <span>Out {clip.fadeOut.toFixed(1)}s</span> : null}
                {clip.muted && <span className="clip-badge-muted">Mute</span>}
                {isMissing && <span className="clip-badge-transition">파일 필요</span>}
              </div>
            </button>
          );
        })}
      </div>

      {selectedVideoClip && selectedVideoRange && (
        <div className="inspector">
          <div className="clip-summary">
            <span>
              원본 오디오 조각 {selectedVideoRange.index + 1} ·{' '}
              {formatClock(selectedVideoRange.start)} - {formatClock(selectedVideoRange.end)}
            </span>
            <span>영상과 묶여 있어 위치 이동은 영상 조각 순서를 따릅니다.</span>
          </div>
          <AudioMixFields
            muted={selectedVideoClip.muted}
            volume={normalizeAudioVolume(selectedVideoClip.volume)}
            fadeIn={normalizeAudioFade(selectedVideoClip.fadeIn, selectedVideoRange.outputDuration)}
            fadeOut={normalizeAudioFade(selectedVideoClip.fadeOut, selectedVideoRange.outputDuration)}
            duration={selectedVideoRange.outputDuration}
            onChange={(patch, groupKey) =>
              onUpdateVideoClip(selectedVideoClip.id, patch, groupKey)
            }
            groupPrefix={`video-audio:${selectedVideoClip.id}`}
          />
        </div>
      )}

      {selectedAudioClip && (
        <div className="inspector">
          <label>
            이름
            <input
              type="text"
              value={selectedAudioClip.label}
              onChange={(event) =>
                onUpdateAudioClip(
                  selectedAudioClip.id,
                  { label: event.target.value },
                  `audio-label:${selectedAudioClip.id}`
                )
              }
            />
          </label>
          {selectedSource && (
            <div className="clip-summary">
              <span>
                {selectedSource.kind === 'effect' ? '효과음' : '음악'} · {selectedSource.name}
              </span>
              <span>
                원본 {formatClock(selectedAudioClip.sourceStart)} -{' '}
                {formatClock(selectedAudioClip.sourceEnd)}
              </span>
            </div>
          )}
          <div className="field-grid two">
            <NumberField
              label="시작"
              value={selectedAudioClip.start}
              min={0}
              step={0.05}
              onChange={(value) =>
                onUpdateAudioClip(
                  selectedAudioClip.id,
                  {
                    start: value,
                    end: value + getAudioClipDuration(selectedAudioClip)
                  },
                  `audio-time:${selectedAudioClip.id}:start`
                )
              }
            />
            <NumberField
              label="종료"
              value={selectedAudioClip.end}
              min={selectedAudioClip.start + MIN_CUE_DURATION}
              step={0.05}
              onChange={(value) =>
                onUpdateAudioClip(
                  selectedAudioClip.id,
                  {
                    end: value,
                    sourceEnd: selectedAudioClip.sourceStart + Math.max(MIN_CUE_DURATION, value - selectedAudioClip.start)
                  },
                  `audio-time:${selectedAudioClip.id}:end`
                )
              }
            />
          </div>
          <AudioMixFields
            muted={selectedAudioClip.muted}
            volume={selectedAudioClip.volume}
            fadeIn={selectedAudioClip.fadeIn}
            fadeOut={selectedAudioClip.fadeOut}
            duration={getAudioClipDuration(selectedAudioClip)}
            onChange={(patch, groupKey) =>
              onUpdateAudioClip(selectedAudioClip.id, patch, groupKey)
            }
            groupPrefix={`audio-mix:${selectedAudioClip.id}`}
          />
        </div>
      )}
    </div>
  );
}

function AudioMixFields({
  muted,
  volume,
  fadeIn,
  fadeOut,
  duration,
  onChange,
  groupPrefix
}: {
  muted: boolean;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  duration: number;
  onChange: (patch: Partial<AudioClip & VideoClip>, groupKey?: string) => void;
  groupPrefix: string;
}) {
  return (
    <>
      <div className="field-grid two">
        <NumberField
          label="볼륨"
          value={volume}
          min={0}
          max={2}
          step={0.05}
          onChange={(value) => onChange({ volume: value }, `${groupPrefix}:volume`)}
        />
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={muted}
            onChange={(event) => onChange({ muted: event.target.checked })}
          />
          음소거
        </label>
      </div>
      <div className="field-grid two">
        <NumberField
          label="Fade In"
          value={fadeIn}
          min={0}
          max={Math.max(0, duration / 2)}
          step={0.05}
          onChange={(value) => onChange({ fadeIn: value }, `${groupPrefix}:fade-in`)}
        />
        <NumberField
          label="Fade Out"
          value={fadeOut}
          min={0}
          max={Math.max(0, duration / 2)}
          step={0.05}
          onChange={(value) => onChange({ fadeOut: value }, `${groupPrefix}:fade-out`)}
        />
      </div>
    </>
  );
}

function CaptionPanel({
  cues,
  selectedCue,
  fonts,
  onSelect,
  onSeek,
  onUpdate,
  onUpdateStyle,
  onUpdateTime
}: {
  cues: CaptionCue[];
  selectedCue: CaptionCue | null | undefined;
  fonts: AppFontAsset[];
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onUpdate: (id: string, patch: Partial<CaptionCue>, groupKey?: string) => void;
  onUpdateStyle: (
    id: string,
    patch: Partial<CaptionStyle>,
    groupKey?: string
  ) => void;
  onUpdateTime: (id: string, key: 'start' | 'end', value: number) => void;
}) {
  return (
    <div className="panel-body">
      <div className="item-list">
        {cues.length === 0 && <p className="empty-copy">자막 없음</p>}
        {cues.map((cue, index) => (
          <button
            type="button"
            key={cue.id}
            className={selectedCue?.id === cue.id ? 'item-card active' : 'item-card'}
            onClick={() => {
              onSelect(cue.id);
              onSeek(cue.start);
            }}
          >
            <span>{index + 1}</span>
            <strong>{cue.text || '빈 자막'}</strong>
            <small>
              {formatClock(cue.start)} - {formatClock(cue.end)}
            </small>
          </button>
        ))}
      </div>

      {selectedCue && (
        <div className="inspector">
          <label>
            내용
            <textarea
              value={selectedCue.text}
              rows={4}
              onChange={(event) =>
                onUpdate(
                  selectedCue.id,
                  { text: event.target.value },
                  `cue-text:${selectedCue.id}`
                )
              }
            />
          </label>
          <div className="field-grid two">
            <NumberField
              label="시작"
              value={selectedCue.start}
              step={0.05}
              onChange={(value) => onUpdateTime(selectedCue.id, 'start', value)}
            />
            <NumberField
              label="종료"
              value={selectedCue.end}
              step={0.05}
              onChange={(value) => onUpdateTime(selectedCue.id, 'end', value)}
            />
          </div>
          <Segmented
            label="위치"
            value={selectedCue.position}
            options={[
              ['bottom', '하단'],
              ['middle', '중앙'],
              ['top', '상단']
            ]}
            onChange={(value) =>
              onUpdate(selectedCue.id, { position: value as CaptionPosition })
            }
          />
          <div className="align-row">
            {(['left', 'center', 'right'] as TextAlign[]).map((align) => (
              <button
                type="button"
                key={align}
                className={selectedCue.style.align === align ? 'active' : ''}
                onClick={() => onUpdateStyle(selectedCue.id, { align })}
              >
                {align === 'left' && <AlignLeft size={16} />}
                {align === 'center' && <AlignCenter size={16} />}
                {align === 'right' && <AlignRight size={16} />}
              </button>
            ))}
          </div>
          <FontWeightSelect
            family={selectedCue.style.fontFamily}
            fonts={fonts}
            value={selectedCue.style.fontWeight ?? defaultCaptionStyle.fontWeight}
            onChange={(fontWeight) =>
              onUpdateStyle(
                selectedCue.id,
                { fontWeight },
                `cue-weight:${selectedCue.id}`
              )
            }
          />
          <StyleControls
            style={selectedCue.style}
            fonts={fonts}
            onChange={(patch) =>
              onUpdateStyle(selectedCue.id, patch, `cue-style:${selectedCue.id}`)
            }
          />
        </div>
      )}
    </div>
  );
}

function OverlayPanel({
  overlays,
  selectedOverlay,
  fonts,
  onSelect,
  onSeek,
  onUpdate,
  onUpdateTime
}: {
  overlays: TextOverlay[];
  selectedOverlay: TextOverlay | null | undefined;
  fonts: AppFontAsset[];
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onUpdate: (id: string, patch: Partial<TextOverlay>, groupKey?: string) => void;
  onUpdateTime: (id: string, key: 'start' | 'end', value: number) => void;
}) {
  return (
    <div className="panel-body">
      <div className="item-list">
        {overlays.length === 0 && <p className="empty-copy">텍스트 없음</p>}
        {overlays.map((overlay, index) => (
          <button
            type="button"
            key={overlay.id}
            className={selectedOverlay?.id === overlay.id ? 'item-card active' : 'item-card'}
            onClick={() => {
              onSelect(overlay.id);
              onSeek(overlay.start);
            }}
          >
            <span>{index + 1}</span>
            <strong>{overlay.text || '빈 텍스트'}</strong>
            <small>
              {formatClock(overlay.start)} - {formatClock(overlay.end)}
            </small>
          </button>
        ))}
      </div>

      {selectedOverlay && (
        <div className="inspector">
          <label>
            내용
            <textarea
              value={selectedOverlay.text}
              rows={3}
              onChange={(event) =>
                onUpdate(
                  selectedOverlay.id,
                  { text: event.target.value },
                  `overlay-text:${selectedOverlay.id}`
                )
              }
            />
          </label>
          <div className="field-grid two">
            <NumberField
              label="시작"
              value={selectedOverlay.start}
              step={0.05}
              onChange={(value) => onUpdateTime(selectedOverlay.id, 'start', value)}
            />
            <NumberField
              label="종료"
              value={selectedOverlay.end}
              step={0.05}
              onChange={(value) => onUpdateTime(selectedOverlay.id, 'end', value)}
            />
          </div>
	          <div className="field-grid two">
	            <NumberField
	              label="X"
              value={selectedOverlay.x}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                onUpdate(selectedOverlay.id, { x: value }, `overlay-position:${selectedOverlay.id}`)
              }
            />
            <NumberField
              label="Y"
              value={selectedOverlay.y}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                onUpdate(selectedOverlay.id, { y: value }, `overlay-position:${selectedOverlay.id}`)
	              }
	            />
	          </div>
	          <section className="text-position-presets" aria-label="텍스트 고정 위치">
	            <div className="section-label">
	              <span>고정 위치</span>
	              <small>영상 기준</small>
	            </div>
	            <div className="position-preset-grid">
	              {textPositionPresets.map((preset) => {
	                const isActive =
	                  Math.abs(selectedOverlay.x - preset.x) < 0.5 &&
	                  Math.abs(selectedOverlay.y - preset.y) < 0.5 &&
	                  (selectedOverlay.align ?? defaultTextOverlay.align) === preset.align;

	                return (
	                  <button
	                    type="button"
	                    key={preset.id}
	                    className={isActive ? 'active' : ''}
	                    title={preset.label}
	                    aria-label={preset.label}
	                    onClick={() =>
	                      onUpdate(
	                        selectedOverlay.id,
	                        { x: preset.x, y: preset.y, align: preset.align },
	                        `overlay-position-preset:${selectedOverlay.id}:${preset.id}`
	                      )
	                    }
	                  >
	                    <span aria-hidden="true" />
	                  </button>
	                );
	              })}
	            </div>
	          </section>
	          <div className="field-grid two">
	            <NumberField
              label="가로 배율"
              value={selectedOverlay.scaleX ?? 1}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(value) =>
                onUpdate(
                  selectedOverlay.id,
                  { scaleX: clamp(value, 0.25, 4) },
                  `overlay-scale:${selectedOverlay.id}`
                )
              }
            />
            <NumberField
              label="세로 배율"
              value={selectedOverlay.scaleY ?? 1}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(value) =>
                onUpdate(
                  selectedOverlay.id,
                  { scaleY: clamp(value, 0.25, 4) },
                  `overlay-scale:${selectedOverlay.id}`
                )
              }
            />
          </div>
          <section className="text-style-presets" aria-label="텍스트 스타일 프리셋">
            <div className="section-label">
              <span>스타일 프리셋</span>
              <small>한 번에 적용</small>
            </div>
            <div className="text-preset-grid">
              {textOverlayStylePresets.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() =>
                    onUpdate(
                      selectedOverlay.id,
                      preset.patch,
                      `overlay-preset:${selectedOverlay.id}:${preset.id}`
                    )
                  }
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.tone}</span>
                </button>
              ))}
            </div>
          </section>
          <div className="text-decoration-panel">
            <FontWeightSelect
              family={selectedOverlay.fontFamily}
              fonts={fonts}
              value={selectedOverlay.fontWeight ?? defaultTextOverlay.fontWeight}
              onChange={(fontWeight) =>
                onUpdate(
                  selectedOverlay.id,
                  { fontWeight },
                  `overlay-weight:${selectedOverlay.id}`
                )
              }
            />
            <div className="align-row" aria-label="텍스트 정렬">
              {(['left', 'center', 'right'] as TextAlign[]).map((align) => (
                <button
                  type="button"
                  key={align}
                  className={
                    (selectedOverlay.align ?? defaultTextOverlay.align) === align ? 'active' : ''
                  }
                  onClick={() =>
                    onUpdate(selectedOverlay.id, { align }, `overlay-align:${selectedOverlay.id}`)
                  }
                >
                  {align === 'left' && <AlignLeft size={16} />}
                  {align === 'center' && <AlignCenter size={16} />}
                  {align === 'right' && <AlignRight size={16} />}
                </button>
              ))}
            </div>
            <div className="text-toggle-row">
              <button
                type="button"
                className={selectedOverlay.italic ? 'active' : ''}
                onClick={() =>
                  onUpdate(
                    selectedOverlay.id,
                    { italic: !selectedOverlay.italic },
                    `overlay-italic:${selectedOverlay.id}`
                  )
                }
              >
                I
              </button>
              <button
                type="button"
                className={selectedOverlay.underline ? 'active' : ''}
                onClick={() =>
                  onUpdate(
                    selectedOverlay.id,
                    { underline: !selectedOverlay.underline },
                    `overlay-underline:${selectedOverlay.id}`
                  )
                }
              >
                U
              </button>
            </div>
          </div>
          <StyleControls
            style={selectedOverlay}
            fonts={fonts}
            onChange={(patch) =>
              onUpdate(selectedOverlay.id, patch, `overlay-style:${selectedOverlay.id}`)
            }
          />
        </div>
      )}
    </div>
  );
}

function EffectPanel({
  effects,
  selectedEffect,
  onSelect,
  onSeek,
  onUpdate,
  onUpdateTime
}: {
  effects: InteractionEffect[];
  selectedEffect: InteractionEffect | null | undefined;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onUpdate: (id: string, patch: Partial<InteractionEffect>, groupKey?: string) => void;
  onUpdateTime: (id: string, key: 'start' | 'end', value: number) => void;
}) {
  return (
    <div className="panel-body">
      <div className="item-list">
        {effects.length === 0 && <p className="empty-copy">효과 없음</p>}
        {effects.map((effect, index) => (
          <button
            type="button"
            key={effect.id}
            className={selectedEffect?.id === effect.id ? 'item-card active' : 'item-card'}
            onClick={() => {
              onSelect(effect.id);
              onSeek(effect.start);
            }}
          >
            <span>{index + 1}</span>
            <strong>{effect.label || effectName(effect.kind)}</strong>
            <small>
              {formatClock(effect.start)} - {formatClock(effect.end)}
            </small>
          </button>
        ))}
      </div>

      {selectedEffect && (
        <div className="inspector">
          <Segmented
            label="효과"
            value={selectedEffect.kind}
            options={[
              ['tap', '터치 링'],
              ['click', '클릭 점'],
              ['pulse', '펄스'],
              ['spotlight', '스포트'],
              ['swipe', '스와이프'],
              ['target', '타겟'],
              ['cursor', '클릭 포인터'],
              ['finger', '손가락']
            ]}
            onChange={(value) => {
              const kind = value as InteractionEffectKind;
              onUpdate(selectedEffect.id, {
                kind,
                ...interactionEffectPresets[kind],
                ...(isArtworkEffect(kind)
                  ? { end: selectedEffect.start + ONE_SHOT_EFFECT_DURATION }
                  : {})
              });
            }}
          />
          <label>
            라벨
            <input
              type="text"
              value={selectedEffect.label}
              placeholder="선택 사항"
              onChange={(event) =>
                onUpdate(
                  selectedEffect.id,
                  { label: event.target.value },
                  `effect-label:${selectedEffect.id}`
                )
              }
            />
          </label>
          <div className="field-grid two">
            <NumberField
              label="시작"
              value={selectedEffect.start}
              step={0.05}
              onChange={(value) => onUpdateTime(selectedEffect.id, 'start', value)}
            />
            <NumberField
              label="종료"
              value={selectedEffect.end}
              step={0.05}
              onChange={(value) => onUpdateTime(selectedEffect.id, 'end', value)}
            />
          </div>
          <div className="field-grid two">
            <NumberField
              label="X"
              value={selectedEffect.x}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                onUpdate(selectedEffect.id, { x: value }, `effect-position:${selectedEffect.id}`)
              }
            />
            <NumberField
              label="Y"
              value={selectedEffect.y}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                onUpdate(selectedEffect.id, { y: value }, `effect-position:${selectedEffect.id}`)
              }
            />
          </div>
          <div className="field-grid two">
            <NumberField
              label="크기"
              value={selectedEffect.size}
              min={24}
              max={260}
              step={1}
              onChange={(value) =>
                onUpdate(selectedEffect.id, { size: value }, `effect-style:${selectedEffect.id}`)
              }
            />
            <label>
              색상
              <input
                type="color"
                value={toColorInput(selectedEffect.color)}
                onChange={(event) =>
                  onUpdate(
                    selectedEffect.id,
                    { color: event.target.value },
                    `effect-style:${selectedEffect.id}`
                  )
                }
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function FontWeightSelect({
  family,
  fonts,
  value,
  onChange
}: {
  family: string;
  fonts: AppFontAsset[];
  value: number;
  onChange: (fontWeight: number) => void;
}) {
  const availableWeights = new Set(
    fonts
      .filter((font) => font.family === family)
      .map((font) => font.weight)
  );

  return (
    <label>
      굵기
      <select
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {fontWeightOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} · {option.label}
            {availableWeights.has(option.value) ? ' · 파일 있음' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function StyleControls({
  style,
  fonts,
  onChange
}: {
  style: Pick<
    CaptionStyle,
    | 'fontFamily'
    | 'fontSize'
    | 'color'
    | 'background'
    | 'outlineColor'
    | 'outlineWidth'
    | 'shadow'
  >;
  fonts: AppFontAsset[];
  onChange: (
    patch: Partial<
      Pick<
        CaptionStyle,
        | 'fontFamily'
        | 'fontSize'
        | 'color'
        | 'background'
        | 'outlineColor'
        | 'outlineWidth'
        | 'shadow'
      >
    >
  ) => void;
}) {
  const fontOptions = getFontFamilyOptions(fonts, style.fontFamily);
	  const backgroundOpacity = getCssOpacity(style.background, 1);
	  const backgroundEnabled = backgroundOpacity > 0.01;
	  const backgroundColor = toColorInput(style.background, '#101216');
	  const outlineEnabled = style.outlineWidth > 0;

	  return (
	    <div className="style-controls">
      <label className="wide-field">
        폰트
        <select
          value={style.fontFamily}
          onChange={(event) => onChange({ fontFamily: event.target.value })}
        >
          {fontOptions.map((font) => (
            <option key={font.family} value={font.family}>
              {font.displayName}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label="크기"
        value={style.fontSize}
        min={18}
        max={180}
        step={1}
        onChange={(fontSize) => onChange({ fontSize })}
      />
      <label>
        글자색
        <input
          type="color"
          value={toColorInput(style.color)}
	          onChange={(event) => onChange({ color: event.target.value })}
	        />
	      </label>
	      <div className={`style-option-card wide-field ${backgroundEnabled ? '' : 'is-off'}`}>
	        <label className="switch-row">
	          <input
	            type="checkbox"
	            checked={backgroundEnabled}
	            onChange={(event) =>
	              onChange({
	                background: withCssOpacity(
	                  backgroundColor,
	                  event.target.checked ? Math.max(backgroundOpacity, 0.5) : 0
	                )
	              })
	            }
	          />
	          <span>
	            배경
	            <small>텍스트 뒤 색상 박스</small>
	          </span>
	        </label>
	        <div className="field-grid two">
	          <label>
	            색상
	            <input
	              type="color"
	              value={backgroundColor}
	              disabled={!backgroundEnabled}
	              onChange={(event) =>
	                onChange({
	                  background: withCssOpacity(
	                    event.target.value,
	                    Math.max(backgroundOpacity, 0.5)
	                  )
	                })
	              }
	            />
	          </label>
	          <label className="range-field">
	            투명도
	            <span>{Math.round(backgroundOpacity * 100)}%</span>
	            <input
	              type="range"
	              min={0}
	              max={1}
	              step={0.05}
	              value={backgroundOpacity}
	              disabled={!backgroundEnabled}
	              onChange={(event) =>
	                onChange({
	                  background: withCssOpacity(backgroundColor, Number(event.target.value))
	                })
	              }
	            />
	          </label>
	        </div>
	      </div>
	      <div className={`style-option-card wide-field ${outlineEnabled ? '' : 'is-off'}`}>
	        <label className="switch-row">
	          <input
	            type="checkbox"
	            checked={outlineEnabled}
	            onChange={(event) =>
	              onChange({ outlineWidth: event.target.checked ? Math.max(style.outlineWidth, 2) : 0 })
	            }
	          />
	          <span>
	            외곽선
	            <small>영상 위 가독성 보정</small>
	          </span>
	        </label>
	        <div className="field-grid two">
	          <label>
	            색상
	            <input
	              type="color"
	              value={toColorInput(style.outlineColor, '#101216')}
	              disabled={!outlineEnabled}
	              onChange={(event) => onChange({ outlineColor: event.target.value })}
	            />
	          </label>
	          <NumberField
	            label="두께"
	            value={style.outlineWidth}
	            min={0}
	            max={10}
	            step={1}
	            disabled={!outlineEnabled}
	            onChange={(outlineWidth) => onChange({ outlineWidth })}
	          />
	        </div>
	      </div>
	      <label className="toggle-field">
	        <input
	          type="checkbox"
          checked={style.shadow}
          onChange={(event) => onChange({ shadow: event.target.checked })}
        />
        그림자
      </label>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-field">
      <span>{label}</span>
      <div>
        {options.map(([optionValue, optionLabel]) => (
          <button
            type="button"
            key={optionValue}
            className={value === optionValue ? 'active' : ''}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function removeTimedRangeItems<T extends { start: number; end: number }>(
  items: T[],
  start: number,
  end: number
) {
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  const removedDuration = rangeEnd - rangeStart;

  return items.flatMap((item) => {
    if (item.end <= rangeStart) return [item];
    if (item.start >= rangeEnd) {
      return [
        {
          ...item,
          start: item.start - removedDuration,
          end: item.end - removedDuration
        }
      ];
    }
    if (item.start >= rangeStart && item.end <= rangeEnd) return [];

    const nextStart = item.start < rangeStart ? item.start : rangeStart;
    const nextEnd = item.end > rangeEnd ? item.end - removedDuration : rangeStart;
    if (nextEnd - nextStart < MIN_CUE_DURATION) return [];

    return [
      {
        ...item,
        start: nextStart,
        end: nextEnd
      }
    ];
  });
}

function removeAudioRangeItems(items: AudioClip[], start: number, end: number) {
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  const removedDuration = rangeEnd - rangeStart;

  return items.flatMap((item) => {
    if (item.end <= rangeStart) return [item];
    if (item.start >= rangeEnd) {
      return [{ ...item, start: item.start - removedDuration, end: item.end - removedDuration }];
    }
    if (item.start >= rangeStart && item.end <= rangeEnd) return [];

    const overlapStart = Math.max(item.start, rangeStart);
    const nextStart = item.start < rangeStart ? item.start : rangeStart;
    const nextEnd = item.end > rangeEnd ? item.end - removedDuration : rangeStart;
    if (nextEnd - nextStart < MIN_CUE_DURATION) return [];

    return [
      {
        ...item,
        start: nextStart,
        end: nextEnd,
        sourceStart: item.sourceStart + Math.max(0, overlapStart - item.start),
        sourceEnd: item.sourceStart + Math.max(0, overlapStart - item.start) + (nextEnd - nextStart)
      }
    ];
  });
}

function timelineClipTitle(kind: string, label: string, start: number, end: number) {
  return `${kind}: ${label} (${formatClock(start)} - ${formatClock(end)})`;
}

function getClipThumbnailCount(
  start: number,
  end: number,
  pxPerSecond: number,
  thumbnailHeight = 24
) {
  const width = Math.max(TIMELINE_MIN_ITEM_WIDTH, (end - start) * pxPerSecond);
  if (width < 96) return 0;
  const targetCellWidth = clamp(
    thumbnailHeight * (16 / 9),
    TIMELINE_THUMBNAIL_TARGET_CELL_WIDTH,
    190
  );
  return Math.max(2, Math.min(18, Math.ceil(width / targetCellWidth)));
}

function getClipThumbnailStrip(
  thumbnails: TimelineThumbnail[],
  clip: VideoClip,
  count: number
) {
  if (count <= 0 || thumbnails.length === 0) return [];

  const sourceStart = Math.max(0, clip.sourceStart);
  const sourceEnd = Math.max(sourceStart + MIN_CUE_DURATION, clip.sourceEnd);
  const sourceDuration = sourceEnd - sourceStart;

  return Array.from({ length: count }).flatMap((_, index) => {
    const targetTime = sourceStart + ((index + 0.5) / count) * sourceDuration;
    const thumbnail = getNearestThumbnail(thumbnails, targetTime);
    return thumbnail ? [thumbnail] : [];
  });
}

function getNearestThumbnail(thumbnails: TimelineThumbnail[], time: number) {
  return thumbnails.reduce<TimelineThumbnail | null>((closest, thumbnail) => {
    if (!closest) return thumbnail;
    return Math.abs(thumbnail.time - time) < Math.abs(closest.time - time)
      ? thumbnail
      : closest;
  }, null);
}

function getTimelineTrackHeight(laneCount: number) {
  return Math.max(46, laneCount * TIMELINE_ITEM_LANE_HEIGHT + TIMELINE_ITEM_TOP_PADDING * 2);
}

function getVideoClipMetrics(laneHeight: number) {
  const itemHeight = Math.max(20, laneHeight - 6);
  const metaHeight = clamp(Math.round(itemHeight * 0.28), 22, 34);
  const waveHeight = clamp(Math.round(itemHeight * 0.08), 6, 12);
  const thumbnailHeight = Math.max(14, itemHeight - metaHeight - waveHeight);

  return { thumbnailHeight, metaHeight, waveHeight };
}

function renderAudioWaveformBars(waveform: AudioWaveform) {
  const bars = waveform.length > 0
    ? waveform.slice(0, 32)
    : Array.from({ length: 18 }, (_, index) => 0.34 + ((index * 7) % 11) / 22);

  return bars.map((value, index) => (
    <span key={index} style={{ height: `${clamp(value, 0.12, 1) * 100}%` }} />
  ));
}

function clampTimedRange(start: number, end: number, duration: number) {
  const itemDuration = Math.max(MIN_CUE_DURATION, end - start);
  const safeStart = clamp(start, 0, Math.max(0, duration - itemDuration));

  return {
    start: safeStart,
    end: safeStart + itemDuration,
    snapped: false,
    snapTime: safeStart
  };
}

function getTimelineSelectionSummary(
  selection: Selection,
  clipRanges: ReturnType<typeof getClipTimelineRanges>,
  audioClips: AudioClip[],
  audioSourceMap: Map<string, AudioSourceMeta>,
  cues: CaptionCue[],
  overlays: TextOverlay[],
  effects: InteractionEffect[]
) {
  if (!selection) return '선택 없음';

  if (selection.kind === 'clip') {
    const range = clipRanges.find((item) => item.clip.id === selection.id);
    return range
      ? `영상 조각 ${range.index + 1} · ${formatClock(range.start)} - ${formatClock(range.end)}`
      : '영상 조각';
  }

  if (selection.kind === 'sourceAudio') {
    const range = clipRanges.find((item) => item.clip.id === selection.id);
    return range
      ? `원본 오디오 ${range.index + 1} · ${formatClock(range.start)} - ${formatClock(range.end)}`
      : '원본 오디오';
  }

  if (selection.kind === 'cue') {
    const cue = cues.find((item) => item.id === selection.id);
    return cue ? `자막 · ${formatClock(cue.start)} - ${formatClock(cue.end)}` : '자막';
  }

  if (selection.kind === 'overlay') {
    const overlay = overlays.find((item) => item.id === selection.id);
    return overlay
      ? `텍스트 · ${formatClock(overlay.start)} - ${formatClock(overlay.end)}`
      : '텍스트';
  }

  if (selection.kind === 'audio') {
    const clip = audioClips.find((item) => item.id === selection.id);
    const source = clip ? audioSourceMap.get(clip.sourceId) : null;
    return clip
      ? `오디오 · ${clip.label || source?.name || '오디오'} · ${formatClock(clip.start)} - ${formatClock(clip.end)}`
      : '오디오';
  }

  const effect = effects.find((item) => item.id === selection.id);
  return effect ? `효과 · ${formatClock(effect.start)} - ${formatClock(effect.end)}` : '효과';
}

function getVideoClipPreviewVolume(
  range: ReturnType<typeof getClipTimelineRanges>[number],
  time: number
) {
  if (range.clip.muted) return 0;
  const localTime = clamp(time - range.start, 0, range.outputDuration);
  return clamp(
    normalizeAudioVolume(range.clip.volume) *
      getFadeMultiplier(localTime, range.outputDuration, range.clip.fadeIn, range.clip.fadeOut),
    0,
    1
  );
}

function getAudioClipPreviewVolume(clip: AudioClip, time: number) {
  if (clip.muted) return 0;
  const duration = getAudioClipDuration(clip);
  const localTime = clamp(time - clip.start, 0, duration);
  return clamp(
    normalizeAudioVolume(clip.volume) *
      getFadeMultiplier(localTime, duration, clip.fadeIn, clip.fadeOut),
    0,
    1
  );
}

function getFadeMultiplier(
  localTime: number,
  duration: number,
  fadeIn?: number,
  fadeOut?: number
) {
  const inDuration = normalizeAudioFade(fadeIn, duration);
  const outDuration = normalizeAudioFade(fadeOut, duration);
  const inMultiplier = inDuration > 0 ? clamp(localTime / inDuration, 0, 1) : 1;
  const outMultiplier =
    outDuration > 0 ? clamp((duration - localTime) / outDuration, 0, 1) : 1;
  return Math.min(inMultiplier, outMultiplier);
}

function isTextEditingElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

function isTimelineInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      '.timeline-item, .clip-trim-handle, .timed-trim-handle, .timeline-track-resize-handle, .timeline-lane-resize-handle, .playhead, .timeline-transition, .timeline-snap-guide, .clip-reorder-guide, .timeline-cut-marker'
    )
  );
}

function getThumbnailStepForRange(start: number, end: number) {
  const range = Math.max(1, end - start);
  return clamp(range / 24, 1, 20);
}

function getThumbnailCacheKey(time: number) {
  return Number(time.toFixed(2));
}

function pruneThumbnailCache(cache: Map<number, TimelineThumbnail>, desiredTimes: number[]) {
  if (cache.size <= 140) return;

  const keep = new Set(desiredTimes.map(getThumbnailCacheKey));
  for (const key of cache.keys()) {
    if (!keep.has(key)) {
      cache.delete(key);
    }
  }
}

async function generateTimelineThumbnails(videoUrl: string, times: number[]) {
  if (typeof document === 'undefined') return [];
  if (times.length === 0) return [];

  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;
  video.load();

  try {
    if (video.readyState < 1) {
      await waitForMediaEvent(video, 'loadedmetadata', 4000);
    }

    if (video.readyState < 2) {
      await waitForMediaEvent(video, 'loadeddata', 4000).catch(() => undefined);
    }

    const canvas = document.createElement('canvas');
    canvas.width = TIMELINE_THUMBNAIL_WIDTH;
    canvas.height = TIMELINE_THUMBNAIL_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) return [];

    const thumbnails: TimelineThumbnail[] = [];

    for (const time of times.slice(0, TIMELINE_MAX_THUMBNAILS)) {
      await seekVideoForThumbnail(video, time);
      drawVideoThumbnailFrame(video, context, canvas.width, canvas.height);

      thumbnails.push({
        time,
        url: canvas.toDataURL('image/jpeg', TIMELINE_THUMBNAIL_QUALITY)
      });
    }

    return thumbnails;
  } catch {
    return [];
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function seekVideoForThumbnail(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.03 && video.readyState >= 2) return;

  const seeked = waitForMediaEvent(video, 'seeked', 2500).catch(() => undefined);
  video.currentTime = time;
  await seeked;
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: string,
  timeoutMs: number
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    const handleEvent = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error(`Media failed while waiting for ${eventName}`));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      media.removeEventListener(eventName, handleEvent);
      media.removeEventListener('error', handleError);
    };

    media.addEventListener(eventName, handleEvent, { once: true });
    media.addEventListener('error', handleError, { once: true });
  });
}

function drawVideoThumbnailFrame(
  video: HTMLVideoElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;

  context.clearRect(0, 0, width, height);
  context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
}

function formatTimelineTick(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);

  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(file.name);
}

function isAudioFile(file: File) {
  return file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac|aiff)$/i.test(file.name);
}

async function readAudioDuration(file: File) {
  if (typeof document === 'undefined') return 0;

  const audio = document.createElement('audio');
  const url = URL.createObjectURL(file);
  audio.preload = 'metadata';
  audio.src = url;

  try {
    await waitForMediaEvent(audio, 'loadedmetadata', 3000);
    return Number.isFinite(audio.duration) ? audio.duration : 0;
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

async function generateAudioWaveform(file: File): Promise<AudioWaveform> {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return [];

  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const samples = 32;
    const blockSize = Math.max(1, Math.floor(channel.length / samples));

    return Array.from({ length: samples }, (_, index) => {
      const start = index * blockSize;
      let sum = 0;
      for (let offset = 0; offset < blockSize && start + offset < channel.length; offset += 1) {
        sum += Math.abs(channel[start + offset]);
      }
      return clamp(sum / blockSize * 3.2, 0.12, 1);
    });
  } finally {
    await context.close().catch(() => undefined);
  }
}

function doesFileMatchAudioSource(file: File, source: AudioSourceMeta) {
  const nameMatches = file.name === source.name;
  const sizeMatches = source.size <= 0 || file.size === source.size;
  const modifiedMatches =
    source.lastModified <= 0 || Math.abs(file.lastModified - source.lastModified) < 2000;

  return nameMatches && sizeMatches && modifiedMatches;
}

function getFontFamilyOptions(fonts: AppFontAsset[], currentFamily: string) {
  const grouped = new Map<
    string,
    { family: string; displayName: string; variantCount: number; source: AppFontAsset['source'] }
  >();

  fonts.forEach((font) => {
    const current = grouped.get(font.family);
    grouped.set(font.family, {
      family: font.family,
      displayName: font.family === builtinPreviewFontFamily ? font.displayName : font.family,
      variantCount: (current?.variantCount ?? 0) + 1,
      source: current?.source === 'builtin' ? 'builtin' : font.source
    });
  });

  if (currentFamily && !grouped.has(currentFamily)) {
    grouped.set(currentFamily, {
      family: currentFamily,
      displayName: `${currentFamily} 파일 필요`,
      variantCount: 0,
      source: 'local'
    });
  }

  return Array.from(grouped.values()).map((font) => ({
    family: font.family,
    displayName:
      font.variantCount > 1
        ? `${font.displayName} (${font.variantCount} weights)`
        : font.displayName
  }));
}

function getFontFamilyGroups(fonts: AppFontAsset[]) {
  const grouped = new Map<string, AppFontAsset[]>();

  fonts.forEach((font) => {
    const current = grouped.get(font.family) ?? [];
    current.push(font);
    grouped.set(font.family, current);
  });

  return Array.from(grouped.entries())
    .map(([family, variants]) => {
      const sortedVariants = [...variants].sort((a, b) => {
        if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
        if (a.weight !== b.weight) return a.weight - b.weight;
        return a.style.localeCompare(b.style);
      });
      const first = sortedVariants[0];

      return {
        family,
        displayName: first?.source === 'builtin' ? first.displayName : family,
        variants: sortedVariants
      };
    })
    .sort((a, b) => {
      const aBuiltin = a.variants.some((font) => font.source === 'builtin');
      const bBuiltin = b.variants.some((font) => font.source === 'builtin');
      if (aBuiltin !== bBuiltin) return aBuiltin ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

function mergeFontAssets(previous: AppFontAsset[], imported: AppFontAsset[]) {
  const next = [...previous];

  imported.forEach((fontAsset) => {
    const existingIndex = next.findIndex(
      (asset) =>
        asset.family === fontAsset.family &&
        asset.weight === fontAsset.weight &&
        asset.style === fontAsset.style &&
        asset.source === fontAsset.source
    );

    if (existingIndex >= 0) {
      next[existingIndex] = fontAsset;
    } else {
      next.push(fontAsset);
    }
  });

  return next;
}

function choosePreferredImportedFont(imported: AppFontAsset[]) {
  return (
    imported.find((font) => font.weight === 400 && font.style === 'normal') ??
    imported.find((font) => font.style === 'normal') ??
    imported[0]
  );
}

function snapPreviewPosition(x: number, y: number) {
  let nextX = clamp(x, 0, 100);
  let nextY = clamp(y, 0, 100);
  const guide: NonNullable<PreviewGuideState> = { label: '' };
  const centerThreshold = 2;
  const safeThreshold = 1.5;

  if (Math.abs(nextX - 50) <= centerThreshold) {
    nextX = 50;
    guide.vertical = 50;
  } else if (Math.abs(nextX - 10) <= safeThreshold) {
    nextX = 10;
    guide.vertical = 10;
  } else if (Math.abs(nextX - 90) <= safeThreshold) {
    nextX = 90;
    guide.vertical = 90;
  }

  if (Math.abs(nextY - 50) <= centerThreshold) {
    nextY = 50;
    guide.horizontal = 50;
  } else if (Math.abs(nextY - 10) <= safeThreshold) {
    nextY = 10;
    guide.horizontal = 10;
  } else if (Math.abs(nextY - 90) <= safeThreshold) {
    nextY = 90;
    guide.horizontal = 90;
  }

  if (guide.vertical === 50 && guide.horizontal === 50) {
    guide.label = '정중앙 스냅';
  } else if (guide.vertical === 50) {
    guide.label = '가로 중앙 스냅';
  } else if (guide.horizontal === 50) {
    guide.label = '세로 중앙 스냅';
  } else if (guide.vertical !== undefined || guide.horizontal !== undefined) {
    guide.label = '안전 영역 스냅';
  }

  return {
    x: nextX,
    y: nextY,
    guide: guide.label ? guide : null
  };
}

function createProjectMediaMeta(
  file: File,
  details?: { duration?: number; width?: number; height?: number }
): ProjectMediaMeta {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    ...(details?.duration !== undefined ? { duration: details.duration } : {}),
    ...(details?.width !== undefined ? { width: details.width } : {}),
    ...(details?.height !== undefined ? { height: details.height } : {})
  };
}

function doesFileMatchProjectMedia(
  file: File | null,
  expectedMeta?: ProjectMediaMeta,
  fallbackName?: string | null
) {
  if (!file) return false;
  if (!expectedMeta) return fallbackName ? file.name === fallbackName : true;

  const nameMatches = file.name === expectedMeta.name;
  const sizeMatches = expectedMeta.size <= 0 || file.size === expectedMeta.size;
  const modifiedMatches =
    expectedMeta.lastModified <= 0 ||
    Math.abs(file.lastModified - expectedMeta.lastModified) < 2000;

  return nameMatches && sizeMatches && modifiedMatches;
}

function getMediaRelinkMessage(
  file: File,
  expectedMeta: ProjectMediaMeta | null,
  fallbackName: string | null
) {
  if (!expectedMeta) {
    return fallbackName && file.name !== fallbackName
      ? `${file.name} 연결됨. 저장된 원본명은 ${fallbackName}이라 결과가 다를 수 있습니다.`
      : null;
  }

  const issues = [
    file.name !== expectedMeta.name ? '파일명' : '',
    expectedMeta.size > 0 && file.size !== expectedMeta.size ? '크기' : '',
    expectedMeta.lastModified > 0 &&
    Math.abs(file.lastModified - expectedMeta.lastModified) >= 2000
      ? '수정일'
      : ''
  ].filter(Boolean);

  return issues.length > 0
    ? `${file.name} 연결됨. 저장된 원본(${expectedMeta.name})과 ${issues.join(
        '/'
      )}이 달라 결과가 다를 수 있습니다.`
    : null;
}

async function detectVideoHasAudio(file: File): Promise<boolean | null> {
  if (typeof document === 'undefined') return null;

  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.preload = 'metadata';
  video.muted = true;
  video.src = url;

  try {
    await waitForMediaEvent(video, 'loadedmetadata', 3000);
    const media = video as HTMLVideoElement & {
      mozHasAudio?: boolean;
      webkitAudioDecodedByteCount?: number;
      audioTracks?: { length: number };
    };

    if (typeof media.audioTracks?.length === 'number') {
      return media.audioTracks.length > 0;
    }
    if (typeof media.mozHasAudio === 'boolean') {
      return media.mozHasAudio;
    }
    if (typeof media.webkitAudioDecodedByteCount === 'number') {
      return media.webkitAudioDecodedByteCount > 0 ? true : null;
    }

    return null;
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function formatExportPreflightNote(messages: string[], risk: 'low' | 'medium' | 'high') {
  if (messages.length === 0) return '';
  const label = risk === 'high' ? '위험 높음' : risk === 'medium' ? '주의' : '점검';
  return `${label}: ${messages[0]}`;
}

function compactFfmpegLog(message: string) {
  return message.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function downloadText(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function writeAutosaveVideoFile(file: File) {
  const db = await openAutosaveVideoDb();

  try {
    const transaction = db.transaction(AUTOSAVE_VIDEO_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(AUTOSAVE_VIDEO_STORE_NAME);
    const done = idbTransactionDone(transaction);
    const record: AutosaveVideoRecord = {
      file,
      savedAt: new Date().toISOString()
    };

    await idbRequest(store.put(record, AUTOSAVE_VIDEO_KEY));
    await done;
  } finally {
    db.close();
  }
}

async function readAutosaveVideoFile() {
  const db = await openAutosaveVideoDb();

  try {
    const transaction = db.transaction(AUTOSAVE_VIDEO_STORE_NAME, 'readonly');
    const store = transaction.objectStore(AUTOSAVE_VIDEO_STORE_NAME);
    const value = await idbRequest<unknown>(store.get(AUTOSAVE_VIDEO_KEY));

    if (value instanceof File) return value;
    if (isAutosaveVideoRecord(value)) return value.file;
    return null;
  } finally {
    db.close();
  }
}

async function clearAutosaveVideoFile() {
  const db = await openAutosaveVideoDb();

  try {
    const transaction = db.transaction(AUTOSAVE_VIDEO_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(AUTOSAVE_VIDEO_STORE_NAME);
    const done = idbTransactionDone(transaction);
    await idbRequest(store.delete(AUTOSAVE_VIDEO_KEY));
    await done;
  } finally {
    db.close();
  }
}

function openAutosaveVideoDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB를 사용할 수 없습니다.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTOSAVE_VIDEO_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_VIDEO_STORE_NAME)) {
        db.createObjectStore(AUTOSAVE_VIDEO_STORE_NAME);
      }
    };

    request.onerror = () => reject(request.error ?? new Error('영상 자동 저장 DB를 열지 못했습니다.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청에 실패했습니다.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function idbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB 트랜잭션이 취소되었습니다.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB 트랜잭션에 실패했습니다.'));
    transaction.oncomplete = () => resolve();
  });
}

function isAutosaveVideoRecord(value: unknown): value is AutosaveVideoRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'file' in value &&
    (value as { file?: unknown }).file instanceof File
  );
}

async function chooseMp4SaveTarget(defaultFileName: string): Promise<Mp4SaveTarget | null> {
  const fileName = ensureMp4FileName(defaultFileName);
  const savePicker = (window as WindowWithSaveFilePicker).showSaveFilePicker;

  if (typeof savePicker === 'function') {
    try {
      const handle = await savePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'MP4 video',
            accept: {
              'video/mp4': ['.mp4']
            }
          }
        ]
      });

      return {
        kind: 'file-system',
        fileName: ensureMp4FileName(handle.name || fileName),
        handle
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }

      throw error;
    }
  }

  const fallbackName = window.prompt('저장할 MP4 파일 이름을 입력하세요.', fileName);
  if (fallbackName === null) return null;

  return {
    kind: 'download',
    fileName: ensureMp4FileName(fallbackName)
  };
}

async function writeBlobToFileHandle(handle: FileSystemFileHandleLike, blob: Blob) {
  const writable = await handle.createWritable();

  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

function triggerBlobDownload(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
}

function ensureMp4FileName(value: string) {
  const baseName = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+$/, '');
  const safeName = baseName || 'edit-studio-output';

  return /\.mp4$/i.test(safeName) ? safeName : `${safeName}.mp4`;
}

function shiftTimelineItemsToClip<T extends { start: number; end: number }>(
  items: T[],
  rangeStart: number,
  rangeEnd: number
) {
  const clipDuration = Math.max(0, rangeEnd - rangeStart);

  return items
    .filter((item) => item.start < rangeEnd && item.end > rangeStart)
    .map((item) => {
      const start = clamp(item.start - rangeStart, 0, clipDuration);
      const end = clamp(Math.min(item.end, rangeEnd) - rangeStart, 0, clipDuration);

      return {
        ...item,
        start,
        end
      };
    })
    .filter((item) => item.end - item.start >= 0.03);
}

function shiftAudioClipsToClip(
  items: AudioClip[],
  rangeStart: number,
  rangeEnd: number
) {
  const clipDuration = Math.max(0, rangeEnd - rangeStart);

  return items
    .filter((item) => item.start < rangeEnd && item.end > rangeStart)
    .map((item) => {
      const overlapStart = Math.max(item.start, rangeStart);
      const overlapEnd = Math.min(item.end, rangeEnd);
      const start = clamp(overlapStart - rangeStart, 0, clipDuration);
      const end = clamp(overlapEnd - rangeStart, 0, clipDuration);
      const sourceStart = item.sourceStart + Math.max(0, overlapStart - item.start);

      return {
        ...item,
        start,
        end,
        sourceStart,
        sourceEnd: sourceStart + Math.max(0, overlapEnd - overlapStart)
      };
    })
    .filter((item) => item.end - item.start >= 0.03);
}

function toColorInput(value: string, fallback = '#ffffff') {
  return parseCssColorInput(value)?.hex ?? fallback;
}

function getCssOpacity(value: string, fallback = 1) {
  return parseCssColorInput(value)?.opacity ?? fallback;
}

function withCssOpacity(value: string, opacity: number) {
  const parsed = parseCssColorInput(value) ?? parseCssColorInput('#000000');
  const alpha = clamp(opacity, 0, 1);
  if (!parsed) return `rgba(0, 0, 0, ${formatCssAlpha(alpha)})`;

  return `rgba(${parsed.red}, ${parsed.green}, ${parsed.blue}, ${formatCssAlpha(alpha)})`;
}

function parseCssColorInput(value: string) {
  const trimmed = value.trim();
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(trimmed);
  if (hex6) {
    return {
      hex: trimmed.toLowerCase(),
      red: parseInt(hex6[1], 16),
      green: parseInt(hex6[2], 16),
      blue: parseInt(hex6[3], 16),
      opacity: 1
    };
  }

  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
  if (hex3) {
    const hex = `#${hex3
      .slice(1)
      .map((channel) => channel + channel)
      .join('')}`.toLowerCase();

    return parseCssColorInput(hex);
  }

  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    trimmed
  );
  if (!rgba) return null;

  const red = Math.round(clamp(Number(rgba[1]), 0, 255));
  const green = Math.round(clamp(Number(rgba[2]), 0, 255));
  const blue = Math.round(clamp(Number(rgba[3]), 0, 255));

  return {
    hex: `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`,
    red,
    green,
    blue,
    opacity: clamp(Number(rgba[4] ?? 1), 0, 1)
  };
}

function formatCssAlpha(value: number) {
  return clamp(value, 0, 1)
    .toFixed(2)
    .replace(/0+$/g, '')
    .replace(/\.$/, '');
}

function getExportPhaseFromStatus(message: string): ExportPhase {
  if (
    message.includes('FFmpeg') ||
    message.includes('worker') ||
    message.includes('wasm')
  ) {
    return 'engine';
  }
  if (message.includes('렌더 파일') || message.includes('만드는 중')) return 'finalize';
  if (message.includes('메모리') || message.includes('파일')) return 'prepare';
  if (message.includes('필터') || message.includes('전환')) return 'filters';
  if (message.includes('렌더링')) return 'render';
  return 'prepare';
}

function effectName(kind: InteractionEffectKind) {
  const names: Record<InteractionEffectKind, string> = {
    tap: '터치 링',
    click: '클릭 점',
    pulse: '소프트 펄스',
    spotlight: '스포트라이트',
    swipe: '스와이프',
    target: '타겟 포커스',
    cursor: '클릭 포인터',
    finger: '손가락 터치'
  };

  return names[kind];
}

function transitionPreviewStyle(kind: ClipTransitionKind, progress: number): CSSProperties {
  const remaining = (1 - clamp(progress, 0, 1)) * 18;
  const transforms: Record<ClipTransitionKind, string> = {
    fade: 'translate(0, 0)',
    slideleft: `translateX(${remaining}%)`,
    slideright: `translateX(${-remaining}%)`,
    slideup: `translateY(${remaining}%)`,
    slidedown: `translateY(${-remaining}%)`
  };

  return {
    opacity: clamp(progress, 0, 1),
    transform: transforms[kind]
  };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function getStoredPreviewSize(): PreviewSize {
  if (typeof localStorage === 'undefined') return 'medium';
  const value = localStorage.getItem(PREVIEW_SIZE_KEY);
  return value === 'small' || value === 'medium' || value === 'large' || value === 'fill'
    ? value
    : 'medium';
}
