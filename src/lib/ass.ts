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
    ...sortCues(cues).flatMap((cue) =>
      captionCueToDialogues(
        cue,
        { width: playResX, height: playResY },
        availableFontFamilies,
        fontRegistry
      )
    ),
    ...overlays
      .filter((overlay) => overlay.text.trim().length > 0)
      .flatMap((overlay) =>
        overlayToDialogues(
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
Style: Default,AppleGothic,46,&H00FFFFFF&,&H000000FF&,&H00101010&,&H80101010&,0,0,0,0,100,100,0,0,1,2,2,2,80,80,68,1
Style: CaptionBox,AppleGothic,1,&H80101010&,&H000000FF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Overlay,AppleGothic,54,&H00FFFFFF&,&H000000FF&,&H00101010&,&H80101010&,0,0,0,0,100,100,0,0,1,2,2,5,40,40,40,1
Style: OverlayBox,AppleGothic,1,&H80101010&,&H000000FF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
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

const captionBoxLayer = 0;
const captionTextLayer = 1;
const overlayBoxLayer = 2;
const overlayTextLayer = 3;
const effectLayer = 4;

function captionCueToDialogues(
  cue: CaptionCue,
  dimensions: VideoDimensions,
  availableFontFamilies: Set<string> | null,
  fontRegistry: AssFontRegistry
) {
  const text = cue.text.trim();
  if (!text) return [];

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
    `\\4c${hexToAssColor(cue.style.outlineColor)}`,
    `\\bord${Math.max(0, cue.style.outlineWidth)}`,
    `\\shad${cue.style.shadow ? 2 : 0}`
  ].join('');

  const textDialogue = `Dialogue: ${captionTextLayer},${secondsToAssTimestamp(cue.start)},${secondsToAssTimestamp(
    cue.end
  )},Default,,0,0,0,,{${tags}}${escapeAssText(text)}`;
  const boxDialogue = captionBackgroundToDialogue(cue, text, dimensions);

  return boxDialogue ? [boxDialogue, textDialogue] : [textDialogue];
}

function overlayToDialogues(
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
    `\\4c${hexToAssColor(overlay.outlineColor)}`,
    `\\bord${Math.max(0, overlay.outlineWidth)}`,
    `\\shad${overlay.shadow ? 2 : 0}`
  ].join('');

  const textDialogue = `Dialogue: ${overlayTextLayer},${secondsToAssTimestamp(
    overlay.start
  )},${secondsToAssTimestamp(overlay.end)},Overlay,,0,0,0,,{${tags}}${escapeAssText(
    wrappedText
  )}`;
  const boxDialogue = overlayBackgroundToDialogue(overlay, wrappedText, dimensions);

  return boxDialogue ? [boxDialogue, textDialogue] : [textDialogue];
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

  return `Dialogue: ${effectLayer},${secondsToAssTimestamp(
    effect.start
  )},${secondsToAssTimestamp(effect.end)},Effect,,0,0,0,,{${tags}}${text}`;
}

function captionBackgroundToDialogue(
  cue: CaptionCue,
  text: string,
  dimensions: VideoDimensions
) {
  if (!hasVisibleFill(cue.style.background)) return null;

  const lines = getTextLines(text);
  const width = Math.min(
    dimensions.width * 0.84,
    Math.max(
      1,
      Math.max(...lines.map((line) => estimateLineWidth(line, cue.style.fontSize))) + 28
    )
  );
  const height = Math.max(1, lines.length * cue.style.fontSize * 1.28 + 16);
  const left = (dimensions.width - width) / 2;
  const top =
    cue.position === 'top'
      ? dimensions.height * 0.08
      : cue.position === 'middle'
        ? (dimensions.height - height) / 2
        : dimensions.height * 0.93 - height;

  return backgroundBoxToDialogue({
    layer: captionBoxLayer,
    start: cue.start,
    end: cue.end,
    style: 'CaptionBox',
    color: cue.style.background,
    left,
    top,
    width,
    height,
    radius: 6
  });
}

