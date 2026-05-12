import {
  builtinExportFontFamily,
  builtinPreviewFontFamily
} from './types';

export interface AppFontAsset {
  id: string;
  family: string;
  exportFamily: string;
  exportFamilyCandidates?: string[];
  displayName: string;
  variantName: string;
  weight: number;
  style: 'normal' | 'italic';
  source: 'builtin' | 'local';
  supportsHangul?: boolean;
  file?: File;
}

export const fontWeightOptions = [
  { value: 100, label: 'Thin' },
  { value: 200, label: 'ExtraLight' },
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'SemiBold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'ExtraBold' },
  { value: 900, label: 'Black' }
];

export const builtinFontAsset: AppFontAsset = {
  id: 'builtin-applegothic',
  family: builtinPreviewFontFamily,
  exportFamily: builtinExportFontFamily,
  exportFamilyCandidates: [builtinExportFontFamily, builtinPreviewFontFamily],
  displayName: 'AppleGothic 기본',
  variantName: 'Regular',
  weight: 400,
  style: 'normal',
  source: 'builtin',
  supportsHangul: true
};

export const fontDownloadLinks = [
  {
    name: 'Noto Sans KR',
    href: 'https://fonts.google.com/download?family=Noto%20Sans%20KR'
  },
  {
    name: 'Noto Serif KR',
    href: 'https://fonts.google.com/download?family=Noto%20Serif%20KR'
  },
  {
    name: 'Nanum Gothic',
    href: 'https://fonts.google.com/download?family=Nanum%20Gothic'
  }
];

export function isSupportedFontFile(file: File) {
  return /\.(ttf|otf)$/i.test(file.name);
}

export async function getFontFamilyFromFile(file: File) {
  const buffer = await file.arrayBuffer();
  const names = extractSfntNameMetadata(buffer);
  return names.preferredFamily ?? names.family ?? names.fullName ?? stripFontExtension(file.name);
}

export async function getFontMetadataFromFile(file: File) {
  const buffer = await file.arrayBuffer();
  const names = extractSfntNameMetadata(buffer);
  const rawFamily =
    names.preferredFamily ?? names.family ?? names.fullName ?? stripFontExtension(file.name);
  const inferred = inferFontVariantFromName(`${file.name} ${rawFamily}`);
  const family = normalizeFontFamilyName(rawFamily);
  const exportFamily =
    normalizeSfntName(names.family ?? names.preferredFamily ?? names.fullName ?? rawFamily) ?? family;
  const exportFamilyCandidates = uniqueFontNames([
    exportFamily,
    names.family,
    names.preferredFamily,
    names.fullName,
    names.postScriptName,
    rawFamily,
    family
  ]);
  const variantName = getFontWeightLabel(inferred.weight);
  const displayName =
    inferred.weight === 400 && inferred.style === 'normal'
      ? family
      : `${family} ${variantName}${inferred.style === 'italic' ? ' Italic' : ''}`;

  return {
    family,
    exportFamily,
    exportFamilyCandidates,
    displayName,
    variantName,
    weight: inferred.weight,
    style: inferred.style,
    supportsHangul: fontSupportsHangul(buffer)
  };
}

export function stripFontExtension(name: string) {
  return name.replace(/\.(ttf|otf)$/i, '').trim() || 'Imported Font';
}

export function inferFontVariantFromName(name: string) {
  const normalized = stripFontExtension(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  const packed = normalized.replace(/\s+/g, '');
  const style: AppFontAsset['style'] =
    /\bitalic\b|\boblique\b/.test(normalized) ? 'italic' : 'normal';

  const weightMatchers: Array<[number, RegExp]> = [
    [200, /(extra|ultra)\s*light|extralight|ultralight/],
    [800, /(extra|ultra)\s*bold|extrabold|ultrabold/],
    [600, /semi\s*bold|demi\s*bold|semibold|demibold/],
    [100, /thin|hairline/],
    [300, /light/],
    [500, /medium/],
    [700, /bold/],
    [900, /black|heavy/],
    [400, /regular|normal|book/]
  ];

  const weight = weightMatchers.find(([, matcher]) => matcher.test(packed))?.[0] ?? 400;
  return { weight, style };
}

export function getFontWeightLabel(weight: number) {
  return (
    fontWeightOptions.find((option) => option.value === weight)?.label ??
    `${Math.round(weight)}`
  );
}

export function containsHangul(text: string) {
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text);
}

