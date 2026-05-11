import { clamp, MIN_CUE_DURATION } from './time';

export const TIMELINE_MIN_PX_PER_SECOND = 0.08;
export const TIMELINE_MAX_PX_PER_SECOND = 180;
export const TIMELINE_DEFAULT_PX_PER_SECOND = 18;
export const TIMELINE_MIN_ITEM_WIDTH = 28;

export interface TimelineViewport {
  pxPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
}

export interface TimelineTick {
  time: number;
  major: boolean;
}

export interface TimelineItemLayout<T> {
  item: T;
  lane: number;
}

export interface TimelineThumbnailWindow {
  start: number;
  end: number;
  step: number;
}

export function getTimelineContentWidth(
  duration: number,
  pxPerSecond: number,
  viewportWidth = 0,
  edgePadding = 0
) {
  return Math.max(
    viewportWidth,
    Math.ceil(Math.max(duration, 1) * pxPerSecond + edgePadding * 2)
  );
}

export function chooseThumbnailStepForPxPerSecond(pxPerSecond: number) {
  const targetSpacingPx = pxPerSecond >= 90 ? 120 : pxPerSecond >= 42 ? 150 : 210;
  return clamp(targetSpacingPx / Math.max(pxPerSecond, 0.1), 0.5, 24);
}

export function getVisibleThumbnailTimes(
  duration: number,
  request: TimelineThumbnailWindow,
  maxCount = 96
) {
  const safeDuration = Math.max(MIN_CUE_DURATION, duration);
  const start = clamp(request.start, 0, safeDuration);
  const end = clamp(Math.max(request.end, start + request.step), 0, safeDuration);
  const step = Math.max(0.5, request.step);
  const times: number[] = [];
  let cursor = Math.floor(start / step) * step;

  while (cursor <= end && times.length < maxCount) {
    times.push(clamp(cursor, 0, Math.max(0, safeDuration - 0.08)));
    cursor += step;
  }

  if (times.length === 0) {
    times.push(clamp(start, 0, Math.max(0, safeDuration - 0.08)));
  }

  return Array.from(new Set(times.map((time) => Number(time.toFixed(2)))));
}

export function timeToTimelineX(time: number, pxPerSecond: number) {
  return Math.max(0, time) * pxPerSecond;
}

export function timelineXToTime(x: number, pxPerSecond: number, duration: number) {
  return clamp(x / Math.max(pxPerSecond, 0.001), 0, Math.max(duration, 0));
}

export function getVisibleTimelineRange(
  viewport: TimelineViewport,
  duration: number,
  edgePadding = 0
) {
  const start = timelineXToTime(
    viewport.scrollLeft - edgePadding,
    viewport.pxPerSecond,
    duration
  );
  const end = timelineXToTime(
    viewport.scrollLeft + viewport.viewportWidth - edgePadding,
    viewport.pxPerSecond,
    duration
  );

  return { start, end };
}

export function fitTimelinePxPerSecond(
  duration: number,
  viewportWidth: number,
  min = TIMELINE_MIN_PX_PER_SECOND,
  max = TIMELINE_MAX_PX_PER_SECOND,
  edgePadding = 0
) {
  if (!duration || !viewportWidth) return TIMELINE_DEFAULT_PX_PER_SECOND;
  return clamp(Math.max(1, viewportWidth - edgePadding * 2) / Math.max(duration, 1), min, max);
}

export function clampTimelineScrollLeft(
  scrollLeft: number,
  duration: number,
  pxPerSecond: number,
  viewportWidth: number,
  edgePadding = 0
) {
  const maxScroll = Math.max(
    0,
    getTimelineContentWidth(duration, pxPerSecond, viewportWidth, edgePadding) - viewportWidth
  );
  return clamp(scrollLeft, 0, maxScroll);
}

