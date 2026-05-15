import { describe, expect, it } from 'vitest';
import { buildAssScript, escapeAssText, hexToAssColor } from '../src/lib/ass';
import {
  getAudioClipDuration,
  moveAudioClipTo,
  trimAudioClip
} from '../src/lib/audio-edit';
import { getCueDiagnostics } from '../src/lib/diagnostics';
import { createExportPreflightResult } from '../src/lib/export-preflight';
import { inferFontVariantFromName } from '../src/lib/fonts';
import { createKeyframe, getKeyframedValue } from '../src/lib/keyframes';
import { buildVideoEditFilterGraph, getExportDimensions } from '../src/lib/ffmpeg';
import { getEffectExportGlyph } from '../src/lib/effect-rendering';
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory
} from '../src/lib/history';
import { normalizeProjectFile } from '../src/lib/project';
import { shiftTimedItemsToRenderWindow } from '../src/lib/render-window';
import { wrapTextForRender } from '../src/lib/text-wrap';
import {
  buildAtempoChain,
  createOrUpdateTransition,
  extractTimelineRange,
  getClipTimelineRanges,
  getEditTimelineDuration,
  moveClipByOffset,
  removeTimelineRange,
  reorderClipRipple,
  splitClipAtTimelineTime
} from '../src/lib/video-edit';
import {
  cuesToSrt,
  cuesToVtt,
  createCue,
  parseSrt,
  parseVtt,
  sortAndResolveCueOverlaps
} from '../src/lib/subtitle';

describe('subtitle parsing and formatting', () => {
  it('parses SRT cues and preserves multiline text', () => {
    const cues = parseSrt(`1
00:00:01,000 --> 00:00:03,250
안녕하세요
두 번째 줄

2
00:00:04,000 --> 00:00:05,000
다음 자막`);

    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(3.25);
    expect(cues[0].text).toBe('안녕하세요\n두 번째 줄');
  });

  it('parses WebVTT cues with cue identifiers', () => {
    const cues = parseVtt(`WEBVTT

intro
00:00:01.500 --> 00:00:02.500
첫 문장`);

    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBe(1.5);
    expect(cues[0].text).toBe('첫 문장');
  });

  it('exports cues to SRT and VTT', () => {
    const cues = parseSrt(`1
00:00:01,000 --> 00:00:02,000
테스트`);

    expect(cuesToSrt(cues)).toContain('00:00:01,000 --> 00:00:02,000');
    expect(cuesToVtt(cues)).toMatch(/^WEBVTT/);
  });

  it('sorts cues and trims simple overlaps', () => {
    const cues = parseSrt(`1
00:00:03,000 --> 00:00:05,000
B

2
00:00:01,000 --> 00:00:04,000
A`);
    const resolved = sortAndResolveCueOverlaps(cues);

    expect(resolved[0].text).toBe('A');
    expect(resolved[0].end).toBeLessThanOrEqual(resolved[1].start);
  });

  it('reports empty and overlapping cues', () => {
    const cues = [
      ...parseSrt(`1
00:00:01,000 --> 00:00:04,000
A

2
00:00:03,000 --> 00:00:05,000
 B`),
      createCue(6, 7, ' ')
    ];

    expect(getCueDiagnostics(cues)).toEqual({
      emptyTextCount: 1,
      invalidTimeCount: 0,
      overlapCount: 1
    });
  });
});

