# Edit Studio 구조 설명서

이 문서는 코드를 깊게 모르는 상태에서도 Edit Studio가 어떤 구조로 돌아가는지 이해하기 위한 안내서입니다. “어디를 고치면 무엇이 바뀌는지”를 빠르게 잡는 용도입니다.

## 한 줄 요약

Edit Studio는 서버 없이 브라우저 안에서만 동작하는 `React + Vite + TypeScript` 영상 편집 웹 앱입니다.

사용자가 영상/이미지/오디오 파일을 선택하면 파일은 서버로 올라가지 않고 브라우저 메모리에만 머뭅니다. 화면 미리보기는 HTML/CSS/브라우저 미디어 기능으로 빠르게 보여주고, MP4 저장은 `ffmpeg.wasm`으로 브라우저 안에서 렌더링합니다.

## 큰 구조

```text
사용자 파일
  ↓
브라우저 메모리 File / Object URL
  ↓
React 상태(App.tsx)
  ↓
미리보기 / 우측 패널 / 타임라인
  ↓
프로젝트 JSON 저장 또는 FFmpeg WASM MP4 export
```

핵심은 `App.tsx`가 현재 편집 상태를 들고 있고, `src/lib/*` 파일들이 자막 파싱, 타임라인 계산, 영상 조각 계산, FFmpeg 필터 그래프 생성 같은 “계산 로직”을 맡는 형태입니다.

## 사용 라이브러리

| 라이브러리 | 역할 |
| --- | --- |
| `react`, `react-dom` | 화면 UI를 구성합니다. 미리보기, 패널, 타임라인이 모두 React 컴포넌트입니다. |
| `vite` | 개발 서버와 빌드 도구입니다. `npm run dev`, `npm run build`가 Vite를 사용합니다. |
| `typescript` | 타입 안정성을 위해 사용합니다. 데이터 모델이 `src/lib/types.ts`에 모여 있습니다. |
| `@ffmpeg/ffmpeg`, `@ffmpeg/core`, `@ffmpeg/util` | 브라우저에서 FFmpeg WASM을 실행해 MP4를 렌더링합니다. 서버 렌더링이 아닙니다. |
| `lucide-react` | 상단 버튼, 탭, 도구 버튼의 아이콘을 제공합니다. |
| `vitest` | 단위 테스트 도구입니다. 자막 파싱, 타임라인 계산, FFmpeg 그래프 생성 등을 검증합니다. |
| `@vitejs/plugin-react` | Vite에서 React를 빌드하기 위한 플러그인입니다. |

## 폴더와 파일 역할

```text
src/
  App.tsx               앱 화면 대부분과 상태 관리
  main.tsx              React 앱 시작점
  styles/app.css        전체 UI 디자인
  lib/
    types.ts            프로젝트 데이터 모델 타입
    project.ts          프로젝트 JSON 불러오기/정규화
    history.ts          undo/redo 히스토리
    time.ts             시간 clamp, 포맷, 범위 계산
    subtitle.ts         SRT/WebVTT 파싱/내보내기
    ass.ts              ASS 자막 스크립트 생성
    ffmpeg.ts           MP4 export와 FFmpeg 필터 그래프
    video-edit.ts       영상 조각 split/trim/reorder/transition 계산
    audio-edit.ts       오디오 clip/volume/fade 계산
    timeline.ts         타임라인 좌표, 줌, 눈금, lane 배치 계산
    fonts.ts            폰트 가져오기/굵기 추론
    keyframes.ts        키프레임 생성과 보간 계산
    diagnostics.ts      자막 겹침/오류 진단
    export-preflight.ts export 전 위험도 점검
tests/
  subtitle.test.ts      자막, 프로젝트, 영상편집, FFmpeg, 키프레임 테스트
  timeline.test.ts      타임라인 좌표/줌/lane 테스트
public/
  fonts/AppleGothic.ttf 한국어 export 기본 폰트
docs/
  deployment-check.md   배포 확인 절차
```

