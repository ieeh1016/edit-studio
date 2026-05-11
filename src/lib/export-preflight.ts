import type {
  ClipTransition,
  ExportPreset,
  VideoClip,
  VideoDimensions
} from './types';
import { getEditTimelineDuration } from './video-edit';

export type ExportRiskLevel = 'low' | 'medium' | 'high';

export interface ExportPreflightInput {
  sourceDuration: number;
  dimensions: VideoDimensions;
  preset: ExportPreset;
  clips: VideoClip[];
  transitions: ClipTransition[];
  hasAudio: boolean | null;
  fileSize?: number;
}

export interface ExportPreflightResult {
  duration: number;
  clipCount: number;
  transitionCount: number;
  hasAudio: boolean | null;
  risk: ExportRiskLevel;
  messages: string[];
}

export function createExportPreflightResult({
  sourceDuration,
  dimensions,
  preset,
  clips,
  transitions,
  hasAudio,
  fileSize = 0
}: ExportPreflightInput): ExportPreflightResult {
  const duration = getEditTimelineDuration(clips, transitions) || Math.max(0, sourceDuration);
  const messages: string[] = [];
  let score = 0;

  if (hasAudio === false) {
    messages.push('원본에 오디오가 감지되지 않아 무음 트랙으로 렌더합니다.');
  } else if (hasAudio === null) {
    messages.push('오디오 감지 결과가 불확실합니다. 실패하면 무음 트랙으로 다시 시도해 보세요.');
    score += 1;
  }

  if (duration > 20 * 60) {
    messages.push('20분 이상 긴 영상은 브라우저 메모리 사용량이 커질 수 있습니다.');
    score += 2;
  } else if (duration > 8 * 60) {
    messages.push('긴 영상입니다. 먼저 720p 빠른 렌더로 확인하는 것을 권장합니다.');
    score += 1;
  }

  if (preset === 'source' && dimensions.width * dimensions.height > 1920 * 1080) {
    messages.push('원본 해상도 렌더는 시간이 오래 걸릴 수 있습니다.');
    score += 2;
  }

  if (fileSize > 1_500_000_000) {
    messages.push('원본 파일이 커서 브라우저 메모리 부족이 발생할 수 있습니다.');
    score += 2;
  }

  if (clips.length >= 20 || transitions.length >= 10) {
    messages.push('조각 또는 전환이 많아 필터 그래프가 복잡합니다.');
    score += 1;
  }

  return {
    duration,
    clipCount: clips.length,
    transitionCount: transitions.length,
    hasAudio,
    risk: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low',
    messages
  };
}
