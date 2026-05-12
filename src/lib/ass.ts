import type {
  CaptionCue,
  InteractionEffect,
  TextAlign,
  TextOverlay,
  VideoDimensions
} from './types';
import {
  builtinExportFontFamily as defaultExportFontFamily,
  builtinPreviewFontFamily as defaultPreviewFontFamily
} from './types';
import { secondsToAssTimestamp } from './time';
import { sortCues } from './subtitle';
import { getEffectExportGlyph } from './effect-rendering';
import { containsHangul } from './fonts';
import { wrapTextForRender } from './text-wrap';

interface AssBuildOptions {
  availableFontFamilies?: Iterable<string>;
  fontFaces?: Iterable<AssFontFace>;
}

export interface AssFontFace {
  family: string;
  exportFamily: string;
  weight?: number;
  style?: 'normal' | 'italic';
  supportsHangul?: boolean;
}

export function buildAssScript(
  cues: CaptionCue[],
  overlays: TextOverlay[],
  dimensions: VideoDimensions,
  effects: InteractionEffect[] = [],
  options: AssBuildOptions = {}
) {
  const playResX = Math.max(2, Math.round(dimensions.width));
  const playResY = Math.max(2, Math.round(dimensions.height));
  const availableFontFamilies = options.availableFontFamilies
    ? new Set(options.availableFontFamilies)
    : null;
  const fontRegistry = createAssFontRegistry(options.fontFaces);
  const events = [
    ...sortCues(cues).map((cue) =>
      captionCueToDialogue(cue, availableFontFamilies, fontRegistry)
    ),
    ...overlays
      .filter((overlay) => overlay.text.trim().length > 0)
      .map((overlay) =>
        overlayToDialogue(
          overlay,
          { width: playResX, height: playResY },
          availableFontFamilies,
          fontRegistry
        )
      ),
    ...effects.map((effect) => effectToDialogue(effect, { width: playResX, height: playResY }))
  ].join('\n');

  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,AppleGothic,46,&H00FFFFFF&,&H000000FF&,&H00101010&,&H80101010&,0,0,0,0,100,100,0,0,3,2,2,2,80,80,68,1
Style: Overlay,AppleGothic,54,&H00FFFFFF&,&H000000FF&,&H00101010&,&H80101010&,0,0,0,0,100,100,0,0,3,2,2,5,40,40,40,1
Style: Effect,AppleGothic,76,&H00AAC322&,&H000000FF&,&H00FFFFFF&,&H00000000&,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`;
}

export function escapeAssText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

export function hexToAssColor(color: string, alpha?: string) {
  const parsed = parseCssColor(color);
  const hex = parsed.hex;
  const resolvedAlpha = alpha ?? parsed.alpha;
  const [, red, green, blue] = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? [];

  if (!red || !green || !blue) return '&H00FFFFFF&';

  return `&H${resolvedAlpha}${blue}${green}${red}&`.toUpperCase();
}

function captionCueToDialogue(
  cue: CaptionCue,
  availableFontFamilies: Set<string> | null,
  fontRegistry: AssFontRegistry
) {
  const alignment = getCaptionAlignment(cue.position, cue.style.align);
  const tags = [
    `\\an${alignment}`,
    `\\fn${escapeAssFontName(
      resolveAssFontFamily(cue.style.fontFamily, availableFontFamilies, fontRegistry, {
        weight: cue.style.fontWeight ?? 400,
        italic: false,
        text: cue.text
      })
    )}`,
    `\\fs${Math.round(cue.style.fontSize)}`,
    `\\b${normalizeAssFontWeight(cue.style.fontWeight ?? 400)}`,
    `\\c${hexToAssColor(cue.style.color)}`,
    `\\3c${hexToAssColor(cue.style.outlineColor)}`,
    `\\4c${hexToAssColor(cue.style.background)}`,
    `\\bord${Math.max(0, cue.style.outlineWidth)}`,
    `\\shad${cue.style.shadow ? 2 : 0}`
  ].join('');

  return `Dialogue: 0,${secondsToAssTimestamp(cue.start)},${secondsToAssTimestamp(
    cue.end
  )},Default,,0,0,0,,{${tags}}${escapeAssText(cue.text.trim())}`;
}

function overlayToDialogue(
  overlay: TextOverlay,
  dimensions: VideoDimensions,
  availableFontFamilies: Set<string> | null,
  fontRegistry: AssFontRegistry
) {
  const x = Math.round((overlay.x / 100) * dimensions.width);
  const y = Math.round((overlay.y / 100) * dimensions.height);
  const scaleX = clamp(overlay.scaleX ?? 1, 0.25, 4);
  const scaleY = clamp(overlay.scaleY ?? 1, 0.25, 4);
  const fontWeight = normalizeAssFontWeight(overlay.fontWeight ?? 400);
  const wrappedText = wrapTextForRender(overlay.text.trim(), {
    wrapMode: overlay.wrapMode,
    boxWidth: overlay.boxWidth,
    canvasWidth: dimensions.width,
    fontSize: overlay.fontSize,
    scaleX
  });
  const tags = [
    `\\an${getOverlayAlignment(overlay.align ?? 'center')}`,
    `\\pos(${x},${y})`,
    `\\fn${escapeAssFontName(
      resolveAssFontFamily(overlay.fontFamily, availableFontFamilies, fontRegistry, {
        weight: overlay.fontWeight ?? 400,
        italic: Boolean(overlay.italic),
        text: overlay.text
      })
    )}`,
    `\\fs${Math.round(overlay.fontSize)}`,
    `\\b${fontWeight}`,
    `\\i${overlay.italic ? 1 : 0}`,
    `\\u${overlay.underline ? 1 : 0}`,
    `\\fscx${Math.round(scaleX * 100)}`,
    `\\fscy${Math.round(scaleY * 100)}`,
    `\\c${hexToAssColor(overlay.color)}`,
    `\\3c${hexToAssColor(overlay.outlineColor)}`,
    `\\4c${hexToAssColor(overlay.background)}`,
    `\\bord${Math.max(0, overlay.outlineWidth)}`,
    `\\shad${overlay.shadow ? 2 : 0}`
  ].join('');

  return `Dialogue: 1,${secondsToAssTimestamp(
    overlay.start
  )},${secondsToAssTimestamp(overlay.end)},Overlay,,0,0,0,,{${tags}}${escapeAssText(
    wrappedText
  )}`;
}

function effectToDialogue(effect: InteractionEffect, dimensions: VideoDimensions) {
  const x = Math.round((effect.x / 100) * dimensions.width);
  const y = Math.round((effect.y / 100) * dimensions.height);
  const durationMs = Math.max(200, Math.round((effect.end - effect.start) * 1000));
  const glyph = getEffectExportGlyph(effect.kind);
  const label = effect.label.trim();
  const text = label ? `${glyph}\\N${escapeAssText(label)}` : glyph;
  const tags = [
    '\\an5',
    `\\pos(${x},${y})`,
    `\\fs${Math.round(effect.size)}`,
    `\\c${hexToAssColor(effect.color)}`,
    '\\3c&H00FFFFFF&',
    '\\bord2',
    '\\shad0',
    '\\alpha&H08&',
    `\\fad(35,180)`,
    `\\t(0,${durationMs},\\fscx175\\fscy175\\alpha&HFF&)`
  ].join('');

  return `Dialogue: 2,${secondsToAssTimestamp(
    effect.start
  )},${secondsToAssTimestamp(effect.end)},Effect,,0,0,0,,{${tags}}${text}`;
}

function getCaptionAlignment(position: CaptionCue['position'], align: TextAlign) {
  const table: Record<CaptionCue['position'], Record<TextAlign, number>> = {
    top: { left: 7, center: 8, right: 9 },
    middle: { left: 4, center: 5, right: 6 },
    bottom: { left: 1, center: 2, right: 3 }
  };

  return table[position][align];
}

function getOverlayAlignment(align: TextAlign) {
  return {
    left: 4,
    center: 5,
    right: 6
  }[align];
}

type AssFontRegistry = Map<string, AssFontFace[]>;

function createAssFontRegistry(fontFaces: Iterable<AssFontFace> | undefined): AssFontRegistry {
  const registry: AssFontRegistry = new Map();

  for (const face of fontFaces ?? []) {
    const family = face.family.trim();
    const exportFamily = face.exportFamily.trim();
    if (!family || !exportFamily) continue;

    const current = registry.get(family) ?? [];
    current.push(face);
    registry.set(family, current);

    if (exportFamily !== family) {
      const exportCurrent = registry.get(exportFamily) ?? [];
      exportCurrent.push(face);
      registry.set(exportFamily, exportCurrent);
    }
  }

  return registry;
}

function resolveAssFontFamily(
  fontFamily: string,
  availableFontFamilies: Set<string> | null,
  fontRegistry: AssFontRegistry,
  options: { weight: number; italic: boolean; text: string }
) {
  const requested = fontFamily.trim();
  if (requested === defaultPreviewFontFamily) return defaultExportFontFamily;
  if (!requested) return defaultExportFontFamily;

  const registeredFaces = fontRegistry.get(requested);
  if (registeredFaces?.length) {
    const requiresHangul = containsHangul(options.text);
    const hangulCapableFaces = requiresHangul
      ? registeredFaces.filter((face) => face.supportsHangul !== false)
      : registeredFaces;

    if (requiresHangul && hangulCapableFaces.length === 0) {
      return defaultExportFontFamily;
    }

    return chooseBestAssFontFace(hangulCapableFaces, options).exportFamily;
  }

  if (availableFontFamilies && !availableFontFamilies.has(requested)) {
    return defaultExportFontFamily;
  }

  return requested;
}

function chooseBestAssFontFace(
  faces: AssFontFace[],
  options: { weight: number; italic: boolean }
) {
  return [...faces].sort((a, b) => {
    const aStylePenalty = (a.style === 'italic') === options.italic ? 0 : 1000;
    const bStylePenalty = (b.style === 'italic') === options.italic ? 0 : 1000;
    const aWeight = a.weight ?? 400;
    const bWeight = b.weight ?? 400;
    return (
      aStylePenalty +
      Math.abs(aWeight - options.weight) -
      (bStylePenalty + Math.abs(bWeight - options.weight))
    );
  })[0];
}

function escapeAssFontName(fontFamily: string) {
  return fontFamily.replace(/[{}\\]/g, '').trim() || defaultExportFontFamily;
}

function normalizeAssFontWeight(weight: number) {
  return clamp(Math.round(weight / 100) * 100, 100, 900);
}

function normalizeHex(color: string) {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split('')
      .map((char) => char + char)
      .join('')}`;
  }

  return '#ffffff';
}

function parseCssColor(color: string) {
  const rgba = parseRgba(color);
  if (rgba) return rgba;

  return {
    hex: normalizeHex(color),
    alpha: '00'
  };
}

function parseRgba(color: string) {
  const match = color
    .trim()
    .match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i);

  if (!match) return null;

  const opacity = clamp(Number(match[4] ?? 1), 0, 1);
  const assAlpha = Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(2, '0');

  return {
    hex: `#${[match[1], match[2], match[3]]
      .map((channel) => clamp(Number(channel), 0, 255).toString(16).padStart(2, '0'))
      .join('')}`,
    alpha: assAlpha
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