## 핵심 데이터 모델

데이터 모델은 대부분 `src/lib/types.ts`에 있습니다.

| 타입 | 의미 |
| --- | --- |
| `MediaSourceMeta` | 가져온 영상/이미지/오디오 “원본 소스” 정보입니다. 파일명, 크기, 길이, 해상도 등을 저장합니다. |
| `VideoClip` | 영상 트랙의 조각입니다. 어떤 소스의 몇 초부터 몇 초까지 쓸지, 속도, 볼륨, transform/crop 값을 가집니다. |
| `ImageClip` | 이미지 소스를 타임라인에 얹는 클립입니다. 시작/종료 시간, 위치, 크기, 회전, 불투명도를 가집니다. |
| `CaptionCue` | 자막 한 줄입니다. 시작/종료 시간, 텍스트, 스타일, 위치를 가집니다. |
| `TextOverlay` | 자유 텍스트 오버레이입니다. 미리보기에서 직접 이동/크기 조절하는 텍스트입니다. |
| `InteractionEffect` | 클릭 포인터, 손가락 터치, 펄스 같은 효과입니다. |
| `AudioSourceMeta` | 외부 음악/효과음 파일의 메타 정보입니다. |
| `AudioClip` | 타임라인에 놓인 외부 오디오 클립입니다. 볼륨, 음소거, fade in/out을 가집니다. |
| `ClipTransition` | 인접한 영상 조각 사이의 Fade/Slide 전환입니다. |
| `Keyframe` | 특정 시간의 위치/크기/회전/볼륨 같은 값을 저장하는 애니메이션 포인트입니다. |
| `ProjectFile` | JSON으로 저장되는 전체 프로젝트 포맷입니다. |
| `EditorSnapshot` | undo/redo에 들어가는 현재 편집 상태입니다. |

중요한 점은 실제 영상/오디오/이미지 파일 자체는 JSON에 저장되지 않는다는 것입니다. JSON에는 “이 파일이 필요하다”는 메타 정보와 편집 데이터만 저장합니다. 그래서 다른 날 다시 열 때는 같은 원본 파일을 다시 연결해야 할 수 있습니다.

## 화면 구조

현재 화면은 크게 네 덩어리입니다.

| 영역 | 구현 위치 | 역할 |
| --- | --- | --- |
| 상단 헤더 | `App.tsx` | 가져오기, 저장, 도움말, export 프리셋, MP4 저장 버튼 |
| 중앙 미리보기 | `App.tsx` | 영상 재생, 자막/텍스트/이미지/효과 overlay 표시 |
| 우측 패널 | `App.tsx` | 미디어, 영상, 오디오, 자막, 텍스트, 효과 세부 편집 |
| 하단 타임라인 | `Timeline` 컴포넌트 in `App.tsx` | 영상/이미지/오디오/자막/텍스트/효과 시간 배치 |

`App.tsx`가 아직 큰 파일입니다. 화면이 계속 커져서 나중에는 `components/Timeline.tsx`, `components/Preview.tsx`, `components/Panels/*`처럼 분리하는 것이 좋습니다.

## 미리보기 방식

미리보기는 최종 MP4 렌더러가 아니라 브라우저 UI입니다.

- 영상: `<video>` 태그로 재생합니다.
- 자막/텍스트/효과/이미지: 영상 위에 CSS overlay로 얹습니다.
- 텍스트/효과/이미지 이동: 미리보기 위에서 pointer drag로 상태값을 바꿉니다.
- 외부 오디오: 숨겨진 `<audio>` 태그를 현재 재생 위치에 맞춰 동기화합니다.
- 파형: 외부 오디오 파일은 Web Audio API로 간단한 막대 파형을 만듭니다.

그래서 미리보기는 빠르게 반응하지만, 최종 MP4와 100% 같은 렌더러는 아닙니다. 최종 결과는 FFmpeg export가 기준입니다.

## 타임라인 방식

