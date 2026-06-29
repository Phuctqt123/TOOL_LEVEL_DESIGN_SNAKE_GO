/* =========================================================================
   CHUỖI 1000 LEVEL THEO ĐƯỜNG CONG ĐỘ KHÓ
   - Module độc lập (IIFE) + tab riêng (#tabSeq / #seqView), pattern như SG2/Compare.
   - ĐIỀU PHỐI các global đã có (KHÔNG viết lại engine):
       generateMap(w,h,longPref,difficulty,wrapping,{mask,fill})  → sinh rắn trên layout bất kỳ
       computeDifficulty(pieces,w,h) → {score,tier,...}  (TIÊU CHÍ ĐỘ KHÓ THỐNG NHẤT, đã calibrate)
       fromGameLevel / toGameLevel   → I/O format game (Y-flip)
       DIFF_TIERS, gameColor
   - Pipeline: nạp Arrow Out → đo độ khó N baseline → auto-fit + ngoại suy curve tới 1000
       → mỗi level bốc layout "đã đục" theo độ khó mục tiêu → generateMap khớp target → export pack.
   ========================================================================= */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => (performance && performance.now ? performance.now() : Date.now());

  /* ---------- Giải nén ZIP (port) ---------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("Trình duyệt không hỗ trợ DEFLATE.");
    const ds = new DecompressionStream("deflate-raw");
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf); let eo = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
    if (eo < 0) throw new Error("ZIP không hợp lệ.");
    const cdCount = dv.getUint16(eo + 10, true); let p = dv.getUint32(eo + 16, true); const td = new TextDecoder(), out = [];
    for (let n = 0; n < cdCount; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true), dataStart = lho + 30 + lNameLen + lExtraLen, comp = u8.subarray(dataStart, dataStart + compSize);
      if (method === 0) out.push({ name, bytes: comp });
      else if (method === 8) { try { out.push({ name, bytes: await inflateRaw(comp) }); } catch (e) { console.error("[seq unzip]", name, e); } }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }
  function isGameLv(o) { return !!(o && typeof o === "object" && (o.XSize != null || Array.isArray(o.Arrows))); }
  function levelCandidates(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.levels)) return data.levels;
    if (isGameLv(data)) return [data];
    return null;
  }
  async function fileToLevels(file) {
    if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
      const entries = await unzip(await file.arrayBuffer()), td = new TextDecoder(), out = [];
      for (const e of entries) {
        if (e.name.endsWith("/") || !/\.json$/i.test(e.name) || /(^|\/)manifest\.json$/i.test(e.name)) continue;
        let data; try { data = JSON.parse(td.decode(e.bytes)); } catch { continue; }
        const cand = levelCandidates(data); if (cand) out.push(...cand);
      }
      return out;
    }
    return levelCandidates(JSON.parse(await file.text())) || [];
  }

  /* ---------- Trích LAYOUT ("đã đục") + chuyển pieces nội bộ ---------- */
  // mask theo HỆ TOẠ ĐỘ của fromGameLevel (Y-flip): y = H-1-floor(idx/W) — để khớp pieces & export round-trip.
  function maskFromLevel(raw) {
    const W = raw.XSize | 0, H = raw.YSize | 0;
    if (!W || !H) return null;
    let mask;
    if (Array.isArray(raw.AllIndices) && raw.AllIndices.length) {
      mask = new Set(); raw.AllIndices.forEach(i => { const x = i % W, y = H - 1 - Math.floor(i / W); if (x >= 0 && x < W && y >= 0 && y < H) mask.add(x + "," + y); });
    } else if (typeof fromGameLevel === "function") {           // không có AllIndices -> lấy hình từ vị trí rắn
      const g = fromGameLevel(raw); mask = new Set(); g.pieces.forEach(p => p.cells.forEach(c => mask.add(c.x + "," + c.y)));
    }
    if (!mask || mask.size < 4) return null;
    return { W, H, mask, area: mask.size, name: raw._name || (raw.LevelId != null ? "level_" + raw.LevelId : null) };
  }
  // độ khó 1 level baseline (đo bằng tiêu chí thống nhất).
  // QUAN TRỌNG: fromGameLevel KHÔNG gán .id, mà solver/computeDifficulty lại dùng p.id
  // -> phải gán id 1..n trước khi chấm, nếu không điểm sai lệch hàng chục điểm.
  function measureBaseline(raw) {
    if (typeof fromGameLevel !== "function" || typeof computeDifficulty !== "function") return null;
    try {
      const g = fromGameLevel(raw); if (!g || !g.pieces.length) return null;
      g.pieces.forEach((p, i) => p.id = i + 1);
      const d = computeDifficulty(g.pieces, g.w, g.h);
      return (d.tier === "KẸT") ? null : d.score;
    } catch (e) { return null; }
  }

  /* ============================ STATE ============================ */
  const ST = {
    raw: [],            // level thô đã nạp (theo thứ tự)
    pool: [],           // layout đã trích (sorted by area asc khi sinh)
    baseScores: [],     // điểm đo của N level baseline (null nếu KẸT)
    nBase: 120,
    total: 1000,
    anchors: [],        // [{L, v}] điểm neo curve (kéo y)
    targetArr: null,    // mảng target theo level (1..total)
    results: [],        // [{i,W,H,pieces,mask,score,tier,target}]
    busy: false, cancel: false
  };

  /* ---------- ĐƯỜNG CONG ---------- */
  function smoothBaseline() {
    const s = ST.baseScores, out = []; const win = 5;
    for (let i = 0; i < s.length; i++) {
      let sum = 0, c = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(s.length - 1, i + win); j++) { if (s[j] != null) { sum += s[j]; c++; } }
      out.push(c ? sum / c : null);
    }
    // lấp đầu/cuối null bằng giá trị gần nhất
    let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
    last = null; for (let i = out.length - 1; i >= 0; i--) { if (out[i] == null) out[i] = last; else last = out[i]; }
    return out.map(v => v == null ? 30 : v);
  }
  function anchorLevels() {
    const N = ST.total, nb = Math.min(ST.nBase, N);
    const raw = [1, Math.round(nb * .25), Math.round(nb * .5), nb, Math.round(N * .25), Math.round(N * .5), Math.round(N * .75), N];
    return [...new Set(raw.map(v => clamp(Math.round(v), 1, N)))].sort((a, b) => a - b);
  }
  function autoFitCurve() {
    const N = ST.total, nb = Math.min(ST.nBase, N), sm = smoothBaseline();
    const smAt = L => sm.length ? sm[clamp(L - 1, 0, sm.length - 1)] : 30;
    const last = sm.length ? smAt(nb) : 40, ceil = clamp(Math.max(88, last + 12), 50, 96), tau = Math.max(120, (N - nb) / 1.4);
    const Ls = anchorLevels();
    ST.anchors = Ls.map(L => {
      let v = L <= nb ? smAt(L) : (ceil - (ceil - last) * Math.exp(-(L - nb) / tau));
      return { L, v: clamp(Math.round(v), 0, 100) };
    });
    // ép tiến triển không giảm (progression)
    for (let i = 1; i < ST.anchors.length; i++) if (ST.anchors[i].v < ST.anchors[i - 1].v) ST.anchors[i].v = ST.anchors[i - 1].v;
    rebuildTarget(); drawCurve();
  }
  function presetCurve(kind) {
    const N = ST.total, Ls = anchorLevels(), lo = 12, hi = 90;
    const f = t => kind === "easein" ? t * t : kind === "scurve" ? (t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)) : t;
    ST.anchors = Ls.map(L => ({ L, v: clamp(Math.round(lo + (hi - lo) * f((L - 1) / (N - 1 || 1))), 0, 100) }));
    rebuildTarget(); drawCurve();
  }
  function evalCurveAt(L) {
    const a = ST.anchors; if (!a.length) return 30;
    if (L <= a[0].L) return a[0].v; if (L >= a[a.length - 1].L) return a[a.length - 1].v;
    for (let i = 0; i < a.length - 1; i++) if (L >= a[i].L && L <= a[i + 1].L) { const f = (L - a[i].L) / ((a[i + 1].L - a[i].L) || 1); return a[i].v + (a[i + 1].v - a[i].v) * f; }
    return a[a.length - 1].v;
  }
  function rebuildTarget() { const N = ST.total, arr = new Array(N); for (let i = 0; i < N; i++) arr[i] = clamp(Math.round(evalCurveAt(i + 1)), 0, 100); ST.targetArr = arr; }

  const CV = { W: 720, H: 240, PAD: { l: 30, r: 12, t: 12, b: 22 } };
  function cvX(L) { return CV.PAD.l + (L - 1) / Math.max(1, ST.total - 1) * (CV.W - CV.PAD.l - CV.PAD.r); }
  function cvY(v) { return CV.H - CV.PAD.b - v / 100 * (CV.H - CV.PAD.t - CV.PAD.b); }
  function drawCurve() {
    const cv = $("seqCurve"); if (!cv) return; cv.width = CV.W; cv.height = CV.H;
    const g = cv.getContext("2d"); g.clearRect(0, 0, CV.W, CV.H); g.fillStyle = "#0e1424"; g.fillRect(0, 0, CV.W, CV.H);
    g.font = "10px sans-serif";
    [0, 20, 40, 60, 80, 100].forEach(v => { const y = cvY(v); g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(CV.PAD.l, y); g.lineTo(CV.W - CV.PAD.r, y); g.stroke(); g.fillStyle = "rgba(255,255,255,.3)"; g.fillText(String(v), 6, y + 3); });
    // mốc level trục X
    g.fillStyle = "rgba(255,255,255,.3)"; [1, Math.round(ST.total / 4), Math.round(ST.total / 2), Math.round(ST.total * 3 / 4), ST.total].forEach(L => { g.fillText(String(L), cvX(L) - 8, CV.H - 8); });
    // scatter baseline (xanh dương)
    g.fillStyle = "#5b9dff";
    ST.baseScores.forEach((s, i) => { if (s == null) return; const x = cvX(i + 1), y = cvY(s); g.beginPath(); g.arc(x, y, 1.7, 0, 7); g.fill(); });
    // đường target (vàng)
    if (ST.targetArr) { g.strokeStyle = "#e0b84f"; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < ST.total; i += Math.max(1, Math.floor(ST.total / 360))) { const x = cvX(i + 1), y = cvY(ST.targetArr[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    // điểm đã sinh (xanh lá)
    if (ST.results.length) { g.fillStyle = "rgba(79,208,138,.85)"; ST.results.forEach(r => { if (r == null) return; const x = cvX(r.i), y = cvY(r.score); g.beginPath(); g.arc(x, y, 1.4, 0, 7); g.fill(); }); }
    // điểm neo (kéo được)
    ST.anchors.forEach(a => { const x = cvX(a.L), y = cvY(a.v); g.beginPath(); g.arc(x, y, 5, 0, 7); g.fillStyle = "#e6e9ef"; g.fill(); g.strokeStyle = "#0f1115"; g.lineWidth = 1.5; g.stroke(); });
  }

  /* ---------- Sinh theo target ----------
     Then chốt (đã kiểm chứng trên data thật): DIỆN TÍCH board quyết định "sàn" độ khó —
     board to KHÔNG thể dễ dù fill thấp; board nhỏ KHÔNG thể khó. Nên với mỗi target ta:
       (1) suy ra DIỆN TÍCH mong muốn  (2) bốc layout gần diện tích đó
       (3) DÒ cả fill (0.12–0.95) lẫn tham số difficulty, chọn bản gần target nhất.
     Bảng AREA_FOR map độ khó → diện tích (nội suy từ envelope đo được). */
  const AREA_FOR = [[0, 16], [15, 45], [25, 150], [40, 220], [55, 360], [68, 560], [80, 950], [100, 1700]];
  function desiredArea(t) {
    t = clamp(t, 0, 100);
    for (let i = 0; i < AREA_FOR.length - 1; i++) if (t >= AREA_FOR[i][0] && t <= AREA_FOR[i + 1][0]) { const f = (t - AREA_FOR[i][0]) / ((AREA_FOR[i + 1][0] - AREA_FOR[i][0]) || 1); return AREA_FOR[i][1] + (AREA_FOR[i + 1][1] - AREA_FOR[i][1]) * f; }
    return AREA_FOR[AREA_FOR.length - 1][1];
  }
  function poolSortedByArea() { return ST.pool.slice().sort((a, b) => a.area - b.area); }
  // [a,b] = dải chỉ số layout (đã sort theo area) quanh diện tích mong muốn.
  function bandNearArea(sorted, area) {
    let bi = 0, bd = 1e9; for (let i = 0; i < sorted.length; i++) { const d = Math.abs(sorted[i].area - area); if (d < bd) { bd = d; bi = i; } }
    const w = Math.max(2, Math.floor(sorted.length * 0.09));
    return [clamp(bi - w, 0, sorted.length - 1), clamp(bi + w, 0, sorted.length - 1)];
  }
  // generateMap chậm SIÊU tuyến tính theo diện tích -> board to thì THỬ ÍT lần lại (chống chậm).
  function adaptiveTries(area, base) {
    return area <= 120 ? base : area <= 250 ? Math.max(3, Math.round(base * 0.5)) : Math.max(2, Math.round(base * 0.3));
  }
  // Dò trên 1 layout CỐ ĐỊNH — chọn bản gần target nhất.
  // keepShape=true (chế độ 🔒 Giữ layout gốc): LẤP GẦN KÍN mask (~90%+) để giữ ĐÚNG hình "đã đục"
  //   của layout gốc; độ khó nắn bằng cấu trúc rắn (longPref/difficulty) — dải hẹp hơn, đổi lại đúng hình.
  // keepShape=false (chế độ theo độ khó): fill ≤0.78 để vươn xuống vùng dễ + chạy nhanh.
  function genOnLayout(L, target, tries, keepShape) {
    if (typeof generateMap !== "function" || typeof computeDifficulty !== "function" || !L) return null;
    const baseFill = clamp(0.15 + target / 100 * 0.55, 0.15, 0.72);
    let best = null, bestErr = 1e9;
    for (let k = 0; k < tries; k++) {
      let fill, longPref, dparam;
      if (keepShape) {
        fill = clamp(0.95 + (Math.random() * 2 - 1) * 0.05, 0.88, 1);    // lấp gần kín -> phủ đúng khung layout
        longPref = clamp(25 + Math.random() * 65, 0, 95);                 // đa dạng cấu trúc -> mở rộng dải độ khó
        dparam = clamp(target + (Math.random() * 2 - 1) * 32, 0, 100);
      } else {
        fill = clamp(baseFill + (Math.random() * 2 - 1) * 0.2, 0.1, 0.78);
        longPref = clamp(40 + target * 0.35, 0, 95);
        dparam = clamp(target + (Math.random() * 2 - 1) * 18, 0, 100);
      }
      let pieces; try { pieces = generateMap(L.W, L.H, longPref, dparam, 0, { mask: L.mask, fill }); } catch (e) { continue; }
      if (!pieces || pieces.length < 2) continue;
      const d = computeDifficulty(pieces, L.W, L.H); if (d.tier === "KẸT" || !d.score) continue;
      const err = Math.abs(d.score - target);
      if (err < bestErr) { bestErr = err; best = { W: L.W, H: L.H, mask: L.mask, pieces, score: d.score, tier: d.tier, srcName: L.name }; if (err <= 5) break; }   // "đủ tốt" -> dừng sớm cho nhanh
    }
    return best;
  }
  function genForTarget(sorted, target, tries) {
    if (!sorted.length) return null;
    const area = desiredArea(target), [a, b] = bandNearArea(sorted, area), tr = adaptiveTries(area, tries);
    let best = null, bestErr = 1e9;
    for (let k = 0; k < tr; k++) {
      // lệch về phía board NHỎ hơn trong dải (chống overshoot ở vùng dễ)
      const L = sorted[a + Math.floor(Math.pow(Math.random(), 1.3) * (b - a))];
      const r = genOnLayout(L, target, 1); if (!r) continue;
      const err = Math.abs(r.score - target);
      if (err < bestErr) { bestErr = err; best = r; if (err <= 5) break; }
    }
    return best;
  }

  function runGenerate() {
    if (ST.busy) return;
    if (!ST.pool.length) { $("seqGenInfo").textContent = "⚠ Chưa có layout — nạp dữ liệu Arrow Out trước."; return; }
    if (!ST.targetArr) { $("seqGenInfo").textContent = "⚠ Chưa có đường cong — bấm “Auto-fit từ baseline”."; return; }
    ST.busy = true; ST.cancel = false; ST.results = [];
    $("seqGenBtn").disabled = true; $("seqCancelBtn").style.display = "inline-flex";
    const N = ST.total, tries = clamp(parseInt($("seqTries").value) || 10, 2, 40);
    const mode = $("seqLayoutMode") ? $("seqLayoutMode").value : "diff";   // "diff" = chọn theo độ khó · "keep" = 🔒 giữ layout gốc, lặp lại
    // GIỚI HẠN DIỆN TÍCH: generateMap tăng siêu tuyến tính theo area (area 400≈0.2s · 700≈1s · 1100≈7s).
    // Loại board quá to -> nhanh hơn HÀNG CHỤC lần; board ~400 vẫn đạt độ khó ~85 (1000 lv ~3 phút).
    const maxArea = clamp(parseInt($("seqMaxArea").value) || 400, 100, 4000);
    const within = ST.pool.filter(L => L.area <= maxArea);
    const usable = within.length ? within : ST.pool.slice().sort((a, b) => a.area - b.area).slice(0, 1);   // không có board nào ≤ cap -> dùng nhỏ nhất
    const skipped = ST.pool.length - within.length;
    ST.skipped = mode === "keep" ? skipped : 0;
    const sorted = usable.slice().sort((a, b) => a.area - b.area), poolOrig = usable;
    // 🔒 keep mode: DECK xuyên suốt — layout dùng xong bị đẩy xuống cuối hàng, không bao giờ reset.
    // Nhìn top K phía trước deck để chọn layout có area gần target nhất (difficulty matching),
    // sau đó splice nó ra và push xuống cuối -> khoảng cách tối thiểu giữa 2 lần dùng = deck.length - K.
    const keepDeck = (() => {
      const d = poolOrig.slice();
      for (let k = d.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); const t = d[k]; d[k] = d[j]; d[j] = t; }
      return d;
    })();
    let i = 0; const startT = now();
    const tick = () => {
      if (ST.cancel) { finishGen(); return; }
      const t0 = now();
      while (i < N && now() - t0 < 28) {
        const target = ST.targetArr[i];
        let r;
        if (mode === "keep") {
          // Lấy layout từ TOP K của deck (K ≈ 20% deck size), ưu tiên area gần target.
          // Layout được chọn (dù thành công hay fail) đều bị đẩy xuống CUỐI deck.
          const areaTarget = desiredArea(target);
          const K = Math.max(1, Math.min(15, Math.ceil(keepDeck.length * 0.2)));
          let bestIdx = 0, bestDist = Math.abs(keepDeck[0].area - areaTarget);
          for (let k = 1; k < K; k++) { const d = Math.abs(keepDeck[k].area - areaTarget); if (d < bestDist) { bestDist = d; bestIdx = k; } }
          const L = keepDeck.splice(bestIdx, 1)[0];
          r = genOnLayout(L, target, adaptiveTries(L.area, tries), true);
          keepDeck.push(L);   // chôn xuống cuối — cycle không reset suốt toàn bộ chuỗi
        } else {
          r = genForTarget(sorted, target, tries);
        }
        ST.results.push(r ? { i: i + 1, ...r, target } : null);
        i++;
      }
      const ok = ST.results.filter(Boolean).length, el = (now() - startT) / 1000, rate = i / Math.max(0.001, el);
      const eta = rate > 0 ? Math.round((N - i) / rate) : 0;
      $("seqProgBar").style.width = Math.round(i / N * 100) + "%";
      $("seqGenInfo").textContent = `Đang sinh ${i}/${N} · đạt ${ok} · ${rate.toFixed(1)} lv/s · còn ~${eta}s`;
      if (i % Math.max(1, Math.floor(N / 50)) < 2) drawCurve();
      if (i < N) requestAnimationFrame(tick); else finishGen();
    };
    requestAnimationFrame(tick);
  }
  function finishGen() {
    ST.busy = false; $("seqGenBtn").disabled = false; $("seqCancelBtn").style.display = "none";
    const got = ST.results.filter(Boolean); const N = ST.total;
    let sumErr = 0, onT = 0; got.forEach(r => { const e = Math.abs(r.score - r.target); sumErr += e; if (e <= 5) onT++; });
    const mae = got.length ? (sumErr / got.length).toFixed(1) : "—";
    $("seqGenInfo").textContent = `Xong: ${got.length}/${N} level · MAE ${mae} · bám target (±5): ${got.length ? Math.round(onT / got.length * 100) : 0}%`
      + (got.length < N ? ` · ${N - got.length} chỗ KHÔNG sinh được` : "")
      + (ST.skipped ? ` · ⏭ bỏ ${ST.skipped} layout > giới hạn diện tích (tăng cap nếu muốn dùng)` : "");
    drawCurve(); renderResultStats();
    $("seqExportBtn").disabled = !got.length;
  }
  function renderResultStats() {
    const host = $("seqStats"); if (!host) return; const got = ST.results.filter(Boolean);
    if (!got.length) { host.innerHTML = ""; return; }
    const tierCnt = {}; got.forEach(r => tierCnt[r.tier] = (tierCnt[r.tier] || 0) + 1);
    const chips = [`<span class="seq-stat"><b>${got.length}</b> <span>level sinh được</span></span>`];
    (typeof DIFF_TIERS !== "undefined" ? DIFF_TIERS : []).forEach(t => { const name = t[1]; if (tierCnt[name]) chips.push(`<span class="seq-stat">${t[2]} <b>${tierCnt[name]}</b> <span>${name}</span></span>`); });
    host.innerHTML = chips.join("");
  }

  /* ---------- Export ---------- */
  function buildGameLevel(r, id) {
    const base = (typeof toGameLevel === "function")
      ? toGameLevel(r.pieces, r.W, r.H, Math.round(r.score), null)
      : { XSize: r.W, YSize: r.H, Arrows: [], Colors: [] };
    const allIdx = []; r.mask.forEach(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); allIdx.push(x + (r.H - 1 - y) * r.W); });
    allIdx.sort((a, b) => a - b);
    return Object.assign({ GameType: "ArrowsOut", LevelId: id, LevelUId: id, IsFtueLevel: false, MechanicType: "Normal" },
      base, { AllIndices: allIdx, GridObjects: [], _name: "level_" + id, _targetDifficulty: r.target, ...(r.srcName ? { _srcLayout: r.srcName } : {}) });
  }
  function exportPack() {
    const got = ST.results.filter(Boolean); if (!got.length) return;
    const pack = got.map((r, k) => buildGameLevel(r, k + 1));
    const blob = new Blob([JSON.stringify(pack)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `levels_1_to_${got.length}.json`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    $("seqGenInfo").textContent = `✓ Đã xuất ${got.length} level → ${a.download}`;
  }

  /* ---------- Nạp dữ liệu ---------- */
  async function ingest(files) {
    if (!files || !files.length) return;
    $("seqDataInfo").textContent = "⏳ Đang đọc…";
    let raw = [];
    for (const f of files) { try { raw.push(...await fileToLevels(f)); } catch (e) { console.error("[seq]", f.name, e); } }
    raw = raw.filter(isGameLv);
    if (!raw.length) { $("seqDataInfo").textContent = "⚠ Không thấy level hợp lệ."; return; }
    ST.raw = raw;
    // trích pool layout
    ST.pool = raw.map(maskFromLevel).filter(Boolean);
    $("seqDataInfo").innerHTML = `Đã nạp <b>${raw.length}</b> level · pool layout <b>${ST.pool.length}</b>. Bấm “Đo độ khó baseline”.`;
    ST.baseScores = []; ST.results = []; drawCurve();
  }
  function measureBaselineChunked() {
    if (!ST.raw.length) { $("seqBaseInfo").textContent = "⚠ Chưa nạp dữ liệu."; return; }
    ST.nBase = clamp(parseInt($("seqNBase").value) || 120, 1, ST.raw.length);
    ST.total = clamp(parseInt($("seqTotal").value) || 1000, ST.nBase, 5000);
    const N = ST.nBase; ST.baseScores = new Array(N).fill(null); let i = 0;
    $("seqMeasureBtn").disabled = true;
    const tick = () => {
      const t0 = now();
      while (i < N && now() - t0 < 28) { ST.baseScores[i] = measureBaseline(ST.raw[i]); i++; }
      $("seqBaseInfo").textContent = `⏳ Đo ${i}/${N}…`;
      drawCurve();
      if (i < N) requestAnimationFrame(tick);
      else {
        const ok = ST.baseScores.filter(s => s != null);
        const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : 0;
        $("seqBaseInfo").innerHTML = `Đo xong <b>${N}</b> baseline · hợp lệ ${ok.length} · TB <b>${avg}</b>. Bấm “Auto-fit từ baseline”.`;
        $("seqMeasureBtn").disabled = false;
        autoFitCurve();
      }
    };
    requestAnimationFrame(tick);
  }

  /* ---------- Kéo điểm neo trên canvas ---------- */
  let dragIdx = -1;
  function cvPos(e) { const cv = $("seqCurve"), r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (CV.W / r.width), y: (e.clientY - r.top) * (CV.H / r.height) }; }
  function bindCurve() {
    const cv = $("seqCurve"); if (!cv) return;
    cv.addEventListener("pointerdown", e => {
      const { x, y } = cvPos(e); dragIdx = -1; let bd = 14;
      ST.anchors.forEach((a, i) => { const d = Math.hypot(cvX(a.L) - x, cvY(a.v) - y); if (d < bd) { bd = d; dragIdx = i; } });
      if (dragIdx >= 0) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", e => {
      if (dragIdx < 0) return; const { y } = cvPos(e);
      const v = clamp(Math.round((CV.H - CV.PAD.b - y) / (CV.H - CV.PAD.t - CV.PAD.b) * 100), 0, 100);
      ST.anchors[dragIdx].v = v; rebuildTarget(); drawCurve();
    });
    const up = () => { dragIdx = -1; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  }

  /* ============================ MOUNT / TAB ============================ */
  let mounted = false;
  function mount() {
    if (mounted) return; mounted = true;
    const host = $("seqView"); if (!host) return;
    host.innerHTML = `
      <div class="seq-wrap">
        <div class="card">
          <h2><span class="step-no">1</span> Dữ liệu Arrow Out (baseline + pool layout)</h2>
          <div class="seq-drop" id="seqDrop"><b>Kéo–thả</b> hoặc bấm để nạp <small>(point_out_levels.json / pack {levels} / .zip — nhiều file)</small></div>
          <input type="file" id="seqInput" accept=".json,.zip,application/json,application/zip" multiple hidden />
          <div class="row" style="margin-top:8px; align-items:flex-end">
            <button id="seqPickBtn">📁 Chọn file</button>
            <label class="fld" style="flex:0 0 auto">Số level baseline <input type="number" id="seqNBase" min="1" max="2000" value="120" style="width:80px" /></label>
            <label class="fld" style="flex:0 0 auto">Tổng số level <input type="number" id="seqTotal" min="10" max="5000" value="1000" style="width:90px" /></label>
            <button id="seqMeasureBtn" class="primary">📏 Đo độ khó baseline</button>
          </div>
          <div class="seq-info" id="seqDataInfo" style="margin-top:8px"></div>
          <div class="seq-info" id="seqBaseInfo" style="margin-top:4px"></div>
        </div>

        <div class="card">
          <h2><span class="step-no">2</span> Đường cong độ khó (auto-fit baseline → ngoại suy, kéo điểm để chỉnh)</h2>
          <div class="row" style="margin-bottom:8px">
            <button id="seqAutoBtn">✨ Auto-fit từ baseline</button>
            <span class="hint" style="align-self:center">Preset:</span>
            <button class="seq-prst" data-k="linear">Tuyến tính</button>
            <button class="seq-prst" data-k="easein">Ease-in</button>
            <button class="seq-prst" data-k="scurve">S-curve</button>
          </div>
          <div class="seq-curve-wrap"><canvas id="seqCurve"></canvas></div>
          <div class="seq-legend"><span><i class="base"></i> điểm đo baseline</span><span><i class="tgt"></i> đường target</span><span><i class="got"></i> level đã sinh</span></div>
        </div>

        <div class="card">
          <h2><span class="step-no">3</span> Sinh level theo curve (layout chọn theo độ khó mục tiêu)</h2>
          <div class="row" style="align-items:flex-end">
            <label class="fld" style="flex:0 0 auto">Nguồn layout
              <select id="seqLayoutMode">
                <option value="diff">Theo độ khó (board hợp target)</option>
                <option value="keep">🔒 Giữ layout gốc (lặp lại)</option>
              </select>
            </label>
            <label class="fld" style="flex:0 0 auto" title="Bỏ qua board lớn hơn ngưỡng này (số ô). generateMap chậm SIÊU tuyến tính theo diện tích: ~400 ô ≈ 0.2s/lần, ~700 ô ≈ 1s, ~1100 ô ≈ 7s. 400 ⇒ 1000 level ~3 phút. Hạ xuống = NHANH hơn; nâng lên = level khó hơn nhưng CHẬM.">Giới hạn diện tích board <input type="number" id="seqMaxArea" min="100" max="4000" step="50" value="400" style="width:80px" /></label>
            <label class="fld" style="flex:0 0 auto">Số lần thử / level <input type="number" id="seqTries" min="2" max="40" value="8" style="width:80px" /></label>
            <button id="seqGenBtn" class="primary">⚙️ Sinh chuỗi level</button>
            <button id="seqCancelBtn" class="danger" style="display:none">■ Hủy</button>
            <button id="seqExportBtn" disabled>⬇ Export pack JSON</button>
          </div>
          <div class="seq-prog"><i id="seqProgBar"></i></div>
          <div class="seq-info" id="seqGenInfo" style="margin-top:8px"></div>
          <div class="hint" style="margin-top:6px">💡 <b>Theo độ khó</b>: mỗi level tự bốc layout có diện tích hợp target (board to ⇒ khó, nhỏ ⇒ dễ). · <b>🔒 Giữ layout gốc</b>: dùng <b>deck xoay vòng không reset</b> — layout dùng xong bị đẩy xuống cuối hàng (dù thành công hay thất bại), khoảng cách tối thiểu giữa 2 lần dùng ≈ 80% pool size. Mỗi lượt nhìn top ~20% deck để chọn layout có diện tích gần target nhất. Lấp gần kín khung "đã đục" → màn TRÔNG GIỐNG layout gốc.</div>
          <div class="seq-stats" id="seqStats"></div>
        </div>
      </div>`;
    // sự kiện
    const inp = $("seqInput"), drop = $("seqDrop");
    $("seqPickBtn").addEventListener("click", () => inp.click());
    drop.addEventListener("click", () => inp.click());
    inp.addEventListener("change", () => { ingest(inp.files); inp.value = ""; });
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) ingest(e.dataTransfer.files); });
    $("seqMeasureBtn").addEventListener("click", measureBaselineChunked);
    $("seqAutoBtn").addEventListener("click", () => { if (!ST.baseScores.filter(s => s != null).length) { $("seqBaseInfo").textContent = "⚠ Hãy đo baseline trước."; return; } autoFitCurve(); });
    host.querySelectorAll(".seq-prst").forEach(b => b.addEventListener("click", () => presetCurve(b.dataset.k)));
    $("seqGenBtn").addEventListener("click", runGenerate);
    $("seqCancelBtn").addEventListener("click", () => { ST.cancel = true; });
    $("seqExportBtn").addEventListener("click", exportPack);
    bindCurve(); rebuildTarget(); drawCurve();
  }

  function showOthers(show) {
    [".board-area", ".side"].forEach(sel => { const el = document.querySelector(sel); if (el && !show) el.style.display = "none"; });
    ["batchView", "playControls", "playHint", "libPlayBar", "sg2View", "compareView"].forEach(id => { const el = $(id); if (el && !show) el.style.display = "none"; });
  }
  function enterSeq() {
    showOthers(false); $("seqView").style.display = "block"; $("tabSeq").classList.add("tab-active");
    ["tabBatch", "tabPlay", "tabSG2", "tabCompare"].forEach(id => { const t = $(id); if (t) t.classList.remove("tab-active"); });
    mount();
  }
  function exitSeq() { const v = $("seqView"); if (v) v.style.display = "none"; const t = $("tabSeq"); if (t) t.classList.remove("tab-active"); }
  function init() {
    const ts = $("tabSeq"); if (!ts) return;
    ts.addEventListener("click", enterSeq);
    ["tabBatch", "tabPlay", "tabSG2", "tabCompare"].forEach(id => { const t = $(id); if (t) t.addEventListener("click", exitSeq); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
