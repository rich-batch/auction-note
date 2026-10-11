# 오늘의 경매 노트

경매·공매 정보 블로그 — https://rich-batch.github.io/auction-note/

- **경매 가이드** (`content/guide/`): 절차·대출·세금·권리분석 개념을 법령과 공식 자료 기준으로 설명
- **물건 분석** (`content/analysis/`): 실제 경매 사건을 매각물건명세서·등기 기준으로 권리분석

## 시작하기

### 1. 로컬 서버 구동

```bash
hugo server -D        # 초안 포함 실시간 미리보기 (http://localhost:1313)
```

초안 없이 발행된 글만 보려면:
```bash
hugo server           # 발행된 글만 미리보기
```

빌드 결과 확인 (배포 전):
```bash
hugo -D -d /tmp/auction-note-build
```

### 2. 물건 조회 및 등록

#### 온비드(OnBid) 물건 조회
특정 날짜에 개찰되는 물건 확인:
```bash
node tools/analysis/scan-onbid.mjs --date 2026-10-10
```

물건 자동 등록 (최초 1회만 `npx playwright install chromium` 필요):
```bash
node tools/analysis/fetch-onbid.mjs <물건관리번호>
```

#### 법원경매 물건 조회
법원 목록 확인:
```bash
node tools/analysis/scan-court.mjs --courts
```

특정 법원의 특정 날짜 매각공고 조회:
```bash
node tools/analysis/scan-court.mjs --court B000211 --date 2026-10      # 2026년 10월 전체
node tools/analysis/scan-court.mjs --court B000211 --date 2026-10-12   # 2026년 10월 12일만
```

`--court`를 생략하면 `data/courts-of-interest.json`의 `courts` 배열에 등록해 둔 관심 법원을 순서대로 조회한다(법원을 옮길 때마다 1분씩 쉬어 차단을 예방한다):
```bash
node tools/analysis/scan-court.mjs --date 2026-10-12
```

#### 공매·경매 한 번에 조회

같은 날짜로 온비드·법원경매(관심 법원)를 한 번에 훑는다(위 두 스캔을 그대로 실행하는 것뿐이라 결과는 동일하다):
```bash
node tools/analysis/scan-daily.mjs --date 2026-10-12
```

두 스캔 모두 기본적으로 분석 가치가 낮은 물건(최저가 300만원 미만, 공유지분 매각)은 목록에서 생략한다 — 기준을 바꾸거나 전부 보려면:
```bash
node tools/analysis/scan-daily.mjs --date 2026-10-12 --min-price 10000000   # 기준 금액을 올림
node tools/analysis/scan-daily.mjs --date 2026-10-12 --min-price 0 --include-share   # 생략 없이 전부
```

물건 데이터 등록:
```bash
node tools/analysis/new-case.mjs <id> <사건번호>
```

### 3. 사건 데이터 작업

사건 진행 상태 및 다음 할 일 확인:
```bash
node tools/analysis/status.mjs
```

입력 데이터 검증 및 권리 계산 실행:
```bash
node tools/analysis/compute.mjs <사건ID>
```

계산 엔진 테스트:
```bash
node --test tools/analysis/rights.test.mjs
```

### 4. 글 작성 (자동 초안)

작성할 가이드 글감 확인:
```bash
node .claude/skills/write-guide/render-prompt.mjs --list
```

자동 초안 생성 → PR (3편):
```bash
tools/auto/batch.sh guide 3       # 가이드 3편
tools/auto/batch.sh analysis 1    # 분석 1편
```

## 프로젝트 구조

- 일일·주간 운영 절차, 발행 체크리스트, 문제 해결은 [docs/OPERATIONS.md](docs/OPERATIONS.md)
- 저장소 구조, 작성 규칙, 자세한 명령어는 [CLAUDE.md](CLAUDE.md)
- 사건 데이터 필드 설명은 [tools/analysis/README.md](tools/analysis/README.md)
- 사건 분류 관리는 [data/categories.json](data/categories.json)

## 배포

GitHub Actions가 자동으로:
- `main` 브랜치 push 시 빌드·배포
- 매일 KST 07:00에 정기 빌드·배포

결과: https://rich-batch.github.io/auction-note/
