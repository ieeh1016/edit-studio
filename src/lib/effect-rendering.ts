import type { InteractionEffectKind } from './types';

export const effectExportGlyphs: Record<InteractionEffectKind, string> = {
  tap: '◎',
  click: '◉',
  pulse: '○',
  spotlight: '◌',
  swipe: '→',
  target: '⌖',
  cursor: '➤',
  finger: '☝'
};

export function getEffectExportGlyph(kind: InteractionEffectKind) {
  return effectExportGlyphs[kind];
}
