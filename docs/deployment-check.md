# Edit Studio Deployment Check

GitHub Pages 설정은 `Deploy from a branch` → `gh-pages` → `/root` 기준입니다.
`main`에 push하면 GitHub Actions가 `dist`를 빌드한 뒤 `gh-pages` 브랜치에 강제 반영합니다.

## 자동 배포 확인

1. GitHub 저장소의 `Actions` 탭에서 `Deploy to gh-pages`가 성공했는지 확인합니다.
2. Pages URL을 엽니다: https://ieeh1016.github.io/edit-studio/
3. 브라우저 강력 새로고침 후 첫 화면이 정상 표시되는지 확인합니다.

## 응답 체크

아래 명령은 HTML, JS, CSS, 폰트, FFmpeg WASM이 모두 `200 OK`로 내려오는지 확인합니다.

```bash
npm run check:deploy
```

다른 도메인으로 연결했다면 URL을 인자로 넘깁니다.

```bash
node scripts/check-deployment.mjs https://editstudio.kr/
```

## 수동 기능 체크

1. 영상 파일을 선택합니다.
2. 자막, 텍스트, 클릭/터치 효과를 하나씩 추가합니다.
3. 타임라인에서 확대/축소, 좌우 이동, 트랙 높이 조절을 확인합니다.
4. `720p 빠른 렌더`로 짧은 MP4 내보내기를 실행합니다.
5. 새로고침 후 자동 저장된 프로젝트가 복구되고, 원본 영상 재연결 안내가 명확한지 확인합니다.
