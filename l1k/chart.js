/* =========================================================================
   1000 LEVELS · CHART  (L1K.Chart)
   ---------------------------------------------------------------------------
   Biểu đồ 2 đường độ khó (ĐỐI THỦ + GAME TA) trên CÙNG 1 trục, kèm đường
   TARGET (từ sheet). Hỗ trợ:
     - pan (kéo ngang) + zoom theo con lăn chuột (zoom quanh vị trí con trỏ)
     - double-click = reset view
     - click 1 điểm trên đường GAME TA -> callback(levelNo) để sửa độ khó + regen
     - LAZY: chỉ vẽ lại khi invalidate()/đổi view (coalesce bằng requestAnimationFrame)
   Component thuần, không phụ thuộc Store — UI bơm data vào qua setData().
   ========================================================================= */
(function () {
  "use strict";
  const L1K = (window.L1K = window.L1K || {});
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const PAD = { l: 40, r: 14, t: 14, b: 26 };
  const COL = {
    bg: "#0e1424", grid: "rgba(255,255,255,.08)", axis: "rgba(255,255,255,.5)",
    opp: "#5b9dff", ours: "#4fd08a", target: "#e0b84f", sel: "#ff6f8a"
  };

  function create(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const state = {
      opponent: [], ours: [], target: [], total: 1000,
      vx0: 1, vx1: 1000,          // miền level đang xem
      selected: null,             // levelNo đang chọn (highlight)
      _raf: 0, _w: 0, _h: 0
    };
    const HIT = opts.hitSeries || "ours";   // series được click (mặc định "ours"; mục 2 dùng "target")

    function plotW() { return state._w - PAD.l - PAD.r; }
    function plotH() { return state._h - PAD.t - PAD.b; }
    function xToPx(L) { return PAD.l + (L - state.vx0) / Math.max(1e-6, state.vx1 - state.vx0) * plotW(); }
    function pxToX(px) { return state.vx0 + (px - PAD.l) / Math.max(1, plotW()) * (state.vx1 - state.vx0); }
    function yToPx(v) { return PAD.t + plotH() - clamp(v, 0, 100) / 100 * plotH(); }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 720, cssH = canvas.clientHeight || 240;
      state._w = cssW; state._h = cssH;
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawSeries(arr, color, opt) {
      opt = opt || {};
      if (!arr || !arr.length) return;
      const lo = Math.max(0, Math.floor(state.vx0) - 1), hi = Math.min(arr.length - 1, Math.ceil(state.vx1));
      const span = state.vx1 - state.vx0;
      const step = span > 1400 ? Math.ceil(span / 1400) : 1;   // thưa hoá khi zoom xa (mượt)
      ctx.lineWidth = opt.width || 2; ctx.strokeStyle = color;
      if (opt.dash) ctx.setLineDash(opt.dash); else ctx.setLineDash([]);
      ctx.beginPath(); let started = false;
      for (let i = lo; i <= hi; i += step) {
        const v = arr[i]; if (v == null) { started = false; continue; }
        const x = xToPx(i + 1), y = yToPx(v);
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      }
      ctx.stroke(); ctx.setLineDash([]);
      // chấm điểm (chỉ khi đủ thưa để không rối)
      if (opt.dots && (hi - lo) / step <= 240) {
        ctx.fillStyle = color;
        for (let i = lo; i <= hi; i += step) { const v = arr[i]; if (v == null) continue; ctx.beginPath(); ctx.arc(xToPx(i + 1), yToPx(v), opt.dotR || 2.2, 0, 7); ctx.fill(); }
      }
    }

    function draw() {
      state._raf = 0;
      if (!state._w) resize();
      const W = state._w, H = state._h;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
      ctx.font = "10px sans-serif";
      // lưới ngang + nhãn Y
      [0, 20, 40, 60, 80, 100].forEach(v => {
        const y = yToPx(v); ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        ctx.fillStyle = COL.axis; ctx.fillText(String(v), 6, y + 3);
      });
      // mốc trục X (5 mốc theo view)
      ctx.fillStyle = COL.axis;
      for (let t = 0; t <= 4; t++) {
        const L = Math.round(state.vx0 + (state.vx1 - state.vx0) * t / 4);
        const x = clamp(xToPx(L), PAD.l, W - PAD.r);
        ctx.fillText(String(L), x - 8, H - 8);
      }
      // các đường
      drawSeries(state.opponent, COL.opp, { width: 1.8, dash: [4, 3] });
      drawSeries(state.target, COL.target, HIT === "target" ? { width: 2.2, dots: true, dotR: 2.4 } : { width: 1.6, dash: [2, 4] });
      if (HIT !== "target") drawSeries(state.ours, COL.ours, { width: 2.2, dots: true, dotR: 2.4 });
      // highlight level đang chọn
      if (state.selected != null && state.selected >= state.vx0 && state.selected <= state.vx1) {
        const x = xToPx(state.selected);
        ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke(); ctx.setLineDash([]);
        const v = state[HIT][state.selected - 1];
        if (v != null) { ctx.fillStyle = COL.sel; ctx.beginPath(); ctx.arc(x, yToPx(v), 4.2, 0, 7); ctx.fill(); }
      }
    }
    function requestDraw() { if (!state._raf) state._raf = requestAnimationFrame(draw); }

    /* ---------- hit-test điểm trên đường GAME TA ---------- */
    function nearestOurs(mx, my) {
      const arr = state[HIT]; if (!arr || !arr.length) return null;
      const lo = Math.max(0, Math.floor(state.vx0) - 1), hi = Math.min(arr.length - 1, Math.ceil(state.vx1));
      let best = -1, bd = 14 * 14;
      for (let i = lo; i <= hi; i++) { const v = arr[i]; if (v == null) continue; const dx = xToPx(i + 1) - mx, dy = yToPx(v) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      return best >= 0 ? best + 1 : null;
    }

    function pxToY(py) { return clamp((PAD.t + plotH() - py) / plotH() * 100, 0, 100); }

    /* ---------- tương tác ---------- */
    // mode = 'pan' (kéo nền) | 'point' (kéo 1 điểm để sửa giá trị — chỉ khi opts.editable)
    let dragging = false, moved = false, lastX = 0, downX = 0, downY = 0, mode = "pan", dragLevel = null;
    function localPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener("pointerdown", e => {
      const p = localPos(e); dragging = true; moved = false; lastX = p.x; downX = p.x; downY = p.y;
      const hit = opts.editable ? nearestOurs(p.x, p.y) : null;
      mode = hit ? "point" : "pan"; dragLevel = hit;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
      const p = localPos(e);
      if (dragging) {
        if (Math.abs(p.x - downX) + Math.abs(p.y - downY) > 4) moved = true;
        if (mode === "point" && dragLevel != null) {                 // kéo điểm -> đổi giá trị (live)
          const v = Math.round(pxToY(p.y));
          const arr = state[HIT]; if (arr) arr[dragLevel - 1] = v;
          state.selected = dragLevel; requestDraw();
          if (opts.onPointDrag) opts.onPointDrag(dragLevel, v);
          canvas.style.cursor = "ns-resize";
        } else {                                                     // kéo nền -> pan
          const dpx = p.x - lastX; lastX = p.x;
          const span = state.vx1 - state.vx0, shift = -dpx / Math.max(1, plotW()) * span;
          let nx0 = state.vx0 + shift, nx1 = state.vx1 + shift;
          if (nx0 < 1) { nx1 += 1 - nx0; nx0 = 1; }
          if (nx1 > state.total) { nx0 -= nx1 - state.total; nx1 = state.total; nx0 = Math.max(1, nx0); }
          state.vx0 = nx0; state.vx1 = nx1; requestDraw();
          canvas.style.cursor = "grabbing";
        }
      } else {
        canvas.style.cursor = nearestOurs(p.x, p.y) ? (opts.editable ? "ns-resize" : "pointer") : "crosshair";
      }
    });
    function endDrag(e) {
      if (!dragging) return; dragging = false; canvas.style.cursor = "crosshair";
      const p = localPos(e);
      if (mode === "point" && dragLevel != null) {
        if (moved) { if (opts.onPointDragEnd) opts.onPointDragEnd(dragLevel, Math.round(pxToY(p.y))); }
        else if (opts.onPointClick) { state.selected = dragLevel; requestDraw(); opts.onPointClick(dragLevel, { ours: state.ours[dragLevel - 1], target: state.target[dragLevel - 1] }); }
      } else if (!moved) {   // click nền (không kéo) trên điểm
        const L = nearestOurs(p.x, p.y);
        if (L != null && opts.onPointClick) { state.selected = L; requestDraw(); opts.onPointClick(L, { ours: state.ours[L - 1], target: state.target[L - 1] }); }
      }
      mode = "pan"; dragLevel = null;
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", () => { dragging = false; mode = "pan"; dragLevel = null; });
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const p = localPos(e); const Lc = pxToX(p.x);
      const factor = e.deltaY < 0 ? 0.82 : 1 / 0.82;
      let span = (state.vx1 - state.vx0) * factor;
      span = clamp(span, 4, state.total - 1);
      const frac = (p.x - PAD.l) / Math.max(1, plotW());
      let nx0 = Lc - frac * span, nx1 = nx0 + span;
      if (nx0 < 1) { nx1 += 1 - nx0; nx0 = 1; }
      if (nx1 > state.total) { nx0 -= nx1 - state.total; nx1 = state.total; }
      state.vx0 = Math.max(1, nx0); state.vx1 = Math.min(state.total, nx1); requestDraw();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => { resetView(); });

    function resetView() { state.vx0 = 1; state.vx1 = Math.max(2, state.total); requestDraw(); }

    /* ---------- API ---------- */
    function setData(d) {
      if (d.opponent) state.opponent = d.opponent;
      if (d.ours) state.ours = d.ours;
      if (d.target) state.target = d.target;
      if (d.total) {
        const changed = d.total !== state.total;
        state.total = d.total;
        // đổi tổng số level -> xem full extent cho dễ định hướng; chặn view vượt biên.
        if (changed) resetView();
        else if (state.vx1 > state.total) { state.vx1 = state.total; if (state.vx1 <= state.vx0) resetView(); }
      }
      requestDraw();
    }
    const api = {
      setData, draw: requestDraw, resetView,
      invalidate: requestDraw,
      resize() { resize(); requestDraw(); },
      select(L) { state.selected = L; requestDraw(); },
      view() { return { vx0: state.vx0, vx1: state.vx1 }; },
      setView(a, b) { state.vx0 = clamp(a, 1, state.total); state.vx1 = clamp(b, state.vx0 + 1, state.total); requestDraw(); }
    };
    resize(); requestDraw();
    window.addEventListener("resize", () => { resize(); requestDraw(); });
    return api;
  }

  L1K.Chart = { create, COL };
})();
