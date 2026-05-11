export type CaptionPosition = 'bottom' | 'middle' | 'top';
export type TextAlign = 'left' | 'center' | 'right';
export type ExportPreset = 'fast720' | 'source';
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

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
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
}

export interface VideoClip {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  speed: number;
  muted: boolean;
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

export interface ProjectMediaMeta {
  name: string;
  size: number;
  lastModified: number;
  duration?: number;
  width?: number;
  height?: number;
}

export interface ProjectFile {
  version: 1;
  videoName?: string;
  mediaMeta?: ProjectMediaMeta;
  cues: CaptionCue[];
  overlays: TextOverlay[];
  effects: InteractionEffect[];
  videoClips?: VideoClip[];
  transitions?: ClipTransition[];
  createdAt: string;
  updatedAt: string;
}

export interface EditorSnapshot {
  cues: CaptionCue[];
  overlays: TextOverlay[];
  effects: InteractionEffect[];
  videoClips: VideoClip[];
  transitions: ClipTransition[];
}

export interface VideoDimensions {
  width: number;
  height: number;
}

export const defaultCaptionStyle: CaptionStyle = {
  fontFamily: builtinPreviewFontFamily,
  fontSize: 46,
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
  shadow: true
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
