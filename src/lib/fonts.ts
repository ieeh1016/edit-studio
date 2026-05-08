import {
  builtinExportFontFamily,
  builtinPreviewFontFamily
} from './types';

export interface AppFontAsset {
  id: string;
  family: string;
  exportFamily: string;
  displayName: string;
  source: 'builtin' | 'local';
  file?: File;
}

export const builtinFontAsset: AppFontAsset = {
  id: 'builtin-applegothic',
  family: builtinPreviewFontFamily,
  exportFamily: builtinExportFontFamily,
  displayName: 'AppleGothic 기본',
  source: 'builtin'
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
  return extractSfntFamilyName(buffer) ?? stripFontExtension(file.name);
}

export function stripFontExtension(name: string) {
  return name.replace(/\.(ttf|otf)$/i, '').trim() || 'Imported Font';
}

function extractSfntFamilyName(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12) return null;

  const numTables = view.getUint16(4);
  let nameTableOffset = -1;
  let nameTableLength = 0;

  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > view.byteLength) return null;

    const tag = readAscii(view, recordOffset, 4);
    if (tag === 'name') {
      nameTableOffset = view.getUint32(recordOffset + 8);
      nameTableLength = view.getUint32(recordOffset + 12);
      break;
    }
  }

  if (nameTableOffset < 0 || nameTableOffset + nameTableLength > view.byteLength) {
    return null;
  }

  const count = view.getUint16(nameTableOffset + 2);
  const stringOffset = view.getUint16(nameTableOffset + 4);
  const candidates: Array<{ score: number; value: string }> = [];

  for (let index = 0; index < count; index += 1) {
    const recordOffset = nameTableOffset + 6 + index * 12;
    if (recordOffset + 12 > view.byteLength) break;

    const platformId = view.getUint16(recordOffset);
    const languageId = view.getUint16(recordOffset + 4);
    const nameId = view.getUint16(recordOffset + 6);
    const length = view.getUint16(recordOffset + 8);
    const offset = view.getUint16(recordOffset + 10);
    const absoluteOffset = nameTableOffset + stringOffset + offset;

    if (!isFamilyNameId(nameId) || absoluteOffset + length > view.byteLength) {
      continue;
    }

    const value = decodeNameRecord(view, absoluteOffset, length, platformId).trim();
    if (!value) continue;

    const nameScore = nameId === 16 ? 0 : nameId === 1 ? 1 : 2;
    const localeScore = languageId === 0x0409 ? 0 : 1;
    candidates.push({ score: nameScore * 10 + localeScore, value });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.value ?? null;
}

function isFamilyNameId(nameId: number) {
  return nameId === 16 || nameId === 1 || nameId === 4;
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