타임라인 계산은 `src/lib/timeline.ts`와 `Timeline` 컴포넌트가 나눠 맡습니다.

핵심 개념은 다음입니다.

- `pxPerSecond`: 1초를 화면에서 몇 px로 보여줄지 정합니다.
- `scrollLeft`: 긴 타임라인에서 현재 보고 있는 위치입니다.
- `visibleStart`, `visibleEnd`: 현재 화면에 보이는 시간 구간입니다.
- `timeToTimelineX`, `timelineXToTime`: 시간과 화면 x좌표를 서로 변환합니다.
- `layoutTimelineItems`: 겹치는 자막/텍스트/오디오 아이템을 lane으로 나눕니다.

영상 트랙은 `VideoClip` 조각을 순서대로 이어 붙입니다. 이미지/오디오/자막/텍스트/효과는 각자 시작/종료 시간이 있는 타임라인 아이템입니다.

## 영상 컷 편집 방식

영상 편집 로직은 `src/lib/video-edit.ts`에 있습니다.

- `splitClipAtTimelineTime`: 현재 재생 위치에서 영상 조각을 나눕니다.
- `removeTimelineRange`: IN/OUT 구간을 제거하고 뒤 조각을 앞으로 붙입니다.
- `reorderClipRipple`: 영상 조각 순서를 바꿉니다.
- `getClipTimelineRanges`: 각 영상 조각이 최종 타임라인에서 몇 초부터 몇 초까지인지 계산합니다.
- `normalizeTransitionsForClips`: 전환이 실제 인접 조각 사이에만 남도록 정리합니다.

여기서 “조각”은 원본 파일을 복사해 만든 파일이 아닙니다. 원본의 `sourceStart`부터 `sourceEnd`까지만 사용하겠다는 편집 데이터입니다.

## 오디오 방식

오디오는 두 종류가 있습니다.

1. 원본 영상 오디오
   - `VideoClip`에 붙어 있습니다.
   - 영상 싱크를 깨지 않기 위해 이동은 영상 조각을 따라갑니다.
   - 볼륨, 음소거, fade in/out을 조절합니다.

2. 외부 오디오
   - `AudioSourceMeta`와 `AudioClip`으로 관리합니다.
   - 음악/효과음을 가져와 타임라인에 따로 배치합니다.
   - 볼륨, 음소거, fade in/out, 시작/종료 trim이 가능합니다.
   - 타임라인에는 막대 파형이 표시됩니다.

## MP4 export 방식

MP4 저장은 `src/lib/ffmpeg.ts`가 담당합니다.

큰 흐름은 다음입니다.

```text
1. FFmpeg WASM lazy-load
2. 영상/오디오/이미지/폰트/ASS 자막 파일을 FFmpeg 가상 파일시스템에 write
3. VideoClip마다 trim, speed, crop, transform 처리
4. clip 사이 transition 처리
5. 이미지 overlay, 자막/텍스트/효과 ASS burn-in
6. 외부 오디오 trim/delay/mix
7. H.264/AAC MP4로 출력
```

사용하는 FFmpeg 개념:

- `trim`, `atrim`: 필요한 구간만 자릅니다.
- `setpts`: 영상 속도를 바꿉니다.
- `atempo`: 오디오 속도를 바꿉니다.
- `crop`, `scale`, `rotate`, `overlay`: 영상 transform/crop/image overlay를 처리합니다.
- export 맞춤 방식은 `cover`, `contain`, `stretch`로 나뉩니다. `contain`은 원본 비율을 보존하고 검은 배경 캔버스 위에 얹어 레터박스처럼 보이게 합니다.
- `xfade`: Fade/Slide 전환을 처리합니다.
- `acrossfade`: 전환 구간 오디오를 자연스럽게 겹칩니다.
- `subtitles`: ASS 자막/텍스트/효과를 burn-in합니다.
- `amix`: 외부 음악/효과음을 원본 오디오와 섞습니다.

현재 렌더링은 CPU 중심 FFmpeg WASM 방식입니다. WebGPU 렌더러가 아닙니다.

