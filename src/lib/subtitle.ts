import { defaultCaptionStyle, type CaptionCue } from './types';
import {
  MIN_CUE_DURATION,
  parseTimestamp,
  secondsToSrtTimestamp,
  secondsToVttTimestamp
} from './time';

const timeRangePattern =
  /(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3}\s+-->\s+(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3}/;

export function createCue(
  start: number,
  end: number,
  text: string,
  id: string = crypto.randomUUID()
): CaptionCue {
  return {
    id,
    start,
    end: Math.max(end, start + MIN_CUE_DURATION),
    text,
    style: { ...defaultCaptionStyle },
    position: 'bottom'
  };
}

export function parseSrt(source: string): CaptionCue[] {
  return parseSubtitleBlocks(source, false);
}

export function parseVtt(source: string): CaptionCue[] {
  const withoutHeader = source.replace(/^\uFEFF?WEBVTT[^\n]*(\n|$)/, '');
  return parseSubtitleBlocks(withoutHeader, true);
}

export function parseSubtitleFile(source: string, fileName: string) {
  return fileName.toLowerCase().endsWith('.vtt')
    ? parseVtt(source)
    : parseSrt(source);
}

export function cuesToSrt(cues: CaptionCue[]) {
  return sortCues(cues)
    .map((cue, index) => {
      return `${index + 1}\n${secondsToSrtTimestamp(
        cue.start
      )} --> ${secondsToSrtTimestamp(cue.end)}\n${cue.text.trim()}`;
    })
    .join('\n\n');
}

export function cuesToVtt(cues: CaptionCue[]) {
  const body = sortCues(cues)
    .map((cue) => {
      return `${secondsToVttTimestamp(cue.start)} --> ${secondsToVttTimestamp(
        cue.end
      )}\n${cue.text.trim()}`;
    })
    .join('\n\n');

  return `WEBVTT\n\n${body}`;
}

export function sortCues(cues: CaptionCue[]) {
  return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function sortAndResolveCueOverlaps(cues: CaptionCue[]) {
  const sorted = sortCues(cues).map((cue) => ({ ...cue }));

  for (let index = 0; index < sorted.length; index += 1) {
    const cue = sorted[index];
    cue.end = Math.max(cue.end, cue.start + MIN_CUE_DURATION);

    const previous = sorted[index - 1];
    if (previous && cue.start < previous.end + 0.04) {
      const duration = Math.max(cue.end - cue.start, MIN_CUE_DURATION);
      cue.start = previous.end + 0.04;
      cue.end = cue.start + duration;
    }
  }

  return sorted;
}

function parseSubtitleBlocks(source: string, isVtt: boolean) {
  const normalized = source.replace(/\r/g, '').trim();
  if (!normalized) return [];

  return normalized
    .split(/\n{2,}/)
    .map((block, index) => parseBlock(block, index, isVtt))
    .filter((cue): cue is CaptionCue => Boolean(cue));
}

function parseBlock(block: string, index: number, isVtt: boolean) {
  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const timeLineIndex = lines.findIndex((line) => timeRangePattern.test(line));

  if (timeLineIndex === -1) {
    if (isVtt && lines[0]?.startsWith('NOTE')) return null;
    return null;
  }

  const [startRaw, endRaw] = lines[timeLineIndex].split(/\s+-->\s+/);
  const endClean = endRaw.split(/\s+/)[0];
  const text = lines.slice(timeLineIndex + 1).join('\n').trim();

  if (!text) return null;

  return createCue(
    parseTimestamp(startRaw),
    parseTimestamp(endClean),
    text,
    `cue-${index + 1}`
  );
}
