---
name: write-article
description: 경매·공매 SEO 블로그 글을 keywords.csv 기준으로 새로 쓰거나(공식 자료 조사·경쟁 글 비교·중복 판단 → 출처 링크·표·요약 박스가 들어간 초안 → ELI5 커버 이미지 생성 → AI 흔적 셀프 리뷰), 기존 글을 고쳐 쓰거나, 발행 전 8항목 품질 점검(시각 요소 포함)을 하거나, 수치 갱신 점검을 한다. "글 써줘", "priority N 작성", "다음 글", "고쳐 써줘", "검수해줘", "발행 전 점검", "갱신 점검", "커버 이미지 다시 만들어줘" 요청 시 사용.
argument-hint: [N | priority | 키워드 | 고쳐쓰기 <priority> | 검수 <slug> | 갱신 <slug> | 커버 <slug>]
---

# write-article

목표는 글 수가 아니라 **이 키워드로 검색한 사람에게 1페이지 다른 글보다 더 나은 답**을 주는 것이다. 돈이 걸린 주제(YMYL)라 정확성·출처·기준일이 기본이고, 그 위에 읽는 맛과 사람의 경험, 그리고 끝까지 읽히게 하는 시각 요소(ELI5 커버 이미지·핵심 요약 박스·표)가 있어야 한다.

이 스킬은 **초안까지만** 만든다. `draft`를 false로 바꾸거나, `[경험 추가 필요]`를 지어낸 경험으로 채우거나, 본문 도식(`[이미지 필요]`)을 대신 그리거나, 외부 이미지를 가져오거나, 커밋·푸시하지 않는다. 스킬이 만드는 이미지는 ELI5 커버 한 장뿐이다. 모든 명령은 저장소 루트에서 실행한다.

## 모드

| 요청 | 모드 |
|---|---|
| 인자 없음 / 숫자 N / "1순위" / 키워드 | 새 글 |
| "고쳐쓰기 2", "priority 2 다시 써줘" | 고쳐쓰기 |
| "검수 <slug>", "발행 전 점검" | 검수 |
| "갱신 <slug>", "수치 갱신 점검", "volatile 글 점검" | 갱신 |
| "커버 다시 만들어줘 <slug>", "ELI5 이미지 수정" | 커버 이미지 |

## 새 글

1. **대상 고르기.** 인자 없음 → 다음 1편(조사·비교가 무거워 기본은 1편). 숫자 N → N편(최대 3편 권장). "1순위"/키워드 → 그 한 편.
   ```bash
   node .claude/skills/write-article/render-prompt.mjs --next 1 --type info
   node .claude/skills/write-article/render-prompt.mjs --priority 1
   node .claude/skills/write-article/render-prompt.mjs --list
   ```
   `SKIPPED:`는 같은 슬러그 파일이 이미 있어 건너뛴 행이다. 덮어쓰지 않는다(고치려면 고쳐쓰기 모드).
2. **0단계(조사·경쟁 글 비교·중복 판단).** `=== JOB` 블록의 0단계를 끝까지 하고 `research/<slug>.md`를 저장한다. 지시문이 "멈춰라"라고 한 경우(기존 글과 80% 이상 중복, 차별점 없음)는 **글을 쓰지 않고** 5단계 보고로 넘어간다.
3. **1단계(글쓰기)** 후 저장 → **1-2단계(ELI5 커버 이미지)**: `research/<slug>.eli5.json` 작성 → 렌더링 → PNG를 Read로 열어 눈으로 확인 → **2단계(셀프 리뷰)**로 다시 읽고 고쳐 저장한다.
   ```bash
   node .claude/skills/write-article/render-eli5.mjs research/<slug>.eli5.json
   ```
4. **검사.** FAIL은 PASS까지 고친다. "확인 권장"은 하나씩 읽고 고칠지 판단한다(목록 비율이 높으면 설명 문장으로 풀어 쓰기).
   ```bash
   node .claude/skills/write-article/check-article.mjs content/posts/<slug>.md
   ```
   출처 없는 수치는 조사해서 링크를 달거나 수치를 뺀다. 아무 링크나 붙여 통과시키지 않는다.
