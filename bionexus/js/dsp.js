// BioNexus 신호 처리·통계 모듈 (브라우저와 Node 양쪽에서 사용)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BNDsp = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- WAV ----------

  function fourcc(view, off) {
    return String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
  }

  // RIFF 청크를 훑어 fmt/data 위치를 찾는다. AudioMoth의 GUANO 등 알 수 없는 청크는 건너뛴다.
  function parseWavHeader(buf) {
    const view = new DataView(buf);
    if (buf.byteLength < 12 || fourcc(view, 0) !== 'RIFF' || fourcc(view, 8) !== 'WAVE') {
      throw new Error('WAV(RIFF) 파일이 아닙니다.');
    }
    let off = 12;
    let fmt = null;
    while (off + 8 <= buf.byteLength) {
      const id = fourcc(view, off);
      const size = view.getUint32(off + 4, true);
      const body = off + 8;
      if (id === 'fmt ') {
        let format = view.getUint16(body, true);
        const channels = view.getUint16(body + 2, true);
        const sampleRate = view.getUint32(body + 4, true);
        const blockAlign = view.getUint16(body + 12, true);
        const bitsPerSample = view.getUint16(body + 14, true);
        if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
        fmt = { format, channels, sampleRate, blockAlign, bitsPerSample };
      } else if (id === 'data') {
        if (!fmt) throw new Error('fmt 청크보다 data 청크가 먼저 나왔습니다.');
        if (fmt.format !== 1 && fmt.format !== 3) throw new Error('지원하지 않는 WAV 형식입니다 (PCM/float만 지원).');
        return Object.assign({}, fmt, { dataOffset: body, dataSize: size });
      }
      off = body + size + (size % 2);
    }
    throw new Error('WAV data 청크를 찾지 못했습니다.');
  }

  // buf[byteOffset..]에서 frameCount 프레임을 읽어 첫 채널을 [-1,1] Float32Array로 돌려준다.
  function decodeFrames(buf, header, byteOffset, frameCount) {
    const view = new DataView(buf);
    const out = new Float32Array(frameCount);
    const { blockAlign, bitsPerSample, format } = header;
    for (let i = 0; i < frameCount; i++) {
      const p = byteOffset + i * blockAlign;
      let v;
      if (format === 3) v = bitsPerSample === 64 ? view.getFloat64(p, true) : view.getFloat32(p, true);
      else if (bitsPerSample === 16) v = view.getInt16(p, true) / 32768;
      else if (bitsPerSample === 24) {
        let x = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
        if (x & 0x800000) x -= 0x1000000;
        v = x / 8388608;
      } else if (bitsPerSample === 32) v = view.getInt32(p, true) / 2147483648;
      else if (bitsPerSample === 8) v = (view.getUint8(p) - 128) / 128;
      else throw new Error(bitsPerSample + '비트 WAV는 지원하지 않습니다.');
      out[i] = v;
    }
    return out;
  }

  // 16비트 PCM 모노 WAV로 인코딩. 시간 확장 가청화는 sampleRate만 낮춰 쓰면 된다.
  function encodeWav(samples, sampleRate, normalize) {
    let gain = 1;
    if (normalize) {
      let peak = 0;
      for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
      if (peak > 0) gain = 0.9 / peak;
    }
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    const rate = Math.round(sampleRate);
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] * gain));
      v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return buf;
  }

  // AudioMoth 기본 파일명(20261007_023000.WAV)에서 녹음 시작 시각을 읽는다.
  function parseAudioMothName(name) {
    const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name || '');
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }

  // ---------- 필터 ----------

  function biquadHighpass(fc, fs, Q) {
    const w0 = 2 * Math.PI * fc / fs, c = Math.cos(w0), a = Math.sin(w0) / (2 * Q);
    const a0 = 1 + a;
    return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: -2 * c / a0, a2: (1 - a) / a0, z1: 0, z2: 0 };
  }

  // 4차 버터워스 고역통과 (biquad 2단). 상태를 유지하므로 청크 단위로 연속 호출 가능.
  function makeHighpass(fc, fs) {
    const st = [biquadHighpass(fc, fs, 0.5411961), biquadHighpass(fc, fs, 1.3065630)];
    return function (x) {
      const out = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) {
        let y = x[i];
        for (let k = 0; k < 2; k++) {
          const s = st[k];
          const o = s.b0 * y + s.z1;
          s.z1 = s.b1 * y - s.a1 * o + s.z2;
          s.z2 = s.b2 * y - s.a2 * o;
          y = o;
        }
        out[i] = y;
      }
      return out;
    };
  }

  // ---------- 이벤트 검출 ----------

  const HIST_BINS = 600, HIST_MIN = 1e-8, HIST_MAX = 2;
  const HIST_LOG_MIN = Math.log(HIST_MIN), HIST_LOG_SPAN = Math.log(HIST_MAX) - HIST_LOG_MIN;

  function histBin(a) {
    if (a <= HIST_MIN) return 0;
    const b = Math.floor((Math.log(a) - HIST_LOG_MIN) / HIST_LOG_SPAN * HIST_BINS);
    return Math.min(HIST_BINS - 1, Math.max(0, b));
  }
  function histValue(b) { return Math.exp(HIST_LOG_MIN + (b + 0.5) / HIST_BINS * HIST_LOG_SPAN); }

  // reader: { size, read(start, end) -> Promise<ArrayBuffer> }
  // 1차: 고역통과 신호의 |y| 중앙값으로 잡음 σ 추정 (σ ≈ 중앙값/0.6745)
  // 2차: |y| > k·σ 인 지점을 이벤트로 보고, refractoryMs 동안은 같은 이벤트로 묶는다.
  async function analyzeRecording(reader, opts) {
    opts = Object.assign({ cutoffHz: 20000, k: 8, refractoryMs: 5, chunkBytes: 8 << 20, maxEvents: 5000, onProgress: null }, opts || {});
    const head = await reader.read(0, Math.min(reader.size, 1 << 20));
    const h = parseWavHeader(head);
    const fs = h.sampleRate;
    if (opts.cutoffHz >= fs / 2 * 0.95) {
      throw new Error(`샘플링 레이트 ${fs} Hz로는 ${opts.cutoffHz / 1000} kHz 이상을 담을 수 없습니다. 초음파 녹음은 최소 ${Math.ceil(opts.cutoffHz * 2.2 / 1000)} kHz 이상으로 설정하세요.`);
    }
    let dataEnd = h.dataOffset + h.dataSize;
    if (!h.dataSize || h.dataSize === 0xffffffff || dataEnd > reader.size) dataEnd = reader.size;
    const frames = Math.floor((dataEnd - h.dataOffset) / h.blockAlign);
    const framesPerChunk = Math.max(1, Math.floor(opts.chunkBytes / h.blockAlign));
    const warmup = Math.min(frames, Math.round(fs * 0.002));

    async function pass(onChunk, label, base) {
      const hp = makeHighpass(opts.cutoffHz, fs);
      for (let f = 0; f < frames; f += framesPerChunk) {
        const n = Math.min(framesPerChunk, frames - f);
        const start = h.dataOffset + f * h.blockAlign;
        const buf = await reader.read(start, start + n * h.blockAlign);
        onChunk(hp(decodeFrames(buf, h, 0, n)), f);
        if (opts.onProgress) opts.onProgress(base + 0.5 * (f + n) / frames, label);
      }
    }

    const hist = new Float64Array(HIST_BINS);
    let counted = 0;
    await pass((y, f0) => {
      for (let i = 0; i < y.length; i++) {
        if (f0 + i < warmup) continue;
        hist[histBin(Math.abs(y[i]))]++;
        counted++;
      }
    }, '잡음 추정', 0);
    let acc = 0, medianAbs = 0;
    for (let b = 0; b < HIST_BINS; b++) {
      acc += hist[b];
      if (acc >= counted / 2) { medianAbs = histValue(b); break; }
    }
    const sigma = medianAbs / 0.6745;
    const threshold = opts.absThreshold || opts.k * sigma;
    const refr = Math.max(1, Math.round(fs * opts.refractoryMs / 1000));

    const events = [];
    let truncated = false, cur = null;
    await pass((y, f0) => {
      for (let i = 0; i < y.length; i++) {
        const idx = f0 + i;
        if (idx < warmup) continue;
        const a = Math.abs(y[i]);
        if (cur) {
          if (a > cur.peak) { cur.peak = a; cur.peakIndex = idx; }
          if (idx >= cur.index + refr) { events.push(cur); cur = null; }
        } else if (a > threshold) {
          if (events.length >= opts.maxEvents) { truncated = true; continue; }
          cur = { index: idx, peak: a, peakIndex: idx };
        }
      }
    }, '이벤트 검출', 0.5);
    if (cur) events.push(cur);

    for (const e of events) {
      e.timeSec = e.peakIndex / fs;
      e.snr = sigma > 0 ? e.peak / sigma : Infinity;
    }
    return {
      header: h, sampleRate: fs, channels: h.channels, bitsPerSample: h.bitsPerSample,
      frames, durationSec: frames / fs, noiseSigma: sigma, threshold, events, truncated,
      params: { cutoffHz: opts.cutoffHz, k: opts.k, refractoryMs: opts.refractoryMs },
    };
  }

  async function readSnippet(reader, header, centerFrame, halfFrames, totalFrames) {
    const s = Math.max(0, centerFrame - halfFrames);
    const e = Math.min(totalFrames, centerFrame + halfFrames);
    const start = header.dataOffset + s * header.blockAlign;
    const buf = await reader.read(start, start + (e - s) * header.blockAlign);
    return decodeFrames(buf, header, 0, e - s);
  }

  // ---------- FFT ----------

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  function powerSpectrum(x, n) {
    const re = new Float64Array(n), im = new Float64Array(n);
    const m = Math.min(n, x.length);
    for (let i = 0; i < m; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (m - 1 || 1)));
    fft(re, im);
    const p = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
    return p;
  }

  function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

  function peakFrequency(x, fs, minHz, maxHz) {
    const n = Math.min(4096, nextPow2(x.length));
    const off = Math.max(0, (x.length - n) >> 1); // 조각 가운데(이벤트 위치)를 분석
    const p = powerSpectrum(x.subarray ? x.subarray(off, off + n) : x.slice(off, off + n), n);
    let best = -1, bi = 0;
    for (let i = 1; i < p.length; i++) {
      const f = i * fs / n;
      if (f < (minHz || 0) || (maxHz && f > maxHz)) continue;
      if (p[i] > best) { best = p[i]; bi = i; }
    }
    return bi * fs / n;
  }

  function spectrogram(x, fs, nfft, hop) {
    nfft = nfft || 256; hop = hop || nfft / 4;
    const frames = [];
    for (let s = 0; s + nfft <= x.length; s += hop) frames.push(powerSpectrum(x.subarray(s, s + nfft), nfft));
    return { frames, nfft, hop, fs };
  }

  // 감쇠 사인파 클릭: 파이프라인 자체 검증(소프트웨어 양성 대조)과 데모용.
  function synthClick(fs, freqHz, durMs, amp) {
    const n = Math.round(fs * durMs / 1000);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freqHz * i / fs) * Math.exp(-5 * i / n);
    return out;
  }

  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  function synthTestRecording(fs, seconds, clickTimes, opts) {
    opts = Object.assign({ noise: 0.002, clickAmp: 0.05, clickHz: 40000, seed: 7 }, opts || {});
    const rng = makeRng(opts.seed);
    const x = new Float32Array(Math.round(fs * seconds));
    for (let i = 0; i < x.length; i++) {
      const u = rng() || 1e-12, v = rng();
      x[i] = opts.noise * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      x[i] += 0.02 * Math.sin(2 * Math.PI * 1000 * i / fs); // 가청 대역 잡음(필터로 제거되어야 함)
    }
    const c = synthClick(fs, opts.clickHz, 1, opts.clickAmp);
    for (const t of clickTimes) {
      const s = Math.round(t * fs);
      for (let i = 0; i < c.length && s + i < x.length; i++) x[s + i] += c[i];
    }
    return x;
  }

  // ---------- 통계 ----------

  function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }
  function median(a) {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function sd(a) {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  }

  function ranks(values) {
    const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(values.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }

  function normalCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // 만-휘트니 U. 표본이 작으면 순위합 분포를 DP로 정확히 계산 (동순위 포함).
  function mannWhitney(a, b) {
    const n1 = a.length, n2 = b.length, N = n1 + n2;
    if (!n1 || !n2) return null;
    const r = ranks(a.concat(b));
    const R1 = r.slice(0, n1).reduce((s, v) => s + v, 0);
    const U1 = R1 - n1 * (n1 + 1) / 2;
    const meanU = n1 * n2 / 2;
    let p, method;
    if (N <= 60) {
      const r2 = r.map(v => Math.round(v * 2));
      const maxSum = r2.reduce((s, v) => s + v, 0);
      let dp = [];
      for (let k = 0; k <= n1; k++) dp.push(new Float64Array(maxSum + 1));
      dp[0][0] = 1;
      for (const v of r2) {
        for (let k = Math.min(n1, N) ; k >= 1; k--) {
          const src = dp[k - 1], dst = dp[k];
          for (let s = maxSum - v; s >= 0; s--) if (src[s]) dst[s + v] += src[s];
        }
      }
      const dist = dp[n1];
      let total = 0, extreme = 0;
      const obsDev = Math.abs(R1 * 2 - n1 * (N + 1));
      for (let s = 0; s <= maxSum; s++) {
        if (!dist[s]) continue;
        total += dist[s];
        if (Math.abs(s - n1 * (N + 1)) >= obsDev - 1e-9) extreme += dist[s];
      }
      p = extreme / total; method = '정확 검정';
    } else {
      const z = (U1 - meanU) / Math.sqrt(n1 * n2 * (N + 1) / 12);
      p = 2 * (1 - normalCdf(Math.abs(z))); method = '정규 근사';
    }
    return { U: Math.min(U1, n1 * n2 - U1), U1, p: Math.min(1, p), rankBiserial: 2 * U1 / (n1 * n2) - 1, n1, n2, method };
  }

  // 윌콕슨 부호순위 (짝지은 비교). 0 차이는 제외, 2^n 전수 열거로 정확 p.
  function wilcoxonSignedRank(before, after) {
    const d = [];
    for (let i = 0; i < before.length; i++) { const x = after[i] - before[i]; if (x !== 0 && isFinite(x)) d.push(x); }
    const n = d.length;
    if (!n) return { n: 0, W: 0, p: 1 };
    const r = ranks(d.map(Math.abs));
    const Wp = r.reduce((s, v, i) => s + (d[i] > 0 ? v : 0), 0);
    const center = n * (n + 1) / 4;
    let p;
    if (n <= 20) {
      let extreme = 0;
      const total = 1 << n;
      for (let m = 0; m < total; m++) {
        let w = 0;
        for (let i = 0; i < n; i++) if (m & (1 << i)) w += r[i];
        if (Math.abs(w - center) >= Math.abs(Wp - center) - 1e-9) extreme++;
      }
      p = extreme / total;
    } else {
      const z = (Wp - center) / Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
      p = 2 * (1 - normalCdf(Math.abs(z)));
    }
    return { n, W: Wp, p: Math.min(1, p) };
  }

  function pearson(x, y) {
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  // 스피어만 순위상관. p는 순열 검정(시드 고정, 재현 가능).
  function spearman(x, y, perms) {
    const n = x.length;
    if (n < 3) return { rho: NaN, p: NaN, n };
    const rx = ranks(x), ry = ranks(y);
    const rho = pearson(rx, ry);
    const rng = makeRng(12345);
    const sh = ry.slice();
    let extreme = 0;
    perms = perms || 10000;
    for (let t = 0; t < perms; t++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = sh[i]; sh[i] = sh[j]; sh[j] = tmp; }
      if (Math.abs(pearson(rx, sh)) >= Math.abs(rho) - 1e-12) extreme++;
    }
    return { rho, p: (extreme + 1) / (perms + 1), n };
  }

  // 관람객 퀴즈 정답률이 우연(50%)보다 높은지: 단측 이항 정확 검정
  function binomialGreater(k, n, p0) {
    p0 = p0 == null ? 0.5 : p0;
    let s = 0, c = 1;
    for (let i = 0; i <= n; i++) {
      if (i > 0) c = c * (n - i + 1) / i;
      if (i >= k) s += c * Math.pow(p0, i) * Math.pow(1 - p0, n - i);
    }
    return Math.min(1, s);
  }

  // ---------- 기타 ----------

  function blindCodes(count, seed) {
    const rng = makeRng(seed || Date.now());
    const alphabet = 'ACDEFHJKLMNPRTUVWXY34679';
    const used = new Set(), out = [];
    while (out.length < count) {
      let c = '';
      for (let i = 0; i < 4; i++) c += alphabet[Math.floor(rng() * alphabet.length)];
      if (!used.has(c)) { used.add(c); out.push(c); }
    }
    return out;
  }

  function toCSV(rows, cols) {
    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(v => v !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map(s => s.trim());
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }

  return {
    parseWavHeader, decodeFrames, encodeWav, parseAudioMothName,
    makeHighpass, analyzeRecording, readSnippet,
    fft, powerSpectrum, peakFrequency, spectrogram, nextPow2,
    synthClick, synthTestRecording, makeRng,
    mean, median, sd, ranks, mannWhitney, wilcoxonSignedRank, spearman, pearson, binomialGreater,
    blindCodes, toCSV, parseCSV,
  };
});
