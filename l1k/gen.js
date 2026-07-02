/* =========================================================================
   1000 LEVELS · GEN  (L1K.Gen)
   ---------------------------------------------------------------------------
   ENGINE sinh level — BÊ NGUYÊN logic "Sinh hàng loạt -> clone màu" của
   sequence.js (clone layout "đã đục" + GIỮ NGUYÊN màu gốc theo vị trí đầu rắn,
   fill cao >95%), CỘNG THÊM tuỳ chọn "bám độ khó target" (genOnLayout keepShape):
   sweep longPref/dparam quanh target trong khi vẫn lấp gần kín khung layout gốc.

   Chỉ ĐIỀU PHỐI global của arrow-out.js (KHÔNG viết lại):
     generateMap, computeDifficulty, fromGameLevel, toGameLevel,
     + worker dùng: DIRS, DELTA, MAXSNAKES, inBoard, solve, rint, shuffle, growSnake, snakeLen
   ========================================================================= */
(function () {
  "use strict";
  const L1K = (window.L1K = window.L1K || {});
  const clamp = L1K.util ? L1K.util.clamp : (v, a, b) => Math.max(a, Math.min(b, v));
  const now = L1K.util ? L1K.util.now : () => Date.now();

  /* ===================== NẠP DỮ LIỆU (port unzip + parser) ===================== */
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
      else if (method === 8) { try { out.push({ name, bytes: await inflateRaw(comp) }); } catch (e) { console.error("[L1K unzip]", name, e); } }
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
  async function filesToLevels(files) {
    let raw = [];
    for (const f of files) { try { raw.push(...await fileToLevels(f)); } catch (e) { console.error("[L1K]", f.name, e); } }
    return raw.filter(isGameLv);
  }

  /* ===================== TRÍCH LAYOUT + ĐO ĐỘ KHÓ ===================== */
  // mask theo HỆ TOẠ ĐỘ của fromGameLevel (Y-flip) để round-trip khớp pieces.
  function maskFromLevel(raw) {
    const W = raw.XSize | 0, H = raw.YSize | 0;
    if (!W || !H) return null;
    let mask;
    if (Array.isArray(raw.AllIndices) && raw.AllIndices.length) {
      mask = new Set(); raw.AllIndices.forEach(i => { const x = i % W, y = H - 1 - Math.floor(i / W); if (x >= 0 && x < W && y >= 0 && y < H) mask.add(x + "," + y); });
    } else if (typeof fromGameLevel === "function") {
      const g = fromGameLevel(raw); mask = new Set(); g.pieces.forEach(p => p.cells.forEach(c => mask.add(c.x + "," + c.y)));
    }
    if (!mask || mask.size < 4) return null;
    return { W, H, mask, area: mask.size, name: raw._name || (raw.LevelId != null ? "level_" + raw.LevelId : null) };
  }
  /* ===================== ĐỘ KHÓ "1000 LEVELS" =====================
     computeDifficulty1000 giờ là GLOBAL trong arrow-out.js (dùng chung: tab này + SG1 Sinh hàng loạt
     + SG2 với màn chỉ có rắn). Trọng số: 20%perc + 20%hidden + 20%move + 10%xa + 30%span (bỏ snakeScore).
     Worker của tab này cũng nhận nó tự động qua B.buildCoreSrc() — KHÔNG còn bản sao cục bộ nào phải sửa kèm. */

  // BẪY: fromGameLevel KHÔNG gán .id mà solver/computeDifficulty1000 lại dùng p.id -> gán trước khi chấm.
  function measure(raw) {
    if (typeof fromGameLevel !== "function" || typeof analyzeSolve !== "function" || typeof computeDifficulty1000 !== "function") return null;
    try {
      const g = fromGameLevel(raw); if (!g || !g.pieces.length) return null;
      g.pieces.forEach((p, i) => p.id = i + 1);
      const d = computeDifficulty1000(g.pieces, g.w, g.h);
      return (d.tier === "KẸT") ? null : d.score;
    } catch (e) { return null; }
  }

  /* ===================== CLONE MÀU (giữ nguyên màu gốc) ===================== */
  function buildCloneColorMap(raw) {
    if (typeof fromGameLevel !== "function") return null;
    try {
      const g = fromGameLevel(raw); if (!g || !g.pieces || !g.pieces.length) return null;
      const W = g.w, H = g.h; const cm = Array.from({ length: H }, () => Array(W).fill(0));
      g.pieces.forEach((p, idx) => {
        const color = (typeof p.fixedColor === "number" && p.fixedColor >= 1) ? p.fixedColor : (idx + 1);
        for (const c of p.cells) {
          const x = c && (c.x != null ? c.x : c[0]), y = c && (c.y != null ? c.y : c[1]);
          if (x >= 0 && x < W && y >= 0 && y < H) cm[y][x] = color;
        }
      });
      return { W, H, cm };
    } catch (e) { return null; }
  }
  function applyCloneColorsToPieces(pieces, colorSpec) {
    if (!colorSpec || !pieces || !pieces.length) return;
    const { cm, W, H } = colorSpec;
    for (const p of pieces) {
      if (p.mother) continue;
      const head = p.cells && p.cells[0]; if (!head) continue;
      const x = head.x != null ? head.x : head[0], y = head.y != null ? head.y : head[1];
      if (x >= 0 && x < W && y >= 0 && y < H && cm && cm[y] && cm[y][x]) p.fixedColor = cm[y][x];
    }
  }

  /* ===================== SINH TRÊN 1 LAYOUT (main-thread fallback) ===================== */
  // Pure clone: lấp gần kín, không ép target.
  function genCloneLayout(L, tries) {
    if (typeof generateMap !== "function" || typeof analyzeSolve !== "function" || !L) return null;
    const attempts = Math.max(1, Math.min(5, Math.floor(tries || 3)));
    let best = null;
    for (let k = 0; k < attempts; k++) {
      const fill = 0.96 + Math.random() * 0.03;
      const longPref = 35 + Math.random() * 40;
      const dparam = 30 + Math.random() * 40;
      let pieces; try { pieces = generateMap(L.W, L.H, longPref, dparam, 0, { mask: L.mask, fill }); } catch (e) { continue; }
      if (!pieces || pieces.length < 2) continue;
      const d = computeDifficulty1000(pieces, L.W, L.H);
      if (!d || d.tier === "KẸT" || !d.score) continue;
      best = { W: L.W, H: L.H, mask: L.mask, pieces, score: d.score, tier: d.tier, srcName: L.name };
      if (k >= 1) break;
    }
    return best;
  }
  // Steer theo target: giữ khung (fill>=90%), sweep longPref/dparam quanh target. Best-effort.
  function genSteerLayout(L, target, tries, tolerance) {
    if (typeof generateMap !== "function" || typeof analyzeSolve !== "function" || !L) return null;
    const okErr = Math.max(0, Number.isFinite(tolerance) ? tolerance : 6);
    const tr = Math.max(1, tries || 6);
    let best = null, bestErr = 1e9;
    for (let k = 0; k < tr; k++) {
      const fill = clamp(0.975 + (Math.random() * 2 - 1) * 0.02, 0.97, 0.995);   // fill ≥97% (clone màu, lấp gần kín)
      const sweep = tr > 1 ? (k / (tr - 1)) - 0.5 : 0;
      const longFactor = clamp((target / 100) - sweep * 0.3, 0, 1);
      const longPref = clamp(85 - longFactor * 75 + (Math.random() * 10 - 5), 0, 95);
      const dparam = clamp(target + sweep * 20 + (Math.random() * 6 - 3), 0, 100);
      let pieces; try { pieces = generateMap(L.W, L.H, longPref, dparam, 0, { mask: L.mask, fill }); } catch (e) { continue; }
      if (!pieces || pieces.length < 2) continue;
      const d = computeDifficulty1000(pieces, L.W, L.H); if (!d || d.tier === "KẸT" || !d.score) continue;
      const err = Math.abs(d.score - target);
      if (err < bestErr) { bestErr = err; best = { W: L.W, H: L.H, mask: L.mask, pieces, score: d.score, tier: d.tier, srcName: L.name }; if (err <= okErr) break; }
    }
    return best;
  }
  // ÉP ĐÚNG TARGET: sweep FILL rộng (0.12–0.97) trên cùng mask + longPref/dparam.
  // Fill = mật độ rắn -> đổi độ khó MẠNH -> với tới hầu hết target (trong giới hạn diện tích board).
  // Đánh đổi: level có thể THƯA hơn đối thủ (không lấp gần kín) — nhưng vẫn giữ KHUNG + MÀU đối thủ.
  function genExactLayout(L, target, tries, tolerance) {
    if (typeof generateMap !== "function" || typeof analyzeSolve !== "function" || !L) return null;
    const okErr = Math.max(0, Number.isFinite(tolerance) ? tolerance : 0);
    const tr = Math.max(8, tries || 12);
    let best = null, bestErr = 1e9;
    for (let k = 0; k < tr; k++) {
      let fill;
      if (best && bestErr < 8) fill = clamp(best._fill + (Math.random() * 2 - 1) * 0.08, 0.12, 0.97);          // tinh chỉnh quanh fill tốt
      else fill = clamp(0.14 + (k % 9) / 8 * 0.82 + (Math.random() * 2 - 1) * 0.04, 0.12, 0.97);               // quét thô phủ dải
      const longPref = clamp(40 + target * 0.35 + (Math.random() * 20 - 10), 0, 95);
      const dparam = clamp(target + (Math.random() * 2 - 1) * 12, 0, 100);
      let pieces; try { pieces = generateMap(L.W, L.H, longPref, dparam, 0, { mask: L.mask, fill }); } catch (e) { continue; }
      if (!pieces || pieces.length < 2) continue;
      const d = computeDifficulty1000(pieces, L.W, L.H); if (!d || d.tier === "KẸT" || !d.score) continue;
      const err = Math.abs(d.score - target);
      if (err < bestErr) { bestErr = err; best = { W: L.W, H: L.H, mask: L.mask, pieces, score: d.score, tier: d.tier, srcName: L.name, _fill: fill }; if (err <= okErr) break; }
    }
    return best;
  }
  // generateMap chậm siêu tuyến tính theo diện tích -> board to thì thử ít lần lại.
  function adaptiveTries(area, base) {
    return area <= 120 ? base : area <= 250 ? Math.max(3, Math.round(base * 0.5)) : Math.max(2, Math.round(base * 0.3));
  }

  /* ===================== SINH 1 LEVEL (clone + màu, có/không steer) =====================
     GHI CHÚ KỸ THUẬT: chạy MAIN-THREAD. Bản worker cũ (sequence.js) thực ra KHÔNG
     bao giờ chạy được vì computeDifficulty/generateMap còn phụ thuộc một loạt helper
     (analyzeSolve, percDynamic, percRisk, regionSeparation, movableList, solve,
     depMetrics…) không được nạp vào worker -> luôn ném lỗi và rơi về main-thread.
     Vì ưu tiên ĐÚNG & RÕ RÀNG (không cần nhanh), ở đây sinh thẳng main-thread với
     yield rAF giữa các level để UI không kẹt — đúng như hành vi thực tế đã kiểm chứng
     (~194ms/level). Nếu sau này cần song song thật, đóng gói ĐỦ closure trên vào worker. */
  /* ===== CLONE-MÀU (GIỮ NGUYÊN) — DÙNG LẠI Y HỆT engine tab "Sinh hàng loạt → clone màu" =====
     Cơ chế: đệm viền +1, dựng bản đồ màu theo ô, floodZones lấp ô chưa màu, rồi genLevelCore
     (VÙNG NGẦM: mỗi rắn chỉ nằm trong 1 vùng màu -> không lấn vùng khác) bám target; cuối cùng
     tô màu theo vùng gốc (giữ NGUYÊN màu). Đây là "chia vùng giữ nguyên, màu vùng siết chặt".  */
  function batchEngine() { return (typeof window !== "undefined" && window.__batch) ? window.__batch : null; }
  /* ===== LẤP LỖ THÔNG MINH — nguồn ĐÃ CHUYỂN sang arrow-batch.js (window.__batch), dùng CHUNG với
     tab Sinh hàng loạt. gen.js chỉ delegate (tránh 2 bản trôi nhau). Cùng với mergeFilledZones
     (gộp vùng ô đã lấp -> màu tiếp xúc nhiều nhất). Fallback new Set(cells) nếu thiếu batch (không xảy ra). */
  function smartFillHoles(cells, W, H, opts) { const B = batchEngine(); return (B && typeof B.smartFillHoles === "function") ? B.smartFillHoles(cells, W, H, opts) : new Set(cells); }
  function buildPaddedCloneMap(raw) {
    if (typeof fromGameLevel !== "function") return null;
    let g; try { g = fromGameLevel(raw); } catch (e) { return null; }
    if (!g || !g.pieces || !g.pieces.length) return null;
    const w = g.w, h = g.h, W = w + 2, H = h + 2;
    const cm = Array.from({ length: H }, () => Array(W).fill(-1)); const mask = new Set(); let colored = false;
    g.pieces.forEach((p) => {
      const fc = (typeof p.fixedColor === "number" && p.fixedColor >= 1) ? p.fixedColor : -1; if (fc >= 1) colored = true;
      for (const c of p.cells) { const x = c.x != null ? c.x : c[0], y = c.y != null ? c.y : c[1], X = x + 1, Y = y + 1; if (X >= 0 && X < W && Y >= 0 && Y < H) { mask.add(X + "," + Y); cm[Y][X] = fc; } }
    });
    return { W, H, mask, cm, colored };
  }
  // Chuẩn bị (rẻ, main-thread OK): layout đệm +1, lấp lỗ THÔNG MINH (phân loại giữ/lấp), gán vùng màu.
  // Dùng chung cho cả đường tuần tự (cloneKeepColor) lẫn Worker song song (genFull mới tốn CPU, off-thread).
  function prepCloneTask(raw, opts) {
    const B = batchEngine(); if (!B) return null;
    const built = buildPaddedCloneMap(raw); if (!built || built.mask.size < 4) return null;
    const { W, H, cm, colored } = built; let mask = built.mask;
    const orig = new Set(mask);
    try { mask = smartFillHoles(mask, W, H, opts); } catch (e) {}
    if (colored) {
      // Ô MỚI LẤP -> gộp vào vùng màu TIẾP XÚC NHIỀU NHẤT (mergeFilledZones), rồi floodZones lấp ô còn -1.
      const added = new Set(); mask.forEach(k => { if (!orig.has(k)) added.add(k); });
      if (typeof B.mergeFilledZones === "function") { try { B.mergeFilledZones(cm, added, W, H); } catch (e) {} }
      if (typeof B.floodZones === "function") { try { B.floodZones(cm, mask, W, H); } catch (e) {} }
    }
    return { W, H, mask, cm, colored };
  }
  // Dùng genLevelCore của batch (zone confinement) + tô màu theo vùng gốc. Trả result hoặc null.
  // opts thêm: fillMin (mặc định 0.98 — CHO PHÉP >=98%, không ép cứng 100%).
  // Hạn chế rắn nhỏ được xử lý bằng CAN THIỆP TRỰC TIẾP vào bước CHỌN ĐỘ DÀI khi đặt rắn
  // (genFull params.longFirst — LUÔN thử độ dài TỐI ĐA trước, chỉ ngắn dần khi không đặt được),
  // KHÔNG còn đo/lọc-sau (đo sau không có ý nghĩa can thiệp thật, dễ làm tỉ lệ sinh sụp đổ khi
  // kết hợp với sai số target).
  function cloneKeepColor(raw, target, opts) {
    const B = batchEngine(); if (!B || typeof B.genLevelCore !== "function") return null;
    const prep = prepCloneTask(raw, opts); if (!prep) return null;
    const { W, H, cm, colored, mask } = prep;
    const tol = Number.isFinite(opts && opts.tolerance) ? opts.tolerance : 3;
    const tries = Math.max(1, (opts && opts.tries) || 4);
    const zoneMap = colored ? cm : null;
    const useGenFull = typeof B.genFull === "function";
    // fillMin=0.98 (mặc định): CHO PHÉP fill từ 98% trở lên (không ép cứng 100%). Truyền THẲNG
    // cho genFull làm fillTgt của NÓ (không phải chỉ lọc sau) -> genFull dừng sớm khi đạt ~98%,
    // KHÔNG cần kích hoạt bước "vét 100%" (chỉ chạy khi fillTgt>=0.999) — bước đó nới ràng buộc
    // vùng cho vài ô bướng cuối, dễ làm lem màu vùng. Nới fill còn giúp GIỮ VÙNG SẠCH HƠN.
    const fillMin = clamp(Number.isFinite(opts && opts.fillMin) ? opts.fillMin : 0.98, 0.5, 1);
    const longFirst = !(opts && opts.longFirst === false);   // mặc định BẬT (can thiệp chọn độ dài)
    const strictFill = !!(opts && opts.strictFill);   // mặc định FALSE: LẤY FILL GẦN NHẤT (không loại vì thiếu fill)
    // best = bản ĐẠT fillMin, GẦN target nhất | fb = FALLBACK fill CAO NHẤT khi chưa đạt fillMin (fill bằng -> target gần hơn)
    let best = null, bestScore = 0, bestTier = "", bestErr = 1e9, bestFill = 0;
    let fb = null, fbScore = 0, fbTier = "", fbErr = 1e9, fbFill = -1;
    for (let k = 0; k < tries; k++) {
      let pieces, score, tier, fillR;
      if (useGenFull) {
        let arr; try { arr = B.genFull(W, H, mask, { fill: fillMin, minL: 2, maxL: 0, zoneMap, pinned: null, trap: false, longFirst }, (typeof target === "number" ? target : 0)); } catch (e) { continue; }
        if (!arr || arr.length < 2) continue;
        const d = computeDifficulty1000(arr, W, H); if (!d || d.tier === "KẸT" || !d.score) continue;
        let cov = 0; for (const p of arr) cov += p.cells.length;
        pieces = arr; score = d.score; tier = d.tier; fillR = cov / mask.size;
      } else {   // fallback engine: genLevelCore
        let lvl; try { lvl = B.genLevelCore(W, H, mask, (typeof target === "number" ? target : 0), { diff: 50, mother: false, perLevelZones: false, fill: fillMin, minL: 2, maxL: 0, zoneMap, pinned: null, trap: false, longFirst }); } catch (e) { continue; }
        if (!lvl || !lvl.pieces || lvl.pieces.length < 2) continue;
        pieces = lvl.pieces; score = lvl.score; tier = lvl.tier; fillR = 1 - ((lvl.empty || 0) / mask.size);
      }
      const err = (typeof target === "number") ? Math.abs(score - target) : 0;
      if (fillR >= fillMin) {   // ĐẠT fill -> ứng viên CHÍNH, chọn theo target gần nhất
        if (err < bestErr) { bestErr = err; best = pieces; bestScore = score; bestTier = tier; bestFill = fillR; if (err <= tol) break; }
      } else if (fillR > fbFill || (fillR === fbFill && err < fbErr)) {   // CHƯA đạt fill -> giữ bản fill CAO NHẤT (dự phòng)
        fbFill = fillR; fbErr = err; fb = pieces; fbScore = score; fbTier = tier;
      }
    }
    // Ưu tiên bản ĐẠT fill (gần target nhất). KHÔNG có -> LẤY FILL GẦN NHẤT (fb) thay vì loại level (mặc định
    // mới theo yêu cầu user: thà board hơi thiếu fill còn hơn để trống slot). strictFill=true -> loại như cũ.
    // Cả target lẫn fill giờ đều BEST-EFFORT: chỉ return null khi KHÔNG có board hợp lệ (solvable) nào.
    let chosen = best, cScore = bestScore, cTier = bestTier, cErr = bestErr, cFill = bestFill, fillMiss = false;
    if (!chosen) {
      if (strictFill || !fb) return null;
      chosen = fb; cScore = fbScore; cTier = fbTier; cErr = fbErr; cFill = fbFill; fillMiss = true;
    }
    // strictTarget=true -> khôi phục hành vi loại-khi-lệch-target cũ (opt-in, không có UI).
    if (opts && opts.strictTarget && typeof target === "number" && cErr > tol) return null;
    // tô màu GIỮ NGUYÊN theo vùng gốc: đầu rắn nằm trong vùng nào -> lấy đúng màu gốc vùng đó
    if (colored) for (const p of chosen) { if (p.mother) continue; const hd = p.cells[0]; const x = Array.isArray(hd) ? hd[0] : hd.x, y = Array.isArray(hd) ? hd[1] : hd.y; const col = (cm[y] || [])[x]; if (col >= 1) p.fixedColor = col; }
    const r = { W, H, mask, pieces: chosen, score: cScore, tier: cTier, fillReal: Math.floor(cFill * 100), fillMiss, srcName: raw._name || (raw.LevelId != null ? "level_" + raw.LevelId : "") };
    if (typeof target === "number") { r.target = target; r.err = Math.abs(r.score - target); r.exactMiss = r.err > tol; }
    return r;
  }

  // raw = level đối thủ. target = số hoặc null. opts={steer, tries, tolerance, maxArea}
  // Trả result {W,H,mask,pieces,score,tier,srcName,target} với MÀU đã clone, hoặc null.
  async function cloneOne(raw, target, opts) {
    opts = opts || {};
    const layout = maskFromLevel(raw); if (!layout) return null;
    if (opts.maxArea && layout.area > opts.maxArea) return { skipped: true, area: layout.area };

    // ƯU TIÊN DUY NHẤT engine clone-màu Y HỆT tab Sinh hàng loạt (zone confinement + fill 100%)
    // khi CÓ SẴN engine batch. QUAN TRỌNG: nếu cloneKeepColor thất bại (hết lượt thử mà không ra
    // board hợp lệ) thì level này COI NHƯ KHÔNG SINH ĐƯỢC (trả null) — TUYỆT ĐỐI KHÔNG rơi xuống
    // đường generateMap cũ bên dưới, vì đường đó DÙNG ENGINE KHÁC, không đảm bảo giữ đúng vùng màu
    // và không đảm bảo fill 100% (đã kiểm chứng: rơi vào đó cho ra board lệch vùng rất nặng, âm
    // thầm vi phạm 2 yêu cầu "giữ vùng màu" + "luôn 100%"). Đường cũ CHỈ dùng khi THỰC SỰ thiếu
    // engine batch (vd arrow-batch.js chưa nạp) — trường hợp không xảy ra trong ứng dụng thật.
    if (batchEngine()) return cloneKeepColor(raw, target, opts);

    // fallback (không có engine batch): dùng generateMap + tô màu theo đầu rắn.
    const steer = !!opts.steer && typeof target === "number";
    const exact = steer && !!opts.exact;
    const baseTries = steer ? (opts.tries || (exact ? 16 : 6)) : (opts.tries || 3);
    const tries = adaptiveTries(layout.area, baseTries);
    const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 6;
    const r = !steer ? genCloneLayout(layout, tries)
      : exact ? genExactLayout(layout, target, tries, tol)
        : genSteerLayout(layout, target, tries, tol);
    if (!r) return null;
    const colorSpec = buildCloneColorMap(raw);
    applyCloneColorsToPieces(r.pieces, colorSpec);
    r.srcName = r.srcName || layout.name || raw._name || "";
    if (typeof target === "number") { r.target = target; r.err = Math.abs(r.score - target); r.exactMiss = r.err > tol; }
    return r;
  }

  /* ===================== SINH 1 DẢI [from,to] (workflow gen) — TUẦN TỰ (fallback) ===================== */
  // sources = mảng level đối thủ (đã cắt theo dải). targets = mảng target tương ứng từng output (null=clone thuần).
  // cb: { onProgress(done,total,ok,rate,etaSec,last), shouldCancel() }
  async function runRangeSequential(sources, targets, opts, cb) {
    opts = opts || {}; cb = cb || {};
    const N = sources.length;
    const results = new Array(N).fill(null);
    const startT = now(); let skipped = 0;
    const yieldEvery = 1;   // nhường UI sau mỗi level (generateMap có thể nặng)
    for (let i = 0; i < N; i++) {
      if (cb.shouldCancel && cb.shouldCancel()) break;
      const raw = sources[i], target = targets ? targets[i] : null;
      const r = await cloneOne(raw, target, opts);
      if (r && r.skipped) skipped++;
      else if (r) results[i] = Object.assign({ i: i + 1 }, r);
      const done = i + 1;
      const el = (now() - startT) / 1000, rate = done / Math.max(0.001, el);
      const ok = results.filter(Boolean).length;
      const eta = rate > 0 ? Math.round((N - done) / rate) : 0;
      if (cb.onProgress) cb.onProgress(done, N, ok, rate, eta, results[i]);
      if (done % yieldEvery === 0) await new Promise(res => requestAnimationFrame(() => res()));
    }
    return { results, skipped };
  }

  /* ===================== SINH SONG SONG ĐA LUỒNG (Worker pool) =====================
     Dùng ĐÚNG bộ closure genFull/computeDifficulty… đã kiểm chứng của tab Sinh hàng loạt
     (window.__batch.buildCoreSrc) để dựng Worker — khỏi lặp lại rủi ro "thiếu hàm phụ thuộc"
     đã từng gặp. Mỗi level đối thủ có layout/mask RIÊNG (độc lập nhau) -> hợp lý để chia N
     worker xử lý song song, mỗi worker nhận việc tiếp theo ngay khi rảnh (work-stealing đơn giản).
     Phần NẶNG (genFull tìm bản lấp kín 100% bám target) chạy TRONG worker (off-thread);
     phần NHẸ (đọc JSON, lấp lỗ, floodZones, tô màu theo vùng) vẫn ở main thread. */
  let l1kWorkerURL = null;
  function buildL1KWorkerURL() {
    if (l1kWorkerURL) return l1kWorkerURL;
    const B = batchEngine();
    if (!B || typeof B.buildCoreSrc !== "function") return null;
    let core; try { core = B.buildCoreSrc(); } catch (e) { return null; }
    const MAIN = `
self.onmessage = function (e) {
  var m = e.data;
  var mask = new Set(m.maskArr);
  var zoneMap = m.cm || null;
  // fillMin (mặc định 0.98): CHO PHÉP fill >= 98%, không ép cứng 100% -> genFull dừng sớm hơn,
  // KHÔNG cần kích hoạt bước "vét 100%" (chỉ chạy khi fillTgt>=0.999, hay làm lem vùng màu).
  var fillMin = (typeof m.fillMin === "number") ? m.fillMin : 0.98;
  var longFirst = m.longFirst !== false;   // mặc định BẬT: can thiệp CHỌN ĐỘ DÀI (luôn thử tối đa trước)
  var tol = (typeof m.tol === "number") ? m.tol : 3;
  var strictTarget = !!m.strictTarget;   // mặc định false: LẤY TARGET GẦN NHẤT
  var strictFill = !!m.strictFill;       // mặc định false: LẤY FILL GẦN NHẤT (không loại khi thiếu fill)
  // computeDifficulty1000 ĐÃ CÓ SẴN trong core (buildCoreSrc serialize từ global arrow-out.js) — không định nghĩa lại.
  var best = null, bestScore = 0, bestTier = "", bestErr = 1e9, bestFill = 0;   // ĐẠT fillMin, gần target nhất
  var fb = null, fbScore = 0, fbTier = "", fbErr = 1e9, fbFill = -1;            // FALLBACK: fill cao nhất khi chưa đạt
  for (var k = 0; k < m.tries; k++) {
    var params = { fill: fillMin, minL: 2, maxL: 0, zoneMap: zoneMap, pinned: null, trap: false, longFirst: longFirst };
    var arr;
    try { arr = genFull(m.W, m.H, mask, params, (typeof m.target === "number" ? m.target : 0)); } catch (err) { continue; }
    if (!arr || arr.length < 2) continue;
    var d = computeDifficulty1000(arr, m.W, m.H);
    if (!d || d.tier === "KẸT" || !d.score) continue;
    var cov = 0; for (var i = 0; i < arr.length; i++) cov += arr[i].cells.length;
    var fillR = cov / mask.size;
    var e2 = (typeof m.target === "number") ? Math.abs(d.score - m.target) : 0;
    if (fillR >= fillMin) {   // ĐẠT fill -> ứng viên chính (target gần nhất)
      if (e2 < bestErr) { bestErr = e2; best = arr; bestScore = d.score; bestTier = d.tier; bestFill = fillR; if (e2 <= tol) break; }
    } else if (fillR > fbFill || (fillR === fbFill && e2 < fbErr)) {   // CHƯA đạt fill -> giữ bản fill cao nhất
      fbFill = fillR; fbErr = e2; fb = arr; fbScore = d.score; fbTier = d.tier;
    }
  }
  // Ưu tiên bản ĐẠT fill; không có -> LẤY FILL GẦN NHẤT (fb) thay vì loại (mặc định). strictFill=true -> loại như cũ.
  var pieces = best, score = bestScore, tier = bestTier, cErr = bestErr, cFill = bestFill, fillMiss = false;
  if (!pieces) {
    if (!strictFill && fb) { pieces = fb; score = fbScore; tier = fbTier; cErr = fbErr; cFill = fbFill; fillMiss = true; }
  }
  // strictTarget=true -> khôi phục hành vi loại-khi-lệch-target cũ.
  if (pieces && strictTarget && typeof m.target === "number" && cErr > tol) { pieces = null; score = 0; tier = ""; }
  self.postMessage({ idx: m.idx, pieces: pieces, score: score, tier: tier, fillReal: Math.floor(cFill * 100), fillMiss: fillMiss });
};`;
    try { l1kWorkerURL = URL.createObjectURL(new Blob([core + MAIN], { type: "application/javascript" })); }
    catch (e) { return null; }
    return l1kWorkerURL;
  }
  // Trả {results, skipped} như bản tuần tự, hoặc null nếu không dựng được Worker (caller tự fallback).
  async function runRangeParallel(sources, targets, opts, cb) {
    opts = opts || {}; cb = cb || {};
    const N = sources.length;
    if (!N) return { results: [], skipped: 0 };
    if (typeof Worker === "undefined") return null;
    const url = buildL1KWorkerURL(); if (!url) return null;

    // Chuẩn bị NHẸ trước cho từng level (main-thread, có yield định kỳ cho batch lớn).
    const tasks = new Array(N).fill(null);
    for (let i = 0; i < N; i++) {
      const raw = sources[i];
      if (opts.maxArea) { const layout = maskFromLevel(raw); if (layout && layout.area > opts.maxArea) { tasks[i] = { skip: true }; continue; } }
      const prep = prepCloneTask(raw, opts);
      if (!prep) { tasks[i] = null; continue; }
      const target = targets ? targets[i] : null;
      const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 3;
      const tries = Math.max(1, opts.tries || 4);
      const fillMin = clamp(Number.isFinite(opts.fillMin) ? opts.fillMin : 0.98, 0.5, 1);
      const longFirst = opts.longFirst !== false;   // mặc định BẬT (can thiệp chọn độ dài rắn khi đặt)
      const strictTarget = !!opts.strictTarget;   // mặc định false: lấy target gần nhất
      const strictFill = !!opts.strictFill;        // mặc định false: lấy fill gần nhất (không loại khi thiếu fill)
      tasks[i] = { W: prep.W, H: prep.H, maskArr: Array.from(prep.mask), cm: prep.cm, colored: prep.colored, target, tol, tries, fillMin, longFirst, strictTarget, strictFill, raw };
      if (i % 60 === 59) await new Promise(res => requestAnimationFrame(() => res()));
    }

    const results = new Array(N).fill(null);
    const startT = now(); let skipped = 0, doneCount = 0;
    const workerN = Math.max(1, Math.min((typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4, 12, N));
    const workers = [];

    return new Promise((resolve) => {
      let nextIdx = 0, finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        workers.forEach(w => { try { w.terminate(); } catch (e) {} });
        resolve({ results, skipped });
      };
      const reportProgress = (lastR) => {
        const el = (now() - startT) / 1000, rate = doneCount / Math.max(0.001, el);
        const ok = results.filter(Boolean).length;
        const eta = rate > 0 ? Math.round((N - doneCount) / rate) : 0;
        if (cb.onProgress) cb.onProgress(doneCount, N, ok, rate, eta, lastR);
      };
      const dispatchNext = (worker) => {
        if (finished) return;
        // bỏ qua nhanh các task null/skip (không cần round-trip worker)
        while (nextIdx < N && (!tasks[nextIdx] || tasks[nextIdx].skip)) {
          if (tasks[nextIdx] && tasks[nextIdx].skip) skipped++;
          doneCount++; reportProgress(null); nextIdx++;
        }
        if (nextIdx >= N) { if (doneCount >= N) finish(); return; }
        const idx = nextIdx++, t = tasks[idx];
        worker.postMessage({ idx, W: t.W, H: t.H, maskArr: t.maskArr, cm: t.colored ? t.cm : null, target: t.target, tol: t.tol, tries: t.tries, fillMin: t.fillMin, longFirst: t.longFirst, strictTarget: t.strictTarget, strictFill: t.strictFill });
      };
      for (let w = 0; w < workerN; w++) {
        let worker; try { worker = new Worker(url); } catch (e) { break; }
        workers.push(worker);
        worker.onmessage = (ev) => {
          if (finished) return;
          const data = ev.data || {};
          const idx = data.idx, t = tasks[idx];
          let r = null;
          if (data.pieces && t) {
            if (t.colored) for (const p of data.pieces) { if (p.mother) continue; const hd = p.cells[0]; const x = Array.isArray(hd) ? hd[0] : hd.x, y = Array.isArray(hd) ? hd[1] : hd.y; const col = (t.cm[y] || [])[x]; if (col >= 1) p.fixedColor = col; }
            r = { i: idx + 1, W: t.W, H: t.H, mask: new Set(t.maskArr), pieces: data.pieces, score: data.score, tier: data.tier, fillReal: data.fillReal, fillMiss: !!data.fillMiss, srcName: t.raw._name || (t.raw.LevelId != null ? "level_" + t.raw.LevelId : "") };
            if (typeof t.target === "number") { r.target = t.target; r.err = Math.abs(r.score - t.target); r.exactMiss = r.err > t.tol; }
            results[idx] = r;
          }
          doneCount++; reportProgress(r);
          if (cb.shouldCancel && cb.shouldCancel()) { finish(); return; }
          dispatchNext(worker);
        };
        worker.onerror = () => { if (finished) return; doneCount++; reportProgress(null); dispatchNext(worker); };
        dispatchNext(worker);
      }
      if (!workers.length) resolve(null);   // không tạo được Worker nào -> caller fallback tuần tự
    });
  }

  /** Điều phối: ưu tiên Worker song song (nhanh, tận dụng đa lõi); tự fallback tuần tự nếu
      không dựng được Worker (trình duyệt chặn blob Worker, hoặc thiếu engine batch). */
  async function runRange(sources, targets, opts, cb) {
    const par = await runRangeParallel(sources, targets, opts, cb);
    if (par) return par;
    return runRangeSequential(sources, targets, opts, cb);
  }

  /** Regen 1 level cho click-to-edit (chạy main-thread, 1 level nên nhanh). */
  async function regenOne(raw, target, opts) {
    opts = Object.assign({ steer: true, tries: 8 }, opts || {});
    return cloneOne(raw, target, opts);
  }

  /* ===================== EXPORT format game (round-trip + AllIndices) ===================== */
  function toGameLevelFromResult(r, id) {
    const base = (typeof toGameLevel === "function")
      ? toGameLevel(r.pieces, r.W, r.H, Math.round(r.score), null)
      : { XSize: r.W, YSize: r.H, Arrows: [], Colors: [] };
    const allIdx = []; r.mask.forEach(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); allIdx.push(x + (r.H - 1 - y) * r.W); });
    allIdx.sort((a, b) => a - b);
    return Object.assign(
      { GameType: "ArrowsOut", LevelId: id, LevelUId: id, IsFtueLevel: false, MechanicType: "Normal" },
      base,
      { AllIndices: allIdx, GridObjects: [], _name: "level_" + id, _difficulty: Math.round(r.score), ...(typeof r.target === "number" ? { _targetDifficulty: r.target } : {}), ...(r.srcName ? { _srcLayout: r.srcName } : {}) }
    );
  }

  L1K.Gen = {
    fileToLevels, filesToLevels, isGameLv,
    maskFromLevel, measure,
    cloneOne, regenOne, runRange,
    toGameLevelFromResult,
    buildCloneColorMap, applyCloneColorsToPieces,
    smartFillHoles, prepCloneTask   // expose để test + UI duyệt lỗ sau này
  };
})();
