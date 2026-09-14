---
name: site-readiness
description: 애드센스 심사를 통과할 수 있게 블로그 자체(글이 아니라 사이트)를 준비한다 — 필수 페이지(소개·개인정보처리방침·연락처) 생성, 면책 문구 자동 삽입 점검, 탐색성(깨진 링크·모바일 메뉴) 점검, 30일 준비 일정표 추적, 발행 직전 4대 거절 사유 자가 점검. "필수 페이지 만들어줘", "애드센스 준비", "심사 체크리스트", "30일 일정표", "발행해도 될까" 요청 시 사용. 글 한 편의 품질은 write-article 스킬이 담당한다 — 이 스킬은 사이트 전체를 다룬다.
argument-hint: [필수 페이지 | 30일 일정 <일차> | 발행 전 점검 | 탐색성 점검]
---

# site-readiness

`write-article`이 글 한 편의 품질을 담당한다면, 이 스킬은 **사이트 전체**가 애드센스 심사(또는 그에 준하는 신뢰도 기준)를 통과할 준비가 됐는지를 담당한다. 거절 사유는 보통 넷 중 하나다: 콘텐츠 부족, 복제 의심, 정책 위반, 탐색 곤란.

세부 절차는 아래 참조 파일에 있다. **모드에 맞는 파일만 읽어라** — 한꺼번에 다 읽지 마라.

## 모드

| 요청 | 읽을 파일 | 하는 일 |
|---|---|---|
| "필수 페이지 만들어줘" | `references/required-pages.md` | 소개·개인정보처리방침·연락처 3페이지 생성 |
| "30일 일정표", "N일차" | `references/30day-schedule.md` | 오늘이 며칠째인지 확인, 그날 할 일 안내 |
| "발행 전 점검", "발행해도 될까" | `references/rejection-checklist.md` | 4대 거절 사유 체크리스트로 판정 |
| "탐색성 점검", "링크 확인" | `references/rejection-checklist.md`의 탐색성 항목만 | 깨진 링크·메뉴 접근성·모바일 확인 |
| "면책 문구 확인" | 아래 '면책 문구' 섹션(파일 안 읽어도 됨) | 자동 삽입 상태 점검 |

## 면책 문구 (이미 구현됨 — 점검만)

모든 글 하단에는 `layouts/_partials/disclaimer.html`이 자동으로 붙는다(`layouts/_partials/extend_post_content.html`이 `.Section == "posts"`일 때 include). **글쓴이가 본문에 따로 쓸 필요가 없고, 써도 안 된다** — write-article 스킬의 체커가 중복을 잡는다.

점검할 때:
1. `layouts/_partials/disclaimer.html`과 `layouts/_partials/extend_post_content.html`이 존재하는지 확인.
2. `hugo -D -d <임시 폴더>`로 빌드해서 글 페이지 HTML에 `class="post-disclaimer"`가 있는지 확인.
3. 문구를 바꾸고 싶으면 `layouts/_partials/disclaimer.html` 하나만 고치면 전체 글에 반영된다.

## 이 스킬이 하지 않는 것

- 글 한 편의 출처·구조·AI 흔적 검사 → `write-article`의 `check-article.mjs`
- `draft: false` 전환, 커밋·푸시 → 사람이 최종 확인 후 직접
- 실제 애드센스 신청 자체(코드 삽입 등) → 별도 안내 필요 시 그때 다룬다
