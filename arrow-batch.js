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
    maskImg: null, maskTainted: false, paint: new Set(), brush: 0, previewCell: 16, freeMask: null,
    curve: [{ t: 0, v: 12 }, { t: 1, v: 90 }],
    library: [], selection: new Set(), displayOrder: [],
    sort: "index", filter: "all",
    fillTarget: 100,   // fill 50–100 (=100 ép kín). (Đã bỏ minL/maxL — engine dùng mặc định minL=2, maxL=auto)
    diffMode: "curve", diffMin: 0, diffMax: 100,   // độ khó: 'curve' | 'range' (min..max; mặc định 0–100 = sao cũng được)
    cloneColorMap: null, cloneColorDominant: -1, clonePinned: null, cloneKeep: false, cloneExact: false, cloneSource: null,   // nhân bản: bản đồ màu; cloneKeep = bắt chước màu gốc; cloneExact = giữ NGUYÊN màu (không xoay hue)
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
  // ---------- Preset hình đặc biệt (heart/star/donut/puppy) — port từ tool anh ----------
  const PUPPY_ROWS = ["00111100000111100000","01111111111111111000","11111111111111111100","11111111111111111100","11111111111111111100","11111111111111111100","11111111111111111100","00111111111111100000","00111111111111100000","00111111111111100000","00011111111111100000","00001111111111101100","00001111111111111110","00001111111111111111","00001111111111111111","00001111111111111111","00000111111111111111","00000111111111111111","00001111111111111110","00011111111111111100","00011111001111111111"];
  function shapeGrid(t, W, H) {
    const g = Array.from({ length: H }, () => Array(W).fill(false));
    if (t === "heart") {
      const circR = W * 0.28, lx = W * 0.26, rx = W * 0.74, cy = H * 0.28, bottomY = H * 0.96, apexY = cy + circR * 0.35;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const px = x + 0.5, py = y + 0.5;
        const inL = (px - lx) ** 2 + (py - cy) ** 2 <= circR * circR, inR = (px - rx) ** 2 + (py - cy) ** 2 <= circR * circR;
        let inBody = false;
        if (py >= apexY && py <= bottomY) {
          const tp = Math.pow((py - apexY) / (bottomY - apexY), 1.4);
          const le = (lx - circR * 0.95) * (1 - tp) + (W / 2) * tp, re = (rx + circR * 0.95) * (1 - tp) + (W / 2) * tp;
          inBody = px >= le && px <= re;
        }
        if (inL || inR || inBody) g[y][x] = true;
      }
    } else if (t === "star") {
      const innerRatio = 0.42, vraw = [];
      for (let i = 0; i < 5; i++) {
        const aO = (-Math.PI / 2) + i * (Math.PI * 2 / 5); vraw.push([Math.cos(aO), Math.sin(aO)]);
        const aI = aO + Math.PI / 5; vraw.push([Math.cos(aI) * innerRatio, Math.sin(aI) * innerRatio]);
      }
      const xs = vraw.map(v => v[0]), ys = vraw.map(v => v[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const sx = (W - 1) / (maxX - minX), sy = (H - 1) / (maxY - minY);
      const verts = vraw.map(([x, y]) => [(x - minX) * sx, (y - minY) * sy]);
      const inStar = (px, py) => { let ins = false; for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) { const xi = verts[i][0], yi = verts[i][1], xj = verts[j][0], yj = verts[j][1]; if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inStar(x, y)) g[y][x] = true;
    } else if (t === "donut") {
      const cx = (W - 1) / 2, cy = (H - 1) / 2, oR = Math.min(W, H) / 2 - 0.5, iR = oR * 0.40;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= oR && d >= iR) g[y][x] = true; }
    } else if (t === "puppy") {
      const PR = PUPPY_ROWS.length, PC = PUPPY_ROWS[0].length;   // 21x20, scale nearest-neighbor về W×H
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const py = Math.min(PR - 1, Math.floor(y / H * PR)), px = Math.min(PC - 1, Math.floor(x / W * PC));
        if (PUPPY_ROWS[py][px] === "1") g[y][x] = true;
      }
    }
    return g;
  }
  function smoothGrid(g, W, H, passes) {   // bỏ ngạnh nhọn (nối ≤1 phía), lấp khe sâu (≥3 phía)
    const n4 = (m, x, y) => { let c = 0; for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < W && ny >= 0 && ny < H && m[ny][nx]) c++; } return c; };
    let m = g.map(r => [...r]);
    for (let p = 0; p < passes; p++) {
      const nm = m.map(r => [...r]); let ch = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!m[y][x] && n4(m, x, y) >= 3) { nm[y][x] = true; ch = true; }
        if (m[y][x] && n4(m, x, y) <= 1) { nm[y][x] = false; ch = true; }
      }
      m = nm; if (!ch) break;
    }
    return m;
  }
  function maskShape(t, W, H) {
    let g = shapeGrid(t, W, H);
    if (t === "heart" || t === "donut") g = smoothGrid(g, W, H, 4);
    const set = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x]) set.add(x + "," + y);
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
  // LAYOUT TỰ DO: các ô của 1 hình (vuông/tròn/thoi/tam giác) tâm (cx,cy), bán kính r.
  function shapeCells(type, cx, cy, r) {
    const out = [], t1 = Math.max(1, Math.round(r * 0.4));
    // ĐA GIÁC / SAO: dựng đỉnh (hệ tâm) 1 lần rồi point-in-polygon từng ô.
    const regPoly = (n, rot) => { const v = []; for (let i = 0; i < n; i++) { const a = rot + i * 2 * Math.PI / n; v.push([Math.cos(a) * r, Math.sin(a) * r]); } return v; };
    const starPoly = (n, inner) => { const v = []; for (let i = 0; i < n; i++) { const aO = -Math.PI / 2 + i * 2 * Math.PI / n, aI = aO + Math.PI / n; v.push([Math.cos(aO) * r, Math.sin(aO) * r], [Math.cos(aI) * r * inner, Math.sin(aI) * r * inner]); } return v; };
    let poly = null;
    if (type === "pentagon") poly = regPoly(5, -Math.PI / 2);
    else if (type === "heptagon") poly = regPoly(7, -Math.PI / 2);
    else if (type === "star5") poly = starPoly(5, 0.42);
    else if (type === "star4") poly = starPoly(4, 0.42);
    else if (type === "star6") poly = starPoly(6, 0.5);
    else if (type === "trapezoid") poly = [[-r, r], [r, r], [r * 0.45, -r], [-r * 0.45, -r]];
    else if (type === "parallelogram") poly = [[-r * 0.55, r], [r, r], [r * 0.55, -r], [-r, -r]];
    const inPoly = (px, py, vs) => { let ins = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { const xi = vs[i][0], yi = vs[i][1], xj = vs[j][0], yj = vs[j][1]; if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)) ins = !ins; } return ins; };
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy; let inS = false;
      if (poly) inS = inPoly(dx, dy, poly);
      else if (type === "square") inS = true;
      else if (type === "circle") inS = d2 <= r * r + r * 0.6;
      else if (type === "diamond") inS = Math.abs(dx) + Math.abs(dy) <= r;
      else if (type === "triangle") { const half = ((y - (cy - r)) / (2 * r || 1)) * r; inS = Math.abs(dx) <= half + 0.5; }   // tam giác đỉnh trên
      else if (type === "triDown") { const half = (((cy + r) - y) / (2 * r || 1)) * r; inS = Math.abs(dx) <= half + 0.5; }   // tam giác đỉnh dưới
      else if (type === "hexagon") inS = Math.abs(dy) <= r && Math.abs(dx) <= r - Math.max(0, Math.abs(dy) - r * 0.5);   // lục giác (thót 2 đầu)
      else if (type === "octagon") inS = Math.abs(dx) <= r && Math.abs(dy) <= r && Math.abs(dx) + Math.abs(dy) <= r * 1.5;   // bát giác
      else if (type === "plus") inS = Math.abs(dx) <= t1 || Math.abs(dy) <= t1;   // chữ thập
      else if (type === "exShape") inS = Math.abs(Math.abs(dx) - Math.abs(dy)) <= Math.max(1, r * 0.35);   // chữ X (2 đường chéo)
      else if (type === "hbar") inS = Math.abs(dy) <= Math.max(1, Math.round(r * 0.5));   // thanh ngang
      else if (type === "vbar") inS = Math.abs(dx) <= Math.max(1, Math.round(r * 0.5));   // thanh dọc
      else if (type === "ring") inS = d2 <= r * r && d2 >= (r * 0.6) * (r * 0.6);   // vành khuyên
      else if (type === "ell") inS = dx <= (-r + t1) || dy >= (r - t1);   // chữ L
      else if (type === "tee") inS = dy <= (-r + t1) || Math.abs(dx) <= Math.max(1, Math.round(t1 * 0.7));   // chữ T
      else if (type === "heart") { const tr = r * 0.5, ccy = -r * 0.28, apex = ccy + tr * 0.25, inL = (dx + r * 0.45) ** 2 + (dy - ccy) ** 2 <= tr * tr, inR = (dx - r * 0.45) ** 2 + (dy - ccy) ** 2 <= tr * tr; let inB = false; if (dy >= apex && dy <= r) { const tp = Math.pow((dy - apex) / ((r - apex) || 1), 1.3); inB = Math.abs(dx) <= r * (1 - tp); } inS = inL || inR || inB; }   // trái tim
      else if (type === "crescent") inS = d2 <= r * r && ((dx - r * 0.5) ** 2 + dy * dy) > (r * 0.92) * (r * 0.92);   // trăng lưỡi liềm
      else if (type === "drop") { const bcy = r * 0.25, br = r * 0.7, inBall = dx * dx + (dy - bcy) ** 2 <= br * br; let inTop = false; if (dy < bcy) { const tp = (bcy - dy) / ((bcy + r) || 1); inTop = Math.abs(dx) <= br * (1 - tp); } inS = inBall || inTop; }   // giọt nước
      else if (type === "arrow") { if (dy <= 0) inS = Math.abs(dx) <= (dy + r); else inS = Math.abs(dx) <= Math.max(1, Math.round(r * 0.35)); }   // mũi tên lên
      if (inS) out.push([x, y]);
    }
    return out;
  }
  // 1 ĐƠN VỊ hình: ĐẶC, hoặc RỖNG (viền) + 1 hình KHÁC bên trong (chừa khe) -> vẫn tính là 1 hình.
  function freeUnit(types, type, cx, cy, r, hollow) {
    const solid = shapeCells(type, cx, cy, r);
    if (!hollow || r < 5) return solid;
    const t = 2, inner = new Set(shapeCells(type, cx, cy, r - t).map(c => c[0] + "," + c[1]));
    const ring = solid.filter(([x, y]) => !inner.has(x + "," + y));   // viền = đặc − lõi
    const innerR = Math.floor((r - t) / 2);
    if (innerR >= 2) {
      const ic = shapeCells(types[rint(types.length)], cx, cy, innerR);   // hình bên trong (loại bất kỳ)
      const rf = new Set(); for (const [x, y] of ring) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) rf.add((x + dx) + "," + (y + dy));
      const innerCells = ic.filter(([x, y]) => !rf.has(x + "," + y));   // chừa khe ≥1 ô với viền
      if (innerCells.length >= 4) return ring.concat(innerCells);
    }
    return ring;
  }
  // Sinh nhiều hình KHÔNG CHẠM nhau. 2 kiểu: tâm tạo ĐA GIÁC ĐỀU (+tuỳ chọn 1 hình giữa) | RẢI ngẫu nhiên.
  function genFreeShapes(W, H) {
    const types = ["square", "circle", "diamond", "triangle", "triDown", "hexagon", "octagon", "plus", "hbar", "vbar",
      "pentagon", "heptagon", "star5", "star4", "star6", "trapezoid", "parallelogram", "exShape", "ring", "ell", "tee", "heart", "crescent", "drop", "arrow"];
    const occ = new Set(), forb = new Set();
    const add = cells => { for (const [x, y] of cells) { occ.add(x + "," + y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) forb.add((x + dx) + "," + (y + dy)); } };
    const fits = cells => cells.length >= 4 && !cells.some(([x, y]) => x < 0 || x >= W || y < 0 || y >= H || forb.has(x + "," + y));
    const unit = (cx, cy, r) => freeUnit(types, types[rint(types.length)], cx, cy, r, Math.random() < 0.35);
    let placed = 0;
    if (Math.random() < 0.5) {
      // ĐA GIÁC ĐỀU: tâm các hình = đỉnh đa giác đều quanh tâm bàn -> đường nối tâm là đa giác đều.
      const N = 3 + rint(4), cx0 = W / 2, cy0 = H / 2, R = Math.min(W, H) * (0.30 + Math.random() * 0.08), a0 = Math.random() * Math.PI * 2;
      const maxR = Math.max(2, Math.floor(R * Math.sin(Math.PI / N) - 1.5)), cap = Math.min(maxR, Math.floor(Math.min(W, H) / 4));
      for (let i = 0; i < N; i++) { const a = a0 + i * 2 * Math.PI / N, cx = Math.round(cx0 + R * Math.cos(a)), cy = Math.round(cy0 + R * Math.sin(a)); for (let tr = 0; tr < 25; tr++) { const cells = unit(cx, cy, 2 + rint(Math.max(1, cap - 1))); if (fits(cells)) { add(cells); placed++; break; } } }
      if (Math.random() < 0.55) { const cr = Math.max(2, Math.min(cap, Math.floor(R - maxR - 2))); for (let tr = 0; tr < 25; tr++) { const cells = unit(Math.round(cx0), Math.round(cy0), 2 + rint(Math.max(1, cr - 1))); if (fits(cells)) { add(cells); placed++; break; } } }   // hình GIỮA đa giác
    } else {
      // RẢI ngẫu nhiên 1..4 hình.
      const nShapes = 1 + rint(4);
      for (let i = 0; i < nShapes; i++) for (let tr = 0; tr < 50; tr++) {
        const rMax = Math.max(2, Math.floor(Math.min(W, H) / (nShapes > 1 ? 4 : 3))), r = 2 + rint(Math.max(1, rMax - 1));
        const cx = (r + 1) + rint(Math.max(1, W - 2 * (r + 1))), cy = (r + 1) + rint(Math.max(1, H - 2 * (r + 1)));
        const cells = unit(cx, cy, r); if (fits(cells)) { add(cells); placed++; break; }
      }
    }
    if (!placed) add(shapeCells("circle", W >> 1, H >> 1, Math.max(2, Math.floor(Math.min(W, H) / 3))).filter(([x, y]) => x >= 0 && x < W && y >= 0 && y < H));   // fallback: 1 hình giữa
    return occ;
  }
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
    if (t === "free") { if (!B.freeMask) B.freeMask = genFreeShapes(W, H); return new Set(B.freeMask); }   // nhiều hình rời (cố định cho cả batch; nút 🎲 đổi)
    if (t === "heart" || t === "star" || t === "donut" || t === "puppy") return scaleMask(maskShape(t, W, H), W, H, s);
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
  // Chế độ paint: ô TO (≥16px) + lưới rõ + cuộn; chế độ xem: vừa khung.
  function previewCellSize() {
    const m = Math.max(B.W, B.H);
    return B.layoutType === "paint" ? Math.max(16, Math.min(30, Math.floor(560 / m))) : Math.max(4, Math.floor(440 / m));
  }
  function drawCellPv(ctx, x, y, on, cell) {
    ctx.clearRect(x * cell, y * cell, cell, cell);   // xóa trước (màu bán trong suốt sẽ chồng lên nhau nếu không)
    ctx.fillStyle = on ? "rgba(79,159,255,0.34)" : "rgba(255,255,255,0.03)";
    ctx.fillRect(x * cell, y * cell, cell, cell);
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1;
    ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
  }
  function updateLayoutInfo(mask) {
    const W = B.W, H = B.H, m = mask !== undefined ? mask : currentMask();
    const area = m ? m.size : W * H, mg = marginCells();
    $b("bLayoutInfo").textContent = `Bàn ${W}×${H} · vùng đặt rắn ${area} ô · lề ${mg} ô`
      + (B.layoutType !== "paint" ? ` (${Math.round(B.scale * 100)}%)` : "")
      + ($b("bMother").checked && mg < 1 ? " · ⚠ lề 0 → rắn mẹ khó ôm, giảm kích thước" : "");
  }
  function renderPreview() {
    const cv = $b("bPreview"), W = B.W, H = B.H, cell = previewCellSize();
    B.previewCell = cell;
    cv.width = W * cell; cv.height = H * cell;
    cv.classList.toggle("paintable", B.layoutType === "paint");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const mask = currentMask();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawCellPv(ctx, x, y, mask ? mask.has(x + "," + y) : true, cell);
    updateLayoutInfo(mask);
  }
  function cellFromEvt(cv, e) {
    const r = cv.getBoundingClientRect(), cell = cv.width / B.W;
    const x = Math.floor((e.clientX - r.left) * (cv.width / r.width) / cell);
    const y = Math.floor((e.clientY - r.top) * (cv.height / r.height) / cell);
    if (x < 0 || y < 0 || x >= B.W || y >= B.H) return null;
    return { x, y };
  }
  // Tô/xóa 1 vùng cọ quanh (cx,cy); VẼ TỨC THÌ từng ô (không redraw cả canvas -> mượt khi kéo).
  function applyPaint(cx, cy, val) {
    const r = B.brush || 0, ctx = $b("bPreview").getContext("2d"), cell = B.previewCell;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= B.W || y >= B.H) continue;
      const k = x + "," + y;
      if (val) B.paint.add(k); else B.paint.delete(k);
      drawCellPv(ctx, x, y, val, cell);
    }
    updateLayoutInfo(new Set(B.paint));
  }
  let painting = false, paintVal = 1;
  (function wirePaint() {
    const cv = $b("bPreview");
    cv.addEventListener("pointerdown", e => {
      if (B.layoutType !== "paint") return;
      const c = cellFromEvt(cv, e); if (!c) return;
      painting = true; paintVal = B.paint.has(c.x + "," + c.y) ? 0 : 1;   // bắt đầu từ ô trống=tô, ô đã tô=xóa
      applyPaint(c.x, c.y, paintVal); cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", e => {
      if (!painting || B.layoutType !== "paint") return;
      const c = cellFromEvt(cv, e); if (c) applyPaint(c.x, c.y, paintVal);
    });
    cv.addEventListener("pointerup", () => { painting = false; });
    cv.addEventListener("pointercancel", () => { painting = false; });
  })();

  // ---------- Engine LẤP ĐẦY có-bảo-vệ-solvable (port từ tool teammate) ----------
  // Xây TĂNG DẦN: mỗi lần đặt rắn đều kiểm tra CẢ BÀN vẫn giải được (isSolvable nhanh, Int32 phẳng)
  // -> KHÔNG bao giờ tạo board KẸT -> nhanh + fill cao + luôn giải được. Trả [{id,dir,cells}] hoặc null.
  // placeGuard cho phép rắn TẠM bị chặn (miễn tồn tại thứ tự gỡ hết) -> chuỗi phụ thuộc = độ khó.
  function genFull(W, H, mask, params, target) {
    const tightBias = (target && target > 0) ? Math.max(0, Math.min(0.95, target / 100)) : 0.5;   // target cao -> siết mạnh
    const inMask = (x, y) => x >= 0 && x < W && y >= 0 && y < H && (!mask || mask.has(x + "," + y));
    const DIRN = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
    const board = [];
    for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push(inMask(x, y) ? 0 : null); board.push(row); }
    let TC = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (board[y][x] === 0) TC++;
    if (TC < 2) return null;
    const snakes = []; let sid = 1;
    const userMax = params ? +params.maxL || 0 : 0;
    const maxL = userMax >= 2 ? userMax : Math.max(6, Math.round(0.7 * (W + H)));   // Max Len người dùng; <2 = auto ~35% chu vi (không cap cứng)
    const fillTgt = (params && params.fill > 0) ? params.fill : 1;   // tỉ lệ phủ mục tiêu (1 = ép kín)
    // OPT-IN (mặc định TẮT -> hành vi gốc y hệt, tab Sinh hàng loạt KHÔNG đổi): luôn thử ĐỘ DÀI TỐI ĐA
    // trước ở mọi bước đặt rắn (thay vì phân phối ngẫu nhiên có trọng số); placeGuard() SẴN CÓ cơ chế
    // rút ngắn dần (for L=body.length xuống lo) khi không đặt được -> đúng "dài trước, hết chỗ mới ngắn".
    const longFirst = !!(params && params.longFirst);
    // LÁI CHỦ ĐỘNG theo Ý ĐỒ TRỌNG SỐ (computeDifficulty1000: span 30% = rắn dài/trải rộng -> khó):
    // lenBias 0..1 = mức thiên về rắn DÀI + THẲNG (span lớn). Mặc định suy từ target (target cao -> dài/thẳng,
    // thấp -> ngắn/cuộn); genLevelCore truyền params.lenBias để TỰ CHỈNH giữa các vòng thử theo sai số đo được.
    const lenBias = (params && params.lenBias != null) ? Math.max(0, Math.min(1, params.lenBias))
      : ((target && target > 0) ? Math.max(0.05, Math.min(0.95, target / 100)) : null);
    const userMin = params ? +params.minL || 2 : 2;
    const straightBias = 0.88, lo = Math.max(2, Math.min(maxL, userMin));   // sàn độ dài ở pha đặt chính
    // RẮN GHIM (clone): pre-đặt nguyên trạng, giữ màu; engine chỉ fill các ô CÒN LẠI quanh chúng.
    const pinned = (params && params.pinned) || null;
    if (pinned) for (const pp of pinned) {
      if (!pp.cells || pp.cells.length < 1) continue;
      let okp = true; for (const c of pp.cells) if (!(c.y >= 0 && c.y < H && c.x >= 0 && c.x < W) || board[c.y][c.x] !== 0) { okp = false; break; }
      if (!okp) continue;
      const id = sid++; for (const c of pp.cells) board[c.y][c.x] = id;
      snakes.push({ id, dir: pp.dir, cells: pp.cells.map(c => ({ x: c.x, y: c.y })), fixedColor: pp.fixedColor, ...(pp.mother ? { mother: true } : {}) });
    }
    const free = (x, y) => x >= 0 && x < W && y >= 0 && y < H && board[y][x] === 0;
    const dirOf = cells => (cells.length < 2 ? null : dirFromTo(cells[1], cells[0]));
    const curFill = () => snakes.reduce((a, s) => a + s.cells.length, 0) / TC;
    // VÙNG NGẦM (clone): mỗi rắn chỉ được nằm trong 1 vùng màu; rắn vùng này KHÔNG lấn vùng kia.
    const zoneMap = (params && params.zoneMap) || null;
    const zoneOf = (x, y) => zoneMap ? ((zoneMap[y] || [])[x]) : 0;
    const sameZone = (x1, y1, x2, y2) => !zoneMap || zoneOf(x1, y1) === zoneOf(x2, y2);

    function isSolvable() {   // solver "natural turn" trên lưới phẳng (nhanh)
      const N = W * H, grid = new Int32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = board[y][x]; grid[y * W + x] = (v === null) ? -1 : v; }
      const n = snakes.length; let remaining = n; const done = new Uint8Array(n); let t = 0;
      while (remaining > 0 && t < 500) {
        let moved = 0;
        for (let i = 0; i < n; i++) {
          if (done[i]) continue; const s = snakes[i], hd = DELTA[s.dir]; if (!hd) continue;
          let cx = s.cells[0].x + hd.x, cy = s.cells[0].y + hd.y, clear = true;
          while (cx >= 0 && cx < W && cy >= 0 && cy < H) { const v = grid[cy * W + cx]; if (v === -1 || v === 0) { cx += hd.x; cy += hd.y; continue; } clear = false; break; }
          if (clear) { for (const c of s.cells) grid[c.y * W + c.x] = 0; done[i] = 1; remaining--; moved++; }
        }
        if (!moved) return false; t++;
      }
      return remaining === 0;
    }
    function expLen() {   // 25% ngắn, 35% vừa, 40% dài (đuôi mũ)
      const r = Math.random(); let L;
      if (r < 0.25) L = Math.random() < 0.15 ? 2 : 3 + (Math.random() * 2 | 0);
      else if (r < 0.6) L = 5 + (Math.random() * 5 | 0);
      else L = 10 + Math.floor(-Math.log(Math.max(1e-9, Math.random())) / 0.07);
      return Math.max(lo, Math.min(maxL, L));   // tôn trọng sàn minL & trần maxL
    }
    // Chọn độ dài ứng viên THEO Ý ĐỒ: longFirst = luôn max; lenBias cao -> thiên dài (span lớn = khó),
    // thấp -> thiên ngắn (span nhỏ = dễ); không có ý đồ -> phân phối tự nhiên expLen (hành vi gốc).
    function pickLen() {
      if (longFirst) return maxL;
      if (lenBias == null) return expLen();
      const r = Math.random();
      if (r < lenBias * 0.8) return Math.max(lo, Math.min(maxL, Math.round(maxL * (0.6 + 0.4 * Math.random()))));   // chủ động DÀI
      if (r < lenBias * 0.8 + (1 - lenBias) * 0.5) return Math.max(lo, Math.min(maxL, lo + rint(3)));               // chủ động NGẮN
      return expLen();
    }
    function grow(sx, sy, primary, tlen, allowSet) {   // boustrophedon: đi thẳng rồi gấp; allowSet = giới hạn trong vùng (sửa lỗ)
      const path = [{ x: sx, y: sy }]; board[sy][sx] = -9; let cur = { x: sx, y: sy }, d = primary, run = 0;
      // Độ thẳng theo ý đồ span: bias cao -> chạy thẳng lâu (hộp bao rộng), thấp -> gấp sớm (cuộn gọn)
      const turnAfter = lenBias == null ? 5 + (Math.random() * 3 | 0) : Math.max(2, Math.round(2 + lenBias * 8 + Math.random() * 2));
      while (path.length < tlen) {
        let perp = d.dx !== 0 ? [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }] : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        if (Math.random() < 0.5) perp = [perp[1], perp[0]];
        const force = run >= turnAfter;
        const cands = force ? perp.concat([d]) : (Math.random() < straightBias ? [d].concat(perp) : perp.concat([d]));
        let moved = false;
        for (const dd of cands) { const nx = cur.x + dd.dx, ny = cur.y + dd.dy; if (nx >= 0 && nx < W && ny >= 0 && ny < H && board[ny][nx] === 0 && (allowSet ? allowSet.has(nx + "," + ny) : sameZone(nx, ny, sx, sy))) { run = (dd === d) ? run + 1 : 0; board[ny][nx] = -9; path.push({ x: nx, y: ny }); cur = { x: nx, y: ny }; d = dd; moved = true; break; } }
        if (!moved) break;
      }
      path.forEach(c => board[c.y][c.x] = 0);
      return path;
    }
    // Chất lượng PHỤ THUỘC của đầu rắn (cells[0], hướng dir): -1 nếu thoát thẳng ra rìa (không phụ thuộc);
    // else = perp*1000 + dist. perp=1 nếu rắn chặn cắt VUÔNG GÓC tia thoát (thân nó theo trục vuông góc tại ô chạm);
    // dist = số ô trống tới chỗ chạm (XA hơn = phụ thuộc tầm xa, ưu tiên). -> vuông góc + xa được ưu tiên.
    function depQuality(cells, dir, id) {
      const d = DELTA[dir], px = -d.y, py = d.x;   // (px,py) = trục vuông góc với hướng thoát
      let x = cells[0].x + d.x, y = cells[0].y + d.y, dist = 0;
      while (x >= 0 && y >= 0 && x < W && y < H) {
        const v = board[y][x];
        if (v > 0) {
          if (v === id) return -1;   // tự chặn (không xảy ra nếu solvable)
          const a1 = (x + px >= 0 && x + px < W && y + py >= 0 && y + py < H) ? board[y + py][x + px] : 0;
          const a2 = (x - px >= 0 && x - px < W && y - py >= 0 && y - py < H) ? board[y - py][x - px] : 0;
          const perp = (a1 === v || a2 === v) ? 1 : 0;   // rắn chặn có thân theo trục vuông góc -> cắt ngang
          return perp * 1000 + dist;
        }
        dist++; x += d.x; y += d.y;
      }
      return -1;   // tới rìa thông -> thoát ngay, không phụ thuộc
    }
    function placeGuard(body, preferBlocked) {   // thử orient & rút ngắn sao cho CẢ TẬP vẫn solvable
      // SIẾT: ưu tiên rắn có phụ thuộc TỐT NHẤT (vuông góc + xa) trong 2 hướng bản dài nhất, vẫn solvable.
      if (preferBlocked) {
        let best = null, bestScore = 0;   // chỉ nhận khi có phụ thuộc thật (dq >= 0)
        for (const cells of [body, body.slice().reverse()]) {
          if (cells.length < 2) continue;
          const dir = dirOf(cells); if (!dir) continue;
          const id = sid; for (const c of cells) board[c.y][c.x] = id;
          snakes.push({ id, dir, cells: cells.map(c => ({ x: c.x, y: c.y })) });
          const dq = isSolvable() ? depQuality(cells, dir, id) : -1;
          snakes.pop(); for (const c of cells) board[c.y][c.x] = 0;
          if (dq >= 0 && (!best || dq > bestScore)) { bestScore = dq; best = { cells: cells.map(c => ({ x: c.x, y: c.y })), dir }; }
        }
        if (best) { const id = sid; for (const c of best.cells) board[c.y][c.x] = id; snakes.push({ id, dir: best.dir, cells: best.cells }); sid++; return true; }
      }
      for (let L = body.length; L >= lo; L--) {
        for (const cells of [body.slice(0, L), body.slice(0, L).reverse()]) {
          if (cells.length < 2) continue;
          const dir = dirOf(cells); if (!dir) continue;
          const id = sid; for (const c of cells) board[c.y][c.x] = id;
          snakes.push({ id, dir, cells: cells.map(c => ({ x: c.x, y: c.y })) });
          if (isSolvable()) { sid++; return true; }
          snakes.pop(); for (const c of cells) board[c.y][c.x] = 0;
        }
      }
      return false;
    }
    function edgeCells() {   // viền THẬT của mask (đúng mọi hình)
      const e = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (board[y][x] !== 0) continue;
        for (const d of DIRN) { const nx = x + d.dx, ny = y + d.dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H || !inMask(nx, ny)) { e.push({ x, y }); break; } }
      }
      return e;
    }
    const allEmpty = () => { const a = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (board[y][x] === 0) a.push({ x, y }); return a; };
    function absorbEmpty() {   // vét tới fill mục tiêu: nối ô trống vào ĐUÔI rồi ĐẦU rắn kề; cụm ≥2 -> rắn mới
      const goalCells = fillTgt >= 1 ? TC : Math.ceil(fillTgt * TC);   // dừng khi đạt mục tiêu (=100% thì lấp hết)
      let pass = 0;
      while (pass++ < 10) {
        if (snakes.reduce((a, s) => a + s.cells.length, 0) >= goalCells) break;
        let changed = false; const empties = allEmpty(); if (!empties.length) break;
        for (const e of empties) {
          if (board[e.y][e.x] !== 0) continue; let done2 = false;
          for (const s of snakes) { const tl = s.cells[s.cells.length - 1];   // nối ĐUÔI (cùng vùng màu)
            if (Math.abs(tl.x - e.x) + Math.abs(tl.y - e.y) === 1 && sameZone(e.x, e.y, tl.x, tl.y)) { s.cells.push({ x: e.x, y: e.y }); board[e.y][e.x] = s.id; if (isSolvable()) { changed = done2 = true; break; } s.cells.pop(); board[e.y][e.x] = 0; } }
          if (done2) continue;
          for (const s of snakes) { const hd = s.cells[0];   // nối ĐẦU (cùng vùng màu)
            if (Math.abs(hd.x - e.x) + Math.abs(hd.y - e.y) === 1 && sameZone(e.x, e.y, hd.x, hd.y)) { s.cells.unshift({ x: e.x, y: e.y }); const o = s.dir; s.dir = dirOf(s.cells); board[e.y][e.x] = s.id; if (s.dir && isSolvable()) { changed = done2 = true; break; } s.cells.shift(); s.dir = o; board[e.y][e.x] = 0; } }
        }
        // KHÔNG dựng rắn từ cụm trống còn lại (cụm DFS không phải đường đi -> thân rắn bị chéo/dị dạng).
        // Nối-đuôi/đầu hết cỡ mà vẫn chưa đạt fill -> dừng; genLevelCore sẽ LOẠI board này và thử cách xếp khác.
        if (!changed) break;
      }
    }

    // BẪY THAO TÁC: đặt TRƯỚC một HÀNG ĐẦU rắn cùng QUAY RA — song song, liền kề, đều thoát được; thân mọc
    // VÀO TRONG bằng grow() (chiến thuật cũ, bẻ khúc tự nhiên). Sau khi fill xong sẽ đảo con GIỮA -> quay VÔ.
    const baitIds = [];
    if (params && params.trap) {
      const cards = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
      let best = null;   // đoạn viền-ra-được liền kề DÀI nhất trong 4 hướng
      for (const out of cards) {
        const along = out.dx !== 0 ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
        const okCell = (x, y) => x >= 0 && x < W && y >= 0 && y < H && board[y][x] === 0 && !inMask(x + out.dx, y + out.dy);
        const seen = new Set();
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!okCell(x, y) || seen.has(x + "," + y)) continue;
          const run = []; let cx = x, cy = y;
          while (okCell(cx, cy) && !seen.has(cx + "," + cy)) { seen.add(cx + "," + cy); run.push({ x: cx, y: cy }); cx += along.dx; cy += along.dy; }
          if (!best || run.length > best.run.length) best = { out, run };
        }
      }
      if (best && best.run.length >= 3) {
        const inward = { dx: -best.out.dx, dy: -best.out.dy };
        for (const cell of best.run) {
          if (board[cell.y][cell.x] !== 0) continue;
          const body = grow(cell.x, cell.y, inward, expLen());   // mọc thân vào trong (đầu = ô viền)
          if (body.length < 2) continue;
          if (!(body[0].x === cell.x && body[0].y === cell.y)) body.reverse();   // đầu = ô viền -> dir quay RA
          const dir = dirOf(body); if (!dir) continue;
          const id = sid; for (const c of body) board[c.y][c.x] = id;
          snakes.push({ id, dir, cells: body.map(c => ({ x: c.x, y: c.y })), bait: true });
          if (isSolvable()) { sid++; baitIds.push(id); } else { snakes.pop(); for (const c of body) board[c.y][c.x] = 0; }   // hỏng -> bỏ
        }
      }
    }

    // PHASE 1: rắn dài trước (sort giảm dần), 40% đầu bám viền (edge-first)
    // longFirst: mọi ứng viên = maxL (không phân phối ngẫu nhiên) -> LUÔN thử dài nhất trước tiên.
    const nTarget = Math.round(W * H / 8), targets = [];
    for (let i = 0; i < nTarget; i++) targets.push(pickLen());   // độ dài theo ý đồ trọng số (longFirst/lenBias/tự nhiên)
    targets.sort((a, b) => b - a);
    const skip = new Set();
    for (let ti = 0; ti < targets.length; ti++) {
      if (curFill() >= fillTgt) break;
      const empties = allEmpty().filter(c => !skip.has(c.x + "," + c.y));
      if (!empties.length) break;
      let seed, primary;
      if (ti < targets.length * 0.4) {
        const ec = edgeCells().filter(c => !skip.has(c.x + "," + c.y));
        seed = ec.length ? ec[rint(ec.length)] : empties[rint(empties.length)];
        let outDir = null;
        for (const d of DIRN) { const nx = seed.x + d.dx, ny = seed.y + d.dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H || !inMask(nx, ny)) { outDir = d; break; } }
        if (outDir) { const perp = outDir.dx !== 0 ? [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }] : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }]; primary = perp[rint(2)]; }
        else primary = DIRN[rint(4)];
      } else { seed = empties[rint(empties.length)]; primary = DIRN[rint(4)]; }
      const body = grow(seed.x, seed.y, primary, targets[ti]);
      if (body.length < 2 || !placeGuard(body, Math.random() < tightBias)) skip.add(seed.x + "," + seed.y);
    }
    // PHASE 2: lấp khe — mặc định ưu tiên rắn NGẮN (khe còn lại thường nhỏ/lẻ);
    // longFirst: VẪN thử maxL trước ở đây luôn -> placeGuard tự rút ngắn dần nếu khe không đủ chỗ.
    // NHẮM FILL: khi còn ít ô trống, ưu tiên seed ở ô "KẸT" (ít lân cận trống nhất) -> lấp túi/góc khó
    // TRƯỚC khi hết đường, tránh tự tạo lỗ mồ côi rồi mới đi vá.
    let guard = 0; const maxGuard = W * H * 3;
    while (guard++ < maxGuard) {
      if (curFill() >= fillTgt) break;
      const empties = allEmpty().filter(c => !skip.has(c.x + "," + c.y));
      if (!empties.length) break;
      let seed = empties[0];
      if (empties.length <= 60) {
        let bestN = 9;
        for (const c of empties) { let n = 0; for (const d of DIRN) if (free(c.x + d.dx, c.y + d.dy)) n++; if (n >= 1 && n < bestN) { bestN = n; seed = c; if (n === 1) break; } }
      }
      const tlen = longFirst ? maxL : (lenBias != null ? pickLen() : Math.max(lo, Math.min(maxL, lo + rint(4))));
      const body = grow(seed.x, seed.y, DIRN[rint(4)], tlen);
      if (body.length < 2 || !placeGuard(body, Math.random() < tightBias)) skip.add(seed.x + "," + seed.y);
    }
    // FILL BOOST B1: kéo dài đuôi rắn (giữ solvable, không vụn)
    { let changed = true, rounds = 0;
      while (changed && rounds++ < 30) {
        if (curFill() >= fillTgt) break; changed = false;
        for (const sn of snakes) {
          if (sn.cells.length >= maxL) continue;
          const tail = sn.cells[sn.cells.length - 1];
          for (const d of DIRN) { const nx = tail.x + d.dx, ny = tail.y + d.dy; if (free(nx, ny) && sameZone(nx, ny, tail.x, tail.y)) { sn.cells.push({ x: nx, y: ny }); board[ny][nx] = sn.id; if (isSolvable()) { changed = true; break; } sn.cells.pop(); board[ny][nx] = 0; } }
        }
      }
      // B2: nhồi rắn 2 ô vào ô lẻ, dừng khi rắn-ngắn > 12% (BỎ QUA nếu minL > 2 để tôn trọng sàn)
      if (lo <= 2) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (board[y][x] !== 0) continue;
        const cur2 = snakes.filter(s => s.cells.length === 2).length;
        if (snakes.length && cur2 / snakes.length >= 0.12) break;
        for (const d of DIRN) { const nx = x + d.dx, ny = y + d.dy; if (free(nx, ny) && sameZone(nx, ny, x, y)) { const cells = [{ x, y }, { x: nx, y: ny }], dir = dirOf(cells); if (!dir) break; const id = sid; for (const c of cells) board[c.y][c.x] = id; snakes.push({ id, dir, cells }); if (isSolvable()) { sid++; break; } snakes.pop(); for (const c of cells) board[c.y][c.x] = 0; } }
      }
    }
    if (fillTgt >= 0.95) absorbEmpty();   // chỉ vét tối đa khi fill cao; fill thấp giữ độ thưa
    if (fillTgt >= 0.999) {   // FILL 100% TUYỆT ĐỐI: mọi ô mask PHẢI có rắn — sửa lỗ CHỦ ĐỘNG theo cụm, leo thang 3 nấc
      // Nấc 1: nối ĐUÔI/ĐẦU rắn kề vào ô trống (thử cùng vùng màu trước, nới vùng sau).
      // Nấc 2: cụm trống >=2 ô -> mọc RẮN MỚI gói trong cụm (placeGuard tự rút ngắn, phần dư vòng sau xử tiếp).
      // Nấc 3: "gỡ & mọc lại" — nhấc 1 rắn kề cụm ra, gộp thân nó + cụm thành 1 vùng rồi lấp lại toàn vùng
      //         bằng rắn mới; không kín/không solvable -> hoàn tác nguyên trạng, thử rắn kề khác.
      const emptyClusters = () => {   // gom ô trống thành cụm 4-hướng, cụm NHỎ xử trước (khó lấp nhất)
        const em = allEmpty(), emp = new Set(em.map(c => c.x + "," + c.y)), seen = new Set(), out = [];
        for (const c of em) {
          const k0 = c.x + "," + c.y; if (seen.has(k0)) continue;
          const q = [c], cl = []; seen.add(k0);
          while (q.length) { const u = q.pop(); cl.push(u); for (const d of DIRN) { const nk = (u.x + d.dx) + "," + (u.y + d.dy); if (emp.has(nk) && !seen.has(nk)) { seen.add(nk); q.push({ x: u.x + d.dx, y: u.y + d.dy }); } } }
          out.push(cl);
        }
        return out.sort((a, b) => a.length - b.length);
      };
      const extendInto = (e, anyZone) => {   // nối 1 ô vào đuôi rồi đầu rắn kề (giữ solvable)
        if (board[e.y][e.x] !== 0) return true;
        for (const s of snakes) { if (s.mother) continue; const tl = s.cells[s.cells.length - 1];
          if (Math.abs(tl.x - e.x) + Math.abs(tl.y - e.y) === 1 && (anyZone || sameZone(e.x, e.y, tl.x, tl.y))) { s.cells.push({ x: e.x, y: e.y }); board[e.y][e.x] = s.id; if (isSolvable()) return true; s.cells.pop(); board[e.y][e.x] = 0; } }
        for (const s of snakes) { if (s.mother) continue; const hd = s.cells[0];
          if (Math.abs(hd.x - e.x) + Math.abs(hd.y - e.y) === 1 && (anyZone || sameZone(e.x, e.y, hd.x, hd.y))) { s.cells.unshift({ x: e.x, y: e.y }); const o = s.dir; s.dir = dirOf(s.cells); board[e.y][e.x] = s.id; if (s.dir && isSolvable()) return true; s.cells.shift(); s.dir = o; board[e.y][e.x] = 0; } }
        return false;
      };
      const fillRegion = region => {   // lấp 1 vùng (Set "x,y") bằng rắn mới; trả mảng rắn đã thêm (không kín -> caller tự xét)
        const added = []; let g2 = 0;
        while (g2++ < 60) {
          const rest = []; region.forEach(k => { const i2 = k.indexOf(","), x = +k.slice(0, i2), y = +k.slice(i2 + 1); if (board[y][x] === 0) rest.push({ x, y }); });
          if (!rest.length) break;
          let placed = false;
          for (const st of shuffle(rest.slice()).slice(0, 8)) {
            for (const d of shuffle(DIRN.slice())) {
              const body = grow(st.x, st.y, d, Math.max(2, rest.length), region);
              if (body.length >= 2 && placeGuard(body, false)) { added.push(snakes[snakes.length - 1]); placed = true; break; }
            }
            if (placed) break;
          }
          if (!placed) break;
        }
        return added;
      };
      const removeSnakes = list => { for (const ns of list) { const i2 = snakes.indexOf(ns); if (i2 >= 0) snakes.splice(i2, 1); for (const c of ns.cells) board[c.y][c.x] = 0; } };
      const trySteal = (cl, group) => {   // gỡ nhóm rắn 'group', gộp thân + cụm thành 1 vùng, lấp lại KÍN (3 lượt xáo); hỏng -> hoàn tác
        const region = new Set(cl.map(c => c.x + "," + c.y));
        for (const s of group) { if (snakes.indexOf(s) < 0) return false; for (const c of s.cells) region.add(c.x + "," + c.y); }
        for (const s of group) { snakes.splice(snakes.indexOf(s), 1); for (const c of s.cells) board[c.y][c.x] = 0; }
        for (let att = 0; att < 3; att++) {
          const added = fillRegion(region);
          let remain = false; region.forEach(k => { const i2 = k.indexOf(","), x = +k.slice(0, i2), y = +k.slice(i2 + 1); if (board[y][x] === 0) remain = true; });
          if (!remain && isSolvable()) return true;
          removeSnakes(added);   // lượt này không kín/không solvable -> gỡ rắn mới, xáo lại
        }
        for (const s of group) { for (const c of s.cells) board[c.y][c.x] = s.id; snakes.push(s); }   // hoàn tác nguyên trạng
        return false;
      };
      const stealRegrow = cl => {   // nấc 3: hy sinh 1 rắn kề (rồi leo thang CẶP 2 rắn) để chia lại vùng quanh lỗ
        const inCl = new Set(cl.map(c => c.x + "," + c.y));
        const adj = [];
        for (const s of snakes) {
          if (s.mother || s.bait || s.trap || s.fixedColor >= 1) continue;   // không đụng rắn ghim/mồi/mẹ
          let touch = false;
          for (const c of s.cells) { for (const d of DIRN) if (inCl.has((c.x + d.dx) + "," + (c.y + d.dy))) { touch = true; break; } if (touch) break; }
          if (touch) adj.push(s);
        }
        shuffle(adj);
        for (const s of adj.slice(0, 6)) if (trySteal(cl, [s])) return true;
        const K = Math.min(adj.length, 5);   // cặp 2 rắn kề: vùng gộp to hơn -> nhiều cách chia lại hơn hẳn
        for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) if (trySteal(cl, [adj[i], adj[j]])) return true;
        return false;
      };
      let round = 0;
      while (round++ < 12) {
        const cls = emptyClusters(); if (!cls.length) break;
        let progress = false;
        for (const cl of cls) {
          if (cl.some(c => board[c.y][c.x] !== 0)) { progress = true; continue; }   // vòng trước đã đụng vào cụm này -> gom lại vòng sau
          if (cl.length >= 2) {   // nấc 2 trước: rắn mới nằm gọn trong cụm
            const inCl = new Set(cl.map(c => c.x + "," + c.y));
            const added = fillRegion(inCl);
            if (added.length) { progress = true; continue; }
          }
          let any = false;
          for (const e of cl) if (board[e.y][e.x] === 0 && (extendInto(e, false) || extendInto(e, true))) any = true;   // nấc 1
          if (any) { progress = true; continue; }
          if (stealRegrow(cl)) progress = true;   // nấc 3
        }
        if (!progress) break;
      }
    }
    // BẪY: đảo con GIỮA hàng mồi -> quay VÔ; chỉ giữ nếu đầu mới BỊ CHẶN (click = va chạm) & bàn vẫn giải được.
    if (params && params.trap && baitIds.length >= 2) {
      const mid = (baitIds.length - 1) / 2;
      const ord = baitIds.map((id, i) => [id, Math.abs(i - mid)]).sort((a, b) => a[1] - b[1]).map(z => z[0]);   // giữa hàng trước, lan ra 2 bên
      for (const id of ord) {
        const s = snakes.find(z => z.id === id); if (!s || s.cells.length < 2) continue;
        const oc = s.cells, od = s.dir, rev = s.cells.slice().reverse(), nd = dirOf(rev);
        if (!nd || nd === od) continue;
        s.cells = rev; s.dir = nd;
        const dd = DELTA[nd]; let bx = rev[0].x + dd.x, by = rev[0].y + dd.y, blk = false;   // tia từ đầu MỚI: gặp ô bị chiếm trước rìa = bị chặn
        while (bx >= 0 && by >= 0 && bx < W && by < H) { const v = board[by][bx]; if (v > 0) { blk = true; break; } if (v === null) break; bx += dd.x; by += dd.y; }
        if (blk && isSolvable()) { s.trap = true; break; }   // quay vô bị chặn + bàn vẫn giải -> bẫy thật
        s.cells = oc; s.dir = od;   // không chặn / hỏng -> hoàn lại, thử con kế giữa
      }
    }
    if (snakes.length < 2) return null;
    return snakes.map((s, i) => ({ id: i + 1, dir: s.dir, cells: s.cells.map(c => ({ x: c.x, y: c.y })), ...(s.fixedColor >= 1 ? { fixedColor: s.fixedColor } : {}), ...(s.mother ? { mother: true } : {}), ...(s.bait ? { bait: true } : {}), ...(s.trap ? { trap: true } : {}) }));
  }

  // ---------- Sinh 1 level theo target (pure — dùng cả ở main thread & worker) ----------
  // genFull cho board GIẢI ĐƯỢC theo fill mục tiêu; fill=100 -> PHẢI KÍN TUYỆT ĐỐI (0 ô trống), khác -> ±3%.
  // Độ khó đo bằng computeDifficulty1000 (trọng số tab 1000 Levels: span 30%). Vòng thử LÁI CHỦ ĐỘNG:
  // đo xong lệch target thì chỉnh lenBias (thiên dài/ngắn) cho lần kế — không chỉ sinh random rồi lọc.
  function genLevelCore(W, H, mask, target, params) {
    const fullArea = mask ? mask.size : W * H;
    const wantFill = Math.round((params && params.fill > 0 ? params.fill : 1) * 100);   // % fill mục tiêu
    const MAX = wantFill >= 100 ? 6 : 4;   // ép kín tuyệt đối khó đạt hơn -> thêm lượt thử
    if (params && params.perLevelZones && typeof cutZones === "function") {   // MỖI LEVEL: chia vùng màu riêng
      const cells = new Set();
      if (mask) mask.forEach(k => cells.add(k)); else for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells.add(x + "," + y);
      // 75% LÁT CẮT đối xứng (sọc/quạt/đồng tâm/4 góc/chéo/X), 25% blob hữu cơ (Voronoi) cho đa dạng.
      const zm = (Math.random() < 0.75) ? cutZones(cells, W, H) : spatialZones(cells, W, H, clamp(3 + Math.round(cells.size / 130) + (rint(3) - 1), 2, 6), 8);
      params = Object.assign({}, params, { zoneMap: zm || null });   // confine gen + tô màu (đính kèm level)
    }
    let bestArr = null, bestDd = Infinity;
    // lenBias khởi từ target (span 30%: target cao = rắn dài/thẳng); mỗi vòng đo lệch -> đẩy bias ngược chiều lệch.
    let lenBias = (params && params.lenBias != null) ? params.lenBias : (target ? Math.max(0.05, Math.min(0.95, target / 100)) : null);
    for (let r = 0; r < MAX; r++) {
      const p2 = lenBias != null ? Object.assign({}, params, { lenBias }) : params;
      const arr = genFull(W, H, mask, p2, target);   // target -> ép siết tỉ lệ theo độ khó muốn (bẫy thao tác: layout tự nhiên, bẫy xử lý ở onAccept)
      if (!arr || arr.length < 2) continue;
      let cov = 0; for (const p of arr) cov += p.cells.length;   // rắn chỉ nằm trong mask -> cov = ô đã phủ
      const fillReal = fullArea ? Math.round(cov / fullArea * 100) : 0;
      if (wantFill >= 100 ? cov !== fullArea : Math.abs(fillReal - wantFill) > 3) continue;   // fill=100 -> KÍN TUYỆT ĐỐI (không còn nhận 97–99%); khác -> ±3%
      const pre = computeDifficulty1000(arr, W, H);   // trọng số 1000 Levels (span 30%) — thống nhất với tab 1000 Levels
      if (pre.tier === "KẸT") continue;   // genFull đảm bảo solvable nên gần như không xảy ra
      const dd = target ? Math.abs(pre.score - target) : 0;
      if (dd < bestDd) { bestDd = dd; bestArr = arr; }
      if (dd === 0) break;   // đã đúng điểm -> lấy luôn
      if (target && lenBias != null) {   // lái chủ động: thấp hơn target -> thiên dài/thẳng hơn (span tăng), cao hơn -> ngược lại
        const err = pre.score - target;
        if (err <= -3) lenBias = Math.min(0.95, lenBias + 0.18);
        else if (err >= 3) lenBias = Math.max(0.05, lenBias - 0.18);
      }
    }
    if (!bestArr) return null;
    const arr = bestArr;
    let mothers = [];
    if (params.mother) { mothers = buildMother(arr, W, H, 1, mask ? Array.from(mask) : null); if (mothers.length && !solve(arr.concat(mothers), W, H).solvable) mothers = []; }
    const all = arr.concat(mothers);
    const d = computeDifficulty1000(all, W, H);   // điểm hiển thị/slot cũng theo trọng số 1000 Levels
    if (d.tier === "KẸT") return null;
    const a = analyzeSolve(all, W, H);
    // ĐỈNH-KHÓ-TRONG-MÀN: ép khoảnh khắc khó nhất (chấm đỏ sparkline) rơi vào vùng muốn -> loại nếu lệch.
    let pac = null;
    if (params && params.intraPeak && typeof intraDifficulty === "function") {
      pac = intraDifficulty(all, W, H);
      const b = params.intraPeak;
      if (pac.T >= 3 && (pac.peak < b.min || pac.peak > b.max)) return null;
    }
    const area = mask ? mask.size : W * H;
    let covered = 0; for (const p of all) for (const c of p.cells) if (!mask || mask.has(c.x + "," + c.y)) covered++;
    const fillReal = area ? Math.round(covered / area * 100) : 0;
    const diffDelta = target ? Math.abs(d.score - target) : 0;
    return {
      w: W, h: H, par: all.length, score: d.score, tier: d.tier, emoji: d.emoji,
      fillReal, empty: Math.max(0, area - covered), turns: a.turns,
      t1Pct: all.length ? Math.round(a.t1Avail / all.length * 100) : 0, stuck: a.stuck,
      diffDelta,
      ...(pac && !(params && params.trap) ? { _pac: pac } : {}),   // pacing đã đo sẵn (đỡ tính lại ở thẻ); trap đảo hướng sau -> để thẻ tự tính lại
      ...(params && params.perLevelZones && params.zoneMap ? { zoneMap: params.zoneMap } : {}),   // vùng màu RIÊNG của level (để onAccept tô, rồi xoá)
      pieces: all.map(p => ({ dir: p.dir, cells: p.cells.map(c => [c.x, c.y]), ...(p.mother ? { mother: true } : {}), ...(p.fixedColor >= 1 ? { fixedColor: p.fixedColor } : {}), ...(p.bait ? { bait: true } : {}), ...(p.trap ? { trap: true } : {}) })),
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
  var L = m.targets.length, ti = m.n, nullStreak = 0;   // lệch + nhảy stride để phủ target khác nhau
  for (;;) {                            // nhà máy: sinh liên tục, stream level (kèm deltas); main quyết định nhận theo bậc
    var target = m.targets[((ti % L) + L) % L]; ti += m.stride;
    var lvl = genLevelCore(m.W, m.H, mask, target, m.params);   // map fill 100% giải-được, kèm điểm khó
    if (lvl) { lvl.target = target; self.postMessage(lvl); nullStreak = 0; }
    else { nullStreak++; if (nullStreak >= 60) { self.postMessage({ hb: 60 }); nullStreak = 0; } }  // báo "đã thử nhiều, chưa ra"
  }
};`;

  // Nguồn "lõi" (mọi hàm pure cần cho genFull/genLevelCore chạy trong Worker) — TÁCH RIÊNG khỏi
  // WORKER_MAIN để nơi khác (vd tab 1000 Levels) dựng Worker RIÊNG với logic nhận việc khác,
  // mà vẫn dùng ĐÚNG bộ closure đã kiểm chứng chạy đúng ở đây (khỏi lặp lại rủi ro thiếu hàm phụ thuộc).
  function buildCoreSrc() {
    const fns = [clamp, inBoard, solve, depMetrics, movableList, analyzeSolve, percRisk, percDynamic,
      regionSeparation, intraDifficulty, computeDifficulty, computeDifficulty1000, rint, shuffle, growSnake, snakeLen, generateMap, coverageCount, autoGenerate,
      traceBorder, motherFromLoop, connectedComponents, buildMother, dirFromTo, spatialZones, normalizeZones, cutZones, genFull, genLevelCore];
    let src = '"use strict";\n';
    src += "var DIRS=" + JSON.stringify(DIRS) + ";\n";
    src += "var DELTA=" + JSON.stringify(DELTA) + ";\n";
    src += "var MAXSNAKES=" + MAXSNAKES + ";\n";
    src += "var DIFF_TIERS=" + JSON.stringify(DIFF_TIERS) + ";\n";
    for (const f of fns) src += f.toString() + "\n";
    return src;
  }
  function buildWorkerURL() {
    if (B.workerURL) return B.workerURL;
    B.workerURL = URL.createObjectURL(new Blob([buildCoreSrc() + WORKER_MAIN], { type: "application/javascript" }));
    return B.workerURL;
  }
  function workerCount() {   // dùng HẾT số nhân CPU (bỏ trần 8) — vượt số nhân không nhanh hơn vì CPU-bound
    return Math.max(2, navigator.hardwareConcurrency || 4);
  }
  // VÉT CẠN CHÍNH XÁC: chỉ nhận map có điểm ĐÚNG BẰNG target (score===target, fill 100%), sinh VÔ HẠN tới khi đủ.
  // computeDifficulty tất định nên 1 board luôn ra cùng điểm -> khớp chính xác là hợp lệ.
  const STRICT_DIFF = 0;
  // Mỗi điểm trên curve = 1 SLOT có CHỈ SỐ i (giữ ĐÚNG vị trí đường cong). id level = startId + i,
  // nên dù worker hoàn thành lệch thứ tự thì id vẫn map đúng vị trí curve.
  function buildSlots(targets) { return targets.map((t, i) => ({ i, target: t, filled: false })); }
  // Tìm slot CHƯA đầy cho 1 điểm. range={min,max} -> nhận mọi điểm TRONG KHOẢNG (gắn slot trống bất kỳ);
  // else (đường cong) -> chỉ nhận điểm khớp |Δ|≤STRICT_DIFF với target slot gần nhất. Trả chỉ số slot, else -1.
  function matchSlot(score, slots, range) {
    if (range) {
      if (score < range.min || score > range.max) return -1;
      for (const s of slots) if (!s.filled) return s.i;
      return -1;
    }
    let bestI = -1, bestD = Infinity;
    for (const s of slots) { if (s.filled) continue; const d = Math.abs(s.target - score); if (d < bestD) { bestD = d; bestI = s.i; } }
    return (bestI >= 0 && bestD <= STRICT_DIFF) ? bestI : -1;
  }
  // Sinh SONG SONG kiểu STREAM: worker stream level; main gắn vào slot curve còn trống nếu điểm KHỚP CHÍNH XÁC.
  // resolve: 'done' | 'cancel' | 'fallback'  (KHÔNG có 'exhausted' — grind tới khi đủ).
  function runParallelStream(W, H, maskArr, targets, params, dedup, seen, count, onAccept, range) {
    return new Promise((resolve) => {
      let url; try { url = buildWorkerURL(); } catch (e) { resolve("fallback"); return; }
      const N = workerCount(), workers = [];
      const slots = buildSlots(targets);
      let dead = false, made = 0, tried = 0, lastPaint = 0;
      B.activeWorkers = workers;
      const finish = (r) => { if (dead) return; dead = true; workers.forEach(w => { try { w.terminate(); } catch (e) {} }); B.activeWorkers = null; B.cancelParallel = null; resolve(r); };
      B.cancelParallel = () => finish("cancel");
      const lbl = range ? `khoảng ${range.min}–${range.max}` : "điểm chính xác";
      const hint = () => { if (tried - lastPaint >= 200) { lastPaint = tried; $b("bProgInfo").textContent = `Vét cạn (${lbl})… ${made}/${count} đạt · đã thử ${tried}`; } };
      for (let i = 0; i < N; i++) {
        let w; try { w = new Worker(url); } catch (e) { finish("fallback"); return; }
        workers.push(w);
        w.onmessage = ev => {
          if (dead) return;
          const data = ev.data;
          if (data.hb) { tried += data.hb; hint(); return; }
          const lvl = data;
          if (dedup) { const sig = levelSignature(lvl.pieces); if (seen.has(sig)) { return; } seen.add(sig); }
          const slot = matchSlot(lvl.score, slots, range);
          if (slot >= 0) {
            slots[slot].filled = true;
            if (range) { lvl.target = null; lvl.diffDelta = 0; } else { lvl.target = slots[slot].target; lvl.diffDelta = Math.abs(lvl.score - lvl.target); }
            made = onAccept(lvl, slot);
            if (made >= count) finish("done");
          } else { tried++; hint(); }
        };
        w.onerror = () => finish("fallback");
        w.postMessage({ n: i, stride: N, W, H, maskArr, targets, params });
      }
      if (!workers.length) finish("done");
    });
  }
  // Tuần tự (fallback / tắt song song) — cùng cơ chế hạn ngạch + grind vô hạn.
  async function runSequentialStream(W, H, mask, targets, params, dedup, seen, count, onAccept, range) {
    const slots = buildSlots(targets), lbl = range ? `khoảng ${range.min}–${range.max}` : "điểm chính xác";
    let made = 0, idx = 0, iters = 0, tried = 0, lastPaint = 0;
    while (made < count && !B.cancel) {
      iters++;
      // ưu tiên nhắm vào slot CHƯA đầy (xoay vòng) để genFull có target kéo
      let pick = -1; for (let k = 0; k < slots.length; k++) { const j = (idx + k) % slots.length; if (!slots[j].filled) { pick = j; break; } }
      idx++; if (pick < 0) break;
      const lvl = genLevelCore(W, H, mask, slots[pick].target, params);
      let accepted = false;
      if (lvl) {
        let dup = false;
        if (dedup) { const sig = levelSignature(lvl.pieces); if (seen.has(sig)) dup = true; else seen.add(sig); }
        if (!dup) { const slot = matchSlot(lvl.score, slots, range); if (slot >= 0) { slots[slot].filled = true; if (range) { lvl.target = null; lvl.diffDelta = 0; } else { lvl.target = slots[slot].target; lvl.diffDelta = Math.abs(lvl.score - lvl.target); } made = onAccept(lvl, slot); accepted = true; } }
      }
      if (!accepted) { tried++; if (tried - lastPaint >= 100) { lastPaint = tried; $b("bProgInfo").textContent = `Vét cạn (${lbl})… ${made}/${count} đạt · đã thử ${tried}`; } }
      if (iters % 5 === 0 || made >= count) await new Promise(r => requestAnimationFrame(r));
    }
  }

  // ---------- Dải điểm thực tế của thư viện (tự cập nhật sau khi sinh / import) ----------
  function updateRangeInfo() {
    const el = $b("bMeasureInfo"); if (!el) return;
    if (!B.library.length) { el.textContent = ""; return; }
    let mn = 100, mx = 0, sum = 0, n = 0;
    for (const l of B.library) { if (l.score == null) continue; if (l.score < mn) mn = l.score; if (l.score > mx) mx = l.score; sum += l.score; n++; }
    el.innerHTML = n ? `Thư viện <b>${B.library.length}</b> level · khó <b>${mn}–${mx}</b> (TB ${Math.round(sum / n)})` : "";
  }

  // ---------- Sinh hàng loạt ----------
  async function runBatch() {
    if (B.generating) return;
    const mask = currentMask();
    if (B.layoutType === "image" && (!mask || !mask.size)) { $b("bProgInfo").textContent = "⚠ Mask ảnh rỗng — chỉnh ngưỡng/độ gắt."; return; }
    if (B.layoutType === "paint" && (!mask || !mask.size)) { $b("bProgInfo").textContent = "⚠ Chưa vẽ ô nào."; return; }
    const count = clamp(+$b("bCount").value, 1, 1000);
    // Kiểu độ khó: 'range' (min–max, nhận mọi điểm trong khoảng) | 'curve' (đúng từng điểm đường cong).
    let targets, range = null;
    const trapMode = B.diffMode === "trap";
    if (B.diffMode === "range" || trapMode) {
      let lo, hi;
      if (trapMode) { lo = 0; hi = 100; }   // bẫy thao tác: độ khó tự do, tập trung vào bẫy
      else { lo = clamp(B.diffMin, 0, 100); hi = B.diffMax > 0 ? clamp(B.diffMax, 0, 100) : 100; }
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      range = { min: lo, max: hi };
      targets = []; for (let i = 0; i < count; i++) targets.push(Math.round(lo + (hi - lo) * (count === 1 ? 0.5 : i / (count - 1))));   // rải đều trong khoảng để dẫn hướng sinh
    } else {
      targets = sampleCurve(B.curve, count);
    }
    const trapPerN = trapMode ? 8 : 30;   // bẫy thao tác: ~1 bẫy/8 rắn (nhiều); thường ~1/30
    const colorStyle = $b("bColorStyle") ? $b("bColorStyle").value : "pattern";   // 'pattern' | 'scatter' | 'mix'
    const W = B.W, H = B.H;
    // Vùng tô màu: clone -> B.cloneColorMap (cố định, để bắt chước/thiết kế); TỰ-GEN -> MỖI LEVEL tự chia
    // vùng NGẪU NHIÊN riêng (perLevelZones) -> pattern màu khác nhau từng level mà vẫn confine sạch.
    const cloneImitate = !!(B.cloneColorMap && B.cloneKeep);
    const genZoneMap = B.cloneColorMap || null;
    const perLevelZones = !genZoneMap;   // không phải clone -> mỗi level 1 cách chia vùng riêng
    const IP_BAND = { early: { min: 0, max: 0.42 }, mid: { min: 0.33, max: 0.67 }, late: { min: 0.55, max: 1 } };
    const intraPeak = IP_BAND[$b("bIntraPeak") ? $b("bIntraPeak").value : ""] || null;   // ép vị trí đỉnh-khó-trong-màn (chấm đỏ sparkline)
    const params = { diff: 50, mother: $b("bMother").checked, fill: clamp(B.fillTarget, 50, 100) / 100, minL: 2, maxL: 0, pinned: B.clonePinned || null, zoneMap: genZoneMap, perLevelZones, trap: trapMode, intraPeak };   // minL/maxL = MẶC ĐỊNH (đã bỏ 2 tham số "Dài tối thiểu/tối đa"); rắn GIỚI HẠN trong vùng -> màu liền mạch
    const dedup = true, startId = nextLibId();   // luôn bỏ trùng
    const wantParallel = typeof Worker !== "undefined" && count >= 8;   // luôn xử lý song song (tự fallback 1 luồng nếu bị chặn)

    B.generating = true; B.cancel = false;
    if (typeof colorMode !== "undefined" && colorMode !== "game") { colorMode = "game"; if (typeof syncColorBtn === "function") syncColorBtn(); }   // tô màu chuyên nghiệp -> luôn Màu Game
    $b("bGenerate").disabled = true; $b("bCancel").style.display = "inline-block";
    $b("bProgWrap").style.display = "block"; $b("bProgBar").style.width = "0%";
    renderLibrary();   // hiện thư viện hiện có + đặt observer để appendLibCard hoạt động

    const seen = new Set();
    let made = 0, mode = "1 luồng", errMsg = "", cancelled = false;
    // mỗi level ĐÚNG ĐIỂM + 100% fill -> id = startId + slot (map ĐÚNG vị trí curve, kể cả sinh lệch thứ tự).
    const onAccept = (lvl, slot) => {
      lvl.id = startId + slot; lvl.slot = slot;
      if (cloneImitate) applyCloneColors(lvl.pieces);            // clone KHÔNG tích -> bắt chước màu mẫu (như bản cũ, không bẫy)
      else { const st = colorStyle === "mix" ? (Math.random() < 0.5 ? "scatter" : "pattern") : colorStyle;   // theo Kiểu màu
        if (st === "scatter") scatterColor(lvl.pieces, W, H, trapPerN); else autoColor(lvl.pieces, W, H, lvl.zoneMap || genZoneMap, trapPerN); }
      if (lvl.zoneMap) delete lvl.zoneMap;   // chỉ dùng để tô, không lưu (đỡ nặng thư viện/export)
      if (trapMode) {   // bẫy thao tác: hàng mồi (genFull seed) + con bẫy CÙNG MÀU để trà trộn
        const bait = []; let hasTrap = false;
        lvl.pieces.forEach((p, i) => { if (p.bait || p.trap) { bait.push(i); if (p.trap) hasTrap = true; } });
        if (bait.length) { const col = lvl.pieces[bait[0]].fixedColor; if (col >= 1) bait.forEach(i => lvl.pieces[i].fixedColor = col); }   // cả hàng + con quay-vô đồng MỘT màu
        if (!hasTrap) injectDirTraps(lvl.pieces, W, H);   // genFull chưa dựng được bẫy -> thử post-process
      }
      B.library.push(lvl); B.selection.add(lvl.id); made++;
      appendLibCard(lvl);
      $b("bProgBar").style.width = Math.round(made / count * 100) + "%";
      $b("bProgInfo").textContent = `Đang sinh… ${made}/${count} đạt`;
      return made;
    };
    try {
      if (wantParallel) {
        const N = workerCount(); mode = N + " luồng";
        const r = await runParallelStream(W, H, mask ? Array.from(mask) : null, targets, params, dedup, seen, count, onAccept, range);
        if (r === "cancel") cancelled = true;
        else if (r === "fallback") {   // worker bị chặn/lỗi -> 1 luồng
          $b("bProgInfo").textContent = "⚠ Worker bị chặn — chuyển 1 luồng…"; mode = "1 luồng";
          await runSequentialStream(W, H, mask, targets, params, dedup, seen, count, onAccept, range); cancelled = B.cancel;
        }
      } else {
        await runSequentialStream(W, H, mask, targets, params, dedup, seen, count, onAccept, range); cancelled = B.cancel;
      }
    } catch (err) {
      errMsg = (err && err.message) ? err.message : String(err);
      console.error("[Sinh hàng loạt] LỖI:", err);
    } finally {
      B.generating = false; B.cancelParallel = null;
      $b("bGenerate").disabled = false; $b("bCancel").style.display = "none";
      $b("bProgInfo").textContent = errMsg
        ? "✗ Lỗi khi sinh: " + errMsg + " — mở Console (F12) xem chi tiết."
        : (cancelled ? "⛔ Đã hủy · " : `✓ Xong (${mode}) · `)
          + `${made}/${count} level · ` + (trapMode ? "BẪY thao tác (hàng đầu quay ra + 1 con quay vô va chạm)" : range ? `độ khó trong [${range.min}–${range.max}]` : "độ khó ĐÚNG curve")
          + (cancelled && made < count ? ` · còn thiếu ${count - made} (bấm Sinh để vét tiếp)` : "");
      setTimeout(() => { $b("bProgWrap").style.display = "none"; }, 1600);
      try { saveLibrary(); renderLibrary(); } catch (e2) { console.error("[Thư viện] lỗi render:", e2); }
    }
  }

  // ---------- Thumbnail ----------
  // Biểu đồ ĐƯỜNG pacing: trục x = lượt giải, y = độ khó lượt đó; chấm đỏ = lượt khó nhất.
  function drawSpark(cv, d, W, H, dpr) {
    const ctx = cv.getContext("2d"), n = d.length, pad = 1.5; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);   // vẽ theo DPR -> nét trên màn retina
    if (!n) return;
    const X = i => n === 1 ? W / 2 : pad + i / (n - 1) * (W - 2 * pad), Y = v => H - pad - v * (H - 2 * pad);
    ctx.beginPath(); ctx.moveTo(X(0), H); for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(d[i])); ctx.lineTo(X(n - 1), H); ctx.closePath();
    ctx.fillStyle = "rgba(111,211,176,0.14)"; ctx.fill();   // vùng dưới đường
    ctx.beginPath(); for (let i = 0; i < n; i++) { const x = X(i), y = Y(d[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = "#7fe3bf"; ctx.lineWidth = 1; ctx.lineJoin = "round"; ctx.stroke();
    let mi = 0; for (let i = 1; i < n; i++) if (d[i] > d[mi]) mi = i;
    ctx.beginPath(); ctx.arc(X(mi), Y(d[mi]), 1.5, 0, 7); ctx.fillStyle = "#ff6b5e"; ctx.fill();   // đỉnh khó nhất
  }
  function drawThumb(cv, lvl) {
    const ctx = cv.getContext("2d"), W = lvl.w, H = lvl.h, S = cv.width;
    const cell = S / Math.max(W, H), ox = (S - cell * W) / 2, oy = (S - cell * H) / 2;
    ctx.clearRect(0, 0, S, S);
    // lưới mờ (giao điểm = tâm ô); rắn vẽ TRÊN đường lưới
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = Math.max(0.5, cell * 0.04);
    for (let x = 0; x < W; x++) { ctx.beginPath(); ctx.moveTo(ox + (x + 0.5) * cell, oy + 0.5 * cell); ctx.lineTo(ox + (x + 0.5) * cell, oy + (H - 0.5) * cell); ctx.stroke(); }
    for (let y = 0; y < H; y++) { ctx.beginPath(); ctx.moveTo(ox + 0.5 * cell, oy + (y + 0.5) * cell); ctx.lineTo(ox + (W - 0.5) * cell, oy + (y + 0.5) * cell); ctx.stroke(); }
    lvl.pieces.forEach((p, i) => {
      const color = p.mother ? "#e8c25a" : ((colorMode === "game" && p.fixedColor >= 1 && gameColor(p.fixedColor)) || pieceColor(i));
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, cell * 0.34); ctx.lineCap = "round"; ctx.lineJoin = "round";
      const pts = p.cells.map(c => ({ x: ox + (c[0] + 0.5) * cell, y: oy + (c[1] + 0.5) * cell }));
      const d = DELTA[p.dir], h = pts[0], t = cell * 0.5, b = cell * 0.3, px = -d.y, py = d.x;
      if (pts.length > 1) {
        ctx.beginPath(); ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        for (let k = pts.length - 2; k >= 0; k--) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.stroke();
      }
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
    else list.sort((a, b) => a.id - b.id);   // "index" = theo đường cong (id = vị trí slot trên curve)
    return list;
  }
  function makeLibCard(lvl) {
    const card = document.createElement("div");
    card.className = "lib-card" + (B.selection.has(lvl.id) ? " sel" : "");
    const top = document.createElement("div"); top.className = "lc-top";
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.className = "lc-chk"; chk.checked = B.selection.has(lvl.id);
    chk.addEventListener("change", () => { chk.checked ? B.selection.add(lvl.id) : B.selection.delete(lvl.id); card.classList.toggle("sel", chk.checked); updateSelInfo(); });
    const badge = document.createElement("span"); badge.className = "tierbadge " + (TIER_CLASS[lvl.tier] || "tier0");
    badge.textContent = lvl.score + " " + (lvl.emoji || ""); badge.title = lvl.tier;
    top.append(chk, badge); card.appendChild(top);
    const cvWrap = document.createElement("div"); cvWrap.className = "lc-cv-wrap";
    const cv = document.createElement("canvas"); cv.width = 120; cv.height = 120; cv._level = lvl; if (io) io.observe(cv);
    const playOvl = document.createElement("div"); playOvl.className = "lc-play-overlay"; playOvl.textContent = "▶";
    cvWrap.append(cv, playOvl); card.appendChild(cvWrap);
    const meta = document.createElement("div"); meta.className = "lc-meta";
    meta.innerHTML = `<span>#${lvl.id}</span><span>${lvl.pieces.length} rắn${lvl.fillReal != null ? " · " + lvl.fillReal + "%" : ""}</span>`; card.appendChild(meta);
    // PACING trong màn: sparkline độ-khó-mỗi-lượt + nhãn hình dạng (đỉnh đầu/giữa/cuối…)
    const pac = lvl._pac || (lvl._pac = (typeof intraDifficulty === "function" ? intraDifficulty(normPieces(lvl.pieces).map((p, i) => (p.id = i + 1, p)), lvl.w, lvl.h) : null));
    if (pac && pac.T) {
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1)), cw = 84, ch = 16;
      const spark = document.createElement("canvas"); spark.width = Math.round(cw * dpr); spark.height = Math.round(ch * dpr); spark.style.cssText = `display:block;width:${cw}px;height:${ch}px;margin-top:2px;border-radius:2px`; drawSpark(spark, pac.d, cw, ch, dpr); card.appendChild(spark);
    }
    card.title = `Điểm ${lvl.score} ${lvl.tier}` + (lvl.target != null ? ` (muốn ${lvl.target})` : "")
      + `\nRắn: ${lvl.pieces.length} · Lấp đầy: ${lvl.fillReal != null ? lvl.fillReal + "%" : "—"} · Trống: ${lvl.empty != null ? lvl.empty + " ô" : "—"}`
      + `\nLượt giải: ${lvl.turns != null ? lvl.turns : "—"} · Thoát ngay lượt 1: ${lvl.t1Pct != null ? lvl.t1Pct + "%" : "—"} · Kẹt: ${lvl.stuck != null ? lvl.stuck : 0}`
      + (pac && pac.T ? `\nPacing: ${pac.label} · ${pac.T} lượt (sparkline: dễ=xanh, khó=đỏ)` : "");
    const act = document.createElement("div"); act.className = "lc-actions";
    const playB = document.createElement("button"); playB.textContent = "▶"; playB.title = "Chơi"; playB.addEventListener("click", () => playLibrary(lvl.id));
    const colB = document.createElement("button"); colB.textContent = "🎨"; colB.title = "Sửa màu từng rắn của level này"; colB.addEventListener("click", () => openColorEditor(lvl));
    const cloneB = document.createElement("button"); cloneB.textContent = "⧉"; cloneB.title = "Nhân bản: tạo hàng loạt cùng layout + độ khó ±3 + màu theo vùng"; cloneB.addEventListener("click", () => cloneLevel(lvl));
    const delB = document.createElement("button"); delB.textContent = "🗑"; delB.className = "danger"; delB.title = "Xóa"; delB.addEventListener("click", () => deleteLevel(lvl.id));
    act.append(playB, colB, cloneB, delB); card.appendChild(act);
    return card;
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
    for (const lvl of list) grid.appendChild(makeLibCard(lvl));
    updateSelInfo(); updateRangeInfo();
  }
  function appendLibCard(lvl) {   // STREAMING: thêm 1 card vào cuối lưới (không render lại cả lưới)
    const grid = $b("bLibGrid"); if (!grid) return;
    grid.appendChild(makeLibCard(lvl));
    $b("bLibCount").textContent = B.library.length;
    B.displayOrder.push(lvl.id);
  }
  function updateSelInfo() {
    $b("bSelInfo").textContent = `${B.selection.size} đã chọn / ${B.library.length}`;
    const vis = visibleList(), allSel = vis.length > 0 && vis.every(l => B.selection.has(l.id));
    const tg = $b("bSelToggle"); if (tg) tg.textContent = allSel ? "Bỏ chọn" : "Chọn hết";
  }
  function deleteLevel(id) { B.library = B.library.filter(l => l.id !== id); B.selection.delete(id); saveLibrary(); renderLibrary(); }

  // Tự lấp lỗ: ô TRỐNG mà cả 4 hàng xóm (trong bàn) đều thuộc mask -> thêm vào mask. Lặp tới ổn định.
  function autoFillHoles(cells, W, H) {
    const s = new Set(cells); let changed = true;
    while (changed) {
      changed = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = x + "," + y; if (s.has(k)) continue;
        let allIn = true;
        for (const d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const nx = x + d[0], ny = y + d[1]; if (nx < 0 || nx >= W || ny < 0 || ny >= H || !s.has(nx + "," + ny)) { allIn = false; break; } }
        if (allIn) { s.add(k); changed = true; }
      }
    }
    return s;
  }

  // Chia LAYOUT thành các VÙNG LỚN LIỀN MẠCH: BFS-Voronoi (lan theo ô KỀ từ K seed) -> mỗi vùng luôn liền mạch
  // (khác k-means Euclid có thể tách rời). Phần mask rời thêm vùng mới. Gộp vùng nhỏ tới khi ≤ CAP màu.
  function spatialZones(paint, W, H, K, CAP) {
    const D4 = [[0, -1], [0, 1], [-1, 0], [1, 0]], inP = k => paint.has(k);
    const cells = []; paint.forEach(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); cells.push([x, y]); });
    if (cells.length < 2) return null;
    K = Math.max(1, Math.min(K, cells.length)); CAP = CAP || 8;
    const d2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
    const seeds = [cells[Math.floor(Math.random() * cells.length)]];   // seed phân tán (farthest-point)
    while (seeds.length < K) { let best = cells[0], bd = -1; for (const c of cells) { let md = Infinity; for (const s of seeds) md = Math.min(md, d2(c, s)); if (md > bd) { bd = md; best = c; } } seeds.push(best); }
    const zm = Array.from({ length: H }, () => Array(W).fill(0));
    const q = []; seeds.forEach((s, i) => { if (zm[s[1]][s[0]] === 0) { zm[s[1]][s[0]] = i + 1; q.push(s); } });
    let head = 0;   // BFS đa nguồn theo ô kề -> vùng liền mạch
    while (head < q.length) { const [x, y] = q[head++], z = zm[y][x]; for (const d of D4) { const nx = x + d[0], ny = y + d[1]; if (nx < 0 || nx >= W || ny < 0 || ny >= H || !inP(nx + "," + ny) || zm[ny][nx] !== 0) continue; zm[ny][nx] = z; q.push([nx, ny]); } }
    let next = seeds.length + 1;   // phần rời chưa tới -> vùng mới (flood riêng)
    for (const [sx, sy] of cells) { if (zm[sy][sx] !== 0) continue; const z = next++; zm[sy][sx] = z; const q2 = [[sx, sy]]; let h2 = 0; while (h2 < q2.length) { const [x, y] = q2[h2++]; for (const d of D4) { const nx = x + d[0], ny = y + d[1]; if (nx < 0 || nx >= W || ny < 0 || ny >= H || !inP(nx + "," + ny) || zm[ny][nx] !== 0) continue; zm[ny][nx] = z; q2.push([nx, ny]); } } }
    // gộp vùng NHỎ vào vùng kề lớn nhất tới khi số vùng ≤ CAP (để mỗi vùng 1 màu riêng, không tái dùng)
    const cellsOf = new Map(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const z = zm[y][x]; if (z > 0) { (cellsOf.get(z) || cellsOf.set(z, []).get(z)).push([x, y]); } }
    while (cellsOf.size > CAP) {
      let small = null, ss = Infinity; for (const [z, cs] of cellsOf) if (cs.length < ss) { ss = cs.length; small = z; }
      const ac = new Map(); for (const [x, y] of cellsOf.get(small)) for (const d of D4) { const nx = x + d[0], ny = y + d[1]; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; const z = zm[ny][nx]; if (z > 0 && z !== small) ac.set(z, (ac.get(z) || 0) + 1); }
      let into = null, bc = -1; for (const [z, c] of ac) if (c > bc) { bc = c; into = z; }
      if (into === null) { for (const [z, cs] of cellsOf) if (z !== small && (into === null || cs.length > cellsOf.get(into).length)) into = z; }   // đảo rời: gộp vào vùng lớn nhất
      if (into === null) break;
      for (const c of cellsOf.get(small)) { zm[c[1]][c[0]] = into; cellsOf.get(into).push(c); } cellsOf.delete(small);
    }
    let id = 1; const remap = new Map(); for (const z of cellsOf.keys()) remap.set(z, id++);   // đánh lại 1..R
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const z = zm[y][x]; if (z > 0) zm[y][x] = remap.get(z); }
    return zm;
  }
  // Chuẩn hoá zoneMap thô: TÁCH mỗi nhãn thành các cụm LIỀN MẠCH (4-hướng) riêng -> gộp cụm NHỎ vào cụm
  // kề lớn nhất tới khi ≤ CAP -> đánh số 1..R. Giữ "cùng màu phải chạm nhau" cho mọi kiểu cắt.
  function normalizeZones(zm, W, H, CAP) {
    const D4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const comp = Array.from({ length: H }, () => Array(W).fill(0)); let next = 1; const cellsOf = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (zm[y][x] === 0 || comp[y][x] !== 0) continue;
      const lab = zm[y][x], id = next++, q = [[x, y]], list = []; comp[y][x] = id; let hi = 0;
      while (hi < q.length) { const [cx, cy] = q[hi++]; list.push([cx, cy]); for (const d of D4) { const nx = cx + d[0], ny = cy + d[1]; if (nx < 0 || nx >= W || ny < 0 || ny >= H || comp[ny][nx] !== 0 || zm[ny][nx] !== lab) continue; comp[ny][nx] = id; q.push([nx, ny]); } }
      cellsOf.set(id, list);
    }
    while (cellsOf.size > (CAP || 8)) {
      let small = null, ss = Infinity; for (const [z, cs] of cellsOf) if (cs.length < ss) { ss = cs.length; small = z; }
      const ac = new Map(); for (const [x, y] of cellsOf.get(small)) for (const d of D4) { const nx = x + d[0], ny = y + d[1]; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; const z = comp[ny][nx]; if (z > 0 && z !== small) ac.set(z, (ac.get(z) || 0) + 1); }
      let into = null, bc = -1; for (const [z, c] of ac) if (c > bc) { bc = c; into = z; }
      if (into === null) { for (const [z, cs] of cellsOf) if (z !== small && (into === null || cs.length > cellsOf.get(into).length)) into = z; }
      if (into === null) break;
      for (const c of cellsOf.get(small)) { comp[c[1]][c[0]] = into; cellsOf.get(into).push(c); } cellsOf.delete(small);
    }
    let id = 1; const remap = new Map(); for (const z of cellsOf.keys()) remap.set(z, id++);
    const out = Array.from({ length: H }, () => Array(W).fill(0));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const z = comp[y][x]; if (z > 0) out[y][x] = remap.get(z); }
    return out;
  }
  // Phân vùng bằng LÁT CẮT hình học ĐỐI XỨNG (thoả mãn thị giác): sọc dọc/ngang/chéo, múi quạt, đồng tâm,
  // 4 góc, chữ X. Random kiểu + số vùng -> mỗi level một bố cục cắt khác nhau, gọn gàng, cân đối.
  function cutZones(cells, W, H) {
    if (!cells || cells.size < 2) return null;
    let minx = W, maxx = 0, miny = H, maxy = 0;
    cells.forEach(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; });
    const spanx = maxx - minx + 1, spany = maxy - miny + 1, cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const modes = ["stripesV", "stripesH", "diagNW", "diagNE", "quad", "pie", "rings", "xcross", "frames", "grid", "cornerFan", "chevron", "diagGrid", "radial", "arch", "rotStripes", "wave", "spiral", "checker"], mode = modes[rint(modes.length)];
    const K = clamp(2 + rint(5), 2, 6);   // 2..6 dải/múi/vành
    const gk = clamp(2 + rint(3), 2, 4), corner = [[minx, miny], [maxx, miny], [minx, maxy], [maxx, maxy]][rint(4)];   // tham số cho grid / cornerFan
    // NGẪU NHIÊN HOÁ để 100 level tô khác nhau: phase lệch gốc + dải KHÔNG đều (ngưỡng random) + góc xoay tự do.
    const phase = Math.random();                                   // dịch gốc dải/múi/vành mỗi level
    const bnd = []; for (let i = 0; i < K - 1; i++) bnd.push(Math.random()); bnd.sort((a, b) => a - b);   // ranh giới dải KHÔNG đều
    const band = t => { t = ((t % 1) + 1) % 1; let n = 0; for (const b of bnd) if (t >= b) n++; return n; };   // 0..K-1 theo dải không đều
    const ang = Math.random() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang), wav = 0.12 + Math.random() * 0.25, freq = 1 + rint(3);   // rotStripes/wave
    const labelOf = (x, y) => {
      const dx = x - cx, dy = y - cy, nx = (x - minx) / (spanx || 1), ny = (y - miny) / (spany || 1);
      if (mode === "stripesV") return band(nx + phase);
      if (mode === "stripesH") return band(ny + phase);
      if (mode === "diagNW") return band((nx + ny) / 2 + phase);          // cắt chéo \
      if (mode === "diagNE") return band((nx + (1 - ny)) / 2 + phase);    // cắt chéo /
      if (mode === "rotStripes") return band((nx * ca + ny * sa) + phase);                        // dải XOAY góc tự do
      if (mode === "wave") return band(nx + wav * Math.sin((ny + phase) * Math.PI * 2 * freq) + phase);   // dải LƯỢN sóng
      if (mode === "spiral") { const a = Math.atan2(dy, dx) / (2 * Math.PI), r = Math.hypot(dx / (spanx / 2 || 1), dy / (spany / 2 || 1)); return band(a + r * (1 + rint(1)) + phase); }   // xoáy ốc
      if (mode === "checker") { const gx = Math.floor((nx + phase) * gk), gy = Math.floor((ny + phase) * gk); return (gx + gy) % 2 === 0 ? 0 : 1 + ((gx * 7 + gy) % Math.max(1, K - 1)); }   // caro pha
      if (mode === "quad") return (dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0);                            // 4 góc (đối xứng tâm)
      if (mode === "pie") { let a = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI); return band(a + phase); }   // múi quạt (pha xoay)
      if (mode === "rings") { const r = Math.hypot(dx / (spanx / 2 || 1), dy / (spany / 2 || 1)); return Math.min(K - 1, band(r * 0.5 + phase * 0.15) ); }   // đồng tâm (ranh không đều)
      if (mode === "frames") { const r = Math.max(Math.abs(dx) / (spanx / 2 || 1), Math.abs(dy) / (spany / 2 || 1)); return Math.min(K - 1, band(r * 0.5 + phase * 0.15)); }   // khung VUÔNG đồng tâm
      if (mode === "grid") return Math.floor((nx + phase / gk) % 1 * gk) + gk * Math.floor((ny + phase / gk) % 1 * gk);   // lưới ô (patchwork, pha)
      if (mode === "cornerFan") { const a2 = Math.atan2(Math.abs(y - corner[1]), Math.abs(x - corner[0])) / (Math.PI / 2 + 1e-9); return band(a2 + phase); }   // quạt từ 1 góc
      if (mode === "chevron") return band((Math.abs(dx) / (spanx / 2 || 1) + ny) * 0.5 + phase);   // dải chữ V
      if (mode === "diagGrid") { const a = Math.min(gk - 1, Math.floor(((nx + ny) / 2 + phase) % 1 * gk)), b = Math.min(gk - 1, Math.floor(((nx + (1 - ny)) / 2 + phase) % 1 * gk)); return a + gk * b; }   // patchwork thoi 45°
      if (mode === "radial") { const rr = Math.min(1, Math.floor(Math.hypot(dx / (spanx / 2 || 1), dy / (spany / 2 || 1)) + phase * 0.3)); return rr * 4 + (dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0); }   // bia: vành × góc phần tư
      if (mode === "arch") return Math.min(K - 1, band(Math.hypot((x - cx) / (spanx / 2 || 1), (y - maxy) / (spany || 1)) * 0.5 + phase * 0.15));   // vòng cung (cầu vồng)
      return (Math.abs(dx) * spany >= Math.abs(dy) * spanx) ? (dx >= 0 ? 0 : 1) : (dy >= 0 ? 2 : 3);   // xcross: 4 tam giác
    };
    const zm = Array.from({ length: H }, () => Array(W).fill(0));
    cells.forEach(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); zm[y][x] = labelOf(x, y) + 1; });
    return normalizeZones(zm, W, H, 8);
  }
  // Lan màu: ô mask chưa có màu (lỗ/đệm) -> nhận màu của VÙNG MÀU gần nhất (BFS đa nguồn) -> mọi ô có 1 vùng.
  function floodZones(cm, paint, W, H) {
    const q = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cm[y][x] >= 1) q.push([x, y]);
    if (!q.length) return; let head = 0;
    while (head < q.length) {
      const [x, y] = q[head++], col = cm[y][x];
      for (const d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const nx = x + d[0], ny = y + d[1];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H || !paint.has(nx + "," + ny) || cm[ny][nx] >= 1) continue;
        cm[ny][nx] = col; q.push([nx, ny]);
      }
    }
  }

  /* ===== LẤP LỖ THÔNG MINH (nguồn DÙNG CHUNG cho tab Sinh hàng loạt + 1000 Levels) =====
     autoFillHoles cũ chỉ lấp ô bị bao ĐỦ 4 phía -> lỗ >=2 ô không lấp được + lấp mọi lỗ 1 ô (kể cả hoạ tiết).
     Bản này lấp lỗ MỌI cỡ theo PHÂN LOẠI (đo 2882 level đối thủ: 89% có lỗ, đa số là hoạ tiết):
       GIỮ  lỗ TO (> holeMax ô, mặc định 3) = phần hình vẽ (mắt/lòng donut);
       GIỮ  lỗ có BẠN ĐỐI XỨNG (gương tâm lỗ qua trục hình, chặt ±0.5, + cổng >=50% lỗ nhỏ mới coi là hoa văn);
       LẤP  lỗ nhỏ lẻ loi (<=holeMax) + HỐC BIÊN: (a) LỖ BIÊN NHIỀU Ô (lõm block nối ra ngoài, trong bbox
            hình, <=holeMax ô -> lấp; lõm to như chữ U giữ); (b) rãnh cụt/lõm 1 ô (giáp mask >=3 cạnh).
     opts: { holeMax (mặc định 3; 0 = lấp cả lỗ to nhưng KHÔNG động lõm biên), holeSym (mặc định true) }. */
  function smartFillHoles(cells, W, H, opts) {
    const s = new Set(cells);
    const holeMax = Number.isFinite(opts && opts.holeMax) ? opts.holeMax : 3;
    const symKeep = !(opts && opts.holeSym === false);
    const out = new Set(); const q = [];
    const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const k = x + "," + y; if (s.has(k) || out.has(k)) return; out.add(k); q.push([x, y]); };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (q.length) { const [x, y] = q.pop(); push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    const seen = new Set(), holes = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k0 = x + "," + y; if (s.has(k0) || out.has(k0) || seen.has(k0)) continue;
      const comp = [[x, y]]; seen.add(k0); let head = 0;
      while (head < comp.length) {
        const [cx, cy] = comp[head++];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, nk = nx + "," + ny;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || s.has(nk) || out.has(nk) || seen.has(nk)) continue;
          seen.add(nk); comp.push([nx, ny]);
        }
      }
      let sx = 0, sy = 0; comp.forEach(c => { sx += c[0]; sy += c[1]; });
      holes.push({ cells: comp, size: comp.length, cx: sx / comp.length, cy: sy / comp.length });
    }
    const kept = new Set();
    if (holes.length) {
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      s.forEach(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const TOL = 0.51;
      const near = (a, b) => Math.abs(a.cx - b.cx) <= TOL && Math.abs(a.cy - b.cy) <= TOL;
      const big = holes.filter(hh => holeMax > 0 && hh.size > holeMax);
      const small = holes.filter(hh => !(holeMax > 0 && hh.size > holeMax));
      let paired = new Set();
      if (symKeep && small.length >= 2) {
        for (const hh of small) {
          const mirrors = [{ cx: 2 * mx - hh.cx, cy: hh.cy }, { cx: hh.cx, cy: 2 * my - hh.cy }, { cx: 2 * mx - hh.cx, cy: 2 * my - hh.cy }];
          for (const m of mirrors) {
            if (Math.abs(m.cx - hh.cx) <= TOL && Math.abs(m.cy - hh.cy) <= TOL) continue;
            if (small.some(o2 => o2 !== hh && o2.size === hh.size && near(o2, m))) { paired.add(hh); break; }
          }
        }
        if (paired.size / small.length < 0.5) paired = new Set();
      }
      for (const hh of small) if (!paired.has(hh)) hh.cells.forEach(c => s.add(c[0] + "," + c[1]));
      for (const hh of big) hh.cells.forEach(c => kept.add(c[0] + "," + c[1]));
      for (const hh of paired) hh.cells.forEach(c => kept.add(c[0] + "," + c[1]));
    }
    // LỖ BIÊN NHIỀU Ô (concave bite): ô trống NỐI RA NGOÀI nhưng nằm TRONG bbox của hình = lõm ở rìa
    // (block 2×2 / 1×3 sát mép như hình user). Nhóm 4-hướng trong (out ∩ bbox): nhóm NHỎ (<=edgeCap ô)
    // -> LẤP; nhóm TO -> giữ (lõm chủ ý: chữ U/C/L, Pac-Man). edgeCap = holeMax, nhưng holeMax=0 ("lấp cả
    // lỗ to") vẫn dùng cap 8 để KHÔNG nuốt lõm biên lớn (và giữ đơn điệu: holeMax=0 lấp >= holeMax nhỏ).
    if (s.size) {
      const edgeCap = holeMax > 0 ? holeMax : 8;
      let bx0 = W, bx1 = -1, by0 = H, by1 = -1;
      s.forEach(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; });
      const eseen = new Set();
      for (const ok of out) {
        if (eseen.has(ok)) continue;
        const i = ok.indexOf(","), ex = +ok.slice(0, i), ey = +ok.slice(i + 1);
        if (ex < bx0 || ex > bx1 || ey < by0 || ey > by1) continue;   // ngoài bbox = nền/đệm -> bỏ
        const comp = [ok]; eseen.add(ok); let head = 0;
        while (head < comp.length) {
          const ck = comp[head++]; const ci = ck.indexOf(","), cx = +ck.slice(0, ci), cy = +ck.slice(ci + 1);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy; if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
            const nk = nx + "," + ny; if (out.has(nk) && !eseen.has(nk)) { eseen.add(nk); comp.push(nk); }
          }
        }
        if (comp.length <= edgeCap) for (const ck of comp) s.add(ck);   // lõm biên nhỏ -> lấp; lõm to giữ nguyên
      }
    }
    // HỐC BIÊN 1 Ô: lặp tới ổn định — ô trống KHÔNG thuộc lỗ giữ, giáp mask >=3 cạnh -> lấp (lõm 1 ô/rãnh cụt).
    let changed = true;
    while (changed) {
      changed = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = x + "," + y; if (s.has(k) || kept.has(k)) continue;
        let n = 0;
        if (s.has((x + 1) + "," + y)) n++; if (s.has((x - 1) + "," + y)) n++;
        if (s.has(x + "," + (y + 1))) n++; if (s.has(x + "," + (y - 1))) n++;
        if (n >= 3) { s.add(k); changed = true; }
      }
    }
    return s;
  }

  /* GỘP VÙNG MÀU CHO Ô ĐÃ LẤP: mỗi CỤM ô mới lấp (added, cm đang = -1) được gán MÀU của vùng nó
     TIẾP XÚC NHIỀU NHẤT — đếm số cạnh giáp mỗi màu ở biên cụm, lấy màu nhiều phiếu nhất. Cụm không
     giáp màu nào -> để -1 (floodZones sau xử BFS gần nhất). Dùng cho CẢ batch clone lẫn 1000 Levels. */
  function mergeFilledZones(cm, added, W, H) {
    if (!added || !added.size) return;
    const seen = new Set();
    for (const k0 of added) {
      if (seen.has(k0)) continue;
      const comp = [], stack = [k0]; seen.add(k0); const votes = {};
      while (stack.length) {
        const k = stack.pop(); comp.push(k);
        const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nk = nx + "," + ny;
          if (added.has(nk)) { if (!seen.has(nk)) { seen.add(nk); stack.push(nk); } }
          else { const col = cm[ny][nx]; if (col >= 1) votes[col] = (votes[col] || 0) + 1; }   // giáp vùng màu -> +1 phiếu
        }
      }
      let best = -1, bestN = 0;
      for (const c in votes) if (votes[c] > bestN) { bestN = votes[c]; best = +c; }
      if (best >= 1) for (const k of comp) { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); cm[y][x] = best; }
    }
  }
  // ---------- Nhân bản (clone): bắt chước layout + PHÂN VÙNG NGẦM theo màu + đổi màu random/level ----------
  const cellXY = c => Array.isArray(c) ? { x: c[0], y: c[1] } : { x: c.x, y: c.y };
  function cloneLevel(lvl) {
    B.cloneSource = lvl;   // nhớ nguồn để re-clone khi đổi tích "Tự thiết kế màu"
    { const wrap = $b("bCloneAutoColorWrap"); if (wrap) wrap.style.display = ""; const w2 = $b("bCloneKeepColorWrap"); if (w2) w2.style.display = ""; const w3 = $b("bCloneFillHolesWrap"); if (w3) w3.style.display = ""; }   // hiện nút màu + Lấp lỗ khi clone
    // ----- Layout: đệm 1 ô viền quanh hình (dịch +1, W+2/H+2) -> ô tô không chạm rìa; scale 100% -----
    B.W = lvl.w + 2; B.H = lvl.h + 2; $b("bW").value = B.W; $b("bH").value = B.H;
    B.scale = 1; $b("bScale").value = 100; $b("bScaleVal").textContent = "100";
    // paint mask + bản đồ màu GỐC theo ô (dịch +1)
    let colored = false; const cm = Array.from({ length: B.H }, () => Array(B.W).fill(-1)); const freq = {};
    B.paint = new Set();
    for (const p of lvl.pieces) { const fc = (typeof p.fixedColor === "number") ? p.fixedColor : -1; if (fc >= 1) colored = true;
      for (const c of p.cells) { const { x, y } = cellXY(c); const X = x + 1, Y = y + 1; if (Y >= 0 && Y < B.H && X >= 0 && X < B.W) { B.paint.add(X + "," + Y); cm[Y][X] = fc; if (fc >= 1) freq[fc] = (freq[fc] || 0) + 1; } } }
    // LẤP LỖ THÔNG MINH (giống 1000 Levels) — MẶC ĐỊNH TẮT: clone hiện layout CÓ LỖ để kiểm tra;
    // tích "Lấp lỗ" mới lấp. Ô mới lấp gộp vào vùng màu TIẾP XÚC NHIỀU NHẤT (mergeFilledZones).
    const origPaint = new Set(B.paint);
    const doFill = $b("bCloneFillHoles") && $b("bCloneFillHoles").checked;
    if (doFill) {
      B.paint = smartFillHoles(B.paint, B.W, B.H, { holeMax: 8, holeSym: true });   // batch: lấp mạnh hơn (lỗ nhiều ô + lõm biên), giữ lỗ to/đối xứng
      const added = new Set(); B.paint.forEach(k => { if (!origPaint.has(k)) added.add(k); });
      mergeFilledZones(cm, added, B.W, B.H);   // ô đã lấp -> màu vùng bên cạnh tiếp xúc nhiều nhất
    }
    floodZones(cm, B.paint, B.W, B.H);   // ô chưa màu còn lại (đệm trong / lỗ giữ) -> vùng gần nhất (BFS)
    B.cloneFilled = doFill;   // nhớ trạng thái để báo cáo
    B.layoutType = "paint"; $b("bLayoutType").value = "paint"; setLayoutType("paint");
    // fill mặc định 100% (KÍN TUYỆT ĐỐI) + độ khó [0–100] (sao cũng được) + bỏ "Rắn mẹ"
    B.fillTarget = 100; $b("bFill").value = 100; $b("bFillVal").textContent = "100";
    $b("bMother").checked = false;
    B.diffMode = "range"; $b("bDiffMode").value = "range";
    B.diffMin = 0; B.diffMax = 100; $b("bDiffMin").value = 0; $b("bDiffMax").value = 100; syncDiffMode();
    // Vùng ngầm: rắn sinh ra bị giới hạn trong 1 vùng (không lấn vùng khác); autoColor tô mỗi vùng 1 màu.
    B.clonePinned = null; B.cloneKeep = false; B.cloneExact = false;
    const keepColor = $b("bCloneKeepColor") && $b("bCloneKeepColor").checked;   // GIỮ NGUYÊN màu gốc, chỉ clone cách sắp xếp
    const autoDesign = !keepColor && $b("bCloneAutoColor") && $b("bCloneAutoColor").checked;
    if (autoDesign) {   // TỰ THIẾT KẾ: bỏ màu mẫu, chỉ mượn LAYOUT. cloneColorMap = null -> gen chạy perLevelZones
      // (MỖI level tự chia vùng bằng cutZones ngẫu nhiên như "pattern/lát cắt" bên hình thường) ->
      // 100 level ~90 kiểu tô KHÁC NHAU, thay vì 1 spatialZones cố định dùng chung như trước.
      B.cloneColorMap = null; B.cloneColorDominant = -1; colorMode = "game"; if (typeof syncColorBtn === "function") syncColorBtn();
    } else if (colored) {   // BẮT CHƯỚC màu mẫu: mỗi vùng GIỮ ĐÚNG màu gốc; keepColor -> giữ NGUYÊN (không xoay hue)
      B.cloneColorMap = cm; B.cloneKeep = true; B.cloneExact = keepColor; colorMode = "game"; if (typeof syncColorBtn === "function") syncColorBtn();
    } else { B.cloneColorMap = null; B.cloneColorDominant = -1; }
    state.mode = "batch"; state.fromLibrary = null; syncModeUI();
    renderPreview(); updateCurveInfo();
    $b("bProgInfo").textContent = `⧉ Nhân bản #${lvl.id}: layout ${B.W}×${B.H} (đệm viền) · ${autoDesign ? "TỰ THIẾT KẾ vùng màu" : (keepColor && colored ? "GIỮ NGUYÊN màu gốc" : (colored ? "phân vùng theo màu mẫu" : "không màu"))} · ${doFill ? "ĐÃ lấp lỗ (gộp vùng gần nhất)" : "CHƯA lấp lỗ — tích “Lấp lỗ” để lấp & kiểm tra"} · độ khó 0–100. Bấm 🎲 Sinh.`;
    try { $b("bGenerate").scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  }
  // ---------- Tô màu CHUYÊN NGHIỆP: bộ màu hài hoà + 2 đơn vị KỀ luôn khác & tương phản ----------
  // Bộ palette cong-tay (mỗi bộ vài màu hài hoà, đủ tách biệt) — mỗi level random 1 bộ.
  const COLOR_PALETTES = [
    [1, 5, 7, 11, 14, 20, 17, 26],   // primary tươi (xanh·đỏ·vàng·lá·tím·cam·hồng·teal)
    [1, 3, 26, 29, 11, 14, 38, 32],  // cool / đại dương
    [5, 20, 7, 22, 17, 35, 14, 47],  // warm / hoàng hôn
    [3, 6, 9, 12, 15, 18, 27, 33],   // pastel (sắc nhạt)
    [11, 32, 35, 26, 40, 38, 7, 5],  // earth / rừng
    [14, 16, 1, 26, 11, 20, 5, 47],  // tím-hồng-xanh phối
  ];
  function _rgb(idx) { const h = (typeof GAME_COLORS !== "undefined" && GAME_COLORS[idx - 1]) || "#888888"; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  // ---------- Màu CẢM NHẬN (CIELAB) + sinh palette theo LÝ THUYẾT MÀU ----------
  const _labCache = {}, _hslCache = {};
  function _lab(idx) {   // sRGB -> Lab (D65) -> dùng cho ΔE cảm nhận (đúng mắt người hơn RGB)
    if (_labCache[idx]) return _labCache[idx];
    const c = _rgb(idx).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    let X = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047, Y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, Z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return _labCache[idx] = [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function _cdist(a, b) { const x = _lab(a), y = _lab(b), dL = x[0] - y[0], da = x[1] - y[1], db = x[2] - y[2]; return Math.sqrt(dL * dL + da * da + db * db); }   // ΔE*ab (CIELAB) — KHOẢNG CÁCH CẢM NHẬN
  function _hsl(idx) {   // hex -> HSL (cho phối màu theo hue)
    if (_hslCache[idx]) return _hslCache[idx];
    const [R, G, B] = _rgb(idx).map(v => v / 255), mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; h *= 60; }
    return _hslCache[idx] = [h, s, l];
  }
  function _hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  // Sinh PALETTE theo lý thuyết màu từ 1 hue gốc ngẫu nhiên: analogous / bổ-túc / tam-giác / split / đơn-sắc.
  // Lấy trong gamut 48 màu game (giữ tương thích export) nhưng phối hài hoà -> "vô hạn" mà không xấu.
  function theoryPalette() {
    if (typeof GAME_COLORS === "undefined") return COLOR_PALETTES[0];
    const base = Math.random() * 360, mode = Math.floor(Math.random() * 5);
    let hues;
    if (mode === 0) hues = [base - 34, base - 17, base, base + 17, base + 34, base + 51];           // analogous (kề hue)
    else if (mode === 1) hues = [base, base + 180, base + 18, base + 198, base - 18, base + 162];   // bổ túc (đối hue)
    else if (mode === 2) hues = [base, base + 120, base + 240, base + 30, base + 150, base + 270];  // tam giác (120°)
    else if (mode === 3) hues = [base, base + 150, base + 210, base + 25, base + 175, base + 185];  // split-complementary
    else hues = [base, base, base, base, base, base];                                               // đơn sắc (đổi độ sáng)
    hues = hues.map(h => ((h % 360) + 360) % 360);
    const cand = []; for (let i = 1; i <= GAME_COLORS.length; i++) { const [h, s, l] = _hsl(i); cand.push({ i, h, s, l }); }
    const used = new Set(), pal = [];
    for (let k = 0; pal.length < 8 && k < 64; k++) {
      const th = hues[k % hues.length], wantL = 0.30 + 0.45 * (pal.length / 7);   // trải độ sáng dần (đẹp + dễ tách)
      let best = null, bs = 1e9;
      for (const c of cand) {
        if (used.has(c.i) || c.s < 0.18) continue;   // bỏ màu xám/nhạt tịt -> giữ tươi
        const score = mode === 4 ? _hueDist(c.h, th) * 0.4 + Math.abs(c.l - wantL) * 140 : _hueDist(c.h, th) + Math.abs(c.l - wantL) * 12;
        if (score < bs) { bs = score; best = c; }
      }
      if (best) { used.add(best.i); pal.push(best.i); }
    }
    return pal.length >= 3 ? pal : COLOR_PALETTES[Math.floor(Math.random() * COLOR_PALETTES.length)];
  }
  // Con rắn có THOÁT NGAY được không (tia đầu thông tới rìa, không gặp rắn nào)?
  function _movableNow(pieces, W, H) {
    if (typeof DELTA === "undefined") return pieces.map(() => false);
    const occ = new Map(); pieces.forEach((p, i) => { for (const c of p.cells) { const { x, y } = cellXY(c); occ.set(x + "," + y, i); } });
    return pieces.map(p => {
      if (p.mother) return false; const d = DELTA[p.dir]; if (!d) return false;
      const h = cellXY(p.cells[0]); let x = h.x + d.x, y = h.y + d.y;
      while (x >= 0 && y >= 0 && x < W && y < H) { if (occ.has(x + "," + y)) return false; x += d.x; y += d.y; }
      return true;
    });
  }
  // BẪY HƯỚNG: trong CỤM nhiều con ĐẦU QUAY RA, ĐẦU KỀ ĐẦU & CÙNG MÀU -> đảo ĐÚNG 1 con/vùng-màu thành
  // quay VÔ (vẫn cùng màu -> trà trộn) -> thao tác nhanh dễ tap nhầm. Chỉ giữ nếu CẢ BÀN vẫn giải được.
  function injectDirTraps(pieces, W, H) {
    if (typeof solve !== "function" || typeof dirFromTo !== "function") return;
    const mk = () => pieces.map((p, i) => ({ id: i + 1, dir: p.dir, cells: p.cells.map(c => { const { x, y } = cellXY(c); return { x, y }; }) }));
    if (!solve(mk(), W, H).solvable) return;
    const mv = _movableNow(pieces, W, H), D4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const headAt = new Map(); pieces.forEach((p, i) => { if (!p.mother && mv[i]) { const h = cellXY(p.cells[0]); headAt.set(h.x + "," + h.y, i); } });
    // ứng viên theo VÙNG-MÀU: con move-được, dài ≥3, ĐẦU kề ĐẦU con move-được khác CÙNG MÀU (cụm đầu trà trộn)
    const byColor = new Map();
    pieces.forEach((p, i) => {
      if (p.mother || !mv[i] || p.cells.length < 3) return;
      const h = cellXY(p.cells[0]);
      for (const d of D4) { const o = headAt.get((h.x + d[0]) + "," + (h.y + d[1])); if (o !== undefined && o !== i && pieces[o].fixedColor === p.fixedColor) { const k = p.fixedColor; (byColor.get(k) || byColor.set(k, []).get(k)).push(i); break; } }
    });
    if (!byColor.size) { const g = []; for (let i = 0; i < pieces.length; i++) if (!pieces[i].mother && pieces[i].cells.length >= 3 && mv[i]) g.push(i); if (g.length) byColor.set(0, g); }   // fallback: gộp mọi con quay-ra vào 1 nhóm
    for (const g of byColor.values()) {                 // MỖI VÙNG-MÀU đảo đúng 1 con -> "nhiều vùng đều có"
      for (let n = g.length - 1; n > 0; n--) { const m = Math.floor(Math.random() * (n + 1)); const t = g[n]; g[n] = g[m]; g[m] = t; }
      for (const i of g) {
        const p = pieces[i], oldCells = p.cells, oldDir = p.dir;
        const rev = p.cells.slice().reverse(), a = cellXY(rev[1]), b = cellXY(rev[0]), ndir = dirFromTo(a, b);
        if (!ndir || ndir === oldDir) continue;
        p.cells = rev; p.dir = ndir;                     // đảo: đầu sang đầu kia (quay VÔ)
        const blocked = !_movableNow(pieces, W, H)[i];   // quay vô bị CHẶN ngay -> tap vào = VA CHẠM (bẫy thật)
        if (blocked && solve(mk(), W, H).solvable) break;  // bẫy va chạm + bàn vẫn giải được -> giữ, sang vùng khác
        p.cells = oldCells; p.dir = oldDir;              // không chặn (escape vô hại) hoặc hỏng -> hoàn lại, thử con khác
      }
    }
  }
  // BẪY MÀU: tô vài con KẸT trùng màu với con MOVE-được kề -> đánh lừa nhịp tap (lỡ tay tap con kẹt = mất sao).
  function injectTraps(pieces, W, H, perN) {
    perN = perN > 0 ? perN : 30;
    const mv = _movableNow(pieces, W, H);
    const occ = new Map(); pieces.forEach((p, i) => { for (const c of p.cells) { const { x, y } = cellXY(c); occ.set(x + "," + y, i); } });
    const D4 = [[0, -1], [0, 1], [-1, 0], [1, 0]], cand = [];
    pieces.forEach((p, i) => {
      if (p.mother || mv[i] || !(p.fixedColor >= 1)) return;   // cần con KẸT, có màu
      for (const c of p.cells) { const { x, y } = cellXY(c); let hit = false;
        for (const d of D4) { const o = occ.get((x + d[0]) + "," + (y + d[1])); if (o !== undefined && o !== i && mv[o] && pieces[o].fixedColor >= 1 && pieces[o].fixedColor !== p.fixedColor) { cand.push([i, pieces[o].fixedColor]); hit = true; break; } }
        if (hit) break;
      }
    });
    if (!cand.length) return;
    for (let n = cand.length - 1; n > 0; n--) { const m = Math.floor(Math.random() * (n + 1)); const t = cand[n]; cand[n] = cand[m]; cand[m] = t; }   // xáo trộn
    const N = Math.max(1, Math.min(cand.length, 1 + Math.round(pieces.length / perN)));   // ~1 bẫy / perN rắn
    for (let t = 0; t < N; t++) pieces[cand[t][0]].fixedColor = cand[t][1];   // con kẹt đội màu con move-được kề
  }
  // BẮT CHƯỚC màu mẫu (clone KHÔNG tích tự-thiết-kế) = y như bản cũ: remap màu gốc ngẫu nhiên/level,
  // nhất quán trong level (cùng vùng màu gốc -> cùng màu mới). KHÔNG palette/bẫy.
  function applyCloneColors(pieces) {
    const cm = B.cloneColorMap; if (!cm || cm.length !== B.H || !cm[0] || cm[0].length !== B.W) return;
    const offset = B.cloneExact ? 0 : (1 + Math.floor(Math.random() * 47));   // cloneExact -> GIỮ NGUYÊN màu gốc (không xoay hue)
    const remap = c => (c >= 1 && c <= 48) ? ((c - 1 + offset) % 48) + 1 : c;
    for (const p of pieces) { if (p.mother) continue; const c0 = cellXY(p.cells[0]); const col = (cm[c0.y] || [])[c0.x]; if (col >= 1) p.fixedColor = remap(col); }
  }
  // MÀU LỘN XỘN (không theo pattern vùng): MỖI rắn 1 màu NGẪU NHIÊN trong palette hài hoà; rắn KỀ khác màu -> tổ hợp hợp lý. Vẫn chèn bẫy màu.
  function scatterColor(pieces, W, H, trapPerN) {
    if (!pieces.length || typeof GAME_COLORS === "undefined") return;
    const realIdx = pieces.map((p, i) => i).filter(i => !pieces[i].mother); if (!realIdx.length) return;
    const pal = Math.random() < 0.85 ? theoryPalette() : COLOR_PALETTES[Math.floor(Math.random() * COLOR_PALETTES.length)];
    const idx = new Map(); realIdx.forEach(i => { for (const c of pieces[i].cells) { const { x, y } = cellXY(c); idx.set(x + "," + y, i); } });
    const adj = new Map(); realIdx.forEach(i => adj.set(i, new Set()));
    idx.forEach((i, k) => { const ci = k.indexOf(","), x = +k.slice(0, ci), y = +k.slice(ci + 1); for (const d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const j = idx.get((x + d[0]) + "," + (y + d[1])); if (j != null && j !== i) { adj.get(i).add(j); adj.get(j).add(i); } } });
    const order = realIdx.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }   // thứ tự ngẫu nhiên -> lộn xộn
    const col = new Map();
    for (const i of order) {
      const used = new Set(); adj.get(i).forEach(j => { if (col.has(j)) used.add(col.get(j)); });
      let pool = pal.filter(c => !used.has(c)); if (!pool.length) pool = pal;
      const c = pool[Math.floor(Math.random() * pool.length)]; col.set(i, c); pieces[i].fixedColor = c;
    }
    injectTraps(pieces, W, H, trapPerN);   // giữ bẫy màu của Snake Go 1
  }
  // Tô PALETTE mới (clone tích tự-thiết-kế / tự-build): chia/đọc vùng -> tô hài hoà, vùng kề tương phản + bẫy màu.
  function autoColor(pieces, W, H, zoneMap, trapPerN) {
    if (!pieces.length || typeof GAME_COLORS === "undefined") return;
    if (!zoneMap) {   // tự build: chia vài vùng lớn theo không gian để nhìn như game (khối màu lớn)
      const paint = new Set(); pieces.forEach(p => { if (!p.mother) for (const c of p.cells) { const { x, y } = cellXY(c); paint.add(x + "," + y); } });
      const K = clamp(3 + Math.round(paint.size / 130), 3, 6);
      zoneMap = spatialZones(paint, W, H, K, COLOR_PALETTES[0].length);
    }
    const pal = Math.random() < 0.8 ? theoryPalette() : COLOR_PALETTES[Math.floor(Math.random() * COLOR_PALETTES.length)];   // 80% phối theo lý thuyết màu, 20% bộ tuyển sẵn
    const unitOf = [], occ = new Map();   // pieceIdx -> unitKey; "x,y" -> unitKey
    pieces.forEach((p, i) => {
      if (p.mother) { unitOf[i] = null; return; }   // rắn mẹ giữ màu vàng riêng
      const c0 = cellXY(p.cells[0]);
      const key = zoneMap ? ("z" + ((zoneMap[c0.y] || [])[c0.x])) : ("s" + i);
      unitOf[i] = key;
      for (const c of p.cells) { const { x, y } = cellXY(c); occ.set(x + "," + y, key); }
    });
    const adj = new Map(); const units = new Set(unitOf.filter(u => u !== null));
    units.forEach(u => adj.set(u, new Set()));
    occ.forEach((u, k) => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1);
      for (const d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const nb = occ.get((x + d[0]) + "," + (y + d[1])); if (nb && nb !== u) { adj.get(u).add(nb); adj.get(nb).add(u); } }
    });
    // greedy: đơn vị nhiều hàng xóm trước; MỖI VÙNG 1 MÀU RIÊNG (không tái dùng) -> cùng màu ắt LIỀN MẠCH.
    const order = [...units].sort((a, b) => adj.get(b).size - adj.get(a).size);
    const colorOf = new Map(), used = new Set();
    for (const u of order) {
      const nbCols = []; for (const nb of adj.get(u)) if (colorOf.has(nb)) nbCols.push(colorOf.get(nb));
      let best = -1, bestScore = -1;
      for (const c of pal) { if (used.has(c)) continue; let minD = nbCols.length ? Infinity : 999; for (const nc of nbCols) minD = Math.min(minD, _cdist(c, nc)); if (minD > bestScore) { bestScore = minD; best = c; } }
      if (best < 0) { for (const c of pal) { let minD = nbCols.length ? Infinity : 999; for (const nc of nbCols) minD = Math.min(minD, _cdist(c, nc)); if (minD > bestScore) { bestScore = minD; best = c; } } }   // hết màu chưa dùng (vùng > palette) -> đành lấy tương phản nhất
      colorOf.set(u, best); used.add(best);
    }
    pieces.forEach((p, i) => { if (unitOf[i] !== null) p.fixedColor = colorOf.get(unitOf[i]); });
    injectTraps(pieces, W, H, trapPerN);   // chèn bẫy màu: con kẹt đội màu con move-được kề (đánh lừa nhịp tap)
  }
  function selectedLevels() {   // theo id tăng dần = đúng thứ tự đường cong (kể cả sinh lệch)
    return B.library.filter(l => B.selection.has(l.id)).sort((a, b) => a.id - b.id);
  }

  // ---------- Chơi level từ thư viện ----------
  // ---------- Trình sửa màu từng rắn (per-level) ----------
  const CE = { lvl: null, sel: new Set(), cols: [], cv: null, ctx: null };
  function editorGeom() {
    const lvl = CE.lvl, S = CE.cv.width, W = lvl.w, H = lvl.h;
    const cell = S / Math.max(W, H), ox = (S - cell * W) / 2, oy = (S - cell * H) / 2;
    return { S, W, H, cell, ox, oy };
  }
  function drawEditor() {
    const lvl = CE.lvl, ctx = CE.ctx; if (!lvl) return;
    const { S, W, H, cell, ox, oy } = editorGeom();
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#0e1218"; ctx.fillRect(0, 0, S, S);   // nền tối -> thấy màu rõ
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = Math.max(0.5, cell * 0.04);
    for (let x = 0; x < W; x++) { ctx.beginPath(); ctx.moveTo(ox + (x + .5) * cell, oy + .5 * cell); ctx.lineTo(ox + (x + .5) * cell, oy + (H - .5) * cell); ctx.stroke(); }
    for (let y = 0; y < H; y++) { ctx.beginPath(); ctx.moveTo(ox + .5 * cell, oy + (y + .5) * cell); ctx.lineTo(ox + (W - .5) * cell, oy + (y + .5) * cell); ctx.stroke(); }
    lvl.pieces.forEach((p, i) => {
      const ci = CE.cols[i], color = p.mother ? "#e8c25a" : (gameColor(ci) || pieceColor(i)), on = CE.sel.has(i);
      if (on) { ctx.save(); ctx.shadowColor = "#ffffff"; ctx.shadowBlur = cell * 0.95; }
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, cell * 0.34); ctx.lineCap = "round"; ctx.lineJoin = "round";
      const pts = p.cells.map(c => ({ x: ox + (c[0] + .5) * cell, y: oy + (c[1] + .5) * cell }));
      const d = DELTA[p.dir], h = pts[0], t = cell * .5, b = cell * .3, px = -d.y, py = d.x;
      if (pts.length > 1) { ctx.beginPath(); ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y); for (let k = pts.length - 2; k >= 0; k--) ctx.lineTo(pts[k].x, pts[k].y); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(h.x + d.x * t, h.y + d.y * t); ctx.lineTo(h.x + px * b, h.y + py * b); ctx.lineTo(h.x - px * b, h.y - py * b); ctx.closePath(); ctx.fill();
      if (on) ctx.restore();
    });
    let cur = -1;   // chỉ sáng ô màu khi MỌI con đang chọn cùng 1 màu
    if (CE.sel.size) { const arr = [...CE.sel].map(i => CE.cols[i]); if (arr.every(c => c === arr[0])) cur = arr[0]; }
    const sw = $b("cEditSwatches"); if (sw) sw.querySelectorAll(".cedit-sw").forEach(b => b.classList.toggle("on", +b.dataset.ci === cur));
  }
  function updateEditorHint(msg) {
    const el = $b("cEditHint"); if (!el) return;
    if (msg) { el.innerHTML = msg; return; }
    const n = CE.sel.size;
    el.innerHTML = n
      ? `Đang chọn <b>${n} rắn</b> — bấm 1 ô màu để đổi cả ${n}. Bấm con đã chọn để <b>bỏ</b>.`
      : `Bấm 1 hay <b>nhiều con rắn</b> để chọn, rồi bấm 1 ô màu. Bấm con đã chọn để bỏ.`;
  }
  function onEditorCanvasClick(e) {
    if (!CE.lvl) return;
    const r = CE.cv.getBoundingClientRect(), g = editorGeom();
    const px = (e.clientX - r.left) * (CE.cv.width / r.width), py = (e.clientY - r.top) * (CE.cv.height / r.height);
    const cx = Math.floor((px - g.ox) / g.cell), cy = Math.floor((py - g.oy) / g.cell);
    let hit = -1;
    CE.lvl.pieces.forEach((p, i) => { if (p.mother) return; for (const c of p.cells) if (c[0] === cx && c[1] === cy) { hit = i; break; } });
    if (hit >= 0) { CE.sel.has(hit) ? CE.sel.delete(hit) : CE.sel.add(hit); updateEditorHint(); drawEditor(); }   // toggle: bấm lại = bỏ
  }
  function applySwatch(ci) {
    if (!CE.sel.size) { updateEditorHint("⚠ Chọn ít nhất 1 <b>con rắn</b> trước rồi mới chọn màu."); return; }
    CE.sel.forEach(i => { CE.cols[i] = ci; }); drawEditor();
  }
  function selectAllEditor() { if (!CE.lvl) return; CE.sel.clear(); CE.lvl.pieces.forEach((p, i) => { if (!p.mother) CE.sel.add(i); }); updateEditorHint(); drawEditor(); }
  function clearSelEditor() { CE.sel.clear(); updateEditorHint(); drawEditor(); }
  function randomizeEditor() {
    const lvl = CE.lvl; if (!lvl || typeof autoColor !== "function") return;
    const tmp = lvl.pieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => [c[0], c[1]]), ...(p.mother ? { mother: true } : {}) }));
    autoColor(tmp, lvl.w, lvl.h, null, 30);
    CE.cols = tmp.map(p => (typeof p.fixedColor === "number" ? p.fixedColor : 0));
    drawEditor();
  }
  function ensureColorEditor() {
    if ($b("cEditBackdrop")) return;
    const bd = document.createElement("div"); bd.id = "cEditBackdrop"; bd.className = "cedit-backdrop";
    bd.innerHTML = `
      <div class="cedit-modal" role="dialog" aria-modal="true">
        <div class="cedit-head"><h3>🎨 Sửa màu rắn — Level #<span id="cEditId"></span></h3><button id="cEditClose" class="cedit-x" title="Đóng">✕</button></div>
        <div class="cedit-body">
          <div class="cedit-canvas-wrap"><canvas id="cEditCv" width="440" height="440"></canvas></div>
          <div class="cedit-side">
            <div class="cedit-hint" id="cEditHint"></div>
            <div class="cedit-swatches" id="cEditSwatches"></div>
          </div>
        </div>
        <div class="cedit-foot">
          <button id="cEditSelAll" title="Chọn tất cả rắn (trừ rắn mẹ)">Chọn hết</button>
          <button id="cEditSelNone" title="Bỏ chọn tất cả">Bỏ chọn</button>
          <button id="cEditRandom" title="Tô lại toàn bộ theo lý thuyết màu (ngẫu nhiên hài hoà)">🎲 Phối lại</button>
          <span class="cedit-spacer"></span>
          <button id="cEditCancel">Hủy</button>
          <button id="cEditSave" class="primary">Lưu</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const sw = bd.querySelector("#cEditSwatches");
    for (let i = 1; i <= GAME_COLORS.length; i++) {
      const b = document.createElement("button"); b.className = "cedit-sw"; b.style.background = gameColor(i); b.title = "Màu " + i + " · " + gameColor(i); b.dataset.ci = i;
      b.addEventListener("click", () => applySwatch(i)); sw.appendChild(b);
    }
    CE.cv = bd.querySelector("#cEditCv"); CE.ctx = CE.cv.getContext("2d");
    CE.cv.addEventListener("click", onEditorCanvasClick);
    bd.querySelector("#cEditClose").addEventListener("click", closeColorEditor);
    bd.querySelector("#cEditCancel").addEventListener("click", closeColorEditor);
    bd.querySelector("#cEditSave").addEventListener("click", saveColorEditor);
    bd.querySelector("#cEditRandom").addEventListener("click", randomizeEditor);
    bd.querySelector("#cEditSelAll").addEventListener("click", selectAllEditor);
    bd.querySelector("#cEditSelNone").addEventListener("click", clearSelEditor);
    bd.addEventListener("click", e => { if (e.target === bd) closeColorEditor(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { const x = $b("cEditBackdrop"); if (x && x.classList.contains("show")) closeColorEditor(); } });
  }
  function openColorEditor(lvl) {
    ensureColorEditor();
    CE.lvl = lvl; CE.sel.clear();
    CE.cols = lvl.pieces.map(p => (typeof p.fixedColor === "number" ? p.fixedColor : 0));
    $b("cEditId").textContent = lvl.id;
    updateEditorHint(); drawEditor();
    $b("cEditBackdrop").classList.add("show");
  }
  function closeColorEditor() { const bd = $b("cEditBackdrop"); if (bd) bd.classList.remove("show"); CE.lvl = null; CE.sel.clear(); }
  function saveColorEditor() {
    const lvl = CE.lvl; if (!lvl) { closeColorEditor(); return; }
    lvl.pieces.forEach((p, i) => { const ci = CE.cols[i]; if (ci >= 1) p.fixedColor = ci; else delete p.fixedColor; });
    if (typeof colorMode !== "undefined" && colorMode !== "game") { colorMode = "game"; if (typeof syncColorBtn === "function") syncColorBtn(); }
    saveLibrary();
    const grid = $b("bLibGrid");   // vẽ lại đúng thumbnail của level này
    if (grid) grid.querySelectorAll("canvas").forEach(c => { if (c._level === lvl) { drawThumb(c, lvl); c._drawn = true; } });
    closeColorEditor();
  }

  function playLibrary(id) {
    const lvl = B.library.find(l => l.id === id); if (!lvl) return;
    state.fromLibrary = id;
    state.mode = "play"; state.levelIndex = -1; state.W = lvl.w; state.H = lvl.h;
    const snap = normPieces(lvl.pieces);
    // GIỮ fixedColor để chơi đúng màu game như thumbnail (trước đây bị rớt -> import ra màu khác)
    state.testSnapshot = snap.map(p => ({ dir: p.dir, cells: p.cells.map(c => ({ ...c })), mother: p.mother, ...(typeof p.fixedColor === "number" ? { fixedColor: p.fixedColor } : {}) }));
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
    // có level màu game -> bật Màu Game (nếu không, reload sẽ tô rainbow random, mất màu gốc)
    if (B.library.some(l => l.pieces && l.pieces.some(p => typeof p.fixedColor === "number" && p.fixedColor >= 1)) && typeof colorMode !== "undefined" && colorMode !== "game") {
      colorMode = "game"; if (typeof syncColorBtn === "function") syncColorBtn();
    }
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
  // Level -> object FORMAT GAME (Y-FLIP, Indices...) thuần. + bản pack (kèm metadata để re-import).
  // tên loại obstacle theo Type (tạm — chỉnh lại khi có bảng Type chính thức của game)
  const OBSTACLE_NAMES = { 1: "wooden box", 2: "black hole" };
  function layoutFromName(name) {   // "level_19_v1.json" -> "L19" (số ĐẦU TIÊN trong tên)
    const m = name && String(name).match(/\d+/);
    return m ? ("L" + parseInt(m[0], 10)) : null;
  }
  function metaOf(lvl, nameHint) {   // khối metadata thống kê (tính lại từ chính các con rắn)
    const live = normPieces(lvl.pieces).map((p, i) => (p.id = i + 1, p));
    const a = analyzeSolve(live, lvl.w, lvl.h);
    const sig = (typeof percDynamic === "function") ? percDynamic(live, lvl.w, lvl.h) : { perc: 0 };
    const rates = (a.turnData || []).map(d => d.rate);
    const avg = rates.length ? Math.round(rates.reduce((x, y) => x + y, 0) / rates.length) : 0;
    const mn = rates.length ? Math.round(Math.min(...rates)) : 0;
    const colors = new Set(); lvl.pieces.forEach(p => { if (typeof p.fixedColor === "number" && p.fixedColor >= 1) colors.add(p.fixedColor); });
    const obs = lvl.gameObstacles || [];
    return {
      layout: layoutFromName(nameHint || lvl.fileName) || ("L" + lvl.id), shape: B.layoutType,   // theo SỐ trong tên file
      difficulty: lvl.score, snakeCount: lvl.pieces.length, colorCount: colors.size,
      XSize: lvl.w, YSize: lvl.h, turns: a.turns,
      percDyn: Math.round(sig.perc || 0), avgMoveRate: avg, minRate: mn, t1: a.t1Avail || 0,
      obstacleCount: obs.length, obstacles: [...new Set(obs.map(o => OBSTACLE_NAMES[o.Type] || ("type" + o.Type)))],
    };
  }
  function gamePure(lvl, nameHint) {
    const out = toGameLevel(lvl.pieces, lvl.w, lvl.h, lvl.tier !== "KẸT" ? lvl.score : 0, metaOf(lvl, nameHint));
    if (lvl.gameObstacles && lvl.gameObstacles.length) out.Obstacles = lvl.gameObstacles;   // đưa Obstacles ra top-level để khớp chuẩn game
    return out;
  }
  function packLevelOf(lvl) {
    return Object.assign(gamePure(lvl, lvl.fileName), {
      score: lvl.score, tier: lvl.tier, target: lvl.target,
      fillReal: lvl.fillReal, empty: lvl.empty, turns: lvl.turns, t1Pct: lvl.t1Pct, stuck: lvl.stuck,
      ...(lvl.fileName ? { fileName: lvl.fileName } : {})   // giữ tên file gốc qua pack round-trip
    });
  }

  function exportZip() {   // MỖI FILE = 1 LEVEL đúng format game
    const sel = selectedLevels();
    if (!sel.length) { $b("bSelInfo").textContent = "Chưa chọn level nào để export."; return; }
    const pad = Math.max(3, String(sel.length).length);
    const manifest = { generatedBy: "Arrow Out batch", format: "game (XSize/YSize/Arrows[Indices]/Colors/metadata, Y-flip)", count: sel.length, board: { w: B.W, h: B.H }, layout: B.layoutType, levels: [] };
    const files = [], used = new Set();
    sel.forEach((lvl, i) => {
      // GIỮ TÊN GỐC nếu level được import (lvl.fileName); chưa có (level tự sinh) -> levelNNN.json
      let name = lvl.fileName || ("level" + String(i + 1).padStart(pad, "0") + ".json");
      if (!/\.json$/i.test(name)) name += ".json";
      if (used.has(name)) { const base = name.replace(/\.json$/i, ""); let k = 2; while (used.has(`${base}_${k}.json`)) k++; name = `${base}_${k}.json`; }   // tránh trùng tên
      used.add(name);
      files.push({ name, str: JSON.stringify(gamePure(lvl, name), null, 2) });   // layout theo SỐ trong tên file đã resolve
      manifest.levels.push({ file: name, id: lvl.id, score: lvl.score, tier: lvl.tier, snakes: lvl.pieces.length, fillReal: lvl.fillReal, empty: lvl.empty, turns: lvl.turns, t1Pct: lvl.t1Pct, stuck: lvl.stuck });
    });
    files.push({ name: "manifest.json", str: JSON.stringify(manifest, null, 2) });
    download(zipStore(files), `arrowout-levels-${sel.length}.zip`);
    $b("bSelInfo").textContent = `✓ Đã export ${sel.length} level (ZIP, format game)`;
  }
  function exportPack() {   // 1 file gộp (format game + metadata) để re-import vào tool
    const sel = selectedLevels();
    if (!sel.length) { $b("bSelInfo").textContent = "Chưa chọn level nào để export."; return; }
    const pack = { generatedBy: "Arrow Out batch", format: "game+meta", board: { w: B.W, h: B.H }, layout: B.layoutType, levels: sel.map(packLevelOf) };
    download(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }), `arrowout-pack-${sel.length}.json`);
    $b("bSelInfo").textContent = `✓ Đã export pack ${sel.length} level`;
  }
  // Nạp 1 mảng object level (mỗi object: format game / {w,h,pieces} / pack có .levels) vào thư viện. Trả số đã thêm.
  function ingestLevels(arr) {
    let startId = nextLibId(), added = 0, sawColor = false;
    for (const o of arr) {
      let w, h, pieces, obstacles = [];
      if (isGameFormat(o)) {                                  // format game (lẻ hoặc trong pack)
        const g = fromGameLevel(o); w = g.w; h = g.h; obstacles = g.obstacles || [];
        pieces = g.pieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => [c.x, c.y]), ...(typeof p.fixedColor === "number" && p.fixedColor >= 1 ? { fixedColor: p.fixedColor } : {}) }));
      } else {                                                // format cũ {w,h,pieces}
        if (!o || !Array.isArray(o.pieces)) continue;
        w = o.w || (o.grid && o.grid[0] ? o.grid[0].length : 0); h = o.h || (o.grid ? o.grid.length : 0);
        pieces = o.pieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => Array.isArray(c) ? [c[0], c[1]] : [c.x, c.y]), ...(p.mother ? { mother: true } : {}) }));
      }
      if (!w || !h || !pieces.length) continue;
      if (pieces.some(p => typeof p.fixedColor === "number" && p.fixedColor >= 1)) sawColor = true;   // file có màu cố định
      const live = normPieces(pieces).map((p, i) => (p.id = i + 1, p));   // gán id để solve/analyzeSolve chạy đúng
      // tính LẠI mọi thông số từ chính các con rắn (y như lúc tự sinh) — trọng số 1000 Levels (thống nhất toàn tab)
      const d = computeDifficulty1000(live, w, h);
      const a = analyzeSolve(live, w, h);
      const area = w * h;
      let covered = 0; for (const p of live) covered += p.cells.length;
      const fillReal = area ? Math.round(covered / area * 100) : 0;
      const id = startId++;
      B.library.push({
        w, h, par: live.length, score: d.score, tier: d.tier, emoji: d.emoji,
        fillReal, empty: Math.max(0, area - covered), turns: a.turns,
        t1Pct: live.length ? Math.round(a.t1Avail / live.length * 100) : 0, stuck: a.stuck,
        target: o.target, pieces, id,
        ...((o._srcName || o.fileName) ? { fileName: o._srcName || o.fileName } : {}),   // giữ tên file gốc -> export cùng tên
        ...(obstacles.length ? { gameObstacles: obstacles } : {}),   // giữ Obstacles import được để re-export không mất
      });
      B.selection.add(id); added++;
    }
    // file có màu cố định -> bật "Màu Game" để thumbnail/chơi hiển thị đúng màu trong JSON (như editor)
    if (sawColor && typeof colorMode !== "undefined" && colorMode !== "game") {
      colorMode = "game";
      if (typeof syncColorBtn === "function") syncColorBtn();
    }
    return added;
  }
  function importPack(file) {
    const fr = new FileReader();
    fr.onload = () => {
      let data; try { data = JSON.parse(fr.result); } catch { $b("bSelInfo").textContent = "✗ File JSON không hợp lệ"; return; }
      const arr = Array.isArray(data) ? data : (isGameFormat(data) ? [data] : data.levels);   // 1 level game lẻ / mảng / pack
      if (!Array.isArray(arr)) { $b("bSelInfo").textContent = "✗ Không thấy level nào"; return; }
      if (isGameFormat(data)) data._srcName = file.name;   // 1 file = 1 level -> giữ tên gốc
      const added = ingestLevels(arr);
      saveLibrary(); renderLibrary();
      $b("bSelInfo").textContent = `✓ Đã import ${added} level`;
    };
    fr.readAsText(file);
  }

  // ---------- Đọc ZIP (giải nén STORE + DEFLATE) để import nhiều level cùng lúc ----------
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("Trình duyệt không hỗ trợ giải nén DEFLATE. Hãy dùng ZIP export từ tool này (dạng store) hoặc cập nhật trình duyệt.");
    const ds = new DecompressionStream("deflate-raw");
    const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  }
  // Trả [{name, bytes}] từ buffer ZIP. Đọc Central Directory (chuẩn) → từng local header → giải nén.
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eo = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
    if (eo < 0) throw new Error("Không phải file ZIP hợp lệ (thiếu EOCD).");
    const cdCount = dv.getUint16(eo + 10, true);
    let p = dv.getUint32(eo + 16, true);
    const td = new TextDecoder(), out = [];
    for (let n = 0; n < cdCount; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + compSize);
      if (method === 0) out.push({ name, bytes: comp });
      else if (method === 8) { try { out.push({ name, bytes: await inflateRaw(comp) }); } catch (e) { console.error("[unzip] giải nén lỗi", name, e); } }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }
  async function zipToLevels(file) {   // giải nén 1 ZIP -> { levels, skipped } (KHÔNG render)
    const entries = await unzip(await file.arrayBuffer());
    const td = new TextDecoder(), levels = [];
    let skipped = 0;
    for (const e of entries) {
      if (e.name.endsWith("/") || !/\.json$/i.test(e.name)) continue;            // chỉ nhận .json
      if (/(^|\/)manifest\.json$/i.test(e.name)) continue;                       // bỏ manifest
      let data; try { data = JSON.parse(td.decode(e.bytes)); } catch { skipped++; continue; }
      if (Array.isArray(data)) levels.push(...data);                             // file là mảng level
      else if (isGameFormat(data) || Array.isArray(data.pieces)) { data._srcName = (e.name.split(/[\\/]/).pop() || e.name); levels.push(data); }  // 1 level lẻ -> giữ tên
      else if (Array.isArray(data.levels)) levels.push(...data.levels);          // pack lồng
      else skipped++;
    }
    return { levels, skipped };
  }
  async function importZip(file) {   // kéo-thả 1 .zip
    $b("bSelInfo").textContent = "⏳ Đang đọc ZIP…";
    try {
      const { levels, skipped } = await zipToLevels(file);
      if (!levels.length) { $b("bSelInfo").textContent = "✗ ZIP không có level hợp lệ (cần file .json đúng format)."; return; }
      const added = ingestLevels(levels);
      saveLibrary(); renderLibrary();
      $b("bSelInfo").textContent = `✓ Đã import ${added} level từ ZIP` + (skipped ? ` · bỏ qua ${skipped} file` : "");
    } catch (err) {
      $b("bSelInfo").textContent = "✗ Lỗi đọc ZIP: " + (err && err.message ? err.message : err);
      console.error("[Import ZIP]", err);
    }
  }
  // CHỌN NHIỀU FILE cùng lúc (.json và/hoặc .zip) -> gộp, ingest, render 1 lần.
  async function importFiles(files) {
    if (!files || !files.length) return;
    if (files.length === 1) {   // 1 file: giữ nguyên thông báo chi tiết như cũ
      const f = files[0];
      return (/\.zip$/i.test(f.name) || f.type === "application/zip") ? importZip(f) : importPack(f);
    }
    $b("bSelInfo").textContent = `⏳ Đang import ${files.length} file…`;
    let added = 0, skipped = 0, bad = 0;
    for (const f of files) {
      try {
        if (/\.zip$/i.test(f.name) || f.type === "application/zip") {
          const r = await zipToLevels(f); added += ingestLevels(r.levels); skipped += r.skipped;
        } else {
          let data; try { data = JSON.parse(await f.text()); } catch { bad++; continue; }
          const arr = Array.isArray(data) ? data : (isGameFormat(data) ? [data] : data.levels);
          if (isGameFormat(data)) data._srcName = f.name;   // 1 file = 1 level -> giữ tên gốc
          if (Array.isArray(arr)) added += ingestLevels(arr); else bad++;
        }
      } catch (e) { bad++; console.error("[import]", f.name, e); }
    }
    saveLibrary(); renderLibrary();
    $b("bSelInfo").textContent = `✓ Đã import ${added} level từ ${files.length} file` + (skipped ? ` · bỏ ${skipped} mục` : "") + (bad ? ` · lỗi ${bad} file` : "");
  }

  // ---------- Nạp ảnh: file máy + kéo từ web ----------
  function loadImageBlob(blob, onOK) {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); onOK(img, false); };
    img.onerror = () => { URL.revokeObjectURL(url); $b("bLayoutInfo").textContent = "⚠ Không đọc được ảnh."; };
    img.src = url;
  }
  // Tải ảnh từ URL (kéo từ web). Chuỗi thử: (1) trực tiếp có CORS → (2) qua proxy ảnh
  // weserv (thêm CORS, đọc được pixel) → (3) trực tiếp không CORS (hiển thị được, có thể taint).
  function weservURL(url) {
    const noScheme = url.replace(/^(https?):\/\//i, (m, p) => p.toLowerCase() === "https" ? "ssl:" : "");
    return "https://images.weserv.nl/?url=" + encodeURIComponent(noScheme);
  }
  function loadImageURL(url, onOK) {
    const tryLoad = (src, cors, next) => {
      const img = new Image();
      if (cors) img.crossOrigin = "anonymous";
      img.onload = () => onOK(img, true);
      img.onerror = next;
      img.src = src;
    };
    const isData = /^data:image\//i.test(url);
    tryLoad(url, true, () => {
      if (isData) { $b("bLayoutInfo").textContent = "⚠ Không đọc được ảnh."; return; }
      tryLoad(weservURL(url), true, () =>
        tryLoad(url, false, () => { $b("bLayoutInfo").textContent = "⚠ Không tải được ảnh từ link. Hãy lưu ảnh về máy rồi 'Chọn ảnh'."; }));
    });
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
  // ---------- Wiring ----------
  function setLayoutType(t) {
    B.layoutType = t;
    $b("bImageRow").style.display = t === "image" ? "block" : "none";
    $b("bPaintRow").style.display = t === "paint" ? "block" : "none";
    { const fr = $b("bFreeRoll"); if (fr) fr.style.display = t === "free" ? "inline-block" : "none"; }
    if (t === "free") B.freeMask = genFreeShapes(B.W, B.H);   // chọn layout tự do -> tung 1 bố cục hình rời mới
    renderPreview();   // paint bắt đầu TRỐNG (vẽ từ đầu); dùng "Bật hết" nếu muốn full rồi xóa bớt
  }
  function applySize() {
    B.cloneColorMap = null; B.clonePinned = null; B.cloneKeep = false; B.cloneExact = false; B.cloneSource = null;   // đổi cỡ thủ công -> bỏ clone
    { const wrap = $b("bCloneAutoColorWrap"); if (wrap) wrap.style.display = "none"; const w2 = $b("bCloneKeepColorWrap"); if (w2) w2.style.display = "none"; const w3 = $b("bCloneFillHolesWrap"); if (w3) w3.style.display = "none"; }
    B.W = clamp(+$b("bW").value, 3, 60); B.H = clamp(+$b("bH").value, 3, 60);
    $b("bW").value = B.W; $b("bH").value = B.H;
    B.paint = new Set([...B.paint].filter(k => { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1); return x < B.W && y < B.H; }));
    if (B.layoutType === "free") B.freeMask = genFreeShapes(B.W, B.H);   // đổi cỡ -> tung lại bố cục cho khớp bàn mới
    renderPreview(); updateCurveInfo();
  }

  $b("bLayoutType").addEventListener("change", () => { B.cloneColorMap = null; B.clonePinned = null; B.cloneKeep = false; B.cloneExact = false; B.cloneSource = null; const w = $b("bCloneAutoColorWrap"); if (w) w.style.display = "none"; const w2 = $b("bCloneKeepColorWrap"); if (w2) w2.style.display = "none"; const w3 = $b("bCloneFillHolesWrap"); if (w3) w3.style.display = "none"; setLayoutType($b("bLayoutType").value); });   // đổi layout thủ công -> bỏ clone
  { const fr = $b("bFreeRoll"); if (fr) fr.addEventListener("click", () => { B.freeMask = genFreeShapes(B.W, B.H); renderPreview(); updateCurveInfo(); }); }   // tung lại bố cục hình rời
  $b("bCloneAutoColor").addEventListener("change", () => { if ($b("bCloneAutoColor").checked && $b("bCloneKeepColor")) $b("bCloneKeepColor").checked = false; if (B.cloneSource) cloneLevel(B.cloneSource); });   // đổi tích -> dựng lại clone (bắt chước <-> tự thiết kế)
  { const kc = $b("bCloneKeepColor"); if (kc) kc.addEventListener("change", () => { if (kc.checked && $b("bCloneAutoColor")) $b("bCloneAutoColor").checked = false; if (B.cloneSource) cloneLevel(B.cloneSource); }); }   // giữ-nguyên-màu <-> các chế độ khác (loại trừ lẫn nhau với tự-thiết-kế)
  { const fh = $b("bCloneFillHoles"); if (fh) fh.addEventListener("change", () => { if (B.cloneSource) cloneLevel(B.cloneSource); }); }   // tích/bỏ Lấp lỗ -> dựng lại clone (hiện lỗ <-> lấp lỗ) để kiểm tra
  $b("bApplySize").addEventListener("click", applySize);
  $b("bImgBtn").addEventListener("click", () => $b("bImg").click());
  $b("bImg").addEventListener("change", () => {
    const f = $b("bImg").files[0]; if (!f || !f.type.startsWith("image/")) return;
    loadImageBlob(f, setBatchImage);
  });
  $b("bImgClear").addEventListener("click", () => { B.maskImg = null; B.maskTainted = false; renderPreview(); });
  $b("bScale").addEventListener("input", () => { B.scale = clamp(+$b("bScale").value, 40, 100) / 100; $b("bScaleVal").textContent = $b("bScale").value; renderPreview(); updateCurveInfo(); });
  $b("bMother").addEventListener("change", () => {
    if ($b("bMother").checked && B.scale > 0.97) { $b("bScale").value = 90; B.scale = 0.9; $b("bScaleVal").textContent = "90"; }
    renderPreview();
  });
  $b("bImgTh").addEventListener("input", () => { $b("bImgThVal").textContent = $b("bImgTh").value; if (B.layoutType === "image") renderPreview(); });
  $b("bImgHarsh").addEventListener("input", () => { $b("bImgHarshVal").textContent = $b("bImgHarsh").value; if (B.layoutType === "image") renderPreview(); });
  $b("bBrush").addEventListener("change", () => { B.brush = +$b("bBrush").value; });
  $b("bPaintFill").addEventListener("click", () => { B.paint = new Set(); for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) B.paint.add(x + "," + y); renderPreview(); });
  $b("bPaintClear").addEventListener("click", () => { B.paint = new Set(); renderPreview(); });
  $b("bPaintInvert").addEventListener("click", () => { const n = new Set(); for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) { const k = x + "," + y; if (!B.paint.has(k)) n.add(k); } B.paint = n; renderPreview(); });
  // "Lấp lỗ" (công cụ paint): dùng LẤP LỖ THÔNG MINH (giống clone/1000 Levels) — lấp lỗ nhiều ô + lõm biên,
  // giữ lỗ to/đối xứng. Nếu đang clone (có bản đồ màu) -> tô ô mới lấp theo vùng tiếp xúc nhiều nhất.
  $b("bPaintFillHoles").addEventListener("click", () => {
    const orig = new Set(B.paint);
    B.paint = smartFillHoles(B.paint, B.W, B.H, { holeMax: 8, holeSym: true });
    if (B.cloneColorMap && Array.isArray(B.cloneColorMap)) {
      const added = new Set(); B.paint.forEach(k => { if (!orig.has(k)) added.add(k); });
      mergeFilledZones(B.cloneColorMap, added, B.W, B.H);
      floodZones(B.cloneColorMap, B.paint, B.W, B.H);
    }
    renderPreview();
  });

  function syncDiffMode() {   // hiện/ẩn min-max vs đường cong theo kiểu độ khó
    const isCurve = B.diffMode === "curve";
    const rw = $b("bRangeWrap"); if (rw) rw.style.display = (B.diffMode === "range") ? "flex" : "none";   // min/max chỉ cho 'range'
    const cs = $b("bCurveSection"); if (cs) cs.style.display = isCurve ? "block" : "none";                // đồ thị + preset CHỈ cho 'curve' -> ẩn hẳn khi khác
  }
  $b("bDiffMode").addEventListener("change", () => { B.diffMode = $b("bDiffMode").value; syncDiffMode(); updateCurveInfo(); });
  $b("bDiffMin").addEventListener("input", () => { B.diffMin = clamp(+$b("bDiffMin").value, 0, 100); });
  $b("bDiffMax").addEventListener("input", () => { B.diffMax = clamp(+$b("bDiffMax").value, 0, 100); });
  $b("bFill").addEventListener("input", () => { B.fillTarget = clamp(+$b("bFill").value, 50, 100); $b("bFillVal").textContent = B.fillTarget; });
  $b("bCount").addEventListener("input", updateCurveInfo);
  $b("bGenerate").addEventListener("click", runBatch);
  $b("bCancel").addEventListener("click", () => { B.cancel = true; if (B.cancelParallel) B.cancelParallel(); });

  $b("bSort").addEventListener("change", () => { B.sort = $b("bSort").value; renderLibrary(); });
  $b("bFilter").addEventListener("change", () => { B.filter = $b("bFilter").value; renderLibrary(); });
  $b("bSelToggle").addEventListener("click", () => {   // gộp Chọn hết / Bỏ chọn
    const vis = visibleList(), allSel = vis.length > 0 && vis.every(l => B.selection.has(l.id));
    if (allSel) B.selection.clear(); else vis.forEach(l => B.selection.add(l.id));
    renderLibrary();
  });
  $b("bDelSel").addEventListener("click", () => { B.library = B.library.filter(l => !B.selection.has(l.id)); B.selection.clear(); saveLibrary(); renderLibrary(); });
  $b("bExportZip").addEventListener("click", exportZip);
  $b("bImportBtn").addEventListener("click", () => $b("bImportPack").click());
  $b("bImportPack").addEventListener("change", () => {
    importFiles([...$b("bImportPack").files]);   // hỗ trợ chọn NHIỀU file cùng lúc
    $b("bImportPack").value = "";
  });

  // Tab điều hướng: Sinh hàng loạt <-> Chơi
  { const tb = $b("tabBatch"); if (tb) tb.addEventListener("click", () => { state.mode = "batch"; state.fromLibrary = null; syncModeUI(); renderLibrary(); }); }
  { const tp = $b("tabPlay"); if (tp) tp.addEventListener("click", () => { state.mode = "play"; syncModeUI(); if (state.pieces && state.pieces.length && typeof render === "function") render(); }); }

  // libPlayBar
  $b("libBackBtn").addEventListener("click", () => { state.mode = "batch"; state.fromLibrary = null; syncModeUI(); });
  $b("libPrevBtn").addEventListener("click", () => navLibrary(-1));
  $b("libNextBtn").addEventListener("click", () => navLibrary(1));

  // ---------- Kéo-thả ảnh TOÀN CỤC (chế độ Hàng loạt) ----------
  // Thả ảnh ở BẤT KỲ đâu khi đang ở chế độ Hàng loạt hoặc Editor — có lớp phủ chỉ dẫn.
  const dropOverlay = document.createElement("div");
  dropOverlay.id = "dropOverlay";
  dropOverlay.textContent = "🖼️ Thả ảnh để nạp  ·  🗜️ Thả .json / .zip để import level";
  document.body.appendChild(dropOverlay);
  const dndHasImage = e => e.dataTransfer && [...e.dataTransfer.types].some(t => t === "Files" || t === "text/uri-list" || t === "text/html");
  const dndMode = () => state.mode === "batch" || state.mode === "edit";
  let dragDepth = 0;
  const hideOverlay = () => { dragDepth = 0; dropOverlay.classList.remove("show"); };
  window.addEventListener("dragenter", e => { if (!dndHasImage(e) || !dndMode()) return; dragDepth++; dropOverlay.classList.add("show"); });
  window.addEventListener("dragleave", e => { if (!dndHasImage(e)) return; if (--dragDepth <= 0) hideOverlay(); });
  window.addEventListener("dragover", e => { if (dndHasImage(e) && dndMode()) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  window.addEventListener("dragend", hideOverlay);
  window.addEventListener("drop", e => {
    if (!dndHasImage(e)) return;
    e.preventDefault(); hideOverlay();
    if (state.mode === "batch") {
      const dataFiles = e.dataTransfer.files ? [...e.dataTransfer.files].filter(f => /\.(json|zip)$/i.test(f.name) || f.type === "application/json" || f.type === "application/zip") : [];
      if (dataFiles.length) { importFiles(dataFiles); return; }         // thả .json / .zip (nhiều file) -> import level
      if (!imageFromDataTransfer(e.dataTransfer, setBatchImage)) $b("bLayoutInfo").textContent = "⚠ Không thấy ảnh / level (.json/.zip) trong nội dung kéo vào.";
    } else if (state.mode === "edit") {
      const ok = imageFromDataTransfer(e.dataTransfer, (img, fromWeb) => {
        let tainted = false;
        if (fromWeb) { try { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); } catch (e2) { tainted = true; } }
        if (tainted) { state.maskImg = null; setMaskInfo("⚠ Ảnh web chặn CORS — lưu về máy rồi 'Chọn ảnh'.", "warn"); return; }
        state.maskImg = img; refreshMask(); render();
        setMaskInfo(`Ảnh ${img.naturalWidth}×${img.naturalHeight} đã nạp (kéo vào). Chỉnh Ngưỡng/Độ gắt rồi 'Tạo map từ ảnh'.`);
      });
      if (!ok) setMaskInfo("⚠ Không thấy ảnh trong nội dung kéo.", "warn");
    }
  });

  // ---------- Boot ----------
  loadCurve(); loadLibrary();
  B.scale = clamp(+$b("bScale").value, 40, 100) / 100;
  $b("bScaleVal").textContent = $b("bScale").value;
  B.fillTarget = clamp(+$b("bFill").value, 50, 100); $b("bFillVal").textContent = B.fillTarget;
  B.diffMode = $b("bDiffMode").value;
  B.diffMin = clamp(+$b("bDiffMin").value, 0, 100); B.diffMax = clamp(+$b("bDiffMax").value, 0, 100);
  syncDiffMode();
  setLayoutType("rect");
  updateCurveInfo();
  state.mode = "batch"; syncModeUI(); renderLibrary();   // mặc định hiện chế độ Hàng loạt

  // ---- Xuất engine clone-màu cho tab 1000 Levels dùng LẠI Y HỆT (giữ closure cutZones/spatialZones…) ----
  if (typeof window !== "undefined") {
    window.__batch = window.__batch || {};
    window.__batch.genLevelCore = genLevelCore;   // sinh 1 level theo target + zone confinement (VÙNG NGẦM)
    window.__batch.genFull = genFull;              // engine đặt rắn thô (1 lần/gọi) — nhanh hơn genLevelCore (4 lần)
    window.__batch.floodZones = floodZones;        // lấp ô chưa màu -> vùng màu gần nhất (BFS)
    window.__batch.autoFillHoles = autoFillHoles;  // lấp lỗ bị bao quanh (cũ, chỉ ô bao đủ 4 phía)
    window.__batch.smartFillHoles = smartFillHoles;    // LẤP LỖ THÔNG MINH (phân loại giữ/lấp + hốc biên) — dùng chung
    window.__batch.mergeFilledZones = mergeFilledZones; // gộp vùng ô đã lấp -> màu tiếp xúc nhiều nhất
    window.__batch.cutZones = cutZones;                // chia vùng màu (pattern lát cắt) — expose để test độ đa dạng
    window.__batch.buildCoreSrc = buildCoreSrc;    // nguồn Worker ĐÃ KIỂM CHỨNG (genFull+deps) để dựng Worker riêng
  }
})();
