(function () {
  'use strict';
  const D = window.BNDsp, S = window.BNStore;
  const $ = id => document.getElementById(id);

  const COND_LABEL = { drought: '가뭄 토마토', control: '물 충분한 토마토', cut: '줄기 절단 토마토', noise: '배경·잡음' };
  const GROUP_LABEL = { drought: '가뭄', control: '대조', soil: '흙만' };
  const COLORS = { drought: '#C0621F', control: '#2E6A4B', soil: '#8A8F84' };

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  function table(elm, cols, rows) {
    elm.replaceChildren(
      h('thead', null, h('tr', null, cols.map(c => h('th', null, c[0])))),
      h('tbody', null, rows.map(r => {
        const tr = h('tr', r._attrs || null, cols.map(c => h('td', null, typeof c[1] === 'function' ? c[1](r) : r[c[1]])));
        return tr;
      })));
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const csvBlob = text => new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const fmt = (n, d) => (n == null || !isFinite(n) ? '–' : Number(n).toFixed(d == null ? 1 : d));
  const fmtP = p => (p == null || !isFinite(p) ? '–' : p < 0.001 ? '< 0.001' : p.toFixed(3));
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const readText = file => file.text();

  // ---------- 탭 ----------
  const tabs = $('tabs');
  function showTab(name) {
    for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === name);
    for (const s of document.querySelectorAll('.tab')) s.classList.toggle('on', s.id === 'tab-' + name);
    S.save('tab', name);
    if (name === 'log') drawWeightChart();
    if (name === 'quiz') newQuizRound();
  }
  tabs.addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  // ---------- 로드맵 ----------
  const ROADMAP = [
    ['1주차 · 9/28–10/4 준비', [
      ['r1', '9/28', '2026-09-28', '선행연구 Khait et al.(2023, Cell) 정독 — 주파수 대역·시간당 소리 수·녹음 거리를 원문에서 확인해 표로 정리', '전원'],
      ['r2', '9/29', '2026-09-29', '장비·모종 주문 완료: 초음파 녹음기, 0.1 g 전자저울, 방음 상자 재료, 방울토마토 모종 14개 이상. 도착일이 10/3을 넘기면 국내 재고 대안으로', '녹음·식물'],
      ['r3', '9/30', '2026-09-30', '공개 데이터 내려받기, 분류 모델 학습 시작 (10/14까지 병행)', '분석'],
      ['r4', '10/1', '2026-10-01', '방음 상자 제작, 화분 14개 배치 (가뭄 6·대조 6·흙만 2) → 앱 “실험 기록”에 등록', '식물'],
      ['r5', '10/2', '2026-10-02', '◆ 사전등록 문서 git 커밋: 가설 H1–H3·Q4, 화분 수, 이벤트 판정 기준(고역통과·임계값), 통계 방법', '전원', true],
      ['r6', '10/2', '2026-10-02', '매일 관수 + 기준 무게 기록 시작 (매일 같은 시각)', '식물'],
    ]],
    ['2주차 · 10/5–10/11 파일럿 · 본실험 시작', [
      ['r7', '10/3–10/6', '2026-10-06', '파일럿: 양성 대조(열쇠 흔들기) 녹음 → “초음파 분석”에서 20 kHz 이상 이벤트가 잡히는지 확인. 앱 검증용 합성 파일 분석 결과도 캡처', '녹음'],
      ['r8', '10/5', '2026-10-05', '빈 방음 상자·흙 화분 하룻밤 녹음 → 잡음 기준값', '녹음'],
      ['r9', '10/6', '2026-10-06', '◆ 진행 판정 (Go/No-go) — 양성 대조·잡음 기준 스펙트로그램 두 장을 교수님께 공유', '전원', true],
      ['r10', '10/6', '2026-10-06', '통계 탭에서 블라인드 코드 키 생성 — 분석하지 않는 팀원 1명만 보관', '녹음'],
      ['r11', '10/7', '2026-10-07', '가뭄군 관수 중단 (본실험 시작)', '식물'],
      ['r12', '10/7–10/15', '2026-10-15', '매일: 무게 측정 → 야간 녹음 → 녹음기 처리군·대조군 교차 배치 → 파일 이름을 코드로 바꿔 백업 → 다음 날 바로 분석', '전원'],
    ]],
    ['3주차 · 10/12–10/18 본실험 마무리', [
      ['r13', '10/12–10/18', '2026-10-18', '(선택) 보조 연구: 반응시간 240fps 영상 보정, 진동 장치 + 가속도계로 떨림 주파수 정확도 검증', '앱'],
      ['r14', '10/13', '2026-10-13', '가뭄군 재관수', '식물'],
      ['r15', '10/14', '2026-10-14', '공개 데이터 분류 모델 학습 완료', '분석'],
      ['r16', '10/15', '2026-10-15', '◆ 녹음 종료', '전원', true],
      ['r17', '10/16–10/17', '2026-10-17', '(선택) 대조 화분 2개 줄기 절단 후 녹음', '식물'],
    ]],
    ['4주차 · 10/19–10/25 결과 · 완성', [
      ['r18', '10/16–10/20', '2026-10-20', '블라인드 이벤트 확인(판정자 2명 일치도), 통계 탭 검정, 공개 데이터 모델을 우리 녹음에 적용', '분석'],
      ['r19', '10/20', '2026-10-20', '◆ 결과 확정 — 이후 분석을 더 늘리지 않는다', '전원', true],
      ['r20', '10/19–10/22', '2026-10-22', '이벤트 클립 선정 → 소리 라이브러리 → 체험·퀴즈에 실제 녹음 탑재', '앱'],
      ['r21', '10/21–10/24', '2026-10-24', '보고서·포스터 작성 및 내부 검토 (서론·방법은 1주차 사전등록 문서에서)', '전원'],
      ['r22', '10/25', '2026-10-25', '◆ 제출물 최종본 완성', '전원', true],
      ['r23', '10/26–10/28', '2026-10-28', '버퍼: 형식 점검, 예상 못 한 문제 대응 → 10/28 제출', '전원'],
    ]],
  ];

  function renderRoadmap() {
    const done = new Set(S.load('roadmap', []));
    const now = today();
    let total = 0, count = 0;
    const list = $('roadmapList');
    list.replaceChildren();
    for (const [title, items] of ROADMAP) {
      list.append(h('div', { class: 'roadmap-week' }, title));
      for (const [id, dateLabel, due, text, who, ms] of items) {
        total++;
        const isDone = done.has(id);
        if (isDone) count++;
        const cls = ['rm-item', ms ? 'ms' : '', isDone ? 'done' : '', !isDone && due < now ? 'late' : ''].join(' ');
        const cb = h('input', { type: 'checkbox', 'aria-label': text, checked: isDone, onchange: () => {
          const s = new Set(S.load('roadmap', []));
          cb.checked ? s.add(id) : s.delete(id);
          S.save('roadmap', Array.from(s));
          renderRoadmap();
        } });
        list.append(h('label', { class: cls }, cb, h('span', { class: 'date' }, dateLabel), h('span', { class: 'txt' }, text, h('span', { class: 'who' }, who))));
      }
    }
    $('roadmapBar').style.width = (count / total * 100) + '%';
    $('roadmapStat').textContent = `${count} / ${total} 완료 · 오늘 ${now} · 완성 목표 10/25까지 ${Math.max(0, Math.round((new Date('2026-10-25T12:00:00') - new Date(now + 'T12:00:00')) / 864e5))}일`;
  }

  // ---------- 실험 기록 ----------
  let pots = S.load('pots', []);
  let weights = S.load('weights', []);
  const savePots = () => { S.save('pots', pots); renderPots(); renderWeighGrid(); drawWeightChart(); };
  const saveWeights = () => { S.save('weights', weights); renderLogTable(); drawWeightChart(); };
  const potGroup = id => (pots.find(p => p.id === id) || {}).group;

  function renderPots() {
    $('potList').replaceChildren(...pots.map(p => h('span', { class: 'chip ' + p.group }, `${p.id} · ${GROUP_LABEL[p.group]}`,
      h('button', { 'aria-label': p.id + ' 삭제', onclick: () => { if (confirm(p.id + ' 화분을 목록에서 뺄까요? (기록은 남습니다)')) { pots = pots.filter(x => x !== p); savePots(); } } }, '×'))));
  }
  $('potAdd').onclick = () => {
    const id = $('potId').value.trim();
    if (!id) return;
    if (pots.some(p => p.id === id)) { alert('이미 있는 ID입니다.'); return; }
    pots.push({ id, group: $('potGroup').value });
    $('potId').value = '';
    savePots();
  };
  $('potDefault').onclick = () => {
    const add = [];
    for (let i = 1; i <= 6; i++) add.push({ id: 'D' + i, group: 'drought' });
    for (let i = 1; i <= 6; i++) add.push({ id: 'C' + i, group: 'control' });
    for (let i = 1; i <= 2; i++) add.push({ id: 'S' + i, group: 'soil' });
    for (const p of add) if (!pots.some(x => x.id === p.id)) pots.push(p);
    savePots();
  };

  function renderWeighGrid() {
    const date = $('weighDate').value;
    $('weighGrid').replaceChildren(...pots.map(p => {
      const rec = weights.find(w => w.date === date && w.pot === p.id) || {};
      return h('div', { class: 'weigh-cell' }, h('b', { style: 'color:' + COLORS[p.group] }, `${p.id} · ${GROUP_LABEL[p.group]}`),
        h('input', { type: 'number', step: '0.1', min: '0', placeholder: 'g', 'data-pot': p.id, value: rec.weight ?? '', 'aria-label': p.id + ' 무게(g)' }),
        h('label', null, h('input', { type: 'checkbox', 'data-water': p.id, checked: !!rec.watered }), '측정 후 관수'));
    }));
    if (!pots.length) $('weighGrid').append(h('p', { class: 'muted' }, '먼저 화분을 등록하세요.'));
  }
  $('weighDate').value = today();
  $('weighDate').onchange = renderWeighGrid;
  $('weighSave').onclick = () => {
    const date = $('weighDate').value;
    let n = 0;
    for (const inp of $('weighGrid').querySelectorAll('input[data-pot]')) {
      const pot = inp.dataset.pot;
      const watered = $('weighGrid').querySelector(`input[data-water="${CSS.escape(pot)}"]`).checked;
      weights = weights.filter(w => !(w.date === date && w.pot === pot));
      if (inp.value !== '') { weights.push({ date, pot, weight: parseFloat(inp.value), watered }); n++; }
    }
    weights.sort((a, b) => a.date.localeCompare(b.date) || a.pot.localeCompare(b.pot));
    saveWeights();
    $('weighMsg').textContent = `${date} · ${n}개 저장됨`;
  };

  function renderLogTable() {
    const rows = weights.slice().reverse().map(w => Object.assign({ group: GROUP_LABEL[potGroup(w.pot)] || '?' }, w));
    table($('logTable'), [['날짜', 'date'], ['화분', 'pot'], ['그룹', 'group'], ['무게(g)', r => fmt(r.weight, 1)], ['관수', r => (r.watered ? '예' : '')]], rows);
  }
  $('logExport').onclick = () => download(`화분무게_${today()}.csv`, csvBlob(D.toCSV(weights.map(w => ({
    date: w.date, pot: w.pot, group: potGroup(w.pot) || '', weight_g: w.weight, watered: w.watered ? 1 : 0,
  })), ['date', 'pot', 'group', 'weight_g', 'watered'])));
  $('logImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const rows = D.parseCSV(await readText(f));
    let n = 0;
    for (const r of rows) {
      if (!r.date || !r.pot || r.weight_g === '') continue;
      if (!pots.some(p => p.id === r.pot)) pots.push({ id: r.pot, group: GROUP_LABEL[r.group] ? r.group : 'drought' });
      weights = weights.filter(w => !(w.date === r.date && w.pot === r.pot));
      weights.push({ date: r.date, pot: r.pot, weight: parseFloat(r.weight_g), watered: r.watered === '1' || r.watered === 'true' });
      n++;
    }
    weights.sort((a, b) => a.date.localeCompare(b.date) || a.pot.localeCompare(b.pot));
    S.save('pots', pots); renderPots(); renderWeighGrid(); saveWeights();
    alert(n + '개 기록을 불러왔습니다.');
    e.target.value = '';
  };

  // 간단한 선 그래프 (series: [{color, width, points:[[x,y]]}])
  function lineChart(canvas, series, opt) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, L = 60, R = 16, T = 16, B = 36;
    ctx.clearRect(0, 0, W, H);
    const pts = series.flatMap(s => s.points);
    ctx.fillStyle = '#5A5F57'; ctx.font = '14px sans-serif';
    if (!pts.length) { ctx.fillText(opt.empty || '데이터가 없습니다', L, H / 2); return; }
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
    let y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    if (opt.yMin != null) y0 = Math.min(y0, opt.yMin);
    if (x1 === x0) { x0 -= 1; x1 += 1; }
    if (y1 === y0) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
    const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => H - B - (y - y0) / (y1 - y0) * (H - T - B);
    ctx.strokeStyle = '#E6E0D3'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = y0 + (y1 - y0) * i / 4;
      ctx.beginPath(); ctx.moveTo(L, Y(y)); ctx.lineTo(W - R, Y(y)); ctx.stroke();
      ctx.fillText(fmt(y, opt.yDigits ?? 1), 4, Y(y) + 5);
    }
    const ticks = opt.xTicks || [x0, x1].map(v => [v, fmt(v, 0)]);
    for (const [v, label] of ticks) ctx.fillText(label, Math.min(W - 60, X(v) - 18), H - 12);
    if (opt.yLabel) ctx.fillText(opt.yLabel, L + 6, T + 12);
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width || 2; ctx.globalAlpha = s.alpha || 1;
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
      ctx.stroke();
      if (s.dots) for (const p of s.points) { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 3, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#5A5F57';
  }
  const dayNum = iso => Math.round(new Date(iso + 'T12:00:00') / 864e5);
  const dayTicks = dates => {
    const u = Array.from(new Set(dates)).sort();
    const step = Math.max(1, Math.ceil(u.length / 8));
    return u.filter((_, i) => i % step === 0).map(d => [dayNum(d), d.slice(5).replace('-', '/')]);
  };

  function drawWeightChart() {
    const series = pots.map(p => {
      const ws = weights.filter(w => w.pot === p.id);
      if (!ws.length) return null;
      const base = ws[0].weight;
      return { color: COLORS[p.group], dots: true, points: ws.map(w => [dayNum(w.date), w.weight / base * 100]) };
    }).filter(Boolean);
    lineChart($('weightChart'), series, { yLabel: '첫 측정 대비 %', xTicks: dayTicks(weights.map(w => w.date)), empty: '무게를 기록하면 그래프가 그려집니다' });
  }

  // ---------- 초음파 분석 ----------
  let analyses = S.load('analyses', []);
  const sessions = new Map(); // code -> { reader, result, fileName } (이번 세션에서 연 파일만)
  let current = null, currentEvent = null, currentSnippet = null;
  const expandFactor = () => parseInt($('expand').value, 10);

  const fileReader = file => ({ size: file.size, read: (s, e) => file.slice(s, e).arrayBuffer() });
  const bufferReader = buf => ({ size: buf.byteLength, read: async (s, e) => buf.slice(s, e) });

  function setProgress(frac, msg) {
    $('anaBar').style.width = Math.round(frac * 100) + '%';
    if (msg != null) $('anaMsg').textContent = msg;
  }

  async function analyzeOne(reader, fileName, start) {
    const code = fileName.replace(/\.wav$/i, '');
    const t0 = performance.now();
    let lastUi = 0;
    const result = await D.analyzeRecording(reader, {
      cutoffHz: parseFloat($('cutoff').value) * 1000,
      k: parseFloat($('kSigma').value),
      refractoryMs: parseFloat($('refr').value),
      onProgress: (f, label) => {
        const now = performance.now();
        if (now - lastUi > 100) { lastUi = now; setProgress(f, `${fileName} · ${label} ${Math.round(f * 100)}%`); }
      },
    });
    await new Promise(r => setTimeout(r, 0));
    const hours = result.durationSec / 3600;
    const summary = {
      code, fileName, start: start || D.parseAudioMothName(fileName) || '',
      durationSec: result.durationSec, sampleRate: result.sampleRate, events: result.events.length,
      eventsPerHour: hours > 0 ? result.events.length / hours : 0,
      noiseSigma: result.noiseSigma, threshold: result.threshold,
      cutoffHz: result.params.cutoffHz, k: result.params.k, refractoryMs: result.params.refractoryMs,
      truncated: result.truncated, analyzedAt: new Date().toISOString(),
    };
    analyses = analyses.filter(a => a.code !== code);
    analyses.push(summary);
    S.save('analyses', analyses);
    sessions.set(code, { reader, result, fileName });
    renderAnaTable();
    let warn = '';
    if (result.sampleRate < 192000) warn = ` · 주의: ${result.sampleRate / 1000} kHz 샘플링은 ${result.sampleRate / 2000} kHz까지만 담습니다. 식물 초음파 대역을 충분히 보려면 250–384 kHz를 권장합니다.`;
    setProgress(1, `${fileName}: 이벤트 ${summary.events}개 (${fmt((performance.now() - t0) / 1000)}초 소요)${warn}`);
    return code;
  }

  $('wavInput').onchange = async e => {
    const files = Array.from(e.target.files);
    let last = null;
    for (const f of files) {
      try { last = await analyzeOne(fileReader(f), f.name); }
      catch (err) { setProgress(0, `${f.name}: ${err.message}`); }
    }
    if (last) openDetail(last);
    e.target.value = '';
  };

  $('makeTest').onclick = async () => {
    const fs = 384000, times = [1.2, 3.4, 5.0, 7.7, 9.1];
    const buf = D.encodeWav(D.synthTestRecording(fs, 10, times), fs);
    const code = await analyzeOne(bufferReader(buf), 'TEST_합성클릭5개.wav', '');
    const n = sessions.get(code).result.events.length;
    $('anaMsg').textContent += n === times.length ? ' → 심은 5개를 정확히 찾았습니다 (소프트웨어 양성 대조 통과).' : ` → 심은 5개와 다릅니다(${n}개). 설정을 확인하세요.`;
    openDetail(code);
  };

  function renderAnaTable() {
    const rows = analyses.slice().reverse().map(a => Object.assign({
      _attrs: { class: 'click' + (current && current.code === a.code ? ' sel' : ''), onclick: () => openDetail(a.code) },
    }, a));
    table($('anaTable'), [
      ['코드', 'code'], ['녹음 시각', r => r.start ? r.start.replace('T', ' ') : '–'], ['길이', r => fmt(r.durationSec / 60) + '분'],
      ['샘플링', r => r.sampleRate / 1000 + ' kHz'], ['이벤트', r => r.events + (r.truncated ? '+' : '')], ['시간당', r => fmt(r.eventsPerHour)],
      ['잡음σ', r => r.noiseSigma.toExponential(1)], ['설정', r => `${r.cutoffHz / 1000}k · ${r.k}σ · ${r.refractoryMs}ms`],
      ['', r => h('button', { class: 'ghost', onclick: ev => { ev.stopPropagation(); if (confirm(r.code + ' 결과를 지울까요?')) { analyses = analyses.filter(a => a.code !== r.code); S.save('analyses', analyses); renderAnaTable(); } } }, '삭제')],
    ], rows);
  }
  $('anaExport').onclick = () => download(`초음파분석_${today()}.csv`, csvBlob(D.toCSV(analyses,
    ['code', 'fileName', 'start', 'durationSec', 'sampleRate', 'events', 'eventsPerHour', 'noiseSigma', 'threshold', 'cutoffHz', 'k', 'refractoryMs', 'truncated', 'analyzedAt'])));
  $('anaClear').onclick = () => { if (confirm('분석 결과 목록을 모두 지울까요? (먼저 CSV로 내보내세요)')) { analyses = []; S.save('analyses', analyses); renderAnaTable(); } };

  function openDetail(code) {
    const a = analyses.find(x => x.code === code);
    const s = sessions.get(code);
    current = a;
    renderAnaTable();
    $('detail').hidden = false;
    $('detailTitle').textContent = a.fileName;
    $('eventView').hidden = true;
    if (!s) {
      $('detailMeta').textContent = '이전에 분석한 결과입니다. 이벤트를 보고 들으려면 같은 파일을 다시 선택하세요.';
      $('eventTable').replaceChildren(); lineChart($('rateChart'), [], {}); $('bgAdd').disabled = true;
      return;
    }
    $('bgAdd').disabled = false;
    const r = s.result;
    $('detailMeta').textContent = `${r.sampleRate / 1000} kHz · ${r.bitsPerSample}bit · ${fmt(r.durationSec, 1)}초 · 잡음σ ${r.noiseSigma.toExponential(2)} · 임계값 ${r.threshold.toExponential(2)} · 이벤트 ${r.events.length}개${r.truncated ? ' (최대치 도달, 임계값을 높이세요)' : ''}`;
    const mins = Math.max(1, Math.ceil(r.durationSec / 60));
    const counts = new Array(mins).fill(0);
    for (const e of r.events) counts[Math.min(mins - 1, Math.floor(e.timeSec / 60))]++;
    drawBars($('rateChart'), counts);
    const rows = r.events.slice(0, 1000).map((e, i) => Object.assign({ n: i + 1, _attrs: { class: 'click', onclick: ev => selectEvent(e, ev.currentTarget) } }, e));
    table($('eventTable'), [['#', 'n'], ['시각(초)', r2 => fmt(r2.timeSec, 4)], ['피크 SNR', r2 => fmt(r2.snr, 1)]], rows);
  }

  function drawBars(canvas, counts) {
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, L = 40, B = 24;
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(1, ...counts), bw = (W - L - 10) / counts.length;
    ctx.fillStyle = '#5A5F57'; ctx.font = '13px sans-serif';
    ctx.fillText(String(max), 6, 16); ctx.fillText('0', 6, H - B);
    ctx.fillText('0분', L, H - 6); ctx.fillText(counts.length + '분', W - 50, H - 6);
    ctx.fillStyle = '#2E6A4B';
    counts.forEach((c, i) => { const bh = c / max * (H - B - 10); ctx.fillRect(L + i * bw, H - B - bh, Math.max(1, bw - 1), bh); });
  }

  async function selectEvent(e, tr) {
    const s = sessions.get(current.code);
    for (const x of $('eventTable').querySelectorAll('tr.sel')) x.classList.remove('sel');
    if (tr) tr.classList.add('sel');
    const fs = s.result.sampleRate;
    currentEvent = e;
    currentSnippet = await D.readSnippet(s.reader, s.result.header, e.peakIndex, Math.round(fs * 0.01), s.result.frames);
    showSnippet(currentSnippet, fs, `이벤트 ${fmt(e.timeSec, 4)}초 · SNR ${fmt(e.snr, 1)} · 피크 주파수 ${fmt(D.peakFrequency(currentSnippet, fs, s.result.params.cutoffHz) / 1000, 1)} kHz`);
    $('evLabel').value = `${current.code} · ${fmt(e.timeSec, 2)}초`;
  }

  function showSnippet(x, fs, info) {
    $('eventView').hidden = false;
    const sp = D.spectrogram(x, fs, 256, 32);
    const c = $('specCanvas'), ctx = c.getContext('2d'), W = c.width, H = c.height, L = 50;
    ctx.fillStyle = '#FBFAF6'; ctx.fillRect(0, 0, W, H);
    let max = 1e-20;
    for (const f of sp.frames) for (const v of f) if (v > max) max = v;
    const nb = sp.nfft / 2, cw = (W - L) / Math.max(1, sp.frames.length), rh = H / nb;
    sp.frames.forEach((f, i) => {
      for (let b = 0; b < nb; b++) {
        const db = 10 * Math.log10(f[b] / max + 1e-12);
        const t = Math.max(0, Math.min(1, (db + 70) / 70));
        ctx.fillStyle = `rgb(${Math.round(250 - 222 * t)},${Math.round(248 - 170 * t)},${Math.round(240 - 165 * t)})`;
        ctx.fillRect(L + i * cw, H - (b + 1) * rh, cw + 1, rh + 1);
      }
    });
    ctx.fillStyle = '#5A5F57'; ctx.font = '13px sans-serif';
    for (const k of [0, 0.25, 0.5, 0.75, 1]) ctx.fillText(Math.round(fs / 2 * k / 1000) + 'k', 4, H - k * (H - 14) - 2);
    const cut = (current && current.cutoffHz) || 20000;
    ctx.strokeStyle = '#A4561A'; ctx.setLineDash([4, 4]);
    const yc = H - cut / (fs / 2) * H; ctx.beginPath(); ctx.moveTo(L, yc); ctx.lineTo(W, yc); ctx.stroke(); ctx.setLineDash([]);
    $('eventInfo').textContent = info + ` · 주황 점선 = ${cut / 1000} kHz`;
  }

  let audioCtx = null;
  function playSamples(x, rate, onEnd) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const buf = audioCtx.createBuffer(1, x.length, rate);
      const d = buf.getChannelData(0);
      let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
      const g = peak > 0 ? 0.8 / peak : 1, fade = Math.min(200, x.length >> 3);
      for (let i = 0; i < x.length; i++) {
        const w = Math.min(1, i / fade, (x.length - 1 - i) / fade);
        d[i] = x[i] * g * w;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.connect(audioCtx.destination);
      if (onEnd) src.onended = onEnd;
      src.start();
      return buf.duration;
    } catch (err) {
      alert('소리를 재생하지 못했습니다: ' + err.message);
      return 0;
    }
  }

  $('evPlay').onclick = () => { if (currentSnippet) playSamples(currentSnippet, sessions.get(current.code).result.sampleRate / expandFactor()); };
  $('evDownload').onclick = () => {
    if (!currentSnippet) return;
    const fs = sessions.get(current.code).result.sampleRate;
    download(`${current.code}_${fmt(currentEvent.timeSec, 3)}s_x${expandFactor()}.wav`, new Blob([D.encodeWav(currentSnippet, fs / expandFactor(), true)], { type: 'audio/wav' }));
  };
  $('evAdd').onclick = async () => {
    if (!currentSnippet) return;
    const fs = sessions.get(current.code).result.sampleRate;
    await S.Clips.add({ condition: $('evCond').value, label: $('evLabel').value, samples: currentSnippet, rate: fs / expandFactor(), expand: expandFactor(), source: current.code, createdAt: new Date().toISOString() });
    renderLibrary();
  };
  $('bgAdd').onclick = async () => {
    const s = sessions.get(current.code); if (!s) return;
    const r = s.result, fs = r.sampleRate, half = Math.round(fs * 0.01);
    let idx = -1;
    for (let tries = 0; tries < 200 && idx < 0; tries++) {
      const c = half + Math.floor(Math.random() * Math.max(1, r.frames - 2 * half));
      if (!r.events.some(e => Math.abs(e.peakIndex - c) < fs * 0.05)) idx = c;
    }
    if (idx < 0) { alert('이벤트가 없는 구간을 찾지 못했습니다.'); return; }
    const x = await D.readSnippet(s.reader, r.header, idx, half, r.frames);
    await S.Clips.add({ condition: 'noise', label: `${current.code} 배경 ${fmt(idx / fs, 2)}초`, samples: x, rate: fs / expandFactor(), expand: expandFactor(), source: current.code, createdAt: new Date().toISOString() });
    renderLibrary();
  };

  async function renderLibrary() {
    const clips = await S.Clips.list();
    table($('libTable'), [
      ['분류', r => COND_LABEL[r.condition]], ['설명', 'label'], ['길이', r => fmt(r.samples.length / r.rate, 2) + '초'],
      ['', r => h('button', { class: 'ghost', onclick: () => playSamples(r.samples, r.rate) }, '▶')],
      ['', r => h('button', { class: 'ghost danger', onclick: async () => { await S.Clips.remove(r.id); renderLibrary(); } }, '삭제')],
    ], clips);
  }
  $('libImport').onchange = async e => {
    for (const f of e.target.files) {
      try {
        const buf = await f.arrayBuffer();
        const hd = D.parseWavHeader(buf);
        const frames = Math.floor(Math.min(hd.dataSize || buf.byteLength, buf.byteLength - hd.dataOffset) / hd.blockAlign);
        await S.Clips.add({ condition: $('libImportCond').value, label: f.name, samples: D.decodeFrames(buf, hd, hd.dataOffset, frames), rate: hd.sampleRate, expand: null, source: f.name, createdAt: new Date().toISOString() });
      } catch (err) { alert(f.name + ': ' + err.message); }
    }
    e.target.value = '';
    renderLibrary();
  };
  $('expand').onchange = () => { $('kidExpand').textContent = expandFactor(); };

  // ---------- 통계 ----------
  let blindKey = null;
  $('keyMake').onclick = () => {
    if (!pots.length) { alert('실험 기록 탭에서 화분을 먼저 등록하세요.'); return; }
    const dates = [];
    for (let d = $('keyStart').value; d <= $('keyEnd').value; d = addDays(d, 1)) dates.push(d);
    const pairs = [];
    for (const d of dates) for (const p of pots) pairs.push({ pot: p.id, group: p.group, date: d });
    const codes = D.blindCodes(pairs.length);
    pairs.forEach((p, i) => { p.code = codes[i]; });
    download(`블라인드키_분석자열람금지_${today()}.csv`, csvBlob(D.toCSV(pairs, ['code', 'pot', 'group', 'date'])));
  };
  $('keyImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    blindKey = new Map(D.parseCSV(await readText(f)).map(r => [r.code, r]));
    $('keyMsg').textContent = `키 ${blindKey.size}개 불러옴`;
  };

  // 정오 이전에 시작한 녹음은 전날 밤 실험일로 본다.
  function experimentDay(start) {
    if (!start) return null;
    const d = start.slice(0, 10), hour = parseInt(start.slice(11, 13) || '12', 10);
    return hour < 12 ? addDays(d, -1) : d;
  }
  function weightOn(pot, date) {
    const ws = weights.filter(w => w.pot === pot && w.date <= date);
    return ws.length ? ws[ws.length - 1].weight : null;
  }

  $('runStats').onclick = () => {
    const out = $('statsOut');
    out.replaceChildren();
    const stop = $('stopDate').value, rewater = $('rewaterDate').value;
    const skipped = [];
    const agg = new Map();
    for (const a of analyses) {
      if (a.code.startsWith('TEST_')) continue;
      const k = blindKey && blindKey.get(a.code);
      const pot = k ? k.pot : a.code;
      const date = (k && k.date) || experimentDay(a.start);
      const group = potGroup(pot) || (k && k.group);
      if (!date || !group) { skipped.push(a.code); continue; }
      const key = pot + '|' + date;
      const g = agg.get(key) || { pot, date, group, events: 0, hours: 0 };
      g.events += a.events; g.hours += a.durationSec / 3600;
      agg.set(key, g);
    }
    const pd = Array.from(agg.values()).map(g => Object.assign(g, {
      rate: g.hours > 0 ? g.events / g.hours : NaN,
      phase: g.date < stop ? '기준' : g.date < rewater ? '가뭄' : '재관수',
    })).sort((a, b) => a.date.localeCompare(b.date) || a.pot.localeCompare(b.pot));
    for (const r of pd) {
      const w0 = weightOn(r.pot, stop), w = weightOn(r.pot, r.date);
      r.lossPct = w0 && w != null ? (w0 - w) / w0 * 100 : NaN;
    }
    if (!pd.length) {
      out.append(h('div', { class: 'card' }, '합칠 수 있는 분석 결과가 없습니다. 파일 코드가 화분 ID와 같거나 블라인드 키가 있어야 하고, 날짜(녹음 시각 또는 키)가 필요합니다.'));
      return;
    }

    const potMean = (group, phase, filter) => {
      const m = new Map();
      for (const r of pd) if (r.group === group && r.phase === phase && (!filter || filter(r))) (m.get(r.pot) || m.set(r.pot, []).get(r.pot)).push(r.rate);
      return new Map(Array.from(m, ([p, v]) => [p, D.mean(v)]));
    };
    const dMean = potMean('drought', '가뭄'), cMean = potMean('control', '가뭄'), sMean = potMean('soil', '가뭄');
    const h1 = D.mannWhitney(Array.from(dMean.values()), Array.from(cMean.values()));
    const h2rows = pd.filter(r => r.group === 'drought' && r.phase === '가뭄' && isFinite(r.lossPct) && isFinite(r.rate));
    const h2 = D.spearman(h2rows.map(r => r.lossPct), h2rows.map(r => r.rate));
    const lateD = potMean('drought', '가뭄', r => r.date >= addDays(rewater, -2));
    const reW = potMean('drought', '재관수');
    const paired = Array.from(lateD.keys()).filter(p => reW.has(p));
    const h3 = D.wilcoxonSignedRank(paired.map(p => lateD.get(p)), paired.map(p => reW.get(p)));

    const card = (title, big, lines) => h('div', { class: 'stat' }, h('div', { class: 'muted' }, title), h('div', { class: 'big' }, big), ...lines.map(l => h('div', { class: 'muted' }, l)));
    out.append(h('div', { class: 'card' }, h('h3', null, '결과 요약'), h('div', { class: 'stat-grid' },
      card('H1 가뭄 > 대조 (가뭄 기간 화분별 평균 이벤트/시간)', h1 ? `p = ${fmtP(h1.p)}` : '자료 부족', h1 ? [
        `가뭄 중앙값 ${fmt(D.median(Array.from(dMean.values())))} (n=${h1.n1}) · 대조 중앙값 ${fmt(D.median(Array.from(cMean.values())))} (n=${h1.n2})`,
        `흙만 평균 ${fmt(D.mean(Array.from(sMean.values())))} (잡음 기준)`,
        `만-휘트니 U = ${h1.U} (${h1.method}, 양측) · 순위이연 r = ${fmt(h1.rankBiserial, 2)}`] : ['가뭄·대조 화분의 가뭄 기간 자료가 모두 필요합니다']),
      card('H2 무게 감소 ↔ 이벤트 수 (가뭄군 화분-일)', isFinite(h2.rho) ? `ρ = ${fmt(h2.rho, 2)}` : '자료 부족', isFinite(h2.rho) ? [
        `p = ${fmtP(h2.p)} (순열 검정 10,000회, n=${h2.n} 화분-일)`,
        '같은 화분의 여러 날은 독립이 아니므로 탐색적 결과로 보고'] : ['관수 중단일 무게와 가뭄 기간 녹음이 필요합니다']),
      card('H3 재관수 후 감소 (가뭄군, 마지막 2일 vs 재관수)', h3.n ? `p = ${fmtP(h3.p)}` : '자료 부족', h3.n ? [
        `짝 ${h3.n}개 화분 · 재관수 후 감소한 화분 ${paired.filter(p => reW.get(p) < lateD.get(p)).length}개`,
        `윌콕슨 부호순위 (정확 검정, 양측) W+ = ${h3.W}`] : ['재관수 이후 녹음이 필요합니다']),
    ), skipped.length ? h('p', { class: 'muted' }, `날짜나 그룹을 알 수 없어 제외: ${skipped.join(', ')}`) : null));

    const cv = h('canvas', { width: 1000, height: 340 });
    out.append(h('div', { class: 'card' }, h('h3', null, '날짜별 이벤트/시간 (굵은 선 = 그룹 평균, 얇은 선 = 화분)'), cv,
      h('div', { class: 'legend' }, h('span', { class: 'lg drought' }, '가뭄'), h('span', { class: 'lg control' }, '대조'), h('span', { class: 'lg soil' }, '흙만'))));
    const series = [];
    for (const p of new Set(pd.map(r => r.pot))) {
      const rs = pd.filter(r => r.pot === p);
      series.push({ color: COLORS[rs[0].group], width: 1, alpha: 0.35, points: rs.map(r => [dayNum(r.date), r.rate]) });
    }
    for (const g of ['drought', 'control', 'soil']) {
      const dates = Array.from(new Set(pd.filter(r => r.group === g).map(r => r.date))).sort();
      if (dates.length) series.push({ color: COLORS[g], width: 3, dots: true, points: dates.map(d => [dayNum(d), D.mean(pd.filter(r => r.group === g && r.date === d).map(r => r.rate))]) });
    }
    lineChart(cv, series, { yLabel: '이벤트/시간', yMin: 0, xTicks: dayTicks(pd.map(r => r.date).concat([stop, rewater])) });

    const tbl = h('table');
    table(tbl, [['날짜', 'date'], ['단계', 'phase'], ['화분', 'pot'], ['그룹', r => GROUP_LABEL[r.group]], ['녹음(시간)', r => fmt(r.hours, 2)], ['이벤트', 'events'], ['이벤트/시간', r => fmt(r.rate)], ['무게 감소 %', r => fmt(r.lossPct)]], pd);
    out.append(h('div', { class: 'card' }, h('h3', null, '화분-일 자료'), h('div', { class: 'table-wrap' }, tbl),
      h('div', { class: 'row' }, h('button', { onclick: () => download(`화분일_통합_${today()}.csv`, csvBlob(D.toCSV(pd, ['date', 'phase', 'pot', 'group', 'hours', 'events', 'rate', 'lossPct']))) }, '통합 CSV 내보내기'))));
  };

  // ---------- 소리 체험 ----------
  function drawWave(canvas, x, progress, color) {
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!x) return;
    let peak = 1e-9; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const step = Math.max(1, Math.floor(x.length / W));
    for (let px = 0; px < W; px++) {
      let m = 0;
      for (let i = px * step; i < Math.min(x.length, (px + 1) * step); i++) m = Math.max(m, Math.abs(x[i]));
      const hgt = m / peak * (H / 2 - 8);
      ctx.fillStyle = px / W <= progress ? color : '#D9D3C5';
      ctx.fillRect(px, H / 2 - hgt, 1, hgt * 2 || 1);
    }
  }
  let kidTimer = null;
  const kidColors = { drought: '#C0621F', control: '#2E6A4B', cut: '#6A4C93' };
  for (const btn of document.querySelectorAll('.kid[data-cond]')) {
    btn.onclick = async () => {
      const cond = btn.dataset.cond;
      const clips = (await S.Clips.list()).filter(c => c.condition === cond);
      for (const b of document.querySelectorAll('.kid[data-cond]')) b.classList.remove('playing');
      if (!clips.length) {
        $('kidCaption').textContent = '아직 이 토마토의 녹음이 없어요.';
        $('kidSource').textContent = '연구팀: “초음파 분석” 탭에서 이벤트를 소리 라이브러리에 추가하세요.';
        drawWave($('kidWave'), null);
        return;
      }
      const c = clips[Math.floor(Math.random() * clips.length)];
      btn.classList.add('playing');
      const dur = playSamples(c.samples, c.rate);
      $('kidCaption').textContent = cond === 'drought' ? '딸깍! 물이 부족한 토마토가 낸 소리예요.' : cond === 'cut' ? '줄기가 잘린 토마토가 낸 소리예요.' : '물을 충분히 마신 토마토 옆에서 녹음한 소리예요.';
      $('kidSource').textContent = `${c.label} · ${String(c.source).startsWith('TEST_') ? '앱 검증용 합성음(실제 녹음 아님)' : '우리 팀이 직접 녹음한 소리'}${c.expand ? ` · 실제보다 ${c.expand}배 느리게` : ''}`;
      const t0 = performance.now();
      clearInterval(kidTimer);
      kidTimer = setInterval(() => {
        const p = (performance.now() - t0) / 1000 / dur;
        drawWave($('kidWave'), c.samples, p, kidColors[cond]);
        if (p >= 1) { clearInterval(kidTimer); btn.classList.remove('playing'); }
      }, 30);
    };
  }

  // ---------- 청취 퀴즈 ----------
  let quiz = S.load('quiz', []);
  let round = null;
  async function newQuizRound() {
    const clips = await S.Clips.list();
    const dr = clips.filter(c => c.condition === 'drought');
    let other = clips.filter(c => c.condition === 'control');
    if (!other.length) other = clips.filter(c => c.condition === 'noise');
    const ok = dr.length && other.length;
    for (const id of ['qPlayA', 'qPlayB', 'qAnsA', 'qAnsB']) $(id).disabled = !ok;
    if (!ok) { round = null; $('qFeedback').textContent = '퀴즈에는 가뭄 클립과 대조(또는 배경) 클립이 각각 1개 이상 필요해요.'; renderQuizStat(); return; }
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const d = pick(dr), o = pick(other), droughtIsA = Math.random() < 0.5;
    round = { A: droughtIsA ? d : o, B: droughtIsA ? o : d, droughtIsA };
    $('qFeedback').textContent = '두 소리를 모두 들어 보세요.';
    renderQuizStat();
  }
  function answer(choseA) {
    if (!round) return;
    const correct = choseA === round.droughtIsA;
    quiz.push({ time: new Date().toISOString(), correct: correct ? 1 : 0, droughtClip: (round.droughtIsA ? round.A : round.B).label, otherClip: (round.droughtIsA ? round.B : round.A).label });
    S.save('quiz', quiz);
    $('qFeedback').textContent = correct ? '정답! 목마른 토마토의 소리를 찾았어요.' : `아쉬워요. 목마른 토마토는 ${round.droughtIsA ? 'A' : 'B'}였어요.`;
    round = null;
    for (const id of ['qAnsA', 'qAnsB']) $(id).disabled = true;
    renderQuizStat();
    setTimeout(newQuizRound, 2500);
  }
  function renderQuizStat() {
    const n = quiz.length, k = quiz.reduce((s, q) => s + q.correct, 0);
    $('qStat').textContent = n ? `응답 ${n}명 · 정답 ${k}명 (${fmt(k / n * 100, 0)}%) · 우연(50%)보다 높을 확률 검정 p = ${fmtP(D.binomialGreater(k, n))} (단측 이항 검정)` : '아직 응답이 없습니다.';
  }
  $('qPlayA').onclick = () => round && playSamples(round.A.samples, round.A.rate);
  $('qPlayB').onclick = () => round && playSamples(round.B.samples, round.B.rate);
  $('qAnsA').onclick = () => answer(true);
  $('qAnsB').onclick = () => answer(false);
  $('qExport').onclick = () => download(`청취퀴즈_${today()}.csv`, csvBlob(D.toCSV(quiz, ['time', 'correct', 'droughtClip', 'otherClip'])));
  $('qReset').onclick = () => { if (confirm('퀴즈 응답을 모두 지울까요?')) { quiz = []; S.save('quiz', quiz); renderQuizStat(); } };

  // ---------- 반응시간 ----------
  let rt = S.load('rt', []);
  let rtState = 'idle', rtTimer = null, rtOnset = 0;
  const rtPad = $('rtPad');
  function rtStat() {
    const v = rt.filter(r => !r.falseStart).map(r => r.rt);
    $('rtStat').textContent = v.length ? `유효 ${v.length}회 · 중앙값 ${fmt(D.median(v), 0)} ms · 평균 ${fmt(D.mean(v), 0)} ms · SD ${fmt(D.sd(v), 0)} ms · 조기 반응 ${rt.length - v.length}회` : '기록 없음';
  }
  function rtWait() {
    rtState = 'wait'; rtPad.className = 'rt-pad'; rtPad.textContent = '기다리세요…';
    rtTimer = setTimeout(() => {
      rtPad.className = 'rt-pad go'; rtPad.textContent = '지금!';
      requestAnimationFrame(() => requestAnimationFrame(t => { rtOnset = t; rtState = 'go'; }));
    }, 1000 + Math.random() * 2000);
  }
  rtPad.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    if (rtState === 'idle' || rtState === 'done') { rtWait(); return; }
    if (rtState === 'wait') {
      clearTimeout(rtTimer);
      rt.push({ trial: rt.length + 1, rt: null, falseStart: 1, time: new Date().toISOString() });
      rtPad.className = 'rt-pad early'; rtPad.textContent = '너무 빨라요! 잠시 후 다시';
      rtState = 'pause'; setTimeout(rtWait, 1200);
    } else if (rtState === 'go') {
      const ms = ev.timeStamp - rtOnset;
      rt.push({ trial: rt.length + 1, rt: Math.round(ms), falseStart: 0, time: new Date().toISOString() });
      const valid = rt.filter(r => !r.falseStart).length;
      rtPad.className = 'rt-pad'; rtPad.textContent = `${Math.round(ms)} ms · ${valid % 10 === 0 ? '10회 완료! 다시 하려면 누르세요' : '다음은 곧 시작'}`;
      if (valid % 10 === 0) rtState = 'done'; else { rtState = 'pause'; setTimeout(rtWait, 900); }
    }
    S.save('rt', rt); rtStat();
  });
  $('rtExport').onclick = () => download(`반응시간_${today()}.csv`, csvBlob(D.toCSV(rt.map(r => Object.assign({ device: navigator.userAgent }, r)), ['trial', 'rt', 'falseStart', 'time', 'device'])));
  $('rtReset').onclick = () => { rt = []; S.save('rt', rt); rtStat(); rtState = 'idle'; rtPad.className = 'rt-pad'; rtPad.textContent = '시작하려면 누르세요'; };

  // ---------- 터치 떨림 ----------
  let trSamples = [], trRec = false;
  const trPad = $('trPad');
  function trPush(ev) {
    if (!trRec) return;
    const list = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
    for (const e of (list.length ? list : [ev])) trSamples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
  }
  trPad.addEventListener('pointerdown', e => { trPad.setPointerCapture(e.pointerId); trPush(e); });
  trPad.addEventListener('pointermove', trPush);
  $('trStart').onclick = () => {
    trSamples = []; trRec = true;
    trPad.classList.add('rec'); trPad.textContent = '측정 중… 손가락을 대고 있으세요';
    $('trStart').disabled = true;
    let left = 10;
    $('trMsg').textContent = left + '초';
    const iv = setInterval(() => {
      left--; $('trMsg').textContent = left + '초';
      if (left <= 0) { clearInterval(iv); trRec = false; trPad.classList.remove('rec'); trPad.textContent = '여기에 손가락을 대세요'; $('trStart').disabled = false; $('trMsg').textContent = ''; analyzeTremor(); }
    }, 1000);
  };

  function analyzeTremor() {
    const s = trSamples.slice().sort((a, b) => a.t - b.t).filter((p, i, a) => !i || p.t > a[i - 1].t);
    if (s.length < 32) { $('trStat').textContent = `샘플 ${s.length}개 — 너무 적습니다. 판 위에서 손가락을 떼지 말고 다시 측정하세요.`; lineChart($('trChart'), [], {}); return; }
    // 100 ms 이상 끊긴 곳을 기준으로 가장 긴 연속 구간만 쓴다
    let best = [0, 0], st = 0;
    for (let i = 1; i <= s.length; i++) if (i === s.length || s[i].t - s[i - 1].t > 100) { if (i - st > best[1] - best[0]) best = [st, i]; st = i; }
    const seg = s.slice(best[0], best[1]);
    const dts = seg.slice(1).map((p, i) => p.t - seg[i].t);
    const rate = 1000 / D.median(dts), nyq = rate / 2;
    const n = Math.floor((seg[seg.length - 1].t - seg[0].t) / 1000 * rate);
    const ux = new Float64Array(n), uy = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = seg[0].t + i * 1000 / rate;
      while (j < seg.length - 2 && seg[j + 1].t < t) j++;
      const a = seg[j], b = seg[j + 1], f = (t - a.t) / (b.t - a.t);
      ux[i] = a.x + (b.x - a.x) * f; uy[i] = a.y + (b.y - a.y) * f;
    }
    const detrend = v => {
      const m = v.length, xm = (m - 1) / 2, ym = D.mean(Array.from(v));
      let sxy = 0, sxx = 0;
      for (let i = 0; i < m; i++) { sxy += (i - xm) * (v[i] - ym); sxx += (i - xm) ** 2; }
      const k = sxy / sxx;
      return v.map((y, i) => y - ym - k * (i - xm));
    };
    const dx = detrend(ux), dy = detrend(uy);
    const nf = D.nextPow2(n);
    const px = D.powerSpectrum(dx, nf), py = D.powerSpectrum(dy, nf);
    const pts = [];
    let peakF = 0, peakP = -1;
    for (let i = 1; i < nf / 2; i++) {
      const f = i * rate / nf, p = px[i] + py[i];
      pts.push([f, p]);
      if (f >= 2 && p > peakP) { peakP = p; peakF = f; }
    }
    const rms = Math.sqrt(D.mean(Array.from(dx, v => v * v)) + D.mean(Array.from(dy, v => v * v)));
    lineChart($('trChart'), [{ color: '#2E6A4B', points: pts }], { yLabel: '파워 (x+y)', yDigits: 0, xTicks: [0, 2, 4, 6, 8, 10, 12, 15, 20, 30].filter(f => f <= nyq).map(f => [f, f + 'Hz']) });
    $('trStat').textContent = `샘플 ${seg.length}개 (${fmt((seg[seg.length - 1].t - seg[0].t) / 1000, 1)}초) · 터치 보고 빈도 ≈ ${fmt(rate, 1)} Hz → 측정 가능한 최고 주파수(나이퀴스트) ${fmt(nyq, 1)} Hz · 2 Hz 이상 주 주파수 ${fmt(peakF, 2)} Hz · 흔들림 RMS ${fmt(rms, 2)} px`;
  }
  $('trExport').onclick = () => download(`터치원자료_${today()}.csv`, csvBlob(D.toCSV(trSamples.map(p => ({ t_ms: p.t.toFixed(3), x: p.x, y: p.y })), ['t_ms', 'x', 'y'])));

  // ---------- 시작 ----------
  renderRoadmap(); renderPots(); renderWeighGrid(); renderLogTable(); renderAnaTable(); renderLibrary(); renderQuizStat(); rtStat();
  showTab(S.load('tab', 'roadmap'));
})();
