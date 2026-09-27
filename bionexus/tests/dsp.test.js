// 실행: node bionexus/tests/dsp.test.js
const assert = require('assert');
const D = require('../js/dsp.js');

function readerFrom(buf) {
  return { size: buf.byteLength, read: async (s, e) => buf.slice(s, e) };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('WAV 인코딩 → 헤더 파싱 → 디코딩 왕복', () => {
  const x = new Float32Array([0, 0.5, -0.5, 0.25]);
  const buf = D.encodeWav(x, 384000);
  const h = D.parseWavHeader(buf);
  assert.strictEqual(h.sampleRate, 384000);
  assert.strictEqual(h.bitsPerSample, 16);
  const y = D.decodeFrames(buf, h, h.dataOffset, 4);
  for (let i = 0; i < 4; i++) assert(Math.abs(x[i] - y[i]) < 1e-3);
});

test('알 수 없는 청크(GUANO 등)를 건너뛴다', () => {
  const base = new Uint8Array(D.encodeWav(new Float32Array(10), 250000));
  const extra = new Uint8Array(8 + 5 + 1);
  const dv = new DataView(extra.buffer);
  'GUAN'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint32(4, 5, true);
  const out = new Uint8Array(base.length + extra.length);
  out.set(base.slice(0, 36)); out.set(extra, 36); out.set(base.slice(36), 36 + extra.length);
  const h = D.parseWavHeader(out.buffer);
  assert.strictEqual(h.sampleRate, 250000);
  assert.strictEqual(h.dataOffset, 36 + extra.length + 8);
});

test('AudioMoth 파일명에서 시각 추출', () => {
  assert.strictEqual(D.parseAudioMothName('20261007_023000.WAV'), '2026-10-07T02:30:00');
  assert.strictEqual(D.parseAudioMothName('pot3.wav'), null);
});

test('합성 녹음에서 초음파 클릭을 정확히 검출하고 가청 잡음은 무시', async () => {
  const fs = 384000;
  const times = [0.5, 1.7, 2.2, 3.9, 4.4];
  const x = D.synthTestRecording(fs, 5, times);
  const buf = D.encodeWav(x, fs);
  const r = await D.analyzeRecording(readerFrom(buf), { chunkBytes: 100000 });
  assert.strictEqual(r.events.length, times.length, '검출 수: ' + r.events.length);
  r.events.forEach((e, i) => assert(Math.abs(e.timeSec - times[i]) < 0.002));
  const snip = await D.readSnippet(readerFrom(buf), r.header, r.events[0].peakIndex, 512, r.frames);
  const f = D.peakFrequency(snip, fs, 20000);
  assert(Math.abs(f - 40000) < 1500, '피크 주파수 ' + f);
});

test('긴 조각에서도 가운데 이벤트의 주파수를 잡는다', () => {
  const fs = 384000, x = new Float32Array(7680);
  x.set(D.synthClick(fs, 40000, 1, 0.5), 3840);
  assert(Math.abs(D.peakFrequency(x, fs, 20000) - 40000) < 1500);
});

test('클릭이 없으면 이벤트도 거의 없다 (잡음 대조)', async () => {
  const fs = 384000;
  const buf = D.encodeWav(D.synthTestRecording(fs, 3, []), fs);
  const r = await D.analyzeRecording(readerFrom(buf), {});
  assert(r.events.length <= 1, '오검출 ' + r.events.length);
});

test('샘플링 레이트가 낮으면 오류', async () => {
  const buf = D.encodeWav(new Float32Array(3200), 32000);
  await assert.rejects(D.analyzeRecording(readerFrom(buf), {}));
});

test('만-휘트니 정확 검정: 완전 분리된 6 vs 6', () => {
  const r = D.mannWhitney([10, 11, 12, 13, 14, 15], [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(r.U, 0);
  assert(Math.abs(r.p - 2 / 924) < 1e-9, 'p=' + r.p);
  assert.strictEqual(r.rankBiserial, 1);
});

test('윌콕슨 부호순위: 6쌍 모두 감소하면 p=2/64', () => {
  const r = D.wilcoxonSignedRank([10, 9, 8, 7, 6, 5], [1, 2, 3, 1, 2, 0]);
  assert(Math.abs(r.p - 2 / 64) < 1e-9);
});

test('스피어만: 단조 관계면 rho=1', () => {
  const r = D.spearman([1, 2, 3, 4, 5, 6, 7], [2, 4, 8, 16, 32, 64, 128], 2000);
  assert(Math.abs(r.rho - 1) < 1e-12);
  assert(r.p < 0.01);
});

test('이항 검정', () => {
  assert(Math.abs(D.binomialGreater(10, 10) - 1 / 1024) < 1e-12);
  assert.strictEqual(D.binomialGreater(0, 10), 1);
});

test('CSV 왕복', () => {
  const rows = [{ a: '1', b: 'x,y' }, { a: '2', b: 'q"z' }];
  assert.deepStrictEqual(D.parseCSV(D.toCSV(rows, ['a', 'b'])), rows);
});

test('블라인드 코드는 중복 없음', () => {
  const c = D.blindCodes(200, 3);
  assert.strictEqual(new Set(c).size, 200);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
  }
  console.log(failed ? `${failed}개 실패` : `전체 ${tests.length}개 통과`);
  process.exit(failed ? 1 : 0);
})();
