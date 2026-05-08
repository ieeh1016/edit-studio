import { describe, expect, it } from 'vitest';
import {
  TIMELINE_DEFAULT_PX_PER_SECOND,
  TIMELINE_MAX_PX_PER_SECOND,
  fitTimelinePxPerSecond,
  getVisibleTimelineRange,
  layoutTimelineItems,
  timeToTimelineX,
  timelineXToTime,
  zoomTimelineAroundAnchor
} from '../src/lib/timeline';

describe('timeline viewport helpers', () => {
  it('converts between time and pixel coordinates', () => {
    expect(timeToTimelineX(12.5, 20)).toBe(250);
    expect(timelineXToTime(250, 20, 60)).toBe(12.5);
    expect(timelineXToTime(9999, 20, 60)).toBe(60);
  });

  it('calculates the visible range from scroll and zoom state', () => {
    const range = getVisibleTimelineRange(
      {
        pxPerSecond: 10,
        scrollLeft: 250,
        viewportWidth: 500
      },
      120
    );

    expect(range.start).toBe(25);
    expect(range.end).toBe(75);
  });

  it('keeps the zero point visible when edge padding is applied', () => {
    const range = getVisibleTimelineRange(
      {
        pxPerSecond: 10,
        scrollLeft: 0,
        viewportWidth: 500
      },
      120,
      18
    );

    expect(range.start).toBe(0);
    expect(range.end).toBe(48.2);
  });

  it('fits long timelines into the viewport when possible', () => {
    expect(fitTimelinePxPerSecond(100, 1000)).toBe(10);
    expect(fitTimelinePxPerSecond(100, 1000, 0.08, 620, 18)).toBe(9.64);
    expect(fitTimelinePxPerSecond(0, 1000)).toBe(TIMELINE_DEFAULT_PX_PER_SECOND);
  });

  it('keeps the anchor time stable while zooming around the cursor', () => {
    const next = zoomTimelineAroundAnchor({
      duration: 300,
      currentPxPerSecond: 10,
      nextPxPerSecond: 20,
      scrollLeft: 500,
      anchorX: 250,
      viewportWidth: 1000
    });

    expect(next.anchorTime).toBe(75);
    expect(next.scrollLeft).toBe(1250);
  });

  it('keeps the anchor stable while zooming with padded timeline edges', () => {
    const next = zoomTimelineAroundAnchor({
      duration: 300,
      currentPxPerSecond: 10,
      nextPxPerSecond: 20,
      scrollLeft: 0,
      anchorX: 268,
      viewportWidth: 1000,
      edgePadding: 18
    });

    expect(next.anchorTime).toBe(25);
    expect(next.scrollLeft).toBe(250);
  });

  it('clamps zoom to the editor maximum', () => {
    const next = zoomTimelineAroundAnchor({
      duration: 300,
      currentPxPerSecond: 20,
      nextPxPerSecond: TIMELINE_MAX_PX_PER_SECOND * 4,
      scrollLeft: 0,
      anchorX: 400,
      viewportWidth: 1000
    });

    expect(next.pxPerSecond).toBe(TIMELINE_MAX_PX_PER_SECOND);
  });
});

describe('timeline item layout', () => {
  it('stacks overlapping items into separate lanes', () => {
    const result = layoutTimelineItems(
      [
        { id: 'a', start: 0, end: 3 },
        { id: 'b', start: 1, end: 2 },
        { id: 'c', start: 3.2, end: 4 }
      ],
      (item) => item
    );

    expect(result.laneCount).toBe(2);
    expect(result.layouts.map((layout) => [layout.item.id, layout.lane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0]
    ]);
  });
});
