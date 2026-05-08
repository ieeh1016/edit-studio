export const MIN_CUE_DURATION = 0.2;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function parseTimestamp(raw: string) {
  const value = raw.trim().replace(',', '.');
  const parts = value.split(':');

  if (parts.length === 1) {
    const seconds = Number(parts[0]);
    if (Number.isFinite(seconds)) return seconds;
  }

  if (parts.length === 2 || parts.length === 3) {
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = Number(parts.pop() ?? 0);

    if ([seconds, minutes, hours].every(Number.isFinite)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  throw new Error(`Invalid timestamp: ${raw}`);
}

export function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor((safeSeconds % 1) * 100);

  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(
    2,
    '0'
  )}.${String(centiseconds).padStart(2, '0')}`;
}

export function secondsToSrtTimestamp(seconds: number) {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0'
  )}:${String(wholeSeconds).padStart(2, '0')},${String(milliseconds).padStart(
    3,
    '0'
  )}`;
}

export function secondsToVttTimestamp(seconds: number) {
  return secondsToSrtTimestamp(seconds).replace(',', '.');
}

export function secondsToAssTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor((safeSeconds % 1) * 100);

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(
    wholeSeconds
  ).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

export function coerceCueBounds(start: number, end: number, duration?: number) {
  const maxEnd = duration ?? Number.MAX_SAFE_INTEGER;
  const maxStart = Math.max(0, maxEnd - MIN_CUE_DURATION);
  const safeStart = clamp(start, 0, maxStart);
  const safeEnd = clamp(Math.max(end, safeStart + MIN_CUE_DURATION), 0, maxEnd);

  return {
    start: safeStart,
    end: Math.max(safeEnd, Math.min(maxEnd, safeStart + MIN_CUE_DURATION))
  };
}
