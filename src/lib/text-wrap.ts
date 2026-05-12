import type { TextWrapMode } from './types';

export interface TextRenderWrapOptions {
  wrapMode?: TextWrapMode;
  boxWidth?: number;
  canvasWidth: number;
  fontSize: number;
  scaleX?: number;
}

const defaultBoxWidth = 56;

export function wrapTextForRender(text: string, options: TextRenderWrapOptions) {
  const normalizedText = normalizeTextNewlines(text);
  if ((options.wrapMode ?? 'auto') === 'manual') return normalizedText;

  const boxWidth = clampNumber(options.boxWidth ?? defaultBoxWidth, 12, 95);
  const scaleX = clampNumber(options.scaleX ?? 1, 0.25, 4);
  const availablePx = Math.max(1, (options.canvasWidth * boxWidth) / 100 / scaleX);
  const maxUnits = Math.max(1, availablePx / Math.max(1, options.fontSize));

  return normalizedText
    .split('\n')
    .flatMap((line) => wrapLine(line, maxUnits))
    .join('\n');
}

function wrapLine(line: string, maxUnits: number) {
  if (line.length === 0) return [''];

  const output: string[] = [];
  let current = '';
  let currentWidth = 0;
  const tokens = line.match(/\s+|[^\s]+/g) ?? [line];

  tokens.forEach((token) => {
    const tokenWidth = measureTextUnits(token);
    const isSpace = /^\s+$/.test(token);

    if (isSpace && current.length === 0) return;

    if (current && currentWidth + tokenWidth > maxUnits) {
      output.push(current.trimEnd());
      current = '';
      currentWidth = 0;
      if (isSpace) return;
    }

    if (tokenWidth > maxUnits) {
      for (const char of token) {
        const charWidth = measureCharUnits(char);
        if (current && currentWidth + charWidth > maxUnits) {
          output.push(current.trimEnd());
          current = '';
          currentWidth = 0;
        }
        current += char;
        currentWidth += charWidth;
      }
      return;
    }

    current += token;
    currentWidth += tokenWidth;
  });

  if (current || output.length === 0) output.push(current.trimEnd());
  return output;
}

function measureTextUnits(text: string) {
  return Array.from(text).reduce((sum, char) => sum + measureCharUnits(char), 0);
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

function normalizeTextNewlines(text: string) {
  return text.replace(/\r\n?/g, '\n');
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}