describe('ASS export helpers', () => {
  it('escapes ASS control characters and newlines', () => {
    expect(escapeAssText('A {tag}\\nB\nC')).toBe('A \\{tag\\}\\\\nB\\NC');
  });

  it('converts CSS colors to ASS BGR color format', () => {
    expect(hexToAssColor('#123456')).toBe('&H00563412&');
  });

  it('converts RGBA opacity to ASS alpha', () => {
    expect(hexToAssColor('rgba(18, 52, 86, 0.5)')).toBe('&H80563412&');
  });

  it('wraps overlay text with the same render-window helper used by export', () => {
    const wrapped = wrapTextForRender('가나다라마바사아자차카타파하', {
      wrapMode: 'auto',
      boxWidth: 20,
      canvasWidth: 400,
      fontSize: 40,
      scaleX: 1
    });

    expect(wrapped.split('\n').length).toBeGreaterThan(1);
  });

  it('builds an ASS document with Korean text and overlay events', () => {
    const cues = parseSrt(`1
00:00:01,000 --> 00:00:02,000
한국어 자막`);
    const script = buildAssScript(
      cues,
      [
        {
          id: 'text-1',
          start: 1,
          end: 2,
          text: '타이틀',
          x: 50,
          y: 20,
          fontFamily: 'AppleGothicLocal',
          fontSize: 52,
          fontWeight: 900,
          italic: true,
          underline: true,
          align: 'left',
          scaleX: 1.25,
          scaleY: 0.8,
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0.4)',
          outlineColor: '#000000',
          outlineWidth: 2,
          shadow: true
        }
      ],
      { width: 1920, height: 1080 },
      [
        {
          id: 'effect-1',
          start: 1,
          end: 1.8,
          kind: 'tap',
          x: 25,
          y: 35,
          size: 80,
          color: '#22c3aa',
          label: '터치'
        }
      ]
    );

    expect(script).toContain('Fontname');
    expect(script).toContain('한국어 자막');
    expect(script).toContain('\\fnAppleGothic');
    expect(script).toContain('\\an4');
    expect(script).toContain('\\b900');
    expect(script).toContain('\\i1');
    expect(script).toContain('\\u1');
    expect(script).toContain('\\pos(975,216)');
    expect(script).toContain('\\fscx125');
    expect(script).toContain('\\fscy80');
    expect(script).toContain('\\pos(480,378)');
    expect(script).toContain(getEffectExportGlyph('tap'));
    expect(script).toContain('터치');
  });

  it('falls back to the bundled export font when restored local fonts are missing', () => {
    const script = buildAssScript(
      [],
      [
        {
          id: 'text-1',
          start: 0,
          end: 2,
          text: '복구된 텍스트',
          x: 50,
          y: 50,
          fontFamily: 'Missing Imported Font',
          fontSize: 52,
          fontWeight: 700,
          italic: false,
          underline: false,
          align: 'center',
          scaleX: 1,
          scaleY: 1,
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0.4)',
          outlineColor: '#000000',
          outlineWidth: 2,
          shadow: true
        }
      ],
      { width: 1280, height: 720 },
      [],
      { availableFontFamilies: ['AppleGothicLocal', 'AppleGothic'] }
    );

    expect(script).toContain('\\fnAppleGothic');
    expect(script).not.toContain('Missing Imported Font');
  });

  it('emits explicit ASS newlines for auto-wrapped overlay text', () => {
    const script = buildAssScript(
      [],
      [
        {
          id: 'text-1',
          start: 0,
          end: 2,
          text: '가나다라마바사아자차카타파하',
          x: 50,
          y: 50,
          fontFamily: 'AppleGothicLocal',
          fontSize: 40,
          fontWeight: 700,
          italic: false,
          underline: false,
          align: 'center',
          scaleX: 1,
          scaleY: 1,
          boxWidth: 20,
          wrapMode: 'auto',
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0)',
          outlineColor: '#000000',
          outlineWidth: 1,
          shadow: false
        }
      ],
      { width: 400, height: 300 }
    );

    expect(script).toContain('\\N');
  });

  it('renders text overlay backgrounds as separate ASS drawing boxes', () => {
    const script = buildAssScript(
      [],
      [
        {
          id: 'text-1',
          start: 0,
          end: 2,
          text: '배경 텍스트',
          x: 50,
          y: 50,
          fontFamily: 'AppleGothicLocal',
          fontSize: 48,
          fontWeight: 700,
          italic: false,
          underline: false,
          align: 'center',
          scaleX: 1,
          scaleY: 1,
          boxWidth: 40,
          wrapMode: 'auto',
          color: '#ffffff',
          background: 'rgba(1, 2, 3, 0.5)',
          outlineColor: '#ff0000',
          outlineWidth: 2,
          shadow: true
        }
      ],
      { width: 1000, height: 600 }
    );

    expect(script).toContain('Style: OverlayBox');
    expect(script).toContain('Dialogue: 2,0:00:00.00,0:00:02.00,OverlayBox');
    expect(script).toContain('\\p1');
    expect(script).toContain('\\c&H00030201&');
    expect(script).toContain('\\1a&H80&');
    expect(script).toContain('Dialogue: 3,0:00:00.00,0:00:02.00,Overlay');
    expect(script).toContain('\\3c&H000000FF&');
    expect(script).toContain('\\4c&H000000FF&');
  });

  it('does not emit ASS drawing boxes for transparent text backgrounds', () => {
    const script = buildAssScript(
      [],
      [
        {
          id: 'text-1',
          start: 0,
          end: 2,
          text: '투명 배경',
          x: 50,
          y: 50,
          fontFamily: 'AppleGothicLocal',
          fontSize: 48,
          fontWeight: 700,
          italic: false,
          underline: false,
          align: 'center',
          scaleX: 1,
          scaleY: 1,
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0)',
          outlineColor: '#000000',
          outlineWidth: 1,
          shadow: false
        }
      ],
      { width: 1000, height: 600 }
    );

    expect(script).not.toContain('Dialogue: 2,0:00:00.00,0:00:02.00,OverlayBox');
    expect(script).toContain('Dialogue: 3,0:00:00.00,0:00:02.00,Overlay');
  });

  it('keeps left aligned overlay text padded inside a text-sized background box', () => {
    const script = buildAssScript(
      [],
      [
        {
          id: 'text-1',
          start: 0,
          end: 2,
          text: 'Hi',
          x: 10,
          y: 20,
          fontFamily: 'AppleGothicLocal',
          fontSize: 50,
          fontWeight: 700,
          italic: false,
          underline: false,
          align: 'left',
          scaleX: 1,
          scaleY: 1,
          boxWidth: 40,
          wrapMode: 'auto',
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0.5)',
          outlineColor: '#000000',
          outlineWidth: 1,
          shadow: false
        }
      ],
      { width: 1000, height: 600 }
    );

    expect(script).toContain('Dialogue: 2,0:00:00.00,0:00:02.00,OverlayBox');
    expect(script).toContain('\\pos(100,84)');
    expect(script).toContain('Dialogue: 3,0:00:00.00,0:00:02.00,Overlay');
    expect(script).toContain('\\pos(112,120)');
    expect(script).not.toContain('l 394 0');
  });

  it('uses the exported internal font family when an imported font is available', () => {
    const script = buildAssScript(
      [],
      [
        {
          id: 'text-1',
          start: 0,
          end: 2,
          text: 'Custom Font',
          x: 50,
          y: 50,
          fontFamily: 'Preview Alias',
          fontSize: 48,
          fontWeight: 700,
          italic: false,
          underline: false,
          align: 'center',
          scaleX: 1,
          scaleY: 1,
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0)',
          outlineColor: '#000000',
          outlineWidth: 1,
          shadow: false
        }
      ],
      { width: 1280, height: 720 },
      [],
      {
        fontFaces: [
          {
            family: 'Preview Alias',
            exportFamily: 'Internal Font Family',
            weight: 700,
            style: 'normal',
            supportsHangul: true
          }
        ]
      }
    );

    expect(script).toContain('\\fnInternal Font Family');
  });

  it('falls back to the bundled Korean font when the selected imported font lacks Hangul', () => {
    const script = buildAssScript(
      [],
      [
        {
          id: 'text-1',
          start: 0,
          end: 2,
          text: '한국어 텍스트',
          x: 50,
          y: 50,
          fontFamily: 'Latin Only',
          fontSize: 48,
          fontWeight: 400,
          italic: false,
          underline: false,
          align: 'center',
          scaleX: 1,
          scaleY: 1,
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0)',
          outlineColor: '#000000',
          outlineWidth: 1,
          shadow: false
        }
      ],
      { width: 1280, height: 720 },
      [],
      {
        fontFaces: [
          {
            family: 'Latin Only',
            exportFamily: 'Latin Only Internal',
            weight: 400,
            style: 'normal',
            supportsHangul: false
          }
        ]
      }
    );

    expect(script).toContain('\\fnAppleGothic');
    expect(script).not.toContain('\\fnLatin Only Internal');
  });
});

