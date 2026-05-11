import { describe, expect, it } from 'vitest';
import { buildAssScript, escapeAssText, hexToAssColor } from '../src/lib/ass';
import { getCueDiagnostics } from '../src/lib/diagnostics';
import { createExportPreflightResult } from '../src/lib/export-preflight';
import { inferFontVariantFromName } from '../src/lib/fonts';
import { buildVideoEditFilterGraph, getExportDimensions } from '../src/lib/ffmpeg';
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory
} from '../src/lib/history';
import { normalizeProjectFile } from '../src/lib/project';
import {
  buildAtempoChain,
  createOrUpdateTransition,
  getClipTimelineRanges,
  getEditTimelineDuration,
  removeTimelineRange,
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
    expect(script).toContain('\\pos(960,216)');
    expect(script).toContain('\\fscx125');
    expect(script).toContain('\\fscy80');
    expect(script).toContain('\\pos(480,378)');
    expect(script).toContain('터치');
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
    expect(project.effects[0].kind).toBe('tap');
    expect(project.effects[0].x).toBe(0);
    expect(project.effects[0].y).toBe(100);
    expect(project.effects[0].size).toBe(260);
    expect(project.videoClips?.[0].speed).toBe(4);
    expect(project.videoClips?.[0].muted).toBe(true);
    expect(project.transitions?.[0].kind).toBe('fade');
    expect(project.transitions?.[0].duration).toBeLessThanOrEqual(0.5);
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

  it('splits one source clip when removing a middle section', () => {
    const result = removeTimelineRange([clips[0]], [], 1, 2.5);

    expect(result?.clips).toHaveLength(2);
    expect(result?.clips[0].sourceStart).toBe(0);
    expect(result?.clips[0].sourceEnd).toBe(1);
    expect(result?.clips[1].sourceStart).toBe(2.5);
    expect(result?.clips[1].sourceEnd).toBe(4);
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
    expect(graph).toContain('xfade=transition=slideleft');
    expect(graph).toContain('acrossfade=d=0.5');
    expect(graph).toContain('subtitles=captions.ass:fontsdir=fonts-test');
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
      transitions: []
    });
    const changed = commitEditorHistory(initial, {
      cues: [initialCue, nextCue],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: []
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
      transitions: []
    });
    const first = commitEditorHistory(initial, {
      cues: [{ ...cue, text: 'AB' }],
      overlays: [],
      effects: [],
      videoClips: [],
      transitions: []
    });
    const second = commitEditorHistory(
      first,
      {
        cues: [{ ...cue, text: 'ABC' }],
        overlays: [],
        effects: [],
        videoClips: [],
        transitions: []
      },
      { merge: true }
    );

    expect(second.past).toHaveLength(1);
    expect(undoEditorHistory(second).present.cues[0].text).toBe('A');
  });
});