function overlayBackgroundToDialogue(
  overlay: TextOverlay,
  wrappedText: string,
  dimensions: VideoDimensions
) {
  if (!hasVisibleFill(overlay.background)) return null;

  const scaleX = clamp(overlay.scaleX ?? 1, 0.25, 4);
  const scaleY = clamp(overlay.scaleY ?? 1, 0.25, 4);
  const boxWidth = clamp(overlay.boxWidth ?? 56, 12, 95);
  const width = Math.max(1, ((dimensions.width * boxWidth) / 100) * scaleX);
  const lineCount = getTextLines(wrappedText).length;
  const height = Math.max(1, (lineCount * overlay.fontSize * 1.16 + 14) * scaleY);
  const x = (overlay.x / 100) * dimensions.width;
  const y = (overlay.y / 100) * dimensions.height;
  const align = overlay.align ?? 'center';
  const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;

  return backgroundBoxToDialogue({
    layer: overlayBoxLayer,
    start: overlay.start,
    end: overlay.end,
    style: 'OverlayBox',
    color: overlay.background,
    left,
    top: y - height / 2,
    width,
    height,
    radius: 6 * ((scaleX + scaleY) / 2)
  });
}

function backgroundBoxToDialogue({
  layer,
  start,
  end,
  style,
  color,
  left,
  top,
  width,
  height,
  radius
}: {
  layer: number;
  start: number;
  end: number;
  style: string;
  color: string;
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}) {
  const boxWidth = Math.max(1, Math.round(width));
  const boxHeight = Math.max(1, Math.round(height));
  const boxRadius = Math.round(clamp(radius, 0, Math.min(boxWidth, boxHeight) / 2));
  const tags = [
    '\\an7',
    `\\pos(${Math.round(left)},${Math.round(top)})`,
    '\\p1',
    `\\c${hexToAssColor(color, '00')}`,
    `\\1a&H${getAssAlpha(color)}&`,
    '\\bord0',
    '\\shad0'
  ].join('');

  return `Dialogue: ${layer},${secondsToAssTimestamp(start)},${secondsToAssTimestamp(
    end
  )},${style},,0,0,0,,{${tags}}${roundedRectPath(boxWidth, boxHeight, boxRadius)}`;
}

function roundedRectPath(width: number, height: number, radius: number) {
  if (radius <= 0) return `m 0 0 l ${width} 0 l ${width} ${height} l 0 ${height} l 0 0`;

  const r = Math.min(radius, width / 2, height / 2);
  const k = 0.5522847498;
  const c = r * k;
  const points = [
    `m ${formatPathNumber(r)} 0`,
    `l ${formatPathNumber(width - r)} 0`,
    `b ${formatPathNumber(width - r + c)} 0 ${width} ${formatPathNumber(
      r - c
    )} ${width} ${formatPathNumber(r)}`,
    `l ${width} ${formatPathNumber(height - r)}`,
    `b ${width} ${formatPathNumber(height - r + c)} ${formatPathNumber(
      width - r + c
    )} ${height} ${formatPathNumber(width - r)} ${height}`,
    `l ${formatPathNumber(r)} ${height}`,
    `b ${formatPathNumber(r - c)} ${height} 0 ${formatPathNumber(
      height - r + c
    )} 0 ${formatPathNumber(height - r)}`,
    `l 0 ${formatPathNumber(r)}`,
    `b 0 ${formatPathNumber(r - c)} ${formatPathNumber(r - c)} 0 ${formatPathNumber(
      r
    )} 0`
  ];

  return points.join(' ');
}

function formatPathNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function getTextLines(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function estimateLineWidth(line: string, fontSize: number) {
  return Array.from(line).reduce((sum, char) => sum + measureCharUnits(char), 0) * fontSize;
}

function measureCharUnits(char: string) {
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(char)) return 0.98;
  if (/[\u3000-\u9fff]/.test(char)) return 1;
  if (/\s/.test(char)) return 0.34;
  if (/[ilI.,:;!|]/.test(char)) return 0.28;
  if (/[mwMW@#%&]/.test(char)) return 0.88;
  if (/[0-9]/.test(char)) return 0.56;
  return 0.58;
}

function hasVisibleFill(color: string) {
  const parsed = parseCssColor(color);
  const alpha = Number.parseInt(parsed.alpha, 16);
  if (!Number.isFinite(alpha)) return true;

  return 1 - alpha / 255 > 0.01;
}

function getAssAlpha(color: string) {
  return parseCssColor(color).alpha.toUpperCase();
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