describe('render window helpers', () => {
  it('shifts timed layers into a partial render timeline', () => {
    const shifted = shiftTimedItemsToRenderWindow(
      [
        { id: 'before', start: 0, end: 1 },
        { id: 'covering-start', start: 9, end: 12 },
        { id: 'inside', start: 11, end: 13 },
        { id: 'covering-end', start: 13, end: 18 },
        { id: 'after', start: 20, end: 21 }
      ],
      10,
      15
    );

    expect(shifted).toEqual([
      { id: 'covering-start', start: 0, end: 2 },
      { id: 'inside', start: 1, end: 3 },
      { id: 'covering-end', start: 3, end: 5 }
    ]);
  });
});

describe('project file normalization', () => {
  it('sanitizes malformed project values before they reach the UI', () => {
    const project = normalizeProjectFile({
      version: 1,
      videoName: 12,
      mediaMeta: {
        name: 'source.mp4',
        size: 1234.4,
        lastModified: 1700000000000,
        duration: 10.2,
        width: 1920.6,
        height: 1080.2
      },
      cues: [
        {
          id: 7,
          start: Number.NaN,
          end: 0.01,
          text: 'A',
          position: 'floating',
          style: {
            fontSize: 999,
            fontWeight: 50,
            color: 'red',
            background: 'not-a-color',
            outlineWidth: -10,
            align: 'wide'
          }
        }
      ],
      overlays: [
        {
          start: 3,
          end: 1,
          x: -20,
          y: 140,
          color: '#111111'
        }
      ],
      effects: [
        {
          start: 4,
          end: 4.02,
          kind: 'drag',
          x: -10,
          y: 120,
          size: 999,
          color: 'green'
        }
      ],
      videoClips: [
        {
          id: 'clip-a',
          sourceStart: 0,
          sourceEnd: 4,
          speed: 8,
          muted: true
        },
        {
          id: 'clip-b',
          sourceStart: 4,
          sourceEnd: 6,
          speed: 1,
          muted: false
        }
      ],
      transitions: [
        {
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          kind: 'spin',
          duration: 10
        }
      ],
      audioSources: [
        {
          id: 'audio-source-1',
          name: 'bgm.mp3',
          size: 2048,
          lastModified: 1700000000001,
          duration: 12,
          kind: 'music'
        }
      ],
      audioClips: [
        {
          id: 'audio-clip-1',
          sourceId: 'audio-source-1',
          start: 2,
          end: 6,
          sourceStart: 1,
          sourceEnd: 5,
          volume: 3,
          muted: false,
          fadeIn: 9,
          fadeOut: 1,
          label: 'BGM'
        }
      ]
    });

    expect(project.videoName).toBeUndefined();
    expect(project.mediaMeta).toEqual({
      name: 'source.mp4',
      size: 1234.4,
      lastModified: 1700000000000,
      duration: 10.2,
      width: 1921,
      height: 1080
    });
    expect(project.cues[0].start).toBe(0);
    expect(project.cues[0].end).toBeGreaterThanOrEqual(0.2);
    expect(project.cues[0].position).toBe('bottom');
    expect(project.cues[0].style.fontFamily).toBe('AppleGothicLocal');
    expect(project.cues[0].style.fontSize).toBe(180);
    expect(project.cues[0].style.fontWeight).toBe(100);
    expect(project.cues[0].style.color).toBe('#ffffff');
    expect(project.overlays[0].x).toBe(0);
    expect(project.overlays[0].y).toBe(100);
    expect(project.overlays[0].fontFamily).toBe('AppleGothicLocal');
    expect(project.overlays[0].fontWeight).toBe(800);
    expect(project.overlays[0].italic).toBe(false);
    expect(project.overlays[0].underline).toBe(false);
    expect(project.overlays[0].align).toBe('center');
    expect(project.overlays[0].scaleX).toBe(1);
    expect(project.overlays[0].scaleY).toBe(1);
    expect(project.overlays[0].boxWidth).toBe(56);
    expect(project.overlays[0].wrapMode).toBe('auto');
    expect(project.effects[0].kind).toBe('tap');
    expect(project.effects[0].x).toBe(0);
    expect(project.effects[0].y).toBe(100);
    expect(project.effects[0].size).toBe(260);
    expect(project.mediaSources?.[0]).toMatchObject({
      id: 'primary-video-source',
      kind: 'video',
      name: 'source.mp4'
    });
    expect(project.videoClips?.[0].speed).toBe(4);
    expect(project.videoClips?.[0].muted).toBe(true);
    expect(project.videoClips?.[0].sourceId).toBe('primary-video-source');
    expect(project.videoClips?.[0].scale).toBe(1);
    expect(project.transitions?.[0].kind).toBe('fade');
    expect(project.transitions?.[0].duration).toBeLessThanOrEqual(0.5);
    expect(project.audioSources?.[0].kind).toBe('music');
    expect(project.audioClips?.[0].volume).toBe(2);
    expect(project.audioClips?.[0].fadeIn).toBe(2);
  });
});