5. **보고.**
   - 표: 파일 | 제목 | 글자 수 | 표·박스·이미지 수 | 출처 수 | 경험 자리 수 | 검사 결과 | 건너뛴 행
   - ELI5 커버 이미지: 경로를 알려 주고 사용자가 볼 수 있게 보낸다(원격이면 SendUserFile). 비유가 사실을 틀리게 단순화하지 않았는지 사람이 확인할 것
   - 중복 판단 결론과 흡수 제안(있으면), 차별점, "사람이 구글에서 직접 검색해 1페이지를 다시 확인할 것"
   - 아래 **검수** 모드의 8항목 판정표
   - `[경험 추가 필요]` 자리 목록(사용자가 채울 곳)
   - `[이미지 필요]` 자리가 있으면: 파일명·alt·캡션·구조 초안(사용자가 그려 넣을 도식)

## 고쳐쓰기

기존 글을 현재 템플릿 기준으로 다시 쓴다(사실·출처는 유지하고 문체·구조·경험 자리·AI 흔적을 고침).

1. `render-prompt.mjs --priority <N> --revise`로 지시문을 받는다(`mode=revise`, 원래 `date` 유지, `lastmod`는 오늘).
2. 기존 글과 조사 노트를 읽는다. 조사 노트에 없는 섹션(중복 판단, 경쟁 글 비교, 차별점)이 있으면 0단계의 해당 부분만 수행해 채운다. 수치를 새로 쓰거나 기준일을 오늘로 바꾸려면 그 수치의 출처를 다시 열어 여전히 맞는지 확인한다.
3. 1·2단계대로 다시 쓰고 저장 → 검사 → 새 글의 5단계처럼 보고. 달라진 점(무엇을 고쳤는지)을 먼저 요약한다.

## 검수 (발행 전 8항목)

`check-article.mjs` 결과와 글·조사 노트를 읽고 항목별로 **통과 / 보완 필요**를 판정해 표로 준다. 보완 필요면 무엇을 어떻게 고칠지 한 줄. 사실관계 수치는 맞다고 단정하지 말고 "사람이 공식 자료로 확인 필요"로 표시한다.

| # | 항목 | 판정 기준 |
|---|---|---|
| ① | 출처 표기 | 수치마다 공식 출처 링크, 참고 자료 목록, 조사 노트에 원문 인용 |
| ② | 면책 문구 | 글 끝 "투자 권유가 아닌 정보 제공" |
| ③ | 기준일 표기 | 서론 "YYYY년 M월 D일 기준" = `lastmod`, 자주 바뀌는 수치면 `volatile: true` |
| ④ | 검색 의도 적중 | 첫 문단만 읽고 키워드 질문에 답이 되는가 |
| ⑤ | 다른 글과 중복 | 이미 있는 글·이웃 키워드와 답하는 질문이 다른가(80% 기준) |
| ⑥ | 경험·관점 | 글쓴이의 판단 문장이 있는가, 실제 경험이 들어갔거나 `[경험 추가 필요]`가 표시됐는가(발행 전엔 사람이 채워야 함) |
| ⑦ | AI 흔적 | 예고형 서론, 억지 N가지 분류, 공허한 맺음, 추상 형용사, 정보 나열, 자리만 채우는 단락 |
| ⑧ | 시각 요소 | ELI5 커버가 글 흐름과 맞고 사실을 틀리게 단순화하지 않았는가, 핵심 요약 박스가 결론을 주는가, 표가 비교·절차 정리에 쓰였고 출처·기준일이 붙었는가, 글자 벽 구간이 없는가, 박스·표 도배가 아닌가, alt·캡션이 빈 말이 아닌가, 모든 이미지가 직접 만든 것인가(저작권) |

마지막 거름망도 한 줄로 판정한다: "조사 노트의 경쟁 글들과 나란히 놨을 때 이 글이 더 낫거나 다른 것을 주는가." 아니면 차별점을 보탤 방향 또는 옮겨 갈 옆 키워드를 제안한다.

