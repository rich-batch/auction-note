// 자료 문자열 읽기 테스트. 예시 문자열은 법원경매정보·실거래가 자료의 표기 형식만 본뜬 가상 데이터다.
//   node --test tools/lib/parse.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKoDate, parseTopPriority, parseSurvivingRights, regionParts, matchSigungu } from './parse.mjs';

test('날짜: 법원경매정보에 나오는 여러 표기를 YYYY-MM-DD로', () => {
  assert.equal(parseKoDate('2023.06.20.'), '2023-06-20');
  assert.equal(parseKoDate('2023. 4. 13.'), '2023-04-13'); // 2026-10-16 배치에서 INVALID를 낸 형식
  assert.equal(parseKoDate('2023.4.3'), '2023-04-03');
  assert.equal(parseKoDate('2023-4-13'), '2023-04-13');
  assert.equal(parseKoDate('2023년 4월 13일'), '2023-04-13');
  assert.equal(parseKoDate('2023. 2. 30.'), null); // 달력에 없는 날
  assert.equal(parseKoDate('해당사항 없음'), null);
  assert.equal(parseKoDate(null), null);
});

test('최선순위 설정: 날짜와 종류를 나눈다', () => {
  assert.deepEqual(parseTopPriority('2023. 4. 13. 근저당권'), { date: '2023-04-13', kind: '근저당권' });
  assert.deepEqual(parseTopPriority('2023.06.20. 근저당'), { date: '2023-06-20', kind: '근저당' });
  assert.deepEqual(parseTopPriority(' 2025.01.02 개시결정 '), { date: '2025-01-02', kind: '개시결정' });
  assert.equal(parseTopPriority('근저당권 2023.06.20'), null); // 날짜로 시작하지 않으면 추측하지 않는다
  assert.equal(parseTopPriority(''), null);
});

test('매각으로 소멸되지 않는 권리: 날짜·접수번호·종류', () => {
  const text = '2024.07.09접수 제107054호로 경료된 을구 1번 주택임차권등기는 매수인에게 인수됨. 2024. 8. 1. 접수 제 2001 호 가처분등기는 말소되지 않음';
  assert.deepEqual(parseSurvivingRights(text), [
    { date: '2024-07-09', receipt_no: 107054, kind: '주택임차권등기' },
    { date: '2024-08-01', receipt_no: 2001, kind: '가처분' },
  ]);
  assert.deepEqual(parseSurvivingRights('해당사항 없음'), []);
});

test('소재지: 구가 있는 시는 시+구로', () => {
  assert.deepEqual(regionParts('경기도 수원시 권선구 고색동 100 가상아파트 1동 101호'), { sido: '경기도', sigungu: '수원시 권선구', city: '수원시', gu: '권선구' });
  assert.deepEqual(regionParts('서울특별시 강서구 화곡동 100'), { sido: '서울특별시', sigungu: '강서구', city: null, gu: null });
  assert.deepEqual(regionParts('경기도 김포시 사우동 100'), { sido: '경기도', sigungu: '김포시', city: null, gu: null });
  assert.equal(regionParts('').sigungu, null);
});

test('시군구 고르기: 사이트마다 다른 표기, 같은 이름은 시도로 가른다', () => {
  const suwon = regionParts('경기도 수원시 권선구 고색동 100');
  const opts = ['수원시 장안구', '수원시 권선구', '성남시 분당구'].map(text => ({ text }));
  assert.equal(matchSigungu(opts, suwon).text, '수원시 권선구');
  assert.equal(matchSigungu(['수원장안구', '수원권선구'].map(text => ({ text })), suwon).text, '수원권선구');
  assert.equal(matchSigungu(['수원시'].map(text => ({ text })), suwon), null); // 시만 있으면 함수는 고르지 않는다(호출한 쪽이 판단)

  const names = [{ name: '경기도 수원시 장안구' }, { name: '경기도 수원시 권선구' }];
  assert.equal(matchSigungu(names, suwon, r => r.name).name, '경기도 수원시 권선구');

  const gangseo = regionParts('서울특별시 강서구 화곡동 100');
  const both = [{ name: '부산광역시 강서구' }, { name: '서울특별시 강서구' }];
  assert.equal(matchSigungu(both, gangseo, r => r.name).name, '서울특별시 강서구');
  assert.equal(matchSigungu([{ text: '강서구' }], gangseo).text, '강서구');
});