describe('keyframe interpolation', () => {
  it('interpolates values between keyframes with easing', () => {
    const keyframes = [
      createKeyframe('video', 'clip-a', 'x', 0, 20, 'linear'),
      createKeyframe('video', 'clip-a', 'x', 10, 80, 'ease-in-out')
    ];

    expect(getKeyframedValue(keyframes, 'video', 'clip-a', 'x', -1, 50)).toBe(20);
    expect(getKeyframedValue(keyframes, 'video', 'clip-a', 'x', 10, 50)).toBe(80);
    expect(getKeyframedValue(keyframes, 'video', 'clip-a', 'x', 5, 50)).toBeCloseTo(50, 4);
  });
});

describe('font variant helpers', () => {
  it('infers common Korean font weights and italic styles from file names', () => {
    expect(inferFontVariantFromName('NotoSansKR-Thin.ttf')).toEqual({
      weight: 100,
      style: 'normal'
    });
    expect(inferFontVariantFromName('Pretendard-ExtraLight.otf')).toEqual({
      weight: 200,
      style: 'normal'
    });
    expect(inferFontVariantFromName('Noto Sans KR SemiBold Italic.ttf')).toEqual({
      weight: 600,
      style: 'italic'
    });
    expect(inferFontVariantFromName('NanumGothic-Black.otf')).toEqual({
      weight: 900,
      style: 'normal'
    });
  });
});