## 발행 전 최종 단계 — 링크 검증

`draft: false`로 바꾸기 직전 마지막 점검. 참고 자료의 모든 링크가 실제로 접속 가능한지 확인한다.

```bash
node .claude/skills/write-article/check-article.mjs content/posts/<slug>.md --verify-links
```

- 404, 500 에러, 또는 응답 없는 URL이 나오면 원문을 다시 확인해 올바른 URL로 교정.
- 리다이렉트가 있는 URL(3xx)도 정상이므로 통과.
- 모든 참고 자료 URL이 OK 나올 때까지 재실행.

## 커버 이미지 (ELI5)

글의 전체 흐름을 열 살 아이에게 설명하듯 한 장으로 보여 주는 1200×630 PNG. PaperMod가 글 맨 위에 띄우고, 소셜 공유 미리보기(og:image)로도 쓴다. 외부 이미지 없이 도형·화살표·글자만으로 그려 저작권 문제가 없다.

1. `research/<slug>.eli5.json` 작성(형식·규칙은 템플릿 1-2단계): title, analogy(한 줄 비유), steps 3~4개(label·desc), takeaway, footer
2. 렌더링:
   ```bash
   node .claude/skills/write-article/render-eli5.mjs research/<slug>.eli5.json
   ```
   - 출력: `research/<slug>.eli5.svg`(원본), `assets/images/<slug>/eli5-overview.png`
   - 칸을 넘는 글자·숫자가 있으면 FAIL과 함께 어느 칸인지 알려 준다. 줄여서 다시 실행
3. PNG를 Read로 열어 겹침·잘림·어색한 줄바꿈을 확인
4. front matter:
   ```yaml
   cover:
     image: "images/<slug>/eli5-overview.png"
     alt: "그림에 실제로 있는 것을 설명하는 한 문장"
     caption: "캡션만 읽어도 핵심이 남는 한 문장"
   ```

이미지에 숫자를 넣지 않으므로 수치 갱신 때 다시 만들 필요가 없다. 본문 소제목 흐름이 바뀌었을 때만 다시 만든다.

## 본문 도식을 사람이 넣을 때

스킬이 남긴 `[이미지 필요: images/<slug>/<파일명>.png | alt: … | 캡션: … | 구조: …]`를 사람이 교체한다.

1. 구조대로 순수 도형·화살표로 그린다(캔바 등, 또는 공개 통계 수치로 직접 그린 그래프). 캡처·검색 이미지·기관 로고 금지
2. 가로 1200px 안팎으로 줄여 `assets/images/<slug>/<파일명>.png`에 저장:
   ```bash
   sips -Z 1200 assets/images/<slug>/<파일명>.png
   ```
3. 자리표시자 줄을 아래 두 줄로 바꾼다(이미지 줄 바로 아래가 캡션):
   ```markdown
   ![그림 설명 한 문장](images/<slug>/<파일명>.png)
   *핵심 한 문장 (수치가 있으면 출처 링크와 YYYY년 M월 D일 기준)*
   ```
4. `research/<slug>.md`에 `## 이미지` 섹션을 만들고 `- <파일명>.png: 만든 방법, 사용한 데이터와 출처`를 적는다(검사 스크립트가 확인)

## 갱신 (발행 후 유지보수)

금융 글은 시간이 지나면 스스로 낡는다. `volatile: true` 글은 분기마다, 나머지는 제도 개정 소식이 있을 때 점검한다.

1. 점검 대상 뽑기:
   ```bash
   grep -l '^volatile: true' content/posts/*.md
   node .claude/skills/write-article/check-article.mjs content/posts/<slug>.md --facts
   ```
   `--facts`는 수치·날짜가 들어간 줄과 그 줄의 출처 URL을 줄 번호와 함께 뽑는다.
