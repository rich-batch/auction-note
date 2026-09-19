(() => {
  const dataEl = document.getElementById('sr-data');
  if (!dataEl) return;
  const all = JSON.parse(dataEl.textContent);
  const $ = id => document.getElementById(id);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const diff = d => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => {
    if (n == null) return '미상';
    const eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = n % 1e4;
    const p = [];
    if (eok) p.push(`${eok.toLocaleString('ko-KR')}억`);
    if (man) p.push(`${man.toLocaleString('ko-KR')}만`);
    if (rest) p.push(rest.toLocaleString('ko-KR'));
    return p.length ? `${p.join(' ')} 원` : '0원';
  };
  const RISK = { none: '인수 예상 없음', assume: '임차인 인수 가능', ownership: '소유권 위험', review: '확인 필요' };
  const ctl = { q: $('sr-q'), sido: $('sr-sido'), price: $('sr-price'), failed: $('sr-failed'), when: $('sr-when'), risk: $('sr-risk'), sort: $('sr-sort') };
  const chips = [...document.querySelectorAll('#sr-cats .sr-chip')];

  [...new Set(all.map(x => x.sido))].sort().forEach(s => ctl.sido.add(new Option(s, s)));

  const params = new URLSearchParams(location.search);
  Object.entries(ctl).forEach(([k, el]) => { if (params.has(k)) el.value = params.get(k); });
  const initCats = (params.get('cat') || '').split(',').filter(Boolean);
  chips.forEach(c => c.setAttribute('aria-pressed', String(initCats.includes(c.dataset.cat))));

  const selectedCats = () => chips.filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.dataset.cat);

  function matches(x, f) {
    if (f.cats.length && !f.cats.includes(x.cat)) return false;
    if (f.q && !`${x.title} ${x.region} ${x.court} ${x.catName}`.toLowerCase().includes(f.q)) return false;
    if (f.sido && x.sido !== f.sido) return false;
    if (f.price) {
      const [lo, hi] = f.price.split('-').map(v => (v === '' ? null : Number(v) * 1e8));
      if (lo != null && x.minimum < lo) return false;
      if (hi != null && x.minimum >= hi) return false;
    }
    if (f.failed !== '') {
      const n = Number(f.failed);
      if (n === 2 ? x.failed < 2 : x.failed !== n) return false;
    }
    const d = diff(x.date);
    if (f.when === 'upcoming' && d < 0) return false;
    if (f.when === 'week' && (d < 0 || d > 7)) return false;
    if (f.when === 'month' && (d < 0 || d > 31)) return false;
    if (f.when === 'past' && d >= 0) return false;
    if (f.risk && x.risk !== f.risk) return false;
    return true;
  }

  const sorters = {
    date: (a, b) => {
      const da = diff(a.date), db = diff(b.date);
      if ((da >= 0) !== (db >= 0)) return da >= 0 ? -1 : 1;
      return da >= 0 ? da - db : db - da;
    },
    min_asc: (a, b) => a.minimum - b.minimum,
    ratio_asc: (a, b) => (a.ratio ?? 1e9) - (b.ratio ?? 1e9),
    failed_desc: (a, b) => b.failed - a.failed,
    analyzed_desc: (a, b) => b.analyzed.localeCompare(a.analyzed),
  };

  function card(x) {
    const d = diff(x.date);
    const r = x.result || {};
    const dday = r.outcome ? r.outcome : d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '종료';
    const ddayCls = r.outcome || d < 0 ? 'sr-dday past' : d <= 7 ? 'sr-dday soon' : 'sr-dday';
    const assume = x.risk === 'assume' && x.assumedMax != null
      ? `<div><dt>인수 예상</dt><dd>${won(x.assumedMin)} ~ ${won(x.assumedMax)}</dd></div>` : '';
    const result = r.outcome && r.winning_bid
      ? `<div><dt>매각 결과</dt><dd>${esc(r.outcome)} ${won(r.winning_bid)} (감정가의 ${(r.winning_bid / x.appraisal * 100).toFixed(1)}%)${r.bidders ? ` · 응찰 ${r.bidders}명` : ''}</dd></div>` : '';
    const m2 = x.m2 ? `<div><dt>면적</dt><dd>${x.m2}㎡ (약 ${(x.m2 / 3.3058).toFixed(1)}평)</dd></div>` : '';
    return `<article class="sr-card">
  <div class="sr-head"><span class="sr-cat">${esc(x.catName)}</span><span class="${ddayCls}">${esc(dday)}</span><span class="sr-risk risk-${x.risk}">${RISK[x.risk]}</span></div>
  <h3 class="sr-title"><a href="${esc(x.url)}">${esc(x.title)}</a></h3>
  <dl class="sr-info">
    <div><dt>소재지</dt><dd>${esc(x.region)}</dd></div>${m2}
    <div><dt>감정가</dt><dd>${won(x.appraisal)}</dd></div>
    <div><dt>최저가</dt><dd>${won(x.minimum)}${x.ratio != null ? ` (${x.ratio}%)` : ''}${x.failed ? ` · ${x.failed}회 유찰` : ''}</dd></div>${assume}
    <div><dt>매각기일</dt><dd>${esc(x.date)}</dd></div>${result}
  </dl>
</article>`;
  }

  function run() {
    const f = { cats: selectedCats(), q: ctl.q.value.trim().toLowerCase(), sido: ctl.sido.value, price: ctl.price.value, failed: ctl.failed.value, when: ctl.when.value, risk: ctl.risk.value };
    const list = all.filter(x => matches(x, f)).sort(sorters[ctl.sort.value] || sorters.date);
    $('sr-count').textContent = `${list.length}건 (전체 ${all.length}건)`;
    $('sr-results').innerHTML = list.length ? list.map(card).join('') : '<p class="cal-empty">조건에 맞는 물건이 없습니다. 조건을 줄여 보세요.</p>';
    const p = new URLSearchParams();
    if (f.cats.length) p.set('cat', f.cats.join(','));
    Object.entries(ctl).forEach(([k, el]) => { if (el.value && !(k === 'sort' && el.value === 'date')) p.set(k, el.value); });
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
  }

  Object.values(ctl).forEach(el => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', run));
  chips.forEach(c => c.addEventListener('click', () => { c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')); run(); }));
  $('sr-reset').addEventListener('click', () => {
    Object.values(ctl).forEach(el => { el.value = el === ctl.sort ? 'date' : ''; });
    chips.forEach(c => c.setAttribute('aria-pressed', 'false'));
    run();
  });
  run();
})();