## 프로젝트 저장/복구 방식

프로젝트 저장은 `ProjectFile` JSON입니다.

저장되는 것:

- 자막, 텍스트, 효과
- 영상 조각 정보
- 이미지/오디오 클립 정보
- 미디어 소스 메타 정보
- 전환, 키프레임, 캔버스 설정

저장되지 않는 것:

- 실제 영상 파일
- 실제 이미지 파일
- 실제 오디오 파일
- 가져온 폰트 파일 본문

브라우저 자동 저장은 `localStorage`와 IndexedDB를 같이 씁니다.

- `localStorage`: 프로젝트 JSON 상태 저장
- IndexedDB: 가능하면 원본 영상 파일을 임시 보관

브라우저 저장공간 제한이 있거나 다른 컴퓨터에서 열면 원본 파일은 다시 연결해야 합니다.

## 테스트 구조

테스트는 `vitest`로 실행합니다.

```bash
npm test
```

현재 테스트 범위:

- SRT/WebVTT 파싱과 내보내기
- ASS escaping과 색상 변환
- 프로젝트 JSON 정규화
- 영상 조각 split/remove/reorder/transition
- 오디오 clip trim/move
- FFmpeg filter graph 문자열 생성
- export preflight 위험도
- 타임라인 좌표/줌/lane 계산
- keyframe 보간

빌드는 다음 명령으로 확인합니다.

```bash
npm run build
```

## 기능을 고칠 때 어디를 보면 되나

| 하고 싶은 작업 | 먼저 볼 파일 |
| --- | --- |
| 버튼/패널/미리보기 UI 수정 | `src/App.tsx`, `src/styles/app.css` |
| 전체 디자인 톤 수정 | `src/styles/app.css` |
| 데이터 모델 추가 | `src/lib/types.ts` |
| 프로젝트 JSON 호환성 수정 | `src/lib/project.ts` |
| 타임라인 줌/스크롤/좌표 계산 | `src/lib/timeline.ts`, `Timeline` in `App.tsx` |
| 영상 조각 분할/삭제/순서 변경 | `src/lib/video-edit.ts` |
| 오디오 볼륨/페이드/clip 계산 | `src/lib/audio-edit.ts` |
| 자막 파싱/내보내기 | `src/lib/subtitle.ts` |
| MP4 저장 결과 수정 | `src/lib/ffmpeg.ts`, `src/lib/ass.ts` |
| 키프레임 보간 | `src/lib/keyframes.ts` |
| 자동 저장/복구 | `App.tsx`, `src/lib/project.ts` |

## 현재 구조의 아쉬운 점

- `App.tsx`가 너무 큽니다. 기능은 들어갔지만 컴포넌트 분리가 필요합니다.
- 미리보기와 FFmpeg export가 서로 다른 렌더러라서 일부 스타일은 미세하게 다를 수 있습니다.
- 실제 파일은 브라우저 보안상 JSON에 넣을 수 없어서 재방문 시 파일 재연결 UX가 계속 중요합니다.
- FFmpeg WASM은 브라우저 CPU/메모리 한계를 받습니다. 긴 영상, 4K, 많은 overlay는 느릴 수 있습니다.
- 키프레임은 1차 구조입니다. 전용 곡선 편집기, 다이아몬드 선택/이동/삭제 UX는 더 개선할 수 있습니다.

## 개발자가 아니어도 기억하면 좋은 원칙

- “소스”는 원본 파일 정보입니다.
- “클립/조각”은 원본 파일 중 어느 시간대를 쓸지 적어둔 편집 데이터입니다.
- “타임라인”은 최종 영상에서 언제 보일지 정하는 시간표입니다.
- “미리보기”는 빠르게 보여주는 브라우저 화면입니다.
- “export”는 FFmpeg가 최종 MP4를 새로 만드는 과정입니다.
- “프로젝트 JSON”은 편집 레시피이며, 실제 원본 파일 묶음이 아닙니다.
