import { clamp } from './time';

export function shiftTimedItemsToRenderWindow<T extends { start: number; end: number }>(
  items: T[],
  start: number,
  end: number,
  minDuration = 0.03
) {
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  const renderDuration = Math.max(0, rangeEnd - rangeStart);

  return items
    .filter((item) => item.start < rangeEnd && item.end > rangeStart)
    .map((item) => {
      const overlapStart = Math.max(item.start, rangeStart);
      const overlapEnd = Math.min(item.end, rangeEnd);
      const nextStart = clamp(overlapStart - rangeStart, 0, renderDuration);
      const nextEnd = clamp(overlapEnd - rangeStart, 0, renderDuration);

      return {
        ...item,
        start: nextStart,
        end: nextEnd
      };
    })
    .filter((item) => item.end - item.start >= minDuration);
}