2. 각 출처를 다시 열어 수치가 그대로인지, 이후 개정이 있는지 확인하고 조사 노트에 새 행(확인일 포함)을 추가한다.
3. 바뀐 수치만 고친다. 바뀐 게 없어도 확인을 끝냈으면 `lastmod`와 서론 기준일 문장을 오늘로 함께 갱신한다(검사 스크립트가 둘이 다르면 FAIL).
4. 보고: 바뀐 수치(전 → 후, 출처), 그대로인 수치 수, 확인하지 못한 출처.

## 검사 스크립트가 잡는 것 / 못 잡는 것

**FAIL:** front matter(title·author "rich-batch"·date·lastmod·draft·volatile·categories·tags·description), 슬러그 파일명, 미래 날짜, 제목 연도, description "~정리합니다", `#` 제목, 서론 2~3문단, 기준일 문장 = lastmod, 소제목 4~6개, 표, FAQ 3~5개, 참고 자료, 고지 / 수치 줄 출처 링크, 허용 도메인(go.kr·korea.kr·bok.or.kr·kfb.or.kr·khug.or.kr·kamco.or.kr·onbid.co.kr·fss.or.kr), 참고 자료 누락 URL, 조사 노트에 없는 URL / 조사 노트의 중복 판단·경쟁 글 비교·차별점 섹션 / 예고형·일반론 서론, 공허한 맺음, "은행마다 다릅니다"류, 가상 인물 의심("제 지인", "김 씨는"), 투자 권유 / `draft: false`인데 `[경험 추가 필요]` 남음

시각 요소: `cover`(image = `images/<slug>/eli5-overview.png`, 파일 존재, alt·caption 빈 말 아님, 캡션 수치엔 링크), `research/<slug>.eli5.json` 존재, 서론 직후 `> **핵심 요약**` 박스(1~3줄), 박스 최대 2개, 수치 표 아래 출처 줄에 기준일, 본문 이미지(외부 URL 금지, `assets/images/<slug>/` 파일 존재, alt, 바로 아래 `*캡션*`, 영문 파일명, 500KB 이하, 조사 노트 `## 이미지`에 기록), `[이미지 필요]` 최대 1개·필드 완비·`draft: false`면 남으면 안 됨

**확인 권장(WARN):** 소제목 "N가지", 경험 자리 0곳, 본문 목록·표 비율 50% 초과, 추상 형용사 4회 이상, 표·박스·목록·이미지 없이 문단 6개 이상 연속(글자 벽), 표가 글 분량에 비해 많음, 이미지 200KB 초과·가로 1500px 초과

**못 잡는 것:** 링크한 페이지에 수치가 정말 있는지, 경쟁 글 비교가 실제 구글 한국 1페이지와 같은지, 글이 재미있는지, ELI5 비유가 사실을 틀리게 단순화했는지, 사람이 넣은 이미지가 정말 직접 만든 것인지. 사람이 링크를 열고, 직접 검색하고, 소리 내어 읽고, 이미지를 보고 확인한다.

## keywords.csv

열: `priority,keyword,slug,category,seed,intent,suggested_title,notes,my_experience`

- `slug`: URL. **발행 후 바꾸지 않는다.**
- `category`: `경매 절차` / `권리분석·명도` / `경매 대출·세금` / `공매`
- `my_experience`: 글쓴이가 실제로 겪은 일(짧은 메모). 여기 적힌 것만 1인칭 경험으로 글에 들어간다. 비어 있으면 `[경험 추가 필요]` 자리 표시만 한다.
- 중복 판단에서 흡수 제안이 나와도 CSV는 스킬이 고치지 않는다. 사용자에게 제안하고, 사용자가 행을 합치거나 지운다.

## 글 성격 옵션 (`--type`)

| type | 파일 | 용도 |
|---|---|---|
| `info` (기본) | `templates/info.md` | 정보·교육형 |

새 성격은 `templates/<type>.md`를 추가한다. 자리: `{keyword}` `{slug}` `{category}` `{seed}` `{intent}` `{suggested_title}` `{notes}` `{priority}` `{my_experience}` `{date}`(KST 오늘) `{created}`(기존 글이면 원래 date) `{research_path}` `{existing_posts}` `{related_keywords}`(같은 카테고리 다른 키워드와 작성 여부). 구조가 다르면 `check-article.mjs` 규칙도 나눠야 한다.