export function zoomTimelineAroundAnchor({
  duration,
  currentPxPerSecond,
  nextPxPerSecond,
  scrollLeft,
  anchorX,
  viewportWidth,
  edgePadding = 0
}: {
  duration: number;
  currentPxPerSecond: number;
  nextPxPerSecond: number;
  scrollLeft: number;
  anchorX: number;
  viewportWidth: number;
  edgePadding?: number;
}) {
  const clampedNextPxPerSecond = clamp(
    nextPxPerSecond,
    TIMELINE_MIN_PX_PER_SECOND,
    TIMELINE_MAX_PX_PER_SECOND
  );
  const anchorTime = timelineXToTime(
    scrollLeft + Math.max(anchorX, 0) - edgePadding,
    currentPxPerSecond,
    duration
  );
  const nextScrollLeft = clampTimelineScrollLeft(
    edgePadding + timeToTimelineX(anchorTime, clampedNextPxPerSecond) - Math.max(anchorX, 0),
    duration,
    clampedNextPxPerSecond,
    viewportWidth,
    edgePadding
  );

  return {
    pxPerSecond: clampedNextPxPerSecond,
    scrollLeft: nextScrollLeft,
    anchorTime
  };
}

export function createTimelineTicks(
  duration: number,
  pxPerSecond: number,
  visibleStart = 0,
  visibleEnd = duration
) {
  const safeDuration = Math.max(duration, 1);
  const interval = chooseTimelineTickInterval(pxPerSecond);
  const first = Math.max(0, Math.floor(Math.max(visibleStart - interval, 0) / interval) * interval);
  const last = Math.min(safeDuration, Math.ceil(Math.min(visibleEnd + interval, safeDuration) / interval) * interval);
  const ticks: TimelineTick[] = [];

  for (let time = first; time <= last + 0.001; time += interval) {
    const rounded = Number(time.toFixed(3));
    ticks.push({
      time: Math.min(rounded, safeDuration),
      major: isMajorTimelineTick(rounded, interval)
    });
  }

  if (first > 0) {
    ticks.unshift({ time: 0, major: true });
  } else if (ticks.length > 0) {
    ticks[0] = { time: 0, major: true };
  }

  if (!ticks.some((tick) => Math.abs(tick.time - safeDuration) < 0.001)) {
    ticks.push({ time: safeDuration, major: true });
  }

  return ticks;
}

export function chooseTimelineTickInterval(pxPerSecond: number) {
  const intervals = [
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600
  ];
  return intervals.find((interval) => interval * pxPerSecond >= 72) ?? 600;
}

export function isCompactTimelineItem(start: number, end: number, pxPerSecond: number) {
  return Math.max(0, end - start) * pxPerSecond < 72;
}

export function timelineItemStyle(
  start: number,
  end: number,
  pxPerSecond: number,
  lane = 0,
  laneHeight = 30,
  topPadding = 8,
  minWidth = TIMELINE_MIN_ITEM_WIDTH,
  offsetX = 0
) {
  return {
    left: `${offsetX + timeToTimelineX(start, pxPerSecond)}px`,
    width: `${Math.max(minWidth, (end - start) * pxPerSecond)}px`,
    top: `${topPadding + lane * laneHeight}px`,
    height: `${Math.max(20, laneHeight - 6)}px`
  };
}

export function layoutTimelineItems<T>(
  items: T[],
  getRange: (item: T) => { start: number; end: number }
) {
  const sorted = [...items].sort((a, b) => {
    const rangeA = getRange(a);
    const rangeB = getRange(b);
    return rangeA.start - rangeB.start || rangeA.end - rangeB.end;
  });
  const laneEnds: number[] = [];
  const layouts: TimelineItemLayout<T>[] = [];

  sorted.forEach((item) => {
    const range = getRange(item);
    const start = Math.max(0, range.start);
    const end = Math.max(start + MIN_CUE_DURATION, range.end);
    let lane = laneEnds.findIndex((laneEnd) => start >= laneEnd - 0.001);

    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    layouts.push({ item, lane });
  });

  return {
    layouts,
    laneCount: Math.max(1, laneEnds.length)
  };
}

function isMajorTimelineTick(time: number, interval: number) {
  const majorInterval = interval < 1 ? 1 : interval < 10 ? interval * 5 : interval * 2;
  return Math.abs(time % majorInterval) < 0.001 || Math.abs(time) < 0.001;
}