function normalizeFontFamilyName(name: string) {
  const trimmed = stripFontExtension(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const variantTail =
    /\s+(Thin|Hairline|Extra\s*Light|Ultra\s*Light|Light|Regular|Normal|Book|Medium|Semi\s*Bold|Demi\s*Bold|Bold|Extra\s*Bold|Ultra\s*Bold|Black|Heavy|Italic|Oblique)+$/i;
  const normalized = trimmed.replace(variantTail, '').trim();
  return normalized || trimmed || 'Imported Font';
}

function extractSfntNameMetadata(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12) return {};

  const numTables = view.getUint16(4);
  let nameTableOffset = -1;
  let nameTableLength = 0;

  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > view.byteLength) return {};

    const tag = readAscii(view, recordOffset, 4);
    if (tag === 'name') {
      nameTableOffset = view.getUint32(recordOffset + 8);
      nameTableLength = view.getUint32(recordOffset + 12);
      break;
    }
  }

  if (nameTableOffset < 0 || nameTableOffset + nameTableLength > view.byteLength) {
    return {};
  }

  const count = view.getUint16(nameTableOffset + 2);
  const stringOffset = view.getUint16(nameTableOffset + 4);
  const records: Array<{ languageId: number; nameId: number; value: string }> = [];

  for (let index = 0; index < count; index += 1) {
    const recordOffset = nameTableOffset + 6 + index * 12;
    if (recordOffset + 12 > view.byteLength) break;

    const platformId = view.getUint16(recordOffset);
    const languageId = view.getUint16(recordOffset + 4);
    const nameId = view.getUint16(recordOffset + 6);
    const length = view.getUint16(recordOffset + 8);
    const offset = view.getUint16(recordOffset + 10);
    const absoluteOffset = nameTableOffset + stringOffset + offset;

    if (!isUsefulNameId(nameId) || absoluteOffset + length > view.byteLength) {
      continue;
    }

    const value = normalizeSfntName(decodeNameRecord(view, absoluteOffset, length, platformId));
    if (!value) continue;

    records.push({ languageId, nameId, value });
  }

  return {
    preferredFamily: bestNameRecord(records, 16),
    family: bestNameRecord(records, 1),
    fullName: bestNameRecord(records, 4),
    postScriptName: bestNameRecord(records, 6)
  };
}

function isUsefulNameId(nameId: number) {
  return nameId === 16 || nameId === 1 || nameId === 4 || nameId === 6;
}

function bestNameRecord(
  records: Array<{ languageId: number; nameId: number; value: string }>,
  nameId: number
) {
  const candidates = records.filter((record) => record.nameId === nameId);
  candidates.sort((a, b) => localeScore(a.languageId) - localeScore(b.languageId));
  return candidates[0]?.value;
}

function localeScore(languageId: number) {
  if (languageId === 0x0409) return 0;
  if (languageId === 0x0000) return 1;
  return 2;
}

function normalizeSfntName(name: string | undefined) {
  const normalized = name?.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function uniqueFontNames(names: Array<string | undefined>) {
  return Array.from(new Set(names.map(normalizeSfntName).filter((name): name is string => Boolean(name))));
}

function decodeNameRecord(
  view: DataView,
  offset: number,
  length: number,
  platformId: number
) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  if (platformId === 0 || platformId === 3) {
    let output = '';
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return output;
  }

  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

function readAscii(view: DataView, offset: number, length: number) {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += String.fromCharCode(view.getUint8(offset + index));
  }
  return output;
}

