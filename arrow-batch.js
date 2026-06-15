"use strict";
/* ============================================================
   Arrow Out — Hàng loạt (batch)
   Sinh nhiều level trên 1 layout (vuông / tròn / thoi / ảnh / tự vẽ)
   theo 1 difficulty curve, quản lý thư viện, chơi, export ZIP.
   Dùng lại generator/độ-khó từ arrow-out.js (autoGenerate, computeDifficulty,
   solve, buildMother, computeMask, pieceColor, DELTA, normPieces, liveFrom...).
   Chạy time-sliced trên main thread (không Web Worker -> hoạt động cả file://).
   ============================================================ */
(function () {
  const $b = id => document.getElementById(id);

  const B = state.batch = {
    layoutType: "rect", W: 20, H: 20, scale: 0.9,
    maskImg: null, maskTainted: false, paint: new Set(),
    curve: [{ t: 0, v: 12 }, { t: 1, v: 90 }],
    library: [], selection: new Set(), displayOrder: [],
    sort: "index", filter: "all",
    generating: false, cancel: false, dragIdx: -1,
    workerURL: null, activeWorkers: null, cancelParallel: null,
  };
  state.fromLibrary = null;

  const LS_LIB = "arrowout.batch.library";
  const LS_CURVE = "arrowout.batch.curve";

  const TIER_NUM = { "Rất dễ": 1, "Dễ": 2, "Vừa": 3, "Khó": 4, "Siêu khó": 5 };
  const TIER_CLASS = { "Rất dễ": "tier1", "Dễ": "tier2", "Vừa": "tier3", "Khó": "tier4", "Siêu khó": "tier5", "KẸT": "tier0" };

  // ---------- Layout masks ----------
  // Hình elip/thoi nội tiếp, bán kính nhân `s` (thu/phóng quanh tâm bàn).
  function maskEllipse(W, H, s) {
    const set = new Set(), cx = W / 2, cy = H / 2, rx = W / 2 * s, ry = H / 2 * s;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) set.add(x + "," + y);
    }
    return set;
  }
  function maskDiamond(W, H, s) {
    const set = new Set(), cx = W / 2, cy = H / 2, rx = W / 2 * s, ry = H / 2 * s;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = Math.abs(x + 0.5 - cx) / rx, dy = Math.abs(y + 0.5 - cy) / ry;
      if (dx + dy <= 1) set.add(x + "," + y);
    }
    return set;
  }
  // Co một mask bất kỳ quanh tâm bàn (dùng cho ảnh / tự vẽ). s<1 -> nhỏ lại, chừa lề.
  function scaleMask(mask, W, H, s) {
    if (s >= 0.999) return mask;
    const cx = (W - 1) / 2, cy = (H - 1) / 2, out = new Set();
    for (const k of mask) {
      const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1);
      const nx = Math.round(cx + (x - cx) * s), ny = Math.round(cy + (y - cy) * s);
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.add(nx + "," + ny);
    }
    return out;
  }
  function fullMask(W, H) { const s = new Set(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s.add(x + "," + y); return s; }
  // Lề (ô) còn trống quanh hình ở mức scale hiện tại.
  function marginCells() { return Math.round((1 - B.scale) * Math.min(B.W, B.H) / 2); }
  // mask vùng đặt rắn cho layout hiện tại (null = full bàn, chỉ khi rect & scale=100%).
  function currentMask() {
    const t = B.layoutType, W = B.W, H = B.H, s = B.scale;
    if (t === "rect") return s >= 0.999 ? null : scaleMask(fullMask(W, H), W, H, s);
    if (t === "circle") return maskEllipse(W, H, s);
    if (t === "diamond") return maskDiamond(W, H, s);
    if (t === "image") {
      if (!B.maskImg || B.maskTainted) return new Set();
      try {
        const th = clamp(+$b("bImgTh").value, 0, 255), harsh = clamp(+$b("bImgHarsh").value, 1, 100) / 100;
        return scaleMask(computeMask(B.maskImg, W, H, th, harsh), W, H, s);
      } catch (e) { B.maskTainted = true; return new Set(); }   // ảnh web bị CORS chặn đọc pixel
    }
    if (t === "paint") return scaleMask(new Set(B.paint), W, H, s);
    return null;
  }

  // ---------- Difficulty curve ----------
  function evalCurve(p, t) {
    if (t <= p[0].t) return p[0].v;
    if (t >= p[p.length - 1].t) return p[p.length - 1].v;
    for (let i = 0; i < p.length - 1; i++) {
      if (t >= p[i].t && t <= p[i + 1].t) {
        const f = (t - p[i].t) / ((p[i + 1].t - p[i].t) || 1);
        return p[i].v + (p[i + 1].v - p[i].v) * f;
      }
    }
    return p[p.length - 1].v;
  }
  function sampleCurve(pts, n) {
    const p = pts.slice().sort((a, b) => a.t - b.t), out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      out.push(clamp(Math.round(evalCurve(p, t)), 0, 100));
    }
    return out;
  }
  const PRESETS = {
    linear: [{ t: 0, v: 10 }, { t: 1, v: 92 }],
    easein: [{ t: 0, v: 8 }, { t: 0.55, v: 22 }, { t: 0.82, v: 55 }, { t: 1, v: 96 }],
    scurve: [{ t: 0, v: 8 }, { t: 0.25, v: 18 }, { t: 0.5, v: 50 }, { t: 0.75, v: 82 }, { t: 1, v: 94 }],
    steps: [{ t: 0, v: 15 }, { t: 0.33, v: 15 }, { t: 0.34, v: 45 }, { t: 0.66, v: 45 }, { t: 0.67, v: 80 }, { t: 1, v: 80 }],
    saw: [{ t: 0, v: 15 }, { t: 0.24, v: 55 }, { t: 0.25, v: 25 }, { t: 0.49, v: 70 }, { t: 0.5, v: 35 }, { t: 0.74, v: 85 }, { t: 0.75, v: 45 }, { t: 1, v: 96 }],
  };

  // ---------- Curve editor (canvas) ----------
  const cc = $b("bCurve");
  const ctxC = cc.getContext("2d");
  const PAD = { l: 26, r: 10, t: 10, b: 20 };
  const cX = t => PAD.l + t * (cc.width - PAD.l - PAD.r);
  const cY = v => cc.height - PAD.b - (v / 100) * (cc.height - PAD.t - PAD.b);
  const invT = px => clamp((px - PAD.l) / (cc.width - PAD.l - PAD.r), 0, 1);
  const invV = py => clamp((cc.height - PAD.b - py) / (cc.height - PAD.t - PAD.b) * 100, 0, 100);
  function evtPx(e) {
    const r = cc.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (cc.width / r.width), y: (e.clientY - r.top) * (cc.height / r.height) };
  }
  function nearestPoint(px, py) {
    let bi = -1, bd = 14 * 14;
    B.curve.forEach((p, i) => { const dx = cX(p.t) - px, dy = cY(p.v) - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } });
    return bi;
  }
  function drawCurve() {
    const w = cc.width, h = cc.height;
    ctxC.clearRect(0, 0, w, h);
    // lưới ngang theo tier (20/40/60/80)
    ctxC.strokeStyle = "rgba(255,255,255,0.07)"; ctxC.lineWidth = 1;
    ctxC.fillStyle = "rgba(255,255,255,0.30)"; ctxC.font = "10px sans-serif";
    [0, 20, 40, 60, 80, 100].forEach(v => {
      const y = cY(v); ctxC.beginPath(); ctxC.moveTo(PAD.l, y); ctxC.lineTo(w - PAD.r, y); ctxC.stroke();
      ctxC.fillText(String(v), 4, y + 3);
    });
    // đường curve (sample mịn)
    const p = B.curve.slice().sort((a, b) => a.t - b.t);
    ctxC.strokeStyle = "#4f9fff"; ctxC.lineWidth = 2; ctxC.beginPath();
    for (let i = 0; i <= 80; i++) { const t = i / 80, x = cX(t), y = cY(evalCurve(p, t)); i ? ctxC.lineTo(x, y) : ctxC.moveTo(x, y); }
    ctxC.stroke();
    // chấm mẫu cho từng level
    const n = clamp(+$b("bCount").value, 1, 1000);
    ctxC.fillStyle = "rgba(70,192,138,0.6)";
    const step = Math.max(1, Math.floor(n / 60));
    for (let i = 0; i < n; i += step) { const t = n === 1 ? 0.5 : i / (n - 1); ctxC.beginPath(); ctxC.arc(cX(t), cY(evalCurve(p, t)), 1.6, 0, 7); ctxC.fill(); }
    // điểm control
    B.curve.forEach((pt, i) => {
      ctxC.beginPath(); ctxC.arc(cX(pt.t), cY(pt.v), 5, 0, 7);
      ctxC.fillStyle = (i === 0 || i === B.curve.length - 1) ? "#e0b84f" : "#e6e9ef";
      ctxC.fill(); ctxC.strokeStyle = "#0f1115"; ctxC.lineWidth = 1.5; ctxC.stroke();
    });
  }
  function updateCurveInfo() {
    const n = clamp(+$b("bCount").value, 1, 1000);
    const tg = sampleCurve(B.curve, n);
    $b("bCurveInfo").innerHTML = `<b>${n}</b> level · khó <b>${Math.min(...tg)}–${Math.max(...tg)}</b>`;
    drawCurve();
  }
  cc.addEventListener("pointerdown", e => {
    const { x, y } = evtPx(e); const i = nearestPoint(x, y);
    if (i >= 0) { B.dragIdx = i; cc.setPointerCapture(e.pointerId); }
  });
  cc.addEventListener("pointermove", e => {
    if (B.dragIdx < 0) return;
    const { x, y } = evtPx(e); const i = B.dragIdx, last = B.curve.length - 1;
    B.curve[i].v = Math.round(invV(y));
    if (i > 0 && i < last) {
      const lo = B.curve[i - 1].t + 0.02, hi = B.curve[i + 1].t - 0.02;
      B.curve[i].t = clamp(invT(x), lo, hi);
    }
    updateCurveInfo();
  });
  const endDrag = () => { if (B.dragIdx >= 0) { B.dragIdx = -1; saveCurve(); } };
  cc.addEventListener("pointerup", endDrag);
  cc.addEventListener("pointercancel", endDrag);
  cc.addEventListener("dblclick", e => {
    const { x, y } = evtPx(e); const t = invT(x), v = Math.round(invV(y));
    B.curve.push({ t, v }); B.curve.sort((a, b) => a.t - b.t); saveCurve(); updateCurveInfo();
  });
  cc.addEventListener("contextmenu", e => {
    e.preventDefault();
    const { x, y } = evtPx(e); const i = nearestPoint(x, y);
    if (i > 0 && i < B.curve.length - 1) { B.curve.splice(i, 1); saveCurve(); updateCurveInfo(); }
  });
  document.querySelectorAll(".curve-preset").forEach(btn => btn.addEventListener("click", () => {
    B.curve = PRESETS[btn.dataset.preset].map(p => ({ ...p })); saveCurve(); updateCurveInfo();
  }));

  function saveCurve() { try { localStorage.setItem(LS_CURVE, JSON.stringify(B.curve)); } catch (e) {} }
  function loadCurve() { try { const r = localStorage.getItem(LS_CURVE); if (r) { const c = JSON.parse(r); if (Array.isArray(c) && c.length >= 2) B.curve = c; } } catch (e) {} }

  // ---------- Layout preview + paint ----------
  function renderPreview() {
    const cv = $b("bPreview"), W = B.W, H = B.H;
    const cell = Math.max(4, Math.floor(440 / Math.max(W, H)));
    cv.width = W * cell; cv.height = H * cell;
    cv.classList.toggle("paintable", B.layoutType === "paint");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const mask = currentMask();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const on = mask ? mask.has(x + "," + y) : true;
      ctx.fillStyle = on ? "rgba(79,159,255,0.28)" : "rgba(255,255,255,0.02)";
      ctx.fillRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    }
    const area = mask ? mask.size : W * H;
    const mg = marginCells();
    $b("bLayoutInfo").textContent = `Bàn ${W}×${H} · vùng đặt rắn ${area} ô · lề ${mg} ô`
      + (B.layoutType !== "paint" ? ` (${Math.round(B.scale * 100)}%)` : "")
      + ($b("bMother").checked && mg < 1 ? " · ⚠ lề 0 → rắn mẹ khó ôm, giảm kích thước" : "");
  }
  function cellFromEvt(cv, e) {
    const r = cv.getBoundingClientRect();
    const cell = cv.width / B.W;
    const x = Math.floor((e.clientX - r.left) * (cv.width / r.width) / cell);
    const y = Math.floor((e.clientY - r.top) * (cv.height / r.height) / cell);
    if (x < 0 || y < 0 || x >= B.W || y >= B.H) return null;
    return { x, y };
  }
  let painting = false, paintVal = 1;
  (function wirePaint() {
    const cv = $b("bPreview");
    cv.addEventListener("pointerdown", e => {
      if (B.layoutType !== "paint") return;
      const c = cellFromEvt(cv, e); if (!c) return;
      painting = true; const k = c.x + "," + c.y; paintVal = B.paint.has(k) ? 0 : 1;
      applyPaint(k, paintVal); cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", e => {
      if (!painting || B.layoutType !== "paint") return;
      const c = cellFromEvt(cv, e); if (c) applyPaint(c.x + "," + c.y, paintVal);
    });
    cv.addEventListener("pointerup", () => { painting = false; });
    cv.addEventListener("pointercancel", () => { painting = false; });
  })();
  function applyPaint(k, val) { if (val) B.paint.add(k); else B.paint.delete(k); renderPreview(); }

  // ---------- Sinh 1 level theo target (pure — dùng cả ở main thread & worker) ----------
  // params.fill > 0 -> cố định mật độ (gọi thẳng generateMap); = 0 -> tự động quét fill theo target.
  function genLevelCore(W, H, mask, target, params) {
    const arr = params.fill > 0
      ? generateMap(W, H, params.longPref, params.diff, 0, { mask: mask || null, overflow: 0, fill: params.fill, bounds: null })
      : autoGenerate(W, H, params.diff, 0, params.longPref, mask || null, 0, null, target, null);
    if (!arr || arr.length < 1) return null;
    if (!solve(arr, W, H).solvable) return null;
    let mothers = [];
    if (params.mother) {
      mothers = buildMother(arr, W, H, 1, mask ? Array.from(mask) : null);
      if (mothers.length && !solve(arr.concat(mothers), W, H).solvable) mothers = [];
    }
    const all = arr.concat(mothers);
    const d = computeDifficulty(all, W, H);
    if (d.tier === "KẸT") return null;
    return {
      w: W, h: H, par: all.length, score: d.score, tier: d.tier, emoji: d.emoji,
      pieces: all.map(p => ({ dir: p.dir, cells: p.cells.map(c => [c.x, c.y]), ...(p.mother ? { mother: true } : {}) })),
    };
  }
  function levelSignature(pieces) {
    return pieces.map(p => p.dir[0] + ":" + p.cells.map(c => c[0] + "," + c[1]).join(" ")).sort().join("|");
  }
  function nextLibId() { let m = 0; for (const l of B.library) if (l.id > m) m = l.id; return m + 1; }

  // ---------- Worker song song ----------
  // Worker được lắp từ chính nguồn các hàm pure (qua toString) -> blob URL. Blob worker
  // cùng origin "null" nên chạy được cả khi mở bằng file:// (khác với new Worker('file.js')).
  const WORKER_MAIN = `
self.onmessage = function (e) {
  var m = e.data;
  var mask = m.maskArr ? new Set(m.maskArr) : null;
  var out = [];
  for (var i = 0; i < m.targets.length; i++) {
    var lvl = null;
    for (var r = 0; r < 3 && !lvl; r++) {
      var cand = genLevelCore(m.W, m.H, mask, m.targets[i], m.params);
      if (cand) lvl = cand;
    }
    out.push(lvl);
    if ((i & 7) === 7) self.postMessage({ type: 'progress', n: m.n, done: i + 1 });
  }
  self.postMessage({ type: 'done', n: m.n, results: out });
};`;

  function buildWorkerURL() {
    if (B.workerURL) return B.workerURL;
    const fns = [clamp, inBoard, solve, depMetrics, movableList, analyzeSolve, percRisk, percDynamic,
      computeDifficulty, rint, shuffle, growSnake, snakeLen, generateMap, coverageCount, autoGenerate,
      traceBorder, motherFromLoop, buildMother, dirFromTo, genLevelCore];
    let src = '"use strict";\n';
    src += "var DIRS=" + JSON.stringify(DIRS) + ";\n";
    src += "var DELTA=" + JSON.stringify(DELTA) + ";\n";
    src += "var MAXSNAKES=" + MAXSNAKES + ";\n";
    src += "var DIFF_TIERS=" + JSON.stringify(DIFF_TIERS) + ";\n";
    for (const f of fns) src += f.toString() + "\n";
    src += WORKER_MAIN;
    B.workerURL = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
    return B.workerURL;
  }
  function workerCount(count) {
    const cores = navigator.hardwareConcurrency || 4;
    return Math.max(1, Math.min(cores, 8, Math.ceil(count / 4)));
  }
  // Sinh song song bằng N worker; resolve -> mảng level (đúng thứ tự), reject nếu lỗi/hủy.
  function runParallel(W, H, maskArr, targets, params, onProgress) {
    return new Promise((resolve, reject) => {
      let url; try { url = buildWorkerURL(); } catch (err) { return reject(err); }
      const N = workerCount(targets.length), chunk = Math.ceil(targets.length / N);
      const results = new Array(targets.length), localDone = [], workers = [];
      let finished = 0, dead = false;
      B.activeWorkers = workers;
      const cleanup = () => { workers.forEach(w => { try { w.terminate(); } catch (e) {} }); B.activeWorkers = null; B.cancelParallel = null; };
      const totalProg = () => localDone.reduce((a, b) => a + (b || 0), 0);
      B.cancelParallel = () => { if (!dead) { dead = true; cleanup(); reject("cancel"); } };
      let launched = 0;
      for (let n = 0; n < N; n++) {
        const start = n * chunk, slice = targets.slice(start, start + chunk);
        if (!slice.length) break;
        let w; try { w = new Worker(url); } catch (err) { if (!dead) { dead = true; cleanup(); reject(err); } return; }
        launched++; workers.push(w); w._start = start; localDone[n] = 0;
        w.onmessage = ev => {
          const m = ev.data; if (dead) return;
          if (m.type === "progress") { localDone[m.n] = m.done; onProgress(totalProg()); }
          else if (m.type === "done") {
            localDone[m.n] = m.results.length;
            for (let j = 0; j < m.results.length; j++) results[w._start + j] = m.results[j];
            onProgress(totalProg());
            if (++finished === workers.length) { cleanup(); resolve(results); }
          }
        };
        w.onerror = err => { if (!dead) { dead = true; cleanup(); reject(err.message || "worker error"); } };
        w.postMessage({ n, W, H, maskArr, targets: slice, params });
      }
      if (launched === 0) resolve([]);
    });
  }
  // Đưa mảng kết quả (level | null) vào thư viện, dedup nếu cần.
  function ingestLevels(levels, targets, startId, dedup) {
    const seen = new Set(); let made = 0, skipped = 0;
    for (let i = 0; i < levels.length; i++) {
      const lvl = levels[i]; if (!lvl) continue;
      if (dedup) { const sig = levelSignature(lvl.pieces); if (seen.has(sig)) { skipped++; continue; } seen.add(sig); }
      lvl.id = startId + made; lvl.target = targets[i];
      B.library.push(lvl); B.selection.add(lvl.id); made++;
    }
    return { made, skipped };
  }
  function setProg(done, total, made, tag) {
    $b("bProgBar").style.width = Math.round(done / total * 100) + "%";
    $b("bProgInfo").textContent = `Đang sinh… ${done}/${total}${tag ? " " + tag : ""} · tạo ${made}`;
  }
  // Tuần tự trên main thread (time-sliced) — fallback / khi tắt song song.
  async function runSequential(W, H, mask, targets, params, dedup, startId) {
    const seen = new Set(); let made = 0, skipped = 0, t0 = performance.now();
    for (let i = 0; i < targets.length; i++) {
      if (B.cancel) break;
      let lvl = null;
      for (let r = 0; r < 3 && !lvl; r++) {
        const cand = genLevelCore(W, H, mask, targets[i], params);
        if (!cand) continue;
        if (dedup) { const sig = levelSignature(cand.pieces); if (seen.has(sig)) { if (r < 2) continue; skipped++; break; } seen.add(sig); }
        lvl = cand;
      }
      if (lvl) { lvl.id = startId + made; lvl.target = targets[i]; B.library.push(lvl); B.selection.add(lvl.id); made++; }
      if (performance.now() - t0 > 40 || i === targets.length - 1) {
        setProg(i + 1, targets.length, made, ""); await new Promise(r => requestAnimationFrame(r)); t0 = performance.now();
      }
    }
    return { made, skipped };
  }

  // ---------- Sinh hàng loạt ----------
  async function runBatch() {
    if (B.generating) return;
    const mask = currentMask();
    if (B.layoutType === "image" && (!mask || !mask.size)) { $b("bProgInfo").textContent = "⚠ Mask ảnh rỗng — chỉnh ngưỡng/độ gắt."; return; }
    if (B.layoutType === "paint" && (!mask || !mask.size)) { $b("bProgInfo").textContent = "⚠ Chưa vẽ ô nào."; return; }
    const count = clamp(+$b("bCount").value, 1, 1000);
    const targets = sampleCurve(B.curve, count);
    const params = { diff: clamp(+$b("bDiff").value, 0, 100), longPref: clamp(+$b("bLong").value, 0, 100), mother: $b("bMother").checked, fill: clamp(+$b("bFill").value, 0, 100) / 100 };
    const dedup = $b("bDedup").checked, W = B.W, H = B.H, startId = nextLibId();
    const wantParallel = $b("bParallel").checked && typeof Worker !== "undefined" && count >= 8;

    B.generating = true; B.cancel = false;
    $b("bGenerate").disabled = true; $b("bCancel").style.display = "inline-block";
    $b("bProgWrap").style.display = "block"; $b("bProgBar").style.width = "0%";

    let made = 0, skipped = 0, cancelled = false, mode = "1 luồng";
    if (wantParallel) {
      const N = workerCount(count);
      try {
        const levels = await runParallel(W, H, mask ? Array.from(mask) : null, targets, params,
          d => setProg(d, count, "…", `(song song · ${N} luồng)`));
        const res = ingestLevels(levels, targets, startId, dedup);
        made = res.made; skipped = res.skipped; mode = N + " luồng";
      } catch (err) {
        if (err === "cancel") { cancelled = true; }
        else {
          $b("bProgInfo").textContent = "⚠ Worker bị chặn — chuyển sang 1 luồng…";
          const res = await runSequential(W, H, mask, targets, params, dedup, startId);
          made = res.made; skipped = res.skipped; cancelled = B.cancel;
        }
      }
    } else {
      const res = await runSequential(W, H, mask, targets, params, dedup, startId);
      made = res.made; skipped = res.skipped; cancelled = B.cancel;
    }

    B.generating = false;
    $b("bGenerate").disabled = false; $b("bCancel").style.display = "none";
    $b("bProgInfo").textContent = (cancelled ? "⛔ Đã hủy · " : `✓ Xong (${mode}) · `)
      + `${made} level mới (tổng ${B.library.length})` + (skipped ? ` · bỏ ${skipped} trùng` : "");
    setTimeout(() => { $b("bProgWrap").style.display = "none"; }, 1600);
    saveLibrary(); renderLibrary();
  }

  // ---------- Thumbnail ----------
  function drawThumb(cv, lvl) {
    const ctx = cv.getContext("2d"), W = lvl.w, H = lvl.h, S = cv.width;
    const cell = S / Math.max(W, H), ox = (S - cell * W) / 2, oy = (S - cell * H) / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ctx.fillRect(ox + x * cell + 0.5, oy + y * cell + 0.5, cell - 1, cell - 1);
    lvl.pieces.forEach((p, i) => {
      const color = p.mother ? "#e8c25a" : pieceColor(i);
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, cell * 0.34); ctx.lineCap = "round"; ctx.lineJoin = "round";
      const pts = p.cells.map(c => ({ x: ox + (c[0] + 0.5) * cell, y: oy + (c[1] + 0.5) * cell }));
      if (pts.length > 1) {
        ctx.beginPath(); ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        for (let k = pts.length - 2; k >= 0; k--) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.stroke();
      }
      const d = DELTA[p.dir], h = pts[0], t = cell * 0.5, b = cell * 0.3, px = -d.y, py = d.x;
      ctx.beginPath();
      ctx.moveTo(h.x + d.x * t, h.y + d.y * t);
      ctx.lineTo(h.x + px * b, h.y + py * b);
      ctx.lineTo(h.x - px * b, h.y - py * b);
      ctx.closePath(); ctx.fill();
    });
  }

  // ---------- Thư viện (render + thao tác) ----------
  let io = null;
  function visibleList() {
    let list = B.library.slice();
    if (B.filter !== "all") list = list.filter(l => String(TIER_NUM[l.tier] || 0) === B.filter);
    if (B.sort === "scoreAsc") list.sort((a, b) => a.score - b.score);
    else if (B.sort === "scoreDesc") list.sort((a, b) => b.score - a.score);
    return list;
  }
  function renderLibrary() {
    const grid = $b("bLibGrid"); grid.innerHTML = "";
    $b("bLibCount").textContent = B.library.length;
    if (io) io.disconnect();
    io = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) { const cv = e.target; if (!cv._drawn) { drawThumb(cv, cv._level); cv._drawn = true; } io.unobserve(cv); }
    }, { root: grid });
    const list = visibleList();
    B.displayOrder = list.map(l => l.id);
    for (const lvl of list) {
      const card = document.createElement("div");
      card.className = "lib-card" + (B.selection.has(lvl.id) ? " sel" : "");
      const top = document.createElement("div"); top.className = "lc-top";
      const chk = document.createElement("input"); chk.type = "checkbox"; chk.className = "lc-chk"; chk.checked = B.selection.has(lvl.id);
      chk.addEventListener("change", () => { chk.checked ? B.selection.add(lvl.id) : B.selection.delete(lvl.id); card.classList.toggle("sel", chk.checked); updateSelInfo(); });
      const badge = document.createElement("span"); badge.className = "tierbadge " + (TIER_CLASS[lvl.tier] || "tier0");
      badge.textContent = lvl.score + " " + (lvl.emoji || ""); badge.title = lvl.tier;
      top.append(chk, badge); card.appendChild(top);
      const cv = document.createElement("canvas"); cv.width = 120; cv.height = 120; cv._level = lvl; card.appendChild(cv); io.observe(cv);
      const meta = document.createElement("div"); meta.className = "lc-top";
      meta.innerHTML = `<span>#${lvl.id}</span><span>${lvl.pieces.length} rắn</span>`; card.appendChild(meta);
      const act = document.createElement("div"); act.className = "lc-actions";
      const playB = document.createElement("button"); playB.textContent = "▶"; playB.title = "Chơi"; playB.addEventListener("click", () => playLibrary(lvl.id));
      const delB = document.createElement("button"); delB.textContent = "🗑"; delB.className = "danger"; delB.title = "Xóa"; delB.addEventListener("click", () => deleteLevel(lvl.id));
      act.append(playB, delB); card.appendChild(act);
      grid.appendChild(card);
    }
    updateSelInfo();
  }
  function updateSelInfo() { $b("bSelInfo").textContent = `${B.selection.size} đã chọn / ${B.library.length}`; }
  function deleteLevel(id) { B.library = B.library.filter(l => l.id !== id); B.selection.delete(id); saveLibrary(); renderLibrary(); }
  function selectedLevels() {
    const order = B.library.slice();
    return order.filter(l => B.selection.has(l.id));
  }

  // ---------- Chơi level từ thư viện ----------
  function playLibrary(id) {
    const lvl = B.library.find(l => l.id === id); if (!lvl) return;
    state.fromLibrary = id;
    state.mode = "play"; state.levelIndex = -1; state.W = lvl.w; state.H = lvl.h;
    const snap = normPieces(lvl.pieces);
    state.testSnapshot = snap.map(p => ({ dir: p.dir, cells: p.cells.map(c => ({ ...c })), mother: p.mother }));
    state.pieces = liveFrom(state.testSnapshot);
    state.moves = 0; state.par = lvl.par; state.history = []; state.status = "playing";
    syncModeUI(); render(); refreshDifficulty(state.pieces, state.W, state.H);
    $b("libPlayLabel").textContent = `Level #${lvl.id} · khó ${lvl.score} ${lvl.emoji || ""} ${lvl.tier} · par ${lvl.par}`;
  }
  function navLibrary(delta) {
    if (state.fromLibrary == null) return;
    const order = B.displayOrder.length ? B.displayOrder : B.library.map(l => l.id);
    const i = order.indexOf(state.fromLibrary); if (i < 0) return;
    const j = (i + delta + order.length) % order.length;
    playLibrary(order[j]);
  }

  // ---------- Persistence ----------
  function saveLibrary() {
    try { localStorage.setItem(LS_LIB, JSON.stringify({ v: 1, lib: B.library })); $b("bSelInfo").classList.remove("warn"); }
    catch (e) { $b("bProgInfo").textContent = "⚠ Thư viện quá lớn, không tự lưu được — hãy Export pack để giữ."; }
  }
  function loadLibrary() {
    try { const r = localStorage.getItem(LS_LIB); if (r) { const d = JSON.parse(r); if (d && Array.isArray(d.lib)) B.library = d.lib; } } catch (e) {}
  }

  // ---------- ZIP (store, không nén) ----------
  function crc32(bytes) {
    let table = crc32.t;
    if (!table) { table = crc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; } }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  const u16 = v => new Uint8Array([v & 255, (v >> 8) & 255]);
  const u32 = v => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  function concat(arrs) {
    let len = 0; for (const a of arrs) len += a.length;
    const out = new Uint8Array(len); let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.str), crc = crc32(data);
      const lh = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
      parts.push(lh); central.push({ name, crc, size: data.length, offset }); offset += lh.length;
    }
    const cdParts = []; let cdSize = 0;
    for (const c of central) {
      const cd = concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset), c.name]);
      cdParts.push(cd); cdSize += cd.length;
    }
    const end = concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(offset), u16(0)]);
    return new Blob([...parts, ...cdParts, end], { type: "application/zip" });
  }
  function download(blob, name) {
    const a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 120);
  }
  function levelExport(lvl) { return { w: lvl.w, h: lvl.h, par: lvl.par, score: lvl.score, tier: lvl.tier, target: lvl.target, pieces: lvl.pieces }; }

  function exportZip() {
    const sel = selectedLevels();
    if (!sel.length) { $b("bSelInfo").textContent = "Chưa chọn level nào để export."; return; }
    const pad = Math.max(3, String(sel.length).length);
    const manifest = { generatedBy: "Arrow Out batch", count: sel.length, board: { w: B.W, h: B.H }, layout: B.layoutType, levels: [] };
    const files = [];
    sel.forEach((lvl, i) => {
      const name = "level" + String(i + 1).padStart(pad, "0") + ".json";
      files.push({ name, str: JSON.stringify(levelExport(lvl), null, 2) });
      manifest.levels.push({ file: name, id: lvl.id, score: lvl.score, tier: lvl.tier, snakes: lvl.pieces.length });
    });
    files.push({ name: "manifest.json", str: JSON.stringify(manifest, null, 2) });
    download(zipStore(files), `arrowout-levels-${sel.length}.zip`);
    $b("bSelInfo").textContent = `✓ Đã export ${sel.length} level (ZIP)`;
  }
  function exportPack() {
    const sel = selectedLevels();
    if (!sel.length) { $b("bSelInfo").textContent = "Chưa chọn level nào để export."; return; }
    const pack = { generatedBy: "Arrow Out batch", board: { w: B.W, h: B.H }, layout: B.layoutType, levels: sel.map(levelExport) };
    download(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }), `arrowout-pack-${sel.length}.json`);
    $b("bSelInfo").textContent = `✓ Đã export pack ${sel.length} level`;
  }
  function importPack(file) {
    const fr = new FileReader();
    fr.onload = () => {
      let data; try { data = JSON.parse(fr.result); } catch { $b("bSelInfo").textContent = "✗ File JSON không hợp lệ"; return; }
      const arr = Array.isArray(data) ? data : data.levels;
      if (!Array.isArray(arr)) { $b("bSelInfo").textContent = "✗ Không thấy mảng levels"; return; }
      let startId = nextLibId(), added = 0;
      for (const o of arr) {
        if (!o || !Array.isArray(o.pieces)) continue;
        const w = o.w || (o.grid && o.grid[0] ? o.grid[0].length : 0), h = o.h || (o.grid ? o.grid.length : 0);
        if (!w || !h) continue;
        const pieces = o.pieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => Array.isArray(c) ? [c[0], c[1]] : [c.x, c.y]), ...(p.mother ? { mother: true } : {}) }));
        const live = normPieces(pieces);
        const d = computeDifficulty(live, w, h);
        const id = startId++;
        B.library.push({ w, h, par: o.par || pieces.length, score: o.score != null ? o.score : d.score, tier: o.tier || d.tier, emoji: d.emoji, target: o.target, pieces, id });
        B.selection.add(id); added++;
      }
      saveLibrary(); renderLibrary();
      $b("bSelInfo").textContent = `✓ Đã import ${added} level`;
    };
    fr.readAsText(file);
  }

  // ---------- Nạp ảnh: file máy + kéo từ web ----------
  function loadImageBlob(blob, onOK) {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); onOK(img, false); };
    img.onerror = () => { URL.revokeObjectURL(url); $b("bLayoutInfo").textContent = "⚠ Không đọc được ảnh."; };
    img.src = url;
  }
  // Tải ảnh từ URL (kéo từ web). Thử có CORS trước (để đọc được pixel), lỗi thì thử lại không CORS.
  function loadImageURL(url, onOK) {
    const attempt = cors => {
      const img = new Image();
      if (cors) img.crossOrigin = "anonymous";
      img.onload = () => onOK(img, true);
      img.onerror = () => { if (cors) attempt(false); else $b("bLayoutInfo").textContent = "⚠ Không tải được ảnh từ link (bị chặn). Hãy lưu ảnh về máy rồi bấm 'Chọn ảnh'."; };
      img.src = url;
    };
    attempt(true);
  }
  // Lấy ảnh từ dữ liệu kéo-thả: ưu tiên file, rồi tới URL (uri-list / <img src> / text).
  function imageFromDataTransfer(dt, onImage) {
    const f = dt.files && [...dt.files].find(x => x.type && x.type.startsWith("image/"));
    if (f) { loadImageBlob(f, onImage); return true; }
    let url = (dt.getData("text/uri-list") || "").split("\n").map(s => s.trim()).find(s => s && !s.startsWith("#"));
    if (!url) { const html = dt.getData("text/html"); const m = html && html.match(/<img[^>]+\bsrc\s*=\s*["']([^"']+)["']/i); if (m) url = m[1]; }
    if (!url) { const t = (dt.getData("text/plain") || "").trim(); if (/^https?:\/\//i.test(t) || /^data:image\//i.test(t)) url = t; }
    if (url) { loadImageURL(url, onImage); return true; }
    return false;
  }
  // Nạp ảnh vào batch: kiểm tra taint (ảnh web không cho đọc pixel) + tự chuyển layout sang "Từ ảnh".
  function setBatchImage(img, fromWeb) {
    B.maskImg = img; B.maskTainted = false;
    if (fromWeb) {
      try { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); }
      catch (e) { B.maskTainted = true; }
    }
    if (B.layoutType !== "image") { $b("bLayoutType").value = "image"; setLayoutType("image"); } else renderPreview();
    $b("bLayoutInfo").textContent = B.maskTainted
      ? "⚠ Ảnh web này chặn đọc pixel (CORS). Hãy lưu ảnh về máy rồi bấm 'Chọn ảnh'."
      : `Ảnh ${img.naturalWidth}×${img.naturalHeight} đã nạp${fromWeb ? " (kéo từ web)" : ""}.`;
  }
  function makeDropZone(el, onImage, onMiss) {
    el.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; el.classList.add("dropping"); });
    el.addEventListener("dragleave", e => { if (e.target === el) el.classList.remove("dropping"); });
    el.addEventListener("drop", e => {
      e.preventDefault(); el.classList.remove("dropping");
      if (!imageFromDataTransfer(e.dataTransfer, onImage) && onMiss) onMiss();
    });
  }

  // ---------- Wiring ----------
  function setLayoutType(t) {
    B.layoutType = t;
    $b("bImageRow").style.display = t === "image" ? "block" : "none";
    $b("bPaintRow").style.display = t === "paint" ? "block" : "none";
    if (t === "paint" && B.paint.size === 0) for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) B.paint.add(x + "," + y);
    renderPreview();
  }
  function applySize() {
    B.W = clamp(+$b("bW").value, 3, 60); B.H = clamp(+$b("bH").value, 3, 60);
    $b("bW").value = B.W; $b("bH").value = B.H;
    B.paint = new Set([...B.paint].filter(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); return x < B.W && y < B.H; }));
    renderPreview(); updateCurveInfo();
  }

  $b("bLayoutType").addEventListener("change", () => setLayoutType($b("bLayoutType").value));
  $b("bApplySize").addEventListener("click", applySize);
  $b("bImgBtn").addEventListener("click", () => $b("bImg").click());
  $b("bImg").addEventListener("change", () => {
    const f = $b("bImg").files[0]; if (!f || !f.type.startsWith("image/")) return;
    loadImageBlob(f, setBatchImage);
  });
  $b("bImgClear").addEventListener("click", () => { B.maskImg = null; B.maskTainted = false; renderPreview(); });
  // Kéo-thả ảnh (từ máy hoặc từ web) vào khung xem trước / vùng ảnh.
  makeDropZone(document.querySelector(".layout-preview-wrap"), setBatchImage, () => { $b("bLayoutInfo").textContent = "⚠ Không thấy ảnh trong nội dung kéo vào."; });
  makeDropZone($b("bImageRow"), setBatchImage, () => { $b("bLayoutInfo").textContent = "⚠ Không thấy ảnh trong nội dung kéo vào."; });
  $b("bScale").addEventListener("input", () => { B.scale = clamp(+$b("bScale").value, 40, 100) / 100; $b("bScaleVal").textContent = $b("bScale").value; renderPreview(); updateCurveInfo(); });
  $b("bMother").addEventListener("change", () => {
    if ($b("bMother").checked && B.scale > 0.97) { $b("bScale").value = 90; B.scale = 0.9; $b("bScaleVal").textContent = "90"; }
    renderPreview();
  });
  $b("bImgTh").addEventListener("input", () => { $b("bImgThVal").textContent = $b("bImgTh").value; if (B.layoutType === "image") renderPreview(); });
  $b("bImgHarsh").addEventListener("input", () => { $b("bImgHarshVal").textContent = $b("bImgHarsh").value; if (B.layoutType === "image") renderPreview(); });
  $b("bPaintFill").addEventListener("click", () => { B.paint = new Set(); for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) B.paint.add(x + "," + y); renderPreview(); });
  $b("bPaintClear").addEventListener("click", () => { B.paint = new Set(); renderPreview(); });
  $b("bPaintInvert").addEventListener("click", () => { const n = new Set(); for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) { const k = x + "," + y; if (!B.paint.has(k)) n.add(k); } B.paint = n; renderPreview(); });

  $b("bDiff").addEventListener("input", () => $b("bDiffVal").textContent = $b("bDiff").value);
  $b("bLong").addEventListener("input", () => $b("bLongVal").textContent = $b("bLong").value);
  function syncFillLabel() {
    const v = +$b("bFill").value;
    $b("bFillVal").textContent = v;
    $b("bFillAuto").textContent = v === 0 ? " (tự động)" : "% cố định";
  }
  $b("bFill").addEventListener("input", syncFillLabel);
  $b("bCount").addEventListener("input", updateCurveInfo);
  $b("bGenerate").addEventListener("click", runBatch);
  $b("bCancel").addEventListener("click", () => { B.cancel = true; if (B.cancelParallel) B.cancelParallel(); });

  $b("bSort").addEventListener("change", () => { B.sort = $b("bSort").value; renderLibrary(); });
  $b("bFilter").addEventListener("change", () => { B.filter = $b("bFilter").value; renderLibrary(); });
  $b("bSelAll").addEventListener("click", () => { visibleList().forEach(l => B.selection.add(l.id)); renderLibrary(); });
  $b("bSelNone").addEventListener("click", () => { B.selection.clear(); renderLibrary(); });
  $b("bSelInvert").addEventListener("click", () => { visibleList().forEach(l => B.selection.has(l.id) ? B.selection.delete(l.id) : B.selection.add(l.id)); renderLibrary(); });
  $b("bDelSel").addEventListener("click", () => { B.library = B.library.filter(l => !B.selection.has(l.id)); B.selection.clear(); saveLibrary(); renderLibrary(); });
  $b("bClearLib").addEventListener("click", () => { if (!B.library.length || confirm("Xóa toàn bộ thư viện?")) { B.library = []; B.selection.clear(); saveLibrary(); renderLibrary(); } });
  $b("bExportZip").addEventListener("click", exportZip);
  $b("bExportPack").addEventListener("click", exportPack);
  $b("bImportBtn").addEventListener("click", () => $b("bImportPack").click());
  $b("bImportPack").addEventListener("change", () => { if ($b("bImportPack").files[0]) importPack($b("bImportPack").files[0]); $b("bImportPack").value = ""; });

  // libPlayBar
  $b("libBackBtn").addEventListener("click", () => { state.mode = "batch"; state.fromLibrary = null; syncModeUI(); });
  $b("libPrevBtn").addEventListener("click", () => navLibrary(-1));
  $b("libNextBtn").addEventListener("click", () => navLibrary(1));

  // mode button
  $b("modeBatch").addEventListener("click", () => {
    state.mode = "batch"; state.fromLibrary = null; state.draft = null;
    syncModeUI(); renderPreview(); updateCurveInfo(); renderLibrary();
  });

  // Kéo-thả ảnh vào board khi đang ở Editor (Ảnh → Map). Dùng lại hàm global của arrow-out.js.
  (function wireEditorDrop() {
    const board = document.getElementById("board"); if (!board) return;
    board.addEventListener("dragover", e => { if (state.mode !== "edit") return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; board.classList.add("dropping"); });
    board.addEventListener("dragleave", () => board.classList.remove("dropping"));
    board.addEventListener("drop", e => {
      if (state.mode !== "edit") return;
      e.preventDefault(); board.classList.remove("dropping");
      const ok = imageFromDataTransfer(e.dataTransfer, (img, fromWeb) => {
        let tainted = false;
        if (fromWeb) { try { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); } catch (e2) { tainted = true; } }
        if (tainted) { state.maskImg = null; setMaskInfo("⚠ Ảnh web chặn CORS — lưu về máy rồi 'Chọn ảnh'.", "warn"); return; }
        state.maskImg = img; refreshMask(); render();
        setMaskInfo(`Ảnh ${img.naturalWidth}×${img.naturalHeight} đã nạp (kéo vào). Chỉnh Ngưỡng/Độ gắt rồi 'Tạo map từ ảnh'.`);
      });
      if (!ok) setMaskInfo("⚠ Không thấy ảnh trong nội dung kéo.", "warn");
    });
  })();
  // Chặn trình duyệt điều hướng/mở ảnh khi lỡ thả ra ngoài vùng nhận.
  window.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].some(t => t === "Files" || t === "text/uri-list")) e.preventDefault(); });
  window.addEventListener("drop", e => { if (e.dataTransfer && [...e.dataTransfer.types].some(t => t === "Files" || t === "text/uri-list")) e.preventDefault(); });

  // ---------- Boot ----------
  loadCurve(); loadLibrary();
  B.scale = clamp(+$b("bScale").value, 40, 100) / 100;
  $b("bScaleVal").textContent = $b("bScale").value;
  const cores = navigator.hardwareConcurrency;
  $b("bCores").textContent = cores ? `(~${Math.min(cores, 8)} luồng)` : "";
  syncFillLabel();
  setLayoutType("rect");
  updateCurveInfo();
})();
