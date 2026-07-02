/* =========================================================================
   1000 LEVELS · UI  (L1K.UI)
   ---------------------------------------------------------------------------
   Tầng GIAO DIỆN / điều phối. Mount vào #seqView, chiếm tab "📈 1000 Levels"
   (#tabSeq). Gắn kết Store + Sync + Sheet + Gen + Chart thành 1 workflow:
     1) Dữ liệu: nạp bộ ĐỐI THỦ (clone), build dần bộ GAME TA, export/import.
     2) Sheet độ khó target: vẽ đường target (anchors) + sửa từng level.
     3) Đồ thị 2 đường (đối thủ vs game ta) + target — pan/zoom, click điểm để sửa.
     4) Workflow gen: chọn dải level đối thủ -> clone màu + bám target -> ghi game ta.
     5) Versions / rollback. 6) Trạng thái sync (Local; Google cắm sau).
   QUY ƯỚC: ours[i] = bản clone của opponent[i] (cùng trục X -> so sánh trực tiếp).
   ========================================================================= */
(function () {
  "use strict";
  const L1K = (window.L1K = window.L1K || {});
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtTime = L1K.util ? L1K.util.fmtTime : (t => new Date(t).toLocaleString());

  const ST = {
    total: 1000,
    chart: null,
    targetAnchors: [],          // [{L,v}] đường target kéo được
    busy: false, cancel: false,
    measuredOpp: false,
    selLevel: null,
    pendingRegen: new Set()     // level user VỪA kéo/sửa target -> "Gen lại level đã đổi" chỉ xử lý các level này
  };

  /* ===================== TOAST + LOADING ===================== */
  function toast(msg, kind) {
    let host = $("l1kToasts");
    if (!host) { host = document.createElement("div"); host.id = "l1kToasts"; host.className = "l1k-toasts"; document.body.appendChild(host); }
    const t = document.createElement("div"); t.className = "l1k-toast " + (kind || "info"); t.textContent = msg;
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, kind === "error" ? 5200 : 3000);
  }
  function setBusy(on, text) {
    ST.busy = on;
    const ov = $("l1kOverlay"); if (ov) { ov.style.display = on ? "flex" : "none"; const tx = $("l1kOverlayText"); if (tx && text) tx.textContent = text; }
  }

  /* ===================== ĐƯỜNG TARGET (anchors) ===================== */
  const TC = { W: 560, H: 150, PAD: { l: 28, r: 10, t: 10, b: 18 } };
  function tcX(L) { return TC.PAD.l + (L - 1) / Math.max(1, ST.total - 1) * (TC.W - TC.PAD.l - TC.PAD.r); }
  function tcY(v) { return TC.H - TC.PAD.b - v / 100 * (TC.H - TC.PAD.t - TC.PAD.b); }
  function anchorLevels() {
    const N = ST.total;
    const raw = [1, Math.round(N * .1), Math.round(N * .25), Math.round(N * .5), Math.round(N * .75), Math.round(N * .9), N];
    return [...new Set(raw.map(v => clamp(Math.round(v), 1, N)))].sort((a, b) => a - b);
  }
  function ensureAnchors() {
    if (ST.targetAnchors.length) return;
    // seed từ sheet nếu có, không thì đường thoải 15->85
    const Ls = anchorLevels();
    ST.targetAnchors = Ls.map(L => {
      const t = L1K.Sheet.target(L);
      const def = clamp(Math.round(15 + 70 * (L - 1) / Math.max(1, ST.total - 1)), 0, 100);
      return { L, v: t != null ? t : def };
    });
  }
  function evalTargetAt(L) {
    const a = ST.targetAnchors; if (!a.length) return 50;
    if (L <= a[0].L) return a[0].v; if (L >= a[a.length - 1].L) return a[a.length - 1].v;
    for (let i = 0; i < a.length - 1; i++) if (L >= a[i].L && L <= a[i + 1].L) { const f = (L - a[i].L) / ((a[i + 1].L - a[i].L) || 1); return a[i].v + (a[i + 1].v - a[i].v) * f; }
    return a[a.length - 1].v;
  }
  function drawTargetCurve() {
    const cv = $("l1kTargetCurve"); if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = TC.W * dpr; cv.height = TC.H * dpr; const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, TC.W, TC.H); g.fillStyle = "#0e1424"; g.fillRect(0, 0, TC.W, TC.H);
    g.font = "9px sans-serif";
    [0, 25, 50, 75, 100].forEach(v => { const y = tcY(v); g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(TC.PAD.l, y); g.lineTo(TC.W - TC.PAD.r, y); g.stroke(); g.fillStyle = "rgba(255,255,255,.35)"; g.fillText(String(v), 4, y + 3); });
    // đường target
    g.strokeStyle = "#e0b84f"; g.lineWidth = 2; g.beginPath();
    const step = Math.max(1, Math.floor(ST.total / 300));
    for (let L = 1; L <= ST.total; L += step) { const x = tcX(L), y = tcY(evalTargetAt(L)); L === 1 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.lineTo(tcX(ST.total), tcY(evalTargetAt(ST.total))); g.stroke();
    // anchors
    ST.targetAnchors.forEach(a => { const x = tcX(a.L), y = tcY(a.v); g.beginPath(); g.arc(x, y, 5, 0, 7); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 1.4; g.strokeStyle = "#0f1115"; g.stroke(); });
  }
  let tDrag = -1;
  function bindTargetCurve() {
    const cv = $("l1kTargetCurve"); if (!cv) return;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (TC.W / r.width), y: (e.clientY - r.top) * (TC.H / r.height) }; };
    cv.addEventListener("pointerdown", e => {
      const { x, y } = pos(e); tDrag = -1; let bd = 16;
      ST.targetAnchors.forEach((a, i) => { const d = Math.hypot(tcX(a.L) - x, tcY(a.v) - y); if (d < bd) { bd = d; tDrag = i; } });
      if (tDrag >= 0) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", e => {
      if (tDrag < 0) return; const { y } = pos(e);
      ST.targetAnchors[tDrag].v = clamp(Math.round((TC.H - TC.PAD.b - y) / (TC.H - TC.PAD.t - TC.PAD.b) * 100), 0, 100);
      drawTargetCurve();
    });
    const up = async () => { if (tDrag >= 0) { tDrag = -1; await commitTargetCurve(); } };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", () => tDrag = -1);
  }
  async function commitTargetCurve() {
    const n = await L1K.Sheet.seedFromCurve(1, ST.total, evalTargetAt);
    refreshChartTarget(); renderSheetInfo();
    toast(`Đã cập nhật target ${n} level từ đường cong`, "ok");
  }

  /* ===================== ĐO ĐỘ KHÓ (lazy, chunked) ===================== */
  function measureChunked(levels, into, label, doneFn) {
    const N = levels.length; let i = 0;
    const tick = () => {
      const t0 = performance.now();
      while (i < N && performance.now() - t0 < 26) { const raw = levels[i]; into[i] = raw ? L1K.Gen.measure(raw) : null; i++; }
      $("l1kChartInfo").textContent = `⏳ ${label} ${i}/${N}…`;
      if (ST.chart) ST.chart.invalidate();
      if (ST.targetChart) ST.targetChart.invalidate();
      if (i < N) requestAnimationFrame(tick); else doneFn();
    };
    requestAnimationFrame(tick);
  }
  function measureOpponent() {
    const lv = L1K.Store.M.opponent.levels; if (!lv.length) { toast("Chưa nạp dữ liệu đối thủ", "error"); return; }
    const arr = new Array(lv.length).fill(null); L1K.Store.M.curves.opponent = arr;
    if (ST.chart) ST.chart.setData({ opponent: arr });
    if (ST.targetChart) ST.targetChart.setData({ opponent: arr });
    measureChunked(lv, arr, "Đo đối thủ", async () => {
      await L1K.Store.setCurve("opponent", arr); ST.measuredOpp = true;
      const ok = arr.filter(s => s != null).length, avg = ok ? Math.round(arr.reduce((a, b) => a + (b || 0), 0) / ok) : 0;
      $("l1kChartInfo").textContent = `Đối thủ: đo ${ok}/${lv.length} hợp lệ · TB ${avg}.`;
      if (ST.chart) ST.chart.setData({ opponent: arr });
      // Tự đẩy độ khó đối thủ lên Sheet (tab "opponent") nếu backend đã đăng nhập
      const bk = L1K.Sync.providers.backend;
      if (bk && bk._health && bk._health.loggedIn) {
        try { await bk.pushOppDiff(arr); toast(`Đã ghi độ khó ${ok} level đối thủ lên Sheet (tab "opponent")`, "ok"); }
        catch (e) { toast("Ghi độ khó đối thủ lên Sheet lỗi: " + (e.message || e), "error"); }
      }
    });
  }
  function measureOurs() {
    const lv = L1K.Store.M.ours.levels; if (!lv.filter(Boolean).length) { toast("Chưa có level game ta", "error"); return; }
    const arr = new Array(Math.max(lv.length, ST.total)).fill(null); L1K.Store.M.curves.ours = arr;
    if (ST.chart) ST.chart.setData({ ours: arr });
    measureChunked(lv, arr, "Đo game ta", async () => {
      await L1K.Store.setCurve("ours", arr);
      const ok = arr.filter(s => s != null).length;
      $("l1kChartInfo").textContent = `Game ta: đo ${ok} level.`;
      if (ST.chart) ST.chart.setData({ ours: arr });
    });
  }

  /* ===================== CHART ===================== */
  function curveArr(which, len) { const a = (L1K.Store.M.curves[which] || []).slice(); while (a.length < len) a.push(null); return a; }
  function refreshChartAll() {
    const opp = curveArr("opponent", ST.total), tgt = L1K.Sheet.toArray(ST.total);
    if (ST.chart) ST.chart.setData({ total: ST.total, opponent: opp, ours: curveArr("ours", ST.total), target: tgt });
    if (ST.targetChart) ST.targetChart.setData({ total: ST.total, opponent: opp, target: tgt, ours: [] });
  }
  function refreshChartTarget() { const t = L1K.Sheet.toArray(ST.total); if (ST.chart) ST.chart.setData({ target: t }); if (ST.targetChart) ST.targetChart.setData({ target: t }); }

  /* ===================== KÉO ĐIỂM TARGET -> SỬA + LƯU SHEET REALTIME ===================== */
  function onTargetDrag(level, v) { const a = $("l1kEditLv"), b = $("l1kEditTgt"); if (a) a.value = level; if (b) b.value = v; if ($("l1kSheetInfo")) $("l1kSheetInfo").textContent = `Level ${level} → target ${v} (thả chuột để lưu Sheet)`; }
  let _dragSaveT = 0;
  async function onTargetDragEnd(level, v) {
    await L1K.Sheet.setTarget(level, v, { force: true });   // patch Google Sheet realtime
    ST.pendingRegen.add(level);                              // đánh dấu để "Gen lại level đã đổi"
    refreshChartTarget(); renderSheetInfo();
    const now = performance.now(); if (now - _dragSaveT > 1200) { _dragSaveT = now; toast(`Đã lưu Sheet: level ${level} = ${v}`, "ok"); }
  }

  /* ===================== CLICK ĐIỂM -> SỬA ĐỘ KHÓ + REGEN ===================== */
  async function onPointClick(levelNo) {
    ST.selLevel = levelNo;
    const opp = L1K.Store.M.opponent.levels[levelNo - 1];
    if (!opp) { toast(`Level ${levelNo} không có dữ liệu đối thủ để clone`, "error"); return; }
    const curTarget = L1K.Sheet.target(levelNo);
    const oursScore = (L1K.Store.M.curves.ours || [])[levelNo - 1];
    openEditModal(levelNo, { curTarget, oursScore, oppScore: (L1K.Store.M.curves.opponent || [])[levelNo - 1] });
  }
  function openEditModal(levelNo, info) {
    closeEditModal();
    const wrap = document.createElement("div"); wrap.id = "l1kEdit"; wrap.className = "l1k-modal";
    wrap.innerHTML = `
      <div class="l1k-modal-card">
        <h3>Sửa độ khó · Level ${levelNo}</h3>
        <div class="l1k-kv">
          <span>Đối thủ (gốc)</span><b>${info.oppScore != null ? info.oppScore : "—"}</b>
          <span>Game ta (hiện tại)</span><b>${info.oursScore != null ? info.oursScore : "chưa sinh"}</b>
          <span>Target hiện tại</span><b>${info.curTarget != null ? info.curTarget : "chưa đặt"}</b>
        </div>
        <label class="fld" style="margin-top:10px">Độ khó mới (0–100)
          <input type="number" id="l1kEditVal" min="0" max="100" value="${info.curTarget != null ? info.curTarget : (info.oppScore != null ? info.oppScore : 50)}" />
        </label>
        <div class="row" style="margin-top:12px; justify-content:flex-end">
          <button id="l1kEditCancel">Huỷ</button>
          <button id="l1kEditApply" class="primary">🔁 Lưu target + Gen lại level</button>
        </div>
        <div class="hint" style="margin-top:8px">Hệ thống sẽ: lưu target vào sheet → clone lại layout+màu của đối thủ bám độ khó mới → cập nhật game ta → cập nhật đồ thị.</div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => { if (e.target === wrap) closeEditModal(); });
    $("l1kEditCancel").onclick = closeEditModal;
    $("l1kEditApply").onclick = () => applyEdit(levelNo);
    setTimeout(() => { const i = $("l1kEditVal"); if (i) { i.focus(); i.select(); } }, 30);
  }
  function closeEditModal() { const w = $("l1kEdit"); if (w) w.remove(); }
  async function applyEdit(levelNo) {
    const val = clamp(parseInt($("l1kEditVal").value) || 0, 0, 100);
    closeEditModal();
    setBusy(true, `Đang gen lại level ${levelNo}…`);
    try {
      await L1K.Sheet.setTarget(levelNo, val);
      const opp = L1K.Store.M.opponent.levels[levelNo - 1];
      const r = await L1K.Gen.regenOne(opp, val, { steer: true, ...readGenOpts() });   // dùng ĐÚNG setting mục 4 (fill/lấp lỗ/tries) — trước đây bỏ quên nên regen 1 level ra khác hẳn gen dải
      if (!r || r.skipped) { toast(`Không gen được level ${levelNo}`, "error"); setBusy(false); return; }
      const game = L1K.Gen.toGameLevelFromResult(r, levelNo);
      await L1K.Store.upsertOur(levelNo, game);
      // cập nhật điểm đo ours[levelNo]
      const arr = L1K.Store.M.curves.ours || (L1K.Store.M.curves.ours = []);
      arr[levelNo - 1] = r.score; await L1K.Store.setCurve("ours", arr);
      refreshChartAll(); ST.chart && ST.chart.select(levelNo);
      renderDatasets(); renderSheetInfo();
      toast(`Level ${levelNo}: target ${val} → đạt ${r.score} (lệch ${Math.abs(r.score - val)})`, "ok");
    } catch (e) { console.error(e); toast("Lỗi gen lại: " + (e.message || e), "error"); }
    setBusy(false);
  }

  /* ===================== THAM SỐ GEN DÙNG CHUNG (fill tối thiểu, số lần thử) ===================== */
  // Hạn chế rắn nhỏ: can thiệp TRỰC TIẾP vào bước chọn độ dài khi đặt rắn (genFull longFirst —
  // luôn thử dài nhất trước, chỉ ngắn dần khi không đặt được) — KHÔNG còn tham số đo/lọc-sau.
  function readGenOpts() {
    const fillMin = clamp((parseInt($("l1kFillMin").value, 10) || 98) / 100, 0.5, 1);
    const tries = clamp(parseInt($("l1kTries").value, 10) || 25, 1, 2000);
    // Lấp lỗ thông minh: giữ lỗ > holeMax ô (hình vẽ) + lỗ đối xứng (hoạ tiết); lấp lỗ nhỏ lẻ loi.
    const holeMax = clamp((v => Number.isFinite(v) ? v : 8)(parseInt($("l1kHoleMax").value, 10)), 0, 999);   // mặc định 8 (đồng bộ batch) — lấp lỗ nhiều ô tự động
    const holeSym = !!($("l1kHoleSym") && $("l1kHoleSym").checked);
    return { fillMin, tries, longFirst: true, holeMax, holeSym };
  }

  /* ===================== WORKFLOW GEN DẢI ===================== */
  async function runWorkflow() {
    if (ST.busy) return;
    const opp = L1K.Store.M.opponent.levels;
    if (!opp.length) { toast("Chưa nạp dữ liệu đối thủ", "error"); return; }
    const steer = true, exact = false;   // luôn bám target; fill cao (clone màu) -> gen NHANH
    const tol = clamp((v => Number.isFinite(v) ? v : 3)(parseInt($("l1kTol").value, 10)), 0, 40);
    const maxArea = 0;
    const genOpts = readGenOpts();   // fillMin, tries, longFirst
    // 2 khoảng độc lập: game ta [ourFrom,ourTo] ; đối thủ nguồn [oppFrom,oppTo]
    const ourFrom = clamp(parseInt($("l1kGenOurFrom").value) || 1, 1, 100000);
    const ourTo = clamp(parseInt($("l1kGenOurTo").value) || ourFrom, ourFrom, 100000);
    const oppFrom = clamp(parseInt($("l1kGenOppFrom").value) || 1, 1, opp.length);
    const oppTo = clamp(parseInt($("l1kGenOppTo").value) || oppFrom, oppFrom, opp.length);
    const ourN = ourTo - ourFrom + 1, oppN = oppTo - oppFrom + 1;
    if (ourN !== oppN) { toast(`Số lượng KHÔNG khớp: game ta ${ourN} level ≠ đối thủ ${oppN} level`, "error"); return; }

    ST.busy = true; ST.cancel = false;
    $("l1kGenBtn").disabled = true; $("l1kGenCancel").style.display = "inline-flex";
    await L1K.Store.pushVersion(`trước gen game ta ${ourFrom}-${ourTo} (clone đối thủ ${oppFrom}-${oppTo})`);
    renderVersions();

    const sources = opp.slice(oppFrom - 1, oppTo);
    let noTarget = 0;
    const targets = sources.map((_, k) => {
      const lvNo = ourFrom + k;                      // level GAME TA tương ứng
      let t = steer ? L1K.Sheet.target(lvNo) : null;
      if (steer && t == null) { noTarget++; t = (L1K.Store.M.curves.opponent || [])[oppFrom - 1 + k]; }  // thiếu target -> bám đối thủ nguồn
      return (typeof t === "number") ? t : null;
    });

    const oursArr = L1K.Store.M.curves.ours || (L1K.Store.M.curves.ours = []);
    const startInfo = $("l1kGenInfo");
    let lastDraw = 0;
    const res = await L1K.Gen.runRange(sources, targets, { steer, exact, tolerance: tol, maxArea: maxArea || 0, ...genOpts }, {
      shouldCancel: () => ST.cancel,
      onProgress: (done, total, ok, rate, eta, last) => {
        $("l1kGenBar").style.width = Math.round(done / total * 100) + "%";
        startInfo.textContent = `Đang clone ${done}/${total} · đạt ${ok} · ${rate.toFixed(1)} lv/s · còn ~${eta}s`;
        if (last) { const lvNo = ourFrom + (last.i - 1); oursArr[lvNo - 1] = last.score; }
        const t = performance.now(); if (t - lastDraw > 180) { lastDraw = t; ST.chart && ST.chart.setData({ ours: oursArr.slice() }); }
      }
    });

    // ghi kết quả vào GAME TA theo khoảng ourFrom.. — gen.js giờ BEST-EFFORT CẢ target LẪN fill:
    // mọi board hợp lệ (solvable) đều được ghi. r.exactMiss = lệch quá "Sai số" (board không với tới target);
    // r.fillMiss = không đạt "Fill tối thiểu" -> lấy bản FILL CAO NHẤT (fillReal%). null = KHÔNG sinh
    // được board hợp lệ nào trong "tries" lần (rất hiếm) -> game ta giữ nguyên cũ tại vị trí đó.
    let written = 0, sumErr = 0, maxErr = 0, cnt = 0, offTol = 0, fillMiss = 0, minFill = 100;
    for (let k = 0; k < res.results.length; k++) {
      const r = res.results[k]; if (!r) continue;
      const lvNo = ourFrom + k, idx = lvNo - 1;
      const game = L1K.Gen.toGameLevelFromResult(r, lvNo);
      game._srcOpp = oppFrom + k;   // nhớ nguồn đối thủ để gen lại đúng layout khi resync
      while (L1K.Store.M.ours.levels.length < lvNo) L1K.Store.M.ours.levels.push(null);
      L1K.Store.M.ours.levels[idx] = game; oursArr[idx] = r.score; written++;
      ST.pendingRegen.delete(lvNo);   // đã gen trong đợt này -> gỡ khỏi danh sách chờ
      if (typeof r.target === "number") { const e = Math.abs(r.score - r.target); sumErr += e; maxErr = Math.max(maxErr, e); cnt++; if (r.exactMiss) offTol++; }
      if (r.fillMiss) { fillMiss++; if (typeof r.fillReal === "number") minFill = Math.min(minFill, r.fillReal); }
    }
    L1K.Store.M.ours.count = L1K.Store.M.ours.levels.filter(Boolean).length;
    L1K.Store.M.ours.updatedAt = Date.now();
    L1K.Store.markDirty("ours");
    await L1K.Store.persist("ours");
    await L1K.Store.setCurve("ours", oursArr);
    // KHÔNG tự đẩy Drive — chỉ khi bấm "Đẩy game ta"

    ST.busy = false; ST.cancel = false;
    $("l1kGenBtn").disabled = false; $("l1kGenCancel").style.display = "none";
    $("l1kGenBar").style.width = "100%";
    const failed = ourN - written;   // KHÔNG sinh được board hợp lệ (rất hiếm) — game ta GIỮ NGUYÊN nội dung cũ
    const mae = cnt ? (sumErr / cnt).toFixed(1) : "—";
    const inTol = cnt - offTol;   // số level ĐÚNG trong sai số ±tol; offTol = best-effort (lấy target gần nhất)
    startInfo.textContent = `✓ Xong: ghi ${written}/${ourN} level (game ta ${ourFrom}-${ourTo})`
      + (cnt ? ` · MAE ${mae} · lệch max ${maxErr} · ${inTol} trong sai số ±${tol}${offTol ? `, ${offTol} lấy TARGET GẦN NHẤT (board không với tới target)` : ""}` : " (clone thuần, không target)")
      + (fillMiss > 0 ? ` · ${fillMiss} level lấy FILL GẦN NHẤT (thấp nhất ${minFill}%, không đạt "Fill tối thiểu")` : "")
      + (failed > 0 ? ` · ⚠ ${failed} level KHÔNG sinh được board hợp lệ (giữ nguyên cũ)` : "")
      + (noTarget ? ` · ${noTarget} level thiếu target (bám đối thủ)` : "")
      + (res.skipped ? ` · bỏ ${res.skipped} layout > cap` : "")
      + ` · bấm "Đẩy game ta" để lưu Drive`;
    toast(failed > 0 ? `Gen xong · ghi ${written}/${ourN} (${failed} không sinh được — giữ nguyên cũ)` : (fillMiss ? `Đã gen ${written} level (${fillMiss} lấy fill gần nhất) ✓` : (offTol ? `Đã gen ${written} level (${offTol} lấy target gần nhất) ✓` : `Đã gen ${written} level ✓`)), failed > 0 ? "info" : "ok");
    refreshChartAll(); renderDatasets(); renderVersions(); renderSheetInfo();
  }

  /* ---- GEN DELTA: chỉ gen lại các level game ta LỆCH target (sau khi sửa đường độ khó) ---- */
  async function runDeltaGen() {
    if (ST.busy) return;
    const opp = L1K.Store.M.opponent.levels;
    if (!opp.length) { toast("Chưa nạp dữ liệu đối thủ", "error"); return; }
    const tol = clamp((v => Number.isFinite(v) ? v : 3)(parseInt($("l1kTol").value, 10)), 0, 40);
    const exact = false, maxArea = 0;
    const genOpts = readGenOpts();
    const ours = L1K.Store.M.ours.levels;
    const oursCurve = L1K.Store.M.curves.ours || (L1K.Store.M.curves.ours = []);

    // tìm level cần gen lại: sheet có target & (chưa có ours HOẶC |độ khó hiện tại - target| > tol)
    // CHỈ các level user VỪA kéo/sửa target (ST.pendingRegen) — không quét toàn bộ.
    const pending = Array.from(ST.pendingRegen || []).filter(lv => lv >= 1 && lv <= ST.total).sort((a, b) => a - b);
    if (!pending.length) { toast("Chưa có level nào bạn vừa kéo/sửa. Kéo điểm trên đồ thị (hoặc sửa target) rồi bấm lại.", "info"); return; }
    const todo = [];
    for (const lv of pending) {
      const t = L1K.Sheet.target(lv); if (t == null) continue;
      const g = ours[lv - 1];
      let srcIdx = (g && g._srcOpp) ? g._srcOpp - 1 : lv - 1;
      if (srcIdx < 0 || srcIdx >= opp.length) srcIdx = Math.min(Math.max(0, lv - 1), opp.length - 1);
      if (opp[srcIdx]) todo.push({ lv, src: opp[srcIdx], srcOpp: srcIdx + 1, target: t });
    }
    if (!todo.length) { toast("Level bạn vừa chỉnh chưa có target/nguồn hợp lệ", "info"); return; }
    if (!confirm(`Gen lại ${todo.length} level bạn vừa kéo/sửa? (các level khác giữ nguyên)`)) return;

    ST.busy = true; ST.cancel = false;
    $("l1kGenBtn").disabled = true; const dbtn = $("l1kGenDeltaBtn"); if (dbtn) dbtn.disabled = true;
    $("l1kGenCancel").style.display = "inline-flex";
    await L1K.Store.pushVersion(`trước resync ${todo.length} level lệch target`);
    renderVersions();

    const sources = todo.map(x => x.src), targets = todo.map(x => x.target);
    const startInfo = $("l1kGenInfo"); let lastDraw = 0;
    const res = await L1K.Gen.runRange(sources, targets, { steer: true, exact, tolerance: tol, maxArea: maxArea || 0, ...genOpts }, {
      shouldCancel: () => ST.cancel,
      onProgress: (done, total, ok, rate, eta, last) => {
        $("l1kGenBar").style.width = Math.round(done / total * 100) + "%";
        startInfo.textContent = `Resync ${done}/${total} · đạt ${ok} · ${rate.toFixed(1)} lv/s · còn ~${eta}s`;
        if (last) { const lvNo = todo[last.i - 1].lv; oursCurve[lvNo - 1] = last.score; }
        const tt = performance.now(); if (tt - lastDraw > 180) { lastDraw = tt; ST.chart && ST.chart.setData({ ours: oursCurve.slice() }); }
      }
    });

    // gen.js LẤY TARGET GẦN NHẤT (fill cứng) -> board đạt fill đều ghi; r.exactMiss = lệch quá sai số.
    let written = 0, sumErr = 0, maxErr = 0, offTol = 0;
    for (let k = 0; k < res.results.length; k++) {
      const r = res.results[k]; if (!r) continue;
      const lvNo = todo[k].lv, idx = lvNo - 1;
      const game = L1K.Gen.toGameLevelFromResult(r, lvNo);
      game._srcOpp = todo[k].srcOpp;
      L1K.Store.M.ours.levels[idx] = game; oursCurve[idx] = r.score; written++;
      ST.pendingRegen.delete(lvNo);   // đã gen lại -> gỡ khỏi danh sách chờ
      const e = Math.abs(r.score - todo[k].target); sumErr += e; maxErr = Math.max(maxErr, e); if (r.exactMiss) offTol++;
    }
    L1K.Store.M.ours.count = L1K.Store.M.ours.levels.filter(Boolean).length;
    L1K.Store.M.ours.updatedAt = Date.now();
    L1K.Store.markDirty("ours");
    await L1K.Store.persist("ours");
    await L1K.Store.setCurve("ours", oursCurve);

    ST.busy = false; ST.cancel = false;
    $("l1kGenBtn").disabled = false; if (dbtn) dbtn.disabled = false;
    $("l1kGenCancel").style.display = "none"; $("l1kGenBar").style.width = "100%";
    const failed = todo.length - written;
    const mae = written ? (sumErr / written).toFixed(1) : "—";
    const inTol = written - offTol;
    startInfo.textContent = `✓ Gen lại ${written}/${todo.length} level bạn vừa chỉnh · MAE ${mae} · lệch max ${maxErr} · ${inTol} trong sai số ±${tol}${offTol ? `, ${offTol} lấy TARGET GẦN NHẤT` : ""}`
      + (failed > 0 ? ` · ⚠ ${failed} level KHÔNG đạt fill — giữ nguyên nội dung cũ, thử tăng "Số lần thử"` : "")
      + ` · bấm "Đẩy game ta" để lưu Drive`;
    toast(failed > 0 ? `${written}/${todo.length} ghi · ${failed} KHÔNG đạt fill (giữ cũ)` : (offTol ? `Đã gen lại ${written} (${offTol} target gần nhất)` : `Đã gen lại ${written} level vừa chỉnh`), failed > 0 ? "info" : "ok");
    refreshChartAll(); renderDatasets(); renderVersions(); renderSheetInfo();
  }

  /* ===================== RENDER CÁC PANEL ===================== */
  function _num(id, dflt) { const e = $(id); const v = e ? parseInt(e.value) : NaN; return Number.isFinite(v) ? v : dflt; }
  function updateGenCount() {
    const el = $("l1kGenCount"); if (!el) return;
    const ourFrom = _num("l1kGenOurFrom", 1), ourTo = _num("l1kGenOurTo", ourFrom);
    const oppFrom = _num("l1kGenOppFrom", 1), oppTo = _num("l1kGenOppTo", oppFrom);
    const ourN = ourTo - ourFrom + 1, oppN = oppTo - oppFrom + 1;
    const ok = ourN === oppN && ourN > 0;
    el.innerHTML = `Game ta: <b>${ourN}</b> level · Đối thủ nguồn: <b>${oppN}</b> level — ` +
      (ok ? `<span style="color:var(--good)">khớp ✓</span>` : `<span style="color:var(--danger)">KHÔNG khớp ✕ (phải bằng nhau)</span>`);
  }
  function syncGenRanges() {   // đổi khoảng game ta / oppFrom -> tự chỉnh oppTo cho khớp số lượng
    const ot = $("l1kGenOppTo"); if (!ot) return;
    const ourFrom = _num("l1kGenOurFrom", 1), ourTo = _num("l1kGenOurTo", ourFrom), oppFrom = _num("l1kGenOppFrom", 1);
    ot.value = oppFrom + Math.max(0, ourTo - ourFrom);
    updateGenCount();
  }
  function renderDatasets() {
    const o = L1K.Store.M.opponent, u = L1K.Store.M.ours;
    const el = $("l1kDsInfo"); if (!el) return;
    el.innerHTML = `
      <div class="l1k-ds"><span class="l1k-ds-h">📁 Đối thủ (clone)</span>
        <b>${o.count}</b> level ${o.name ? "· " + o.name : ""} ${o.importedAt ? "· " + fmtTime(o.importedAt) : ""}</div>
      <div class="l1k-ds"><span class="l1k-ds-h">📁 Game ta</span>
        <b>${u.count}</b> level ${u.updatedAt ? "· cập nhật " + fmtTime(u.updatedAt) : "· (trống — sinh từ workflow)"}</div>`;
    // đồng bộ tổng số level theo đối thủ
    if (o.count) { ST.total = Math.max(o.count, 1); ["l1kGenOppFrom", "l1kGenOppTo"].forEach(id => { const e = $(id); if (e) e.max = o.count; }); const ot = $("l1kGenOppTo"); if (ot && !ot._touched) ot.value = Math.min(o.count, 100); }
    updateGenCount();
  }
  function renderSheetInfo() {
    const el = $("l1kSheetInfo"); if (!el) return;
    el.textContent = `Sheet target: đã đặt ${L1K.Sheet.count()} / ${ST.total} level. (Kéo neo để đặt hàng loạt; sửa từng level ở ô bên hoặc click điểm trên đồ thị.)`;
  }
  function renderVersions() {
    const host = $("l1kVersions"); if (!host) return;
    const vs = L1K.Store.listVersions();
    if (!vs.length) { host.innerHTML = `<div class="hint">Chưa có bản lưu. Mỗi lần gen sẽ tự tạo 1 bản để rollback.</div>`; return; }
    host.innerHTML = vs.map(v => `
      <div class="l1k-ver">
        <div class="l1k-ver-meta"><b>${v.label}</b><span>${fmtTime(v.ts)} · ${v.count} level</span></div>
        <div class="l1k-ver-act">
          <button data-roll="${v.id}">↩ Rollback</button>
          <button data-del="${v.id}" class="danger">✕</button>
        </div>
      </div>`).join("");
    host.querySelectorAll("[data-roll]").forEach(b => b.onclick = async () => {
      if (!confirm("Khôi phục game ta về bản này? (bản hiện tại sẽ được lưu lại trước)")) return;
      setBusy(true, "Đang rollback…");
      await L1K.Store.pushVersion("trước rollback");
      await L1K.Store.rollback(b.dataset.roll);
      L1K.Store.M.curves.ours = []; refreshChartAll(); renderDatasets(); renderVersions();
      setBusy(false); toast("Đã rollback game ta", "ok");
    });
    host.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { await L1K.Store.deleteVersion(b.dataset.del); renderVersions(); });
  }
  function renderSync() {
    const el = $("l1kSyncStatus"); if (!el) return;
    const s = L1K.Sync.status(), cur = L1K.Sync.current();
    const dot = s.state === "ok" ? "ok" : s.state === "error" ? "err" : "off";
    el.innerHTML = `<span class="l1k-dot ${dot}"></span> <b>${cur.name}</b> — ${s.text}`;
    // Link Sheet + folder (lấy từ health backend, fallback ID mặc định) — bấm mở luôn
    const lk = $("l1kBkLinks");
    if (lk) {
      const h = (L1K.Sync.providers.backend && L1K.Sync.providers.backend._health) || {};
      const D = (L1K.GoogleClient && L1K.GoogleClient.DEFAULTS) || {};
      const sheetId = h.sheetId || D.sheetId, folderId = h.folderId || D.folderId;
      const parts = [];
      if (sheetId) parts.push(`<a href="https://docs.google.com/spreadsheets/d/${sheetId}" target="_blank" rel="noopener">📊 Mở Google Sheet</a>`);
      if (folderId) parts.push(`<a href="https://drive.google.com/drive/folders/${folderId}" target="_blank" rel="noopener">📁 Mở folder Drive</a>`);
      lk.innerHTML = parts.join(' &nbsp;·&nbsp; ');
    }
    const sel = $("l1kSyncProvider"); if (sel) sel.value = L1K.Sync.currentId;
    const gc = $("l1kGoogleCfg"); if (gc) gc.style.display = L1K.Sync.currentId === "google" ? "block" : "none";
    const bk = $("l1kBackendCfg"); if (bk) bk.style.display = L1K.Sync.currentId === "backend" ? "block" : "none";
    if (L1K.Sync.currentId === "google" && L1K.GoogleClient) {
      const mode = L1K.GoogleClient.authMode || "oauth";
      const ms = $("l1kGMode"); if (ms) ms.value = mode;
      const ob = $("l1kGOAuthBox"); if (ob) ob.style.display = mode === "oauth" ? "block" : "none";
      const sb = $("l1kGSaBox"); if (sb) sb.style.display = mode === "sa" ? "block" : "none";
      const ci = $("l1kGClientId"); if (ci && L1K.GoogleClient.oauth.clientId && !ci.value) ci.value = L1K.GoogleClient.oauth.clientId;
      renderGLinks({ ok: true, sheetId: L1K.GoogleClient.cfg.sheetId, folderId: L1K.GoogleClient.cfg.folderId });
    }
  }
  function renderGLinks(health, prov) {
    const el = $("l1kGLinks"); if (!el) return;
    const sheetId = (prov && prov.config && prov.config.sheetId) || (health && health.sheetId);
    const folderId = (prov && prov.config && prov.config.folderId) || (health && health.folderId);
    const parts = [];
    if (sheetId) parts.push(`<a href="https://docs.google.com/spreadsheets/d/${sheetId}" target="_blank" rel="noopener">📊 Mở Sheet target</a>`);
    if (folderId) parts.push(`<a href="https://drive.google.com/drive/folders/${folderId}" target="_blank" rel="noopener">📁 Mở folder Drive</a>`);
    if (health && health.ok && !health.provisioned && !sheetId) parts.push(`<span class="hint">Chưa provision — bấm "Tạo Sheet/Folder".</span>`);
    el.innerHTML = parts.join(" &nbsp;·&nbsp; ");
  }

  /* ===================== NẠP / EXPORT DỮ LIỆU ===================== */
  async function ingestOpponent(files) {
    if (!files || !files.length) return;
    setBusy(true, "Đang đọc dữ liệu đối thủ…");
    try {
      const lv = await L1K.Gen.filesToLevels(files);
      if (!lv.length) { toast("Không thấy level hợp lệ", "error"); setBusy(false); return; }
      const name = files[0] ? files[0].name : "opponent";
      await L1K.Store.setOpponent(lv, name);
      ST.total = lv.length; ST.measuredOpp = false; ST.targetAnchors = [];
      ensureAnchors(); drawTargetCurve();
      refreshChartAll(); renderDatasets(); renderSheetInfo();
      toast(`Đã nạp ${lv.length} level đối thủ`, "ok");
    } catch (e) { console.error(e); toast("Lỗi đọc file: " + (e.message || e), "error"); }
    setBusy(false);
  }
  // Kéo dataset từ Drive (backend) về app. silent=true: dùng cho auto-pull lúc mở tab (không báo lỗi ồn).
  // Trả số level kéo được (0 nếu không có / lỗi). IndexedDB tách theo origin nên đổi cổng/máy -> kho rỗng,
  // cần kéo lại từ Drive (nguồn thật, độc lập origin).
  async function bkPull(which, label, silent) {
    try {
      if (!silent) setBusy(true, "Đang kéo " + label + " từ Drive…");
      const d = await L1K.Sync.providers.backend.pull(which);
      const lv = (d && Array.isArray(d.levels)) ? d.levels.filter(Boolean) : [];
      if (!lv.length) { if (!silent) toast("Drive chưa có dữ liệu " + label + " (hãy nạp file rồi ⬆ Đẩy)", "info"); if (!silent) setBusy(false); return 0; }
      if (which === "opponent") {
        await L1K.Store.setOpponent(lv, d.name || "opponent (Drive)");
        ST.total = lv.length; ST.measuredOpp = false; ST.targetAnchors = [];
        ensureAnchors(); drawTargetCurve();
      } else {
        await L1K.Store.setOurs(lv); L1K.Store.M.curves.ours = [];
      }
      refreshChartAll(); renderDatasets(); renderSheetInfo();
      if (!silent) toast(`Đã kéo ${lv.length} level ${label} từ Drive`, "ok");
      return lv.length;
    } catch (e) {
      if (!silent) toast("Kéo " + label + " lỗi: " + (e.message || e) + " (backend đang chạy?)", "error");
      return 0;
    } finally { if (!silent) setBusy(false); }
  }
  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function exportOurs() {
    const lv = L1K.Store.M.ours.levels.filter(Boolean);
    if (!lv.length) { toast("Game ta đang trống", "error"); return; }
    download(`gameta_levels_${lv.length}.json`, { levels: lv });
    toast(`Đã xuất ${lv.length} level game ta`, "ok");
  }
  function exportOpponent() {
    const lv = L1K.Store.M.opponent.levels;
    if (!lv.length) { toast("Chưa có dữ liệu đối thủ", "error"); return; }
    download(`opponent_levels_${lv.length}.json`, { levels: lv });
  }
  function exportSheet() { download("sheet_target.json", { rows: L1K.Sheet.exportRows(), updatedAt: L1K.Store.M.sheet.updatedAt }); }
  async function importSheet(file) {
    try { const d = JSON.parse(await file.text()); await L1K.Sheet.importRows(d.rows || d); ST.targetAnchors = []; ensureAnchors(); drawTargetCurve(); refreshChartTarget(); renderSheetInfo(); toast("Đã import sheet target", "ok"); }
    catch (e) { toast("File sheet không hợp lệ", "error"); }
  }
  async function importOurs(files) {
    try {
      const lv = await L1K.Gen.filesToLevels(files); if (!lv.length) { toast("Không thấy level", "error"); return; }
      await L1K.Store.pushVersion("trước import game ta");
      await L1K.Store.setOurs(lv); L1K.Store.M.curves.ours = [];
      refreshChartAll(); renderDatasets(); renderVersions(); toast(`Đã import ${lv.length} level vào game ta`, "ok");
    } catch (e) { toast("Lỗi import: " + (e.message || e), "error"); }
  }

  /* ===================== MOUNT ===================== */
  let mounted = false;
  function mount() {
    if (mounted) return; mounted = true;
    const host = $("seqView"); if (!host) return;
    host.innerHTML = template();
    bindEvents();
    // chart
    ST.chart = L1K.Chart.create($("l1kChart"), { onPointClick: onPointClick });
    ST.targetChart = L1K.Chart.create($("l1kTargetChart"), { hitSeries: "target", editable: true, onPointClick: onPointClick, onPointDrag: onTargetDrag, onPointDragEnd: onTargetDragEnd });
    ensureAnchors(); drawTargetCurve(); bindTargetCurve();
    refreshChartAll(); renderDatasets(); renderSheetInfo(); renderVersions(); renderSync(); updateGenCount();
    L1K.Store.on(() => { /* phản ứng thay đổi nếu cần */ });
  }

  function template() {
    return `
    <div class="l1k-wrap">
      <div class="l1k-overlay" id="l1kOverlay" style="display:none"><div class="l1k-spin"></div><div id="l1kOverlayText">Đang xử lý…</div></div>

      <!-- 1. DỮ LIỆU -->
      <div class="card l1k-card">
        <h2><span class="step-no">1</span> Dữ liệu &amp; Đồng bộ Google</h2>
        <div class="seq-drop" id="l1kOppDrop"><b>Kéo–thả</b> bộ <b>ĐỐI THỦ</b> để clone <small>(point_out_levels.json / pack / .zip)</small></div>
        <input type="file" id="l1kOppInput" accept=".json,.zip" multiple hidden />
        <div class="row" style="margin-top:8px">
          <button id="l1kOppPick">📁 Chọn file đối thủ</button>
        </div>
        <div class="l1k-dsinfo" id="l1kDsInfo" style="margin-top:10px"></div>
        <div class="l1k-sync-inline" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
          <div class="l1k-h3">Đồng bộ Google (backend chính chủ)</div>
          <div class="seq-info" id="l1kSyncStatus" style="margin-bottom:6px"></div>
          <div class="l1k-links" id="l1kBkLinks" style="margin-bottom:8px"></div>
          <div class="row" style="flex-wrap:wrap">
            <button id="l1kBkPullOpp">⬇ Kéo đối thủ (Drive)</button>
            <button id="l1kBkPushOpp" class="primary">⬆ Đẩy đối thủ (Drive)</button>
          </div>
        </div>
      </div>

      <!-- 2. SHEET TARGET -->
      <div class="card l1k-card">
        <h2><span class="step-no">2</span> Sheet độ khó target</h2>
        <div class="seq-curve-wrap"><canvas id="l1kTargetChart" style="width:100%;height:240px"></canvas></div>
        <div class="seq-legend">
          <span><i style="background:#5b9dff"></i> Đối thủ (đo)</span>
          <span><i style="background:#e0b84f"></i> Target</span>
          <span class="hint">· Lăn chuột = zoom · kéo nền = pan · double-click = reset · <b>kéo điểm vàng lên/xuống = sửa target (tự lưu Sheet)</b> · click điểm = sửa + gen lại</span>
        </div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap;align-items:center">
          <span class="hint">Nạp target:</span>
          <button id="l1kSeedOpp" title="Đặt target từng level = độ khó đo được của level đối thủ tương ứng">Bám độ khó đối thủ</button>
          <button id="l1kSeedSheet" title="Kéo độ khó target từ Google Sheet về app">Bám độ khó theo sheet</button>
        </div>
        <div class="row" style="margin-top:10px;align-items:flex-end;flex-wrap:wrap">
          <label class="fld" style="flex:0 0 auto">Sửa level <input type="number" id="l1kEditLv" min="1" value="1" style="width:76px" /></label>
          <label class="fld" style="flex:0 0 auto">Target <input type="number" id="l1kEditTgt" min="0" max="100" style="width:76px" /></label>
          <button id="l1kEditSave" class="primary">Lưu target</button>
          <button id="l1kSheetUpdate" title="Đẩy TOÀN BỘ đường target hiện tại lên Google Sheet (ghi đè)">⬆ Cập nhật Sheet</button>
        </div>
        <div class="seq-info" id="l1kSheetInfo" style="margin-top:8px"></div>
      </div>

      <!-- 3. ĐỒ THỊ 2 ĐƯỜNG -->
      <div class="card l1k-card">
        <h2><span class="step-no">3</span> Đồ thị độ khó (đối thủ vs game ta)</h2>
        <div class="row" style="margin-bottom:8px">
          <button id="l1kMeasureOpp">📏 Đo độ khó đối thủ</button>
          <button id="l1kMeasureOurs">📏 Đo lại game ta</button>
          <button id="l1kResetView">⟲ Reset zoom</button>
        </div>
        <div class="seq-curve-wrap"><canvas id="l1kChart" style="width:100%;height:260px"></canvas></div>
        <div class="seq-legend">
          <span><i style="background:#5b9dff"></i> Đối thủ</span>
          <span><i style="background:#4fd08a"></i> Game ta</span>
          <span><i style="background:#e0b84f"></i> Target</span>
          <span class="hint">· Lăn chuột = zoom · kéo = pan · double-click = reset · <b>click điểm xanh lá</b> = sửa độ khó + gen lại</span>
        </div>
        <div class="seq-info" id="l1kChartInfo" style="margin-top:8px"></div>
      </div>

      <!-- 4. WORKFLOW GEN -->
      <div class="card l1k-card">
        <h2><span class="step-no">4</span> Sinh bộ level (clone màu + bám target)</h2>
        <div class="row" style="align-items:flex-end;flex-wrap:wrap">
          <label class="fld" style="flex:0 0 auto">Game ta: từ <input type="number" id="l1kGenOurFrom" min="1" value="1" style="width:70px" /></label>
          <label class="fld" style="flex:0 0 auto">đến <input type="number" id="l1kGenOurTo" min="1" value="100" style="width:70px" /></label>
          <label class="fld" style="flex:0 0 auto">Clone đối thủ: từ <input type="number" id="l1kGenOppFrom" min="1" value="1" style="width:70px" /></label>
          <label class="fld" style="flex:0 0 auto">đến <input type="number" id="l1kGenOppTo" min="1" value="100" style="width:70px" /></label>
          <label class="fld" style="flex:0 0 auto" title="Chấp nhận lệch ±N so với target — TUYỆT ĐỐI, level lệch quá số này sẽ bị LOẠI (không sinh), không bao giờ ghi ra board sai target.">Sai số ± <input type="number" id="l1kTol" min="0" max="40" value="3" style="width:56px" /></label>
          <label class="fld" style="flex:0 0 auto" title="Tỉ lệ lấp đầy tối thiểu. Mặc định 98% (cho phép <100% để dễ đạt hơn nhiều, giữ vùng màu sạch hơn — không cần ép kín tuyệt đối).">Fill tối thiểu (%) <input type="number" id="l1kFillMin" min="50" max="100" value="98" style="width:64px" /></label>
          <label class="fld" style="flex:0 0 auto" title="Số lần THỬ LẠI tối đa cho MỖI level tới khi đạt đúng sai số. Board khó/lớn cần nhiều lần thử hơn mới trúng — cứ tăng số này nếu thấy nhiều level 'không sinh được' (đổi lại: chậm hơn/level, nhưng không ảnh hưởng level khác vì chạy song song).">Số lần thử/level <input type="number" id="l1kTries" min="1" max="2000" value="25" style="width:68px" /></label>
          <label class="fld" style="flex:0 0 auto" title="Lấp lỗ TỰ ĐỘNG (luôn bật). Lỗ kín TO hơn N ô = PHẦN CỦA HÌNH VẼ (mắt, lòng donut...) -> GIỮ; lỗ ≤ N ô (lẻ loi/slot/block) + lõm biên -> LẤP. Mặc định 8. Đặt 0 = lấp cả lỗ to (trừ lỗ đối xứng).">Giữ lỗ &gt; <input type="number" id="l1kHoleMax" min="0" max="999" value="8" style="width:56px" /> ô</label>
          <label class="chk" style="flex:0 0 auto" title="Lỗ nhỏ nhưng có BẠN ĐỐI XỨNG (gương qua trục dọc/ngang/tâm của hình) = hoạ tiết trang trí -> GIỮ nguyên. Tắt = lỗ nhỏ nào cũng lấp."><input type="checkbox" id="l1kHoleSym" checked /> Giữ lỗ đối xứng</label>
        </div>
        <div class="seq-info" id="l1kGenCount" style="margin-top:4px"></div>
        <div class="row" style="margin-top:8px;align-items:center;flex-wrap:wrap">
          <button id="l1kGenBtn" class="primary">⚙️ Sinh bộ level</button>
          <button id="l1kGenDeltaBtn" title="Chỉ gen lại các level bạn VỪA kéo/sửa target trên đồ thị (từ lần gen trước) — các level khác giữ nguyên">🔁 Gen lại level vừa kéo</button>
          <button id="l1kGenCancel" class="danger" style="display:none">■ Huỷ</button>
        </div>
        <div class="seq-prog" style="margin-top:10px"><i id="l1kGenBar"></i></div>
        <div class="seq-info" id="l1kGenInfo" style="margin-top:8px"></div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">
          <button id="l1kBkPushOurs" class="primary">⬆ Đẩy game ta (Drive + cập nhật Sheet)</button>
          <button id="l1kOursExport">⬇ Export game ta</button>
        </div>
        <div class="hint" style="margin-top:6px">Clone layout + <b>màu gốc y hệt</b> tab "Sinh hàng loạt → clone màu". Khi đặt rắn, engine <b>LUÔN thử độ dài tối đa trước</b> (chỉ ngắn dần khi không đặt được) — hạn chế rắn nhỏ vụn. Level lệch quá "Sai số" so với target Sheet sẽ <b>KHÔNG được sinh</b> (giữ nguyên nội dung cũ) thay vì chấp nhận "gần đúng". Quy ước: <b>game ta[ourFrom+k] = clone của đối thủ[oppFrom+k]</b> (2 khoảng phải bằng số lượng). Trước mỗi lần gen tự lưu 1 bản rollback. Đẩy game ta = lưu Drive + cập nhật độ khó thực đo lên Sheet.</div>
      </div>

      <!-- 5. VERSIONS -->
      <div class="card l1k-card">
        <h2><span class="step-no">5</span> Phiên bản / Rollback</h2>
        <div id="l1kVersions" class="l1k-vers"></div>
      </div>
    </div>`;
  }

  function bindEvents() {
    // 1. dữ liệu
    const oi = $("l1kOppInput"), od = $("l1kOppDrop");
    $("l1kOppPick").onclick = () => oi.click();
    od.onclick = () => oi.click();
    oi.onchange = () => { ingestOpponent(oi.files); oi.value = ""; };
    od.addEventListener("dragover", e => { e.preventDefault(); od.classList.add("drag"); });
    od.addEventListener("dragleave", () => od.classList.remove("drag"));
    od.addEventListener("drop", e => { e.preventDefault(); od.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) ingestOpponent(e.dataTransfer.files); });
    // (phần 1 chỉ còn nạp đối thủ + đẩy đối thủ; export/import game ta đã chuyển mục 4)

    // 2. sheet — nạp target
    $("l1kSeedOpp").onclick = async () => {
      const oc = L1K.Store.M.curves.opponent || [];
      if (!oc.filter(s => s != null).length) { toast("Hãy 'Đo độ khó đối thủ' trước (mục 3)", "error"); return; }
      const n = await L1K.Sheet.seedFromCurve(1, ST.total, L => { const v = oc[L - 1]; return v != null ? v : evalTargetAt(L); });
      refreshChartTarget(); renderSheetInfo();
      toast(`Đã đặt target = độ khó đối thủ cho ${n} level`, "ok");
    };
    { const ssb = $("l1kSeedSheet"); if (ssb) ssb.onclick = async () => {
      setBusy(true, "Đang kéo độ khó target từ Google Sheet…");
      try { const r = await L1K.Sync.providers.backend.pull("sheet"); await L1K.Sheet.importRows(r.rows || {}); refreshChartTarget(); renderSheetInfo(); loadEditLv(); toast("Đã nạp độ khó target từ Sheet", "ok"); }
      catch (e) { toast("Kéo từ Sheet lỗi: " + (e.message || e) + " (backend đang chạy?)", "error"); }
      setBusy(false);
    }; }
    // tự load target khi đổi level (thay nút "Tải")
    const elv = $("l1kEditLv"); if (elv) { elv.addEventListener("input", loadEditLv); loadEditLv(); }
    $("l1kEditSave").onclick = async () => {
      const lv = clamp(parseInt($("l1kEditLv").value) || 1, 1, ST.total);
      const v = clamp(parseInt($("l1kEditTgt").value) || 0, 0, 100);
      await L1K.Sheet.setTarget(lv, v, { force: true });
      ST.pendingRegen.add(lv);
      refreshChartTarget(); renderSheetInfo(); toast(`Đã lưu target level ${lv} = ${v}`, "ok");
    };
    { const su = $("l1kSheetUpdate"); if (su) su.onclick = async () => {
      setBusy(true, "Đang cập nhật toàn bộ Sheet…");
      try { const r = await L1K.Sync.providers.backend.pushSheetBulk(L1K.Sheet.exportRows(), ST.total); toast(r.ok ? `Đã cập nhật ${ST.total} level lên Sheet` : "Lỗi: " + r.text, r.ok ? "ok" : "error"); }
      catch (e) { toast("Cập nhật Sheet lỗi: " + (e.message || e) + " (backend đang chạy?)", "error"); }
      setBusy(false);
    }; }

    // 3. chart
    $("l1kMeasureOpp").onclick = measureOpponent;
    $("l1kMeasureOurs").onclick = measureOurs;
    $("l1kResetView").onclick = () => ST.chart && ST.chart.resetView();

    // 4. gen
    ["l1kGenOurFrom", "l1kGenOurTo", "l1kGenOppFrom"].forEach(id => { const e = $(id); if (e) e.addEventListener("input", syncGenRanges); });
    const gOppTo = $("l1kGenOppTo"); if (gOppTo) gOppTo.addEventListener("input", function () { this._touched = true; updateGenCount(); });
    $("l1kGenBtn").onclick = runWorkflow;
    { const db = $("l1kGenDeltaBtn"); if (db) db.onclick = runDeltaGen; }
    $("l1kGenCancel").onclick = () => { ST.cancel = true; };
    { const oe = $("l1kOursExport"); if (oe) oe.onclick = exportOurs; }

    // Đẩy dữ liệu lên Drive (đối thủ ở mục 1; game ta ở mục 4)
    const bkPush = async (which, label) => {
      if (which === "opponent" && !L1K.Store.M.opponent.levels.length) { toast("Chưa có dữ liệu đối thủ", "error"); return; }
      if (which === "ours" && !L1K.Store.M.ours.levels.filter(Boolean).length) { toast("Game ta đang trống", "error"); return; }
      setBusy(true, "Đang đẩy " + label + " lên backend…");
      try {
        const r = await L1K.Sync.providers.backend.push(which, which === "opponent" ? L1K.Store.M.opponent : L1K.Store.M.ours);
        let extra = "";
        if (which === "ours" && r.ok) {   // cập nhật độ khó THỰC ĐO của game ta lên Sheet (tab "game_ta")
          const arr = ensureOursMeasured();
          try { await L1K.Sync.providers.backend.pushDiff("game_ta", arr); extra = " + cập nhật độ khó Sheet"; } catch (e) {}
        }
        toast(r.ok ? r.text + extra : "Lỗi: " + r.text, r.ok ? "ok" : "error");
      } catch (e) { toast("Lỗi: " + (e.message || e), "error"); }
      setBusy(false);
    };
    const pOpp = $("l1kBkPushOpp"); if (pOpp) pOpp.onclick = () => bkPush("opponent", "đối thủ");
    const pOurs = $("l1kBkPushOurs"); if (pOurs) pOurs.onclick = () => bkPush("ours", "game ta");
    const pullOpp = $("l1kBkPullOpp"); if (pullOpp) pullOpp.onclick = () => bkPull("opponent", "đối thủ", false);
  }
  function loadEditLv() { const e = $("l1kEditLv"), t = $("l1kEditTgt"); if (!e || !t) return; const lv = clamp(parseInt(e.value) || 1, 1, ST.total); const r = L1K.Sheet.get(lv); t.value = r && r.target != null ? r.target : ""; }
  function ensureOursMeasured() {
    const lv = L1K.Store.M.ours.levels, arr = L1K.Store.M.curves.ours || (L1K.Store.M.curves.ours = []);
    for (let i = 0; i < lv.length; i++) { if (lv[i] && arr[i] == null) arr[i] = L1K.Gen.measure(lv[i]); }
    return arr;
  }

  /* ===================== TAB WIRING (thay cho sequence.js) ===================== */
  function showOthers(show) {
    [".board-area", ".side"].forEach(sel => { const el = document.querySelector(sel); if (el && !show) el.style.display = "none"; });
    ["batchView", "playControls", "playHint", "libPlayBar", "sg2View", "compareView"].forEach(id => { const el = $(id); if (el && !show) el.style.display = "none"; });
  }
  async function enterSeq() {
    showOthers(false); $("seqView").style.display = "block"; $("tabSeq").classList.add("tab-active");
    ["tabBatch", "tabPlay", "tabSG2", "tabCompare"].forEach(id => { const t = $(id); if (t) t.classList.remove("tab-active"); });
    await L1K.Store.ready(); await L1K.Sync.hydrate();
    await L1K.Sync.use("backend");   // mọi thứ qua backend chính chủ; không cấu hình trên UI
    mount();
    // AUTO-PULL: IndexedDB tách theo ORIGIN -> đổi cổng (8000->8001) hay mở máy khác thì kho local RỖNG
    // dù Drive vẫn còn dữ liệu. Nếu local trống, thử kéo đối thủ + game ta từ Drive (im lặng, không chặn UI).
    if (!L1K.Store.M.opponent.count) {
      try { if (await L1K.Sync.providers.backend.ping().then(h => h && h.loggedIn).catch(() => false)) {
        const n = await bkPull("opponent", "đối thủ", true);
        if (!L1K.Store.M.ours.count) await bkPull("ours", "game ta", true);
        if (n) toast(`Đã tự kéo ${n} level đối thủ từ Drive (kho máy này trống)`, "ok");
      } } catch (e) {}
    }
    // sau hydrate/pull: cập nhật total + redraw
    if (L1K.Store.M.opponent.count) ST.total = L1K.Store.M.opponent.count;
    drawTargetCurve(); refreshChartAll(); renderDatasets(); renderSheetInfo(); renderVersions(); renderSync(); updateGenCount();
    if (ST.chart) ST.chart.resize();
    if (ST.targetChart) ST.targetChart.resize();
    // Backend: tự kiểm tra khi mở tab (không popup, chỉ health-check)
    L1K.Sync.providers.backend.ping().then(() => renderSync()).catch(() => {});
  }
  function exitSeq() { const v = $("seqView"); if (v) v.style.display = "none"; const t = $("tabSeq"); if (t) t.classList.remove("tab-active"); }
  function init() {
    const ts = $("tabSeq"); if (!ts) return;
    ts.addEventListener("click", enterSeq);
    ["tabBatch", "tabPlay", "tabSG2", "tabCompare"].forEach(id => { const t = $(id); if (t) t.addEventListener("click", exitSeq); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  L1K.UI = { mount, enterSeq, toast };
})();