## 공식 사이트 읽는 법

| 사이트 | 방법 |
|---|---|
| `korea.kr`, `fsc.go.kr`, `hf.go.kr`, `easylaw.go.kr`, `onbid.co.kr` | WebFetch로 읽힌다. WebFetch 요약은 문장을 바꿔 전할 수 있으니 인용할 문장은 curl로 원문 대조 |
| `law.go.kr` | 사람용 페이지는 iframe 껍데기. 조문은 아래 API로 읽고, 글과 노트에는 `https://www.law.go.kr/법령/<법령명>/제N조`를 링크 |
| `courtauction.go.kr` | JS 앱이라 본문이 비어 있음. 법령이나 법제처 찾기쉬운 생활법령으로 대신 인용 |
| `help.scourt.go.kr` | WebFetch DNS 오류 |
| WebFetch 403 | curl에 브라우저 User-Agent로 재시도, 그래도 막히면 인용하지 않음 |

law.go.kr 조문 읽기(현행):
```bash
curl -sL -m 30 -A "Mozilla/5.0" "https://www.law.go.kr/DRF/lawService.do?OC=test&target=law&type=XML&LM=민사집행규칙" \
| python3 -c "
import sys,re
s=sys.stdin.read()
for m in re.finditer(r'<조문단위.*?</조문단위>', s, re.S):
    t=re.sub(r'<!\[CDATA\[|\]\]>|<[^>]+>','',m.group(0))
    if '제63조' in t: print(t.strip()[:800])
"
```
시행 예정 개정 찾기(최신성 확인): `https://www.law.go.kr/DRF/lawSearch.do?OC=test&target=eflaw&type=XML&query=<법령명>` → `현행연혁코드`가 `시행예정`인 행의 `법령일련번호`로 `lawService.do?OC=test&target=eflaw&type=XML&MST=<번호>`를 읽어 `제개정이유`를 확인.

## 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| 글이 정보만 있고 재미없음 | 목록·표 비율 WARN 확인. 섹션 첫머리를 독자의 상황·대가로, 목록 뒤를 설명 문장으로, 예시는 장면으로. 경험 자리를 사람이 채워야 완성됨 |
| 발행했는데 글이 안 보임 | `draft: true`. 로컬 미리보기 `hugo server -D` |
| 날짜 때문에 글이 안 뜸 | date가 미래. 검사가 FAIL로 잡음 |
| 검색에 옛 자료만 나옴 | 예: 생애최초 LTV 2022년 80% → 2025.6.27 수도권·규제지역 70%. 개정 재검색을 건너뛰지 않는다 |
| 공식 자료에 명시가 없음 | 추정하지 말고 "공식 자료에서 확인되지 않음" + 보고 |
| 기준일 FAIL | 서론 기준일 문장과 `lastmod`를 함께 바꾼다 |
| archetype과 형식이 다름 | archetype은 TOML(`+++`), 글은 YAML(`---`) |
| 이미지가 사이트에서 깨짐 | 이미지는 `static/`이 아니라 `assets/images/<slug>/`에, 글에서는 앞에 `/` 없이 `images/<slug>/…`로 쓴다. 그래야 `/auction-note/` 하위 경로가 붙는다 |
| ELI5 렌더링이 멈춤 | macOS 헤드리스 Chrome은 새 프로필로 스크린샷을 쓴 뒤 종료하지 않는다. 스크립트가 PNG가 다 써지면 Chrome을 종료한다(60초 제한). Chrome이 다른 곳에 있으면 `CHROME=<경로>` |
| ELI5 FAIL "칸을 넘음" | label·desc·takeaway를 줄인다. 글자 수가 아니라 렌더링 폭 기준(한글 한 글자 ≈ 글자 크기) |
| 커버 캡션이 본문과 따로 놂 | caption은 takeaway를 다듬은 한 문장. 글 핵심이 바뀌면 JSON과 caption을 함께 고친다 |