function fontSupportsHangul(buffer: ArrayBuffer) {
  return fontSupportsCodepoints(buffer, [0xac00, 0xb098, 0xb2e4]);
}

function fontSupportsCodepoints(buffer: ArrayBuffer, codepoints: number[]) {
  const view = new DataView(buffer);
  const cmapTable = findSfntTable(view, 'cmap');
  if (!cmapTable) return undefined;

  const cmapOffset = cmapTable.offset;
  if (cmapOffset + 4 > view.byteLength) return undefined;

  const subtableCount = view.getUint16(cmapOffset + 2);
  const subtables: Array<{ format: number; offset: number; priority: number }> = [];

  for (let index = 0; index < subtableCount; index += 1) {
    const recordOffset = cmapOffset + 4 + index * 8;
    if (recordOffset + 8 > view.byteLength) continue;

    const platformId = view.getUint16(recordOffset);
    const encodingId = view.getUint16(recordOffset + 2);
    const subtableOffset = cmapOffset + view.getUint32(recordOffset + 4);
    if (subtableOffset + 2 > view.byteLength) continue;

    const format = view.getUint16(subtableOffset);
    const priority =
      format === 12 ? 0 : format === 4 ? 10 : 100;
    const platformPriority = platformId === 3 || platformId === 0 ? 0 : 5;
    const encodingPriority = encodingId === 10 || encodingId === 1 || encodingId === 3 ? 0 : 2;
    subtables.push({
      format,
      offset: subtableOffset,
      priority: priority + platformPriority + encodingPriority
    });
  }

  subtables.sort((a, b) => a.priority - b.priority);

  for (const subtable of subtables) {
    if (subtable.format === 12) {
      const result = format12SupportsCodepoints(view, subtable.offset, codepoints);
      if (result !== undefined) return result;
    }

    if (subtable.format === 4) {
      const result = format4SupportsCodepoints(view, subtable.offset, codepoints);
      if (result !== undefined) return result;
    }
  }

  return undefined;
}

function format12SupportsCodepoints(view: DataView, offset: number, codepoints: number[]) {
  if (offset + 16 > view.byteLength) return undefined;

  const nGroups = view.getUint32(offset + 12);
  const groupsOffset = offset + 16;
  if (groupsOffset + nGroups * 12 > view.byteLength) return undefined;

  return codepoints.every((codepoint) => {
    for (let index = 0; index < nGroups; index += 1) {
      const groupOffset = groupsOffset + index * 12;
      const start = view.getUint32(groupOffset);
      const end = view.getUint32(groupOffset + 4);
      if (codepoint >= start && codepoint <= end) return true;
    }

    return false;
  });
}

function format4SupportsCodepoints(view: DataView, offset: number, codepoints: number[]) {
  if (offset + 14 > view.byteLength) return undefined;

  const length = view.getUint16(offset + 2);
  const segCount = view.getUint16(offset + 6) / 2;
  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segCount * 2 + 2;
  if (offset + length > view.byteLength || startCodeOffset + segCount * 2 > view.byteLength) {
    return undefined;
  }

  return codepoints.every((codepoint) => {
    if (codepoint > 0xffff) return false;

    for (let index = 0; index < segCount; index += 1) {
      const endCode = view.getUint16(endCodeOffset + index * 2);
      const startCode = view.getUint16(startCodeOffset + index * 2);
      if (codepoint >= startCode && codepoint <= endCode && codepoint !== 0xffff) {
        return true;
      }
    }

    return false;
  });
}

function findSfntTable(view: DataView, tag: string) {
  if (view.byteLength < 12) return null;

  const numTables = view.getUint16(4);
  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > view.byteLength) return null;

    if (readAscii(view, recordOffset, 4) === tag) {
      return {
        offset: view.getUint32(recordOffset + 8),
        length: view.getUint32(recordOffset + 12)
      };
    }
  }

  return null;
}