describe('export sizing', () => {
  it('keeps source dimensions for source preset', () => {
    expect(getExportDimensions({ width: 1920, height: 1080 }, 'source')).toEqual({
      width: 1920,
      height: 1080
    });
  });

  it('scales tall videos to 720p with even width', () => {
    expect(getExportDimensions({ width: 1920, height: 1080 }, 'fast720')).toEqual({
      width: 1280,
      height: 720
    });
  });

  it('supports shorts and sanitized custom export dimensions', () => {
    expect(getExportDimensions({ width: 1920, height: 1080 }, 'shorts1080')).toEqual({
      width: 1080,
      height: 1920
    });
    expect(
      getExportDimensions({ width: 1920, height: 1080 }, 'custom', {
        width: 1001,
        height: Number.NaN
      })
    ).toEqual({
      width: 1002,
      height: 2
    });
  });
});

describe('video clip editing', () => {
  const clips = [
    {
      id: 'clip-a',
      sourceStart: 0,
      sourceEnd: 4,
      speed: 1,
      muted: false
    },
    {
      id: 'clip-b',
      sourceStart: 4,
      sourceEnd: 10,
      speed: 2,
      muted: false
    }
  ];

  it('splits clips and recalculates output duration', () => {
    const result = splitClipAtTimelineTime(clips, [], 2);

    expect(result?.clips).toHaveLength(3);
    expect(result?.clips[0].sourceEnd).toBe(2);
    expect(result?.clips[1].sourceStart).toBe(2);
    expect(getEditTimelineDuration(result?.clips ?? [], [])).toBe(7);
  });

  it('clamps transition duration between adjacent clips', () => {
    const transitions = createOrUpdateTransition(clips, [], 'clip-a', 'fade', 5);
    const ranges = getClipTimelineRanges(clips, transitions);

    expect(transitions[0].duration).toBe(1.5);
    expect(ranges[1].start).toBe(2.5);
    expect(getEditTimelineDuration(clips, transitions)).toBe(5.5);
  });

  it('builds safe atempo chains for extreme speed values', () => {
    expect(buildAtempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(buildAtempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
  });

  it('removes a marked timeline range and ripples the remaining clips', () => {
    const result = removeTimelineRange(clips, [], 1, 5);

    expect(result?.clips).toHaveLength(2);
    expect(result?.clips[0].sourceStart).toBe(0);
    expect(result?.clips[0].sourceEnd).toBe(1);
    expect(result?.clips[1].sourceStart).toBe(6);
    expect(result?.clips[1].sourceEnd).toBe(10);
    expect(getEditTimelineDuration(result?.clips ?? [], [])).toBe(3);
  });

  it('extracts an IN/OUT range across clips for partial MP4 rendering', () => {
    const result = extractTimelineRange(clips, [], 1, 5);

    expect(result?.clips).toHaveLength(2);
    expect(result?.clips[0].sourceStart).toBe(1);
    expect(result?.clips[0].sourceEnd).toBe(4);
    expect(result?.clips[1].sourceStart).toBe(4);
    expect(result?.clips[1].sourceEnd).toBe(6);
    expect(result?.transitions).toHaveLength(0);
    expect(getEditTimelineDuration(result?.clips ?? [], result?.transitions ?? [])).toBe(4);
  });

  it('preserves fully visible transitions when extracting a render range', () => {
    const transitions = createOrUpdateTransition(clips, [], 'clip-a', 'fade', 1);
    const result = extractTimelineRange(clips, transitions, 2, 5);

    expect(result?.clips).toHaveLength(2);
    expect(result?.transitions).toHaveLength(1);
    expect(result?.transitions[0].duration).toBe(1);
    expect(getEditTimelineDuration(result?.clips ?? [], result?.transitions ?? [])).toBe(3);
  });

  it('splits one source clip when removing a middle section', () => {
    const result = removeTimelineRange([clips[0]], [], 1, 2.5);

    expect(result?.clips).toHaveLength(2);
    expect(result?.clips[0].sourceStart).toBe(0);
    expect(result?.clips[0].sourceEnd).toBe(1);
    expect(result?.clips[1].sourceStart).toBe(2.5);
    expect(result?.clips[1].sourceEnd).toBe(4);
  });

  it('moves and trims audio clips while preserving source timing', () => {
    const source = {
      id: 'audio-source',
      name: 'music.mp3',
      size: 100,
      lastModified: 1000,
      duration: 10,
      kind: 'music' as const
    };
    const clip = {
      id: 'audio-clip',
      sourceId: source.id,
      start: 2,
      end: 6,
      sourceStart: 1,
      sourceEnd: 5,
      volume: 1,
      muted: false,
      fadeIn: 0,
      fadeOut: 0,
      label: 'Music'
    };

    expect(getAudioClipDuration(clip)).toBe(4);
    expect(moveAudioClipTo(clip, 4, 20)).toMatchObject({ start: 4, end: 8 });
    expect(trimAudioClip(clip, 'start', 3, source)).toMatchObject({
      start: 3,
      sourceStart: 2
    });
    expect(trimAudioClip(clip, 'end', 4, source)).toMatchObject({
      end: 4,
      sourceEnd: 3
    });
  });

  it('reorders cut clips without changing their source ranges', () => {
    const result = reorderClipRipple(clips, [], 'clip-b', 0);

    expect(result?.clips.map((clip) => clip.id)).toEqual(['clip-b', 'clip-a']);
    expect(result?.clips[0].sourceStart).toBe(4);
    expect(result?.clips[0].sourceEnd).toBe(10);
    expect(result?.selectedClipId).toBe('clip-b');
    expect(result?.fromIndex).toBe(1);
    expect(result?.toIndex).toBe(0);
  });

  it('keeps only transitions that still connect adjacent clips after reorder', () => {
    const threeClips = [
      ...clips,
      {
        id: 'clip-c',
        sourceStart: 10,
        sourceEnd: 12,
        speed: 1,
        muted: false
      }
    ];
    const transitions = createOrUpdateTransition(
      threeClips,
      createOrUpdateTransition(threeClips, [], 'clip-a', 'fade', 0.5),
      'clip-b',
      'slideleft',
      0.5
    );
    const result = moveClipByOffset(threeClips, transitions, 'clip-c', -2);

    expect(result?.clips.map((clip) => clip.id)).toEqual(['clip-c', 'clip-a', 'clip-b']);
    expect(result?.transitions).toHaveLength(1);
    expect(result?.transitions[0].fromClipId).toBe('clip-a');
    expect(result?.transitions[0].toClipId).toBe('clip-b');
  });

  it('builds an FFmpeg filter graph with trim, speed and transition filters', () => {
    const transitions = createOrUpdateTransition(clips, [], 'clip-a', 'slideleft', 0.5);
    const graph = buildVideoEditFilterGraph({
      clips,
      transitions,
      outputDimensions: { width: 1280, height: 720 },
      subtitleName: 'captions.ass',
      fontDirName: 'fonts-test'
    });

    expect(graph).toContain('trim=start=0:end=4');
    expect(graph).toContain('setpts=(PTS-STARTPTS)/2');
    expect(graph).toContain('force_original_aspect_ratio=increase');
    expect(graph).toContain('xfade=transition=slideleft');
    expect(graph).toContain('acrossfade=d=0.5');
    expect(graph).toContain('subtitles=captions.ass:fontsdir=fonts-test');
  });

  it('can build a letterbox-style graph that preserves the full source frame', () => {
    const graph = buildVideoEditFilterGraph({
      clips: [clips[0]],
      transitions: [],
      outputDimensions: { width: 1920, height: 1080 },
      fitMode: 'contain',
      subtitleName: 'captions.ass'
    });

    expect(graph).toContain('force_original_aspect_ratio=decrease');
    expect(graph).toContain('color=c=black:s=1920x1080');
    expect(graph).toContain('[bg0][vf0]overlay');
  });

  it('can build a stretched graph when aspect ratio preservation is disabled', () => {
    const graph = buildVideoEditFilterGraph({
      clips: [clips[0]],
      transitions: [],
      outputDimensions: { width: 1920, height: 1080 },
      fitMode: 'stretch',
      subtitleName: 'captions.ass'
    });

    expect(graph).toContain('scale=w=1920:h=1080:flags=lanczos');
    expect(graph).not.toContain('force_original_aspect_ratio');
  });

  it('adds multi-source video inputs and timed image overlays to the export graph', () => {
    const graph = buildVideoEditFilterGraph({
      clips: [
        clips[0],
        {
          ...clips[1],
          sourceId: 'second-video'
        }
      ],
      transitions: [],
      outputDimensions: { width: 1280, height: 720 },
      subtitleName: 'captions.ass',
      videoInputIndexes: { 'second-video': 1 },
      imageInputIndexes: { logo: 2 },
      imageClips: [
        {
          id: 'image-1',
          sourceId: 'logo',
          start: 1,
          end: 3,
          x: 75,
          y: 15,
          scale: 0.5,
          rotation: 0,
          opacity: 0.8
        }
      ]
    });

    expect(graph).toContain('[1:v]trim=start=4:end=10');
    expect(graph).toContain('[2:v]scale=iw*0.5');
    expect(graph).toContain("enable='between(t,1,3)'");
    expect(graph).toContain('colorchannelmixer=aa=0.8');
  });

  it('uses a silent audio fallback when the source has no audio stream', () => {
    const graph = buildVideoEditFilterGraph({
      clips,
      transitions: [],
      outputDimensions: { width: 1280, height: 720 },
      subtitleName: 'captions.ass',
      hasAudio: false
    });

    expect(graph).toContain('anullsrc=channel_layout=stereo');
    expect(graph).not.toContain('[0:a]atrim');
    expect(graph).toContain('concat=n=2:v=0:a=1');
  });

  it('applies video clip volume and fade filters to source audio', () => {
    const graph = buildVideoEditFilterGraph({
      clips: [{ ...clips[0], volume: 0.45, fadeIn: 0.5, fadeOut: 0.75 }],
      transitions: [],
      outputDimensions: { width: 1280, height: 720 },
      subtitleName: 'captions.ass'
    });

    expect(graph).toContain('volume=0.45');
    expect(graph).toContain('afade=t=in:st=0:d=0.5');
    expect(graph).toContain('afade=t=out:st=3.25:d=0.75');
  });

  it('mixes external music and sound effect clips into the export graph', () => {
    const graph = buildVideoEditFilterGraph({
      clips: [clips[0]],
      transitions: [],
      outputDimensions: { width: 1280, height: 720 },
      subtitleName: 'captions.ass',
      audioInputIndexes: { music: 1 },
      audioClips: [
        {
          id: 'audio-1',
          sourceId: 'music',
          start: 1,
          end: 3,
          sourceStart: 0.5,
          sourceEnd: 2.5,
          volume: 0.8,
          muted: false,
          fadeIn: 0.25,
          fadeOut: 0.5,
          label: 'BGM'
        }
      ]
    });

    expect(graph).toContain('[1:a]atrim=start=0.5:end=2.5');
    expect(graph).toContain('adelay=1000|1000');
    expect(graph).toContain('amix=inputs=2:duration=first');
  });

  it('reports export preflight risks before rendering', () => {
    const result = createExportPreflightResult({
      sourceDuration: 1500,
      dimensions: { width: 3840, height: 2160 },
      preset: 'source',
      clips,
      transitions: createOrUpdateTransition(clips, [], 'clip-a', 'fade', 0.5),
      hasAudio: false,
      fileSize: 2_000_000_000
    });

    expect(result.risk).toBe('high');
    expect(result.messages.join(' ')).toContain('무음 트랙');
    expect(result.messages.join(' ')).toContain('브라우저 메모리');
  });
});

describe('editor history', () => {
  it('supports undo and redo of editor snapshots', () => {
    const initialCue = createCue(0, 1, 'A');
    const nextCue = createCue(1, 2, 'B');
    const initial = createEditorHistory({
      cues: [initialCue],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: [],
      audioSources: [],
      audioClips: []
    });
    const changed = commitEditorHistory(initial, {
      cues: [initialCue, nextCue],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: [],
      audioSources: [],
      audioClips: []
    });

    expect(changed.present.cues).toHaveLength(2);
    expect(undoEditorHistory(changed).present.cues).toHaveLength(1);
    expect(redoEditorHistory(undoEditorHistory(changed)).present.cues).toHaveLength(2);
  });

  it('can merge continuous edits into one undo step', () => {
    const cue = createCue(0, 1, 'A');
    const initial = createEditorHistory({
      cues: [cue],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: [],
      audioSources: [],
      audioClips: []
    });
    const first = commitEditorHistory(initial, {
      cues: [{ ...cue, text: 'AB' }],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: [],
      audioSources: [],
      audioClips: []
    });
    const second = commitEditorHistory(
      first,
      {
        cues: [{ ...cue, text: 'ABC' }],
        overlays: [],
        effects: [],
        videoClips: [],
        transitions: [],
        audioSources: [],
        audioClips: []
      },
      { merge: true }
    );

    expect(second.past).toHaveLength(1);
    expect(undoEditorHistory(second).present.cues[0].text).toBe('A');
  });
});
