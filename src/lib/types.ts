export type CaptionPosition = 'bottom' | 'middle' | 'top';
export type TextAlign = 'left' | 'center' | 'right';
export type ExportPreset = 'fast720' | 'hd1080' | 'source' | 'shorts1080' | 'custom';
export type AudioSourceKind = 'music' | 'effect';
export type MediaSourceKind = 'video' | 'image' | 'audio';
export type CanvasAspectPreset = 'source' | '16:9' | '9:16' | '1:1' | 'custom';
export type KeyframeTargetKind = 'video' | 'overlay' | 'effect' | 'audio';
export type KeyframeProperty =
  | 'x'
  | 'y'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'size'
  | 'volume';
export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type ClipTransitionKind =
  | 'fade'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown';
export type InteractionEffectKind =
  | 'tap'
  | 'click'
  | 'pulse'
  | 'spotlight'
  | 'swipe'
  | 'target'
  | 'cursor'
  | 'finger';

export const builtinPreviewFontFamily = 'AppleGothicLocal';
export const builtinExportFontFamily = 'AppleGothic';
export const primaryVideoSourceId = 'primary-video-source';

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  background: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  align: TextAlign;
}

export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
  style: CaptionStyle;
  position: CaptionPosition;
}

export interface TextOverlay {
  id: string;
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  scaleX: number;
  scaleY: number;
  color: string;
  background: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  opacity?: number;
}

export interface CropSettings {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface VideoClip {
  id: string;
  sourceId?: string;
  sourceStart: number;
  sourceEnd: number;
  speed: number;
  muted: boolean;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  crop?: CropSettings;
}

export interface ClipTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  kind: ClipTransitionKind;
  duration: number;
}

export interface InteractionEffect {
  id: string;
  start: number;
  end: number;
  kind: InteractionEffectKind;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
}

export interface AudioSourceMeta {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  duration: number;
  kind: AudioSourceKind;
}

export interface MediaSourceMeta {
  id: string;
  kind: MediaSourceKind;
  name: string;
  size: number;
  lastModified: number;
  duration?: number;
  width?: number;
  height?: number;
}

export interface ImageClip {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface AudioClip {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  label: string;
}

export interface ProjectMediaMeta {
  name: string;
  size: number;
  lastModified: number;
  duration?: number;
  width?: number;
  height?: number;
}

export interface CanvasSettings {
  preset: CanvasAspectPreset;
  width: number;
  height: number;
}

export interface Keyframe {
  id: string;
  targetId: string;
  targetKind: KeyframeTargetKind;
  property: KeyframeProperty;
  time: number;
  value: number;
  easing: KeyframeEasing;
}

export interface ProjectFile {
  version: 1;
  videoName?: string;
  mediaMeta?: ProjectMediaMeta;
  mediaSources?: MediaSourceMeta[];
  cues: CaptionCue[];
  overlays: TextOverlay[];
  effects: InteractionEffect[];
  videoClips?: VideoClip[];
  imageClips?: ImageClip[];
  transitions?: ClipTransition[];
  audioSources?: AudioSourceMeta[];
  audioClips?: AudioClip[];
  keyframes?: Keyframe[];
  canvasSettings?: CanvasSettings;
  createdAt: string;
  updatedAt: string;
}

export interface EditorSnapshot {
  mediaSources: MediaSourceMeta[];
  cues: CaptionCue[];
  overlays: TextOverlay[];
  effects: InteractionEffect[];
  videoClips: VideoClip[];
  imageClips: ImageClip[];
  transitions: ClipTransition[];
  audioSources: AudioSourceMeta[];
  audioClips: AudioClip[];
  keyframes: Keyframe[];
  canvasSettings: CanvasSettings;
}

export interface VideoDimensions {
  width: number;
  height: number;
}

export const defaultCaptionStyle: CaptionStyle = {
  fontFamily: builtinPreviewFontFamily,
  fontSize: 46,
  fontWeight: 700,
  color: '#ffffff',
  background: 'rgba(18, 20, 24, 0.72)',
  outlineColor: '#111111',
  outlineWidth: 2,
  shadow: true,
  align: 'center'
};

export const defaultTextOverlay: Omit<TextOverlay, 'id' | 'start' | 'end'> = {
  text: '텍스트',
  x: 50,
  y: 24,
  fontFamily: builtinPreviewFontFamily,
  fontSize: 54,
  fontWeight: 800,
  italic: false,
  underline: false,
  align: 'center',
  scaleX: 1,
  scaleY: 1,
  color: '#ffffff',
  background: 'rgba(16, 18, 22, 0.4)',
  outlineColor: '#101216',
    outlineWidth: 2,
    shadow: true,
    opacity: 1
};

export const defaultVideoTransform = {
  x: 50,
  y: 50,
  scale: 1,
  rotation: 0,
  opacity: 1,
  crop: {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0
  }
} satisfies Pick<VideoClip, 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'crop'>;

export const defaultCanvasSettings: CanvasSettings = {
  preset: 'source',
  width: 1920,
  height: 1080
};

export const defaultInteractionEffect: Omit<InteractionEffect, 'id' | 'start' | 'end'> = {
  kind: 'tap',
  x: 50,
  y: 50,
  size: 84,
  color: '#22c3aa',
  label: ''
};

export const interactionEffectPresets: Record<
  InteractionEffectKind,
  Pick<InteractionEffect, 'color' | 'size'>
> = {
  tap: { color: '#22c3aa', size: 84 },
  click: { color: '#f26d5b', size: 72 },
  pulse: { color: '#5b7cfa', size: 96 },
  spotlight: { color: '#f2c94c', size: 122 },
  swipe: { color: '#37a2ff', size: 108 },
  target: { color: '#f07cc4', size: 92 },
  cursor: { color: '#f8fbff', size: 72 },
  finger: { color: '#0f0f0f', size: 82 }
};
