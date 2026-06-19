/* ============================================================================
 * SNAKE GO 2 — Bộ SINH HÀNG LOẠT có VẬT PHẨM (WB/BH/Linked/Corner/Pipe).
 * Độc lập Snake 1 (tái dùng generateMap()/buildMother() global). Tự tô màu theo
 * vùng, có trình sửa màu, chèn ảnh, clone. Pipe = đường hầm 2 đầu.
 * ==========================================================================*/
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  const DZ = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const opp = d => ({ up: "down", down: "up", left: "right", right: "left" }[d]);
  const CORNER_OPEN = { NE: ["up", "right"], NW: ["up", "left"], SE: ["down", "right"], SW: ["down", "left"] };
  const TIERS = (typeof DIFF_TIERS !== "undefined") ? DIFF_TIERS : [[20, "Rất dễ", "★"], [40, "Dễ", "★★"], [60, "Vừa", "★★★"], [80, "Khó", "★★★★"], [101, "Siêu khó", "★★★★★"]];
  const TIER_CLASS = ["tier1", "tier2", "tier3", "tier4", "tier5"], TIER_NUM = { "Rất dễ": 1, "Dễ": 2, "Vừa": 3, "Khó": 4, "Siêu khó": 5 };
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, rnd = n => Math.floor(Math.random() * n), $ = id => document.getElementById(id);
  const LS_KEY = "sg2-batch-v1", now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const PALETTE = [1, 5, 7, 11, 14, 20, 17, 26, 29, 35, 9, 23];   // chỉ số GAME_COLORS để tô vùng
  function cornerOut(type, dir) { const o = CORNER_OPEN[type], e = opp(dir); return e === o[0] ? o[1] : e === o[1] ? o[0] : null; }
  function dirOf(a, b) { const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y); return dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up"; }
  function inRect(c, el) { return c.x >= el.x && c.x < el.x + el.w && c.y >= el.y && c.y < el.y + el.h; }
  function cloneSnake(s) { return { id: s.id, dir: s.dir, cells: s.cells.map(c => ({ ...c })), link: s.link, mother: s.mother, fixedColor: s.fixedColor, ev: s.ev }; }

  const S = {
    W: 13, H: 13, shape: "rect", fill: 62, longPref: 55, minL: 2, maxL: 0, mother: false,
    diffMode: "range", diffMin: 0, diffMax: 100, count: 40,
    items: { link: false, corner: false, wb: false, bh: false, pipe: false, elevator: false },
    dens: { link: 40, corner: 25, wb: 25, bh: 15, pipe: 20, elevator: 50 },
    curve: [{ t: 0, v: 10 }, { t: 1, v: 92 }], imageMask: null, imgTh: 128, elevatorTrap: false,
  };
  const TOGGLE = [{ key: "link", label: "🔗 Linked Snake", unlock: 6 }, { key: "corner", label: "⌐ Corner", unlock: 11 }, { key: "wb", label: "📦 Wooden Box", unlock: 15 }, { key: "elevator", label: "🛗 Elevator", unlock: 26 }, { key: "bh", label: "🕳 Black Hole", unlock: 31 }, { key: "pipe", label: "🛢 Pipe (đường hầm)", unlock: 41 }];
  const SHAPES = [["rect", "▭ Chữ nhật"], ["circle", "⬤ Tròn/elip"], ["diamond", "◆ Thoi"], ["donut", "◎ Donut"], ["image", "🖼️ Từ ảnh"]];
  const PRESETS = { linear: [{ t: 0, v: 10 }, { t: 1, v: 92 }], easein: [{ t: 0, v: 8 }, { t: .55, v: 22 }, { t: .82, v: 55 }, { t: 1, v: 96 }], scurve: [{ t: 0, v: 8 }, { t: .25, v: 18 }, { t: .5, v: 50 }, { t: .75, v: 82 }, { t: 1, v: 94 }], steps: [{ t: 0, v: 15 }, { t: .33, v: 15 }, { t: .34, v: 45 }, { t: .66, v: 45 }, { t: .67, v: 80 }, { t: 1, v: 80 }] };

  let LIB = [], SEL = new Set(), sortMode = "id", filterTier = "all";
  let genBusy = false, genCancel = false, nextId = 1, mounted = false, dragIdx = -1;

  // ============================ MASK ============================
  function buildMask(shape, W, H) {
    if (shape === "image") return S.imageMask;
    if (shape === "rect") return null;
    const cx = (W - 1) / 2, cy = (H - 1) / 2, rx = W / 2 * .97, ry = H / 2 * .97, m = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const nx = (x - cx) / rx, ny = (y - cy) / ry, d = nx * nx + ny * ny; let ins = false; if (shape === "circle") ins = d <= 1; else if (shape === "diamond") ins = Math.abs(nx) + Math.abs(ny) <= 1; else if (shape === "donut") ins = d <= 1 && d >= .30; if (ins) m.add(x + "," + y); }
    return m.size >= 8 ? m : null;
  }

  // ============================ SOLVER (pipe = đường hầm 2 đầu) ============================
  // Dựng map tra-cứu vật phẩm 1 lần (tra O(1) mỗi bước tia thay vì quét mảng).
  function itemMaps(it) {
    const cor = it.corner.length ? new Map(it.corner.map(o => [o.x + "," + o.y, o])) : null;
    const wb = it.wb.length ? new Set(it.wb.map(o => o.x + "," + o.y)) : null;
    const bh = it.bh.length ? new Set(it.bh.map(o => o.x + "," + o.y)) : null;
    let pipeAt = null; if (it.pipe.length) { pipeAt = new Map(); it.pipe.forEach(p => p.cells.forEach((c, k) => pipeAt.set(c.x + "," + c.y, { p, k }))); }
    return { cor, wb, bh, pipeAt };
  }
  function occSet(snakes) { const s = new Set(); for (const o of snakes) for (const c of o.cells) s.add(c.x + "," + c.y); return s; }
  function rayResolve(snake, others, it, W, H, m, occ) {
    let { x, y } = snake.cells[0], dir = snake.dir;
    const body = new Set(snake.cells.slice(1).map(c => c.x + "," + c.y));
    m = m || itemMaps(it); occ = occ || occSet(others);   // dùng map dựng sẵn nếu được truyền vào
    let guard = 0, max = (W + H) * 6; const pipes = [];   // các pipe đã chui qua (để đếm số)
    while (guard++ < max) {
      x += DZ[dir].x; y += DZ[dir].y;
      if (x < 0 || y < 0 || x >= W || y >= H) return { ok: true, removed: true, reason: "edge", pipes };
      const key = x + "," + y;
      if (m.cor) { const cor = m.cor.get(key); if (cor) { const nd = cornerOut(cor.type, dir); if (!nd) return { ok: false, reason: "cornerwall" }; dir = nd; continue; } }
      if (m.bh && m.bh.has(key)) return { ok: true, removed: true, reason: "bh", pipes };
      if (m.pipeAt) { const ph = m.pipeAt.get(key);   // CHỈ vào ĐẦU VÀO (cells[0]) đúng hướng; còn lại = chặn
        if (ph) { if (ph.k === 0 && dir === dirOf(ph.p.cells[0], ph.p.cells[1])) { if (pipes.indexOf(ph.p) < 0) pipes.push(ph.p); const oe = ph.p.cells[ph.p.cells.length - 1], oa = ph.p.cells[ph.p.cells.length - 2]; dir = dirOf(oa, oe); x = oe.x; y = oe.y; continue; } return { ok: false, reason: "pipebody" }; } }
      if (m.wb && m.wb.has(key)) return { ok: false, reason: "wb" };
      if (body.has(key)) return { ok: false, reason: "self" };
      if (occ.has(key)) return { ok: false, reason: "snake" };
    }
    return { ok: false, reason: "loop" };
  }
  function escapeRoute(snake, others, it, W, H) {
    let { x, y } = snake.cells[0], dir = snake.dir; const route = []; let guard = 0, max = (W + H) * 6, end = "edge", endDir = dir;
    while (guard++ < max) {
      x += DZ[dir].x; y += DZ[dir].y;
      if (x < 0 || y < 0 || x >= W || y >= H) { end = "edge"; endDir = dir; break; }
      const cor = it.corner.find(c => c.x === x && c.y === y);
      if (cor) { const nd = cornerOut(cor.type, dir); route.push({ x, y }); if (!nd) { end = "edge"; break; } dir = nd; endDir = nd; continue; }
      if (it.bh.some(b => b.x === x && b.y === y)) { route.push({ x, y }); end = "absorb"; break; }
      let ph = null, pk = -1; for (const p of it.pipe) { const k = p.cells.findIndex(c => c.x === x && c.y === y); if (k >= 0) { ph = p; pk = k; break; } }
      if (ph) { if (pk === 0 && dir === dirOf(ph.cells[0], ph.cells[1])) { ph.cells.forEach(c => route.push({ x: c.x, y: c.y })); const oe = ph.cells[ph.cells.length - 1], oa = ph.cells[ph.cells.length - 2]; dir = dirOf(oa, oe); endDir = dir; x = oe.x; y = oe.y; continue; } route.push({ x, y }); end = "edge"; break; }
      route.push({ x, y });
    }
    return { route, end, endDir };
  }
  function groupsOf(snakes) { const m = new Map(), solo = []; snakes.forEach(s => { if (s.link) (m.get(s.link) || m.set(s.link, []).get(s.link)).push(s); else solo.push([s]); }); return [...m.values(), ...solo]; }
  function cloneItems(it) { return { wb: it.wb.map(o => ({ ...o })), bh: it.bh.map(o => ({ ...o })), corner: it.corner.map(o => ({ ...o })), pipe: it.pipe.map(p => ({ cells: p.cells.map(c => ({ ...c })), n: (typeof p.n === "number" && p.n > 0) ? p.n : 3 })) }; }
  function sg2Solve(snakes, items, W, H, elevators) {
    const els = Array.isArray(elevators) ? elevators : (elevators ? [elevators] : []);
    let work = snakes.map(cloneSnake); const curs = els.map(() => -1);   // -1 = tầng trên (rắn ngoài lấn vùng), chưa trồi tầng ẩn
    const it = cloneItems(items); let guard = 0; const N0 = work.length + els.reduce((a, e) => a + e.layers.reduce((b, l) => b + l.length, 0) + e.layers.length, 0) + 12;
    while (guard++ < N0) {
      let promoted = false;   // ELEVATOR: vùng SẠCH RẮN -> trồi tầng ẩn kế (mỗi vùng độc lập)
      els.forEach((el, ei) => { if (curs[ei] < el.layers.length - 1 && !work.some(sn => sn.cells.some(c => inRect(c, el)))) { curs[ei]++; el.layers[curs[ei]].forEach(s => work.push(cloneSnake(s))); promoted = true; } });
      const groups = groupsOf(work), escaping = [], usedPipes = [];
      const mp = itemMaps(it), allOcc = occSet(work);   // dựng 1 lần / sóng; nhóm đơn dùng allOcc (thân tự chặn qua `body`)
      for (const g of groups) { const occ = g.length === 1 ? allOcc : occSet(work.filter(o => g.indexOf(o) < 0)); const rs = g.map(s => rayResolve(s, null, it, W, H, mp, occ)); if (rs.every(r => r.ok && r.removed)) { escaping.push(g); rs.forEach(r => r.pipes && r.pipes.forEach(p => usedPipes.push(p))); } }
      const flat = escaping.flat();
      if (flat.length) { work = work.filter(o => flat.indexOf(o) < 0); for (let i = 0; i < flat.length; i++) it.wb.forEach(w => w.n--); it.wb = it.wb.filter(w => w.n > 0); usedPipes.forEach(p => p.n--); it.pipe = it.pipe.filter(p => p.n > 0); }
      if (!flat.length && !promoted) break;
    }
    return { solvable: work.length === 0 && els.every((el, ei) => curs[ei] >= el.layers.length - 1) };
  }
  function solvableWith(s, it, W, H, elevator) { return sg2Solve(s, it, W, H, elevator).solvable; }
  // Giải đợt (không elevator) -> trả về các con CÒN KẸT.
  function solveStuck(snakes, items, W, H) {
    let work = snakes.map(cloneSnake); const it = cloneItems(items); let guard = 0; const N0 = work.length + 4;
    while (work.length && guard++ < N0) {
      const groups = groupsOf(work), esc = [], up = [];
      const mp = itemMaps(it), allOcc = occSet(work);
      for (const g of groups) { const occ = g.length === 1 ? allOcc : occSet(work.filter(o => g.indexOf(o) < 0)); const rs = g.map(s => rayResolve(s, null, it, W, H, mp, occ)); if (rs.every(r => r.ok && r.removed)) { esc.push(g); rs.forEach(r => r.pipes && r.pipes.forEach(p => up.push(p))); } }
      const flat = esc.flat(); if (!flat.length) break;
      work = work.filter(o => flat.indexOf(o) < 0); for (let i = 0; i < flat.length; i++) it.wb.forEach(w => w.n--); it.wb = it.wb.filter(w => w.n > 0); up.forEach(p => p.n--); it.pipe = it.pipe.filter(p => p.n > 0);
    }
    return work;
  }
  // BẪY "giải phóng sớm": dọn vùng (giữ nguyên rắn ngoài) -> tầng trồi -> đếm rắn TẦNG bị KẸT (đối đầu rắn ngoài).
  function elevatorTrapCount(snakes, items, W, H, elevator) {
    if (!elevator || !elevator.layers.length) return 0;
    const layer = elevator.layers[0];
    const overlap = snakes.filter(s => s.cells.some(c => inRect(c, elevator))), nonOverlap = snakes.filter(s => !s.cells.some(c => inRect(c, elevator)));
    let work = overlap.map(cloneSnake); const walls = nonOverlap.map(cloneSnake); let guard = 0;   // dọn vùng với rắn ngoài làm TƯỜNG
    const wallOcc = occSet(walls), mp = itemMaps(items);
    while (work.length && guard++ < overlap.length + 4) {
      const groups = groupsOf(work), esc = [];
      const allOcc = new Set(wallOcc); work.forEach(o => o.cells.forEach(c => allOcc.add(c.x + "," + c.y)));   // work + walls, 1 lần/sóng
      for (const g of groups) { const occ = g.length === 1 ? allOcc : occSet(work.filter(o => g.indexOf(o) < 0).concat(walls)); if (g.every(s => { const r = rayResolve(s, null, items, W, H, mp, occ); return r.ok && r.removed; })) esc.push(g); }
      const flat = esc.flat(); if (!flat.length) break; work = work.filter(o => flat.indexOf(o) < 0);
    }
    if (work.length) return 0;   // không dọn được vùng nếu không đụng rắn ngoài -> không có bẫy
    const stuck = solveStuck(nonOverlap.concat(layer.map(cloneSnake)), items, W, H);
    return stuck.filter(s => layer.some(ls => ls.id === s.id)).length;   // số rắn tầng kẹt đối đầu
  }
  // 1 con rắn ở TRẠNG THÁI ĐẦU (xét cả rắn khác) có thoát được không — để kiểm tra vật phẩm có ĐẢO tính hợp lệ.
  // occ = TẤT CẢ rắn (thân con đang xét tự chặn qua `body`); dựng occ+map 1 lần rồi tái dùng cho mọi con.
  function escStates(snakes, items, W, H) { const m = itemMaps(items), occ = occSet(snakes); return snakes.map(sn => { if (sn.mother) return false; const r = rayResolve(sn, null, items, W, H, m, occ); return !!(r.ok && r.removed); }); }
  // có ≥1 con rắn bị ĐẢO kết quả thoát (so với before) khi có thêm vật phẩm
  function anyFlip(snakes, items, W, H, before) { const m = itemMaps(items), occ = occSet(snakes); return snakes.some((sn, i) => { if (sn.mother) return false; const r = rayResolve(sn, null, items, W, H, m, occ); return !!(r.ok && r.removed) !== before[i]; }); }

  // ============================ ĐỘ KHÓ = Snake 1 + 1 trọng số vật phẩm ============================
  function itemWeight(snakes, items, N) {
    let w = 0;
    items.wb.forEach(b => w += 3 + 1.2 * Math.min(b.n, N));
    groupsOf(snakes).filter(g => g.length > 1).forEach(g => w += (g.length - 1) * 4 + 2);
    w += items.corner.length * 2.2;
    items.pipe.forEach(p => w += 3 + 0.7 * Math.min(p.n, N) + p.cells.length * 0.3);
    w -= items.bh.length * 4;
    return clamp(w, -20, 42);
  }
  function sg2Difficulty(snakes, items, W, H, elevators) {
    const els = Array.isArray(elevators) ? elevators : (elevators ? [elevators] : []);
    const N = snakes.length; if (!N) return { score: 0, tier: "—", emoji: "" };
    const pieces = snakes.map((s, i) => ({ id: i + 1, dir: s.dir, cells: s.cells.map(c => ({ ...c })) }));
    let base = 0; if (typeof computeDifficulty === "function") { const d = computeDifficulty(pieces, W, H); if (d && typeof d.score === "number") base = d.score; }
    const evTerm = els.reduce((a, e) => a + clamp(6 + e.layers.length * 5, 0, 28), 0);
    let score = clamp(Math.round(base + itemWeight(snakes, items, N) + evTerm), 0, 100);
    const trap = els.reduce((a, e) => a + elevatorTrapCount(snakes, items, W, H, e), 0);
    score += trap * 5;   // mỗi bẫy (rắn tầng đối-đầu-gây-thua-nếu-trồi-sớm): +5 (TỔNG có thể vượt 100)
    const [, tier, emoji] = TIERS.find(t => Math.min(score, 100) < t[0]);
    return { score, tier, emoji, trap };
  }

  // ============================ SINH ============================
  function cellsUsed(s, it) { const u = new Set(); s.forEach(sn => sn.cells.forEach(c => u.add(c.x + "," + c.y))); it.wb.forEach(o => u.add(o.x + "," + o.y)); it.bh.forEach(o => u.add(o.x + "," + o.y)); it.corner.forEach(o => u.add(o.x + "," + o.y)); it.pipe.forEach(p => p.cells.forEach(c => u.add(c.x + "," + c.y))); return u; }
  function emptyCells(s, it, W, H, mask) { const used = cellsUsed(s, it), out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = x + "," + y; if (used.has(k) || (mask && !mask.has(k))) continue; out.push({ x, y }); } return out; }
  function tryAddItems(s, it, W, H, mask, kind, want, elevators, maxFails) {
    let added = 0; const FL = maxFails || 22;
    while (added < want) {   // KHÔNG trần cứng: mỗi cái đặt -> quét tới FL ô KHÁC NHAU (xáo trộn); không ô nào hợp lệ -> dừng
      const E = emptyCells(s, it, W, H, mask); if (!E.length) break;
      for (let i = E.length - 1; i > 0; i--) { const j = rnd(i + 1), t = E[i]; E[i] = E[j]; E[j] = t; }   // xáo trộn
      const before = escStates(s, it, W, H);                                  // trạng thái thoát TRƯỚC khi thêm (state cố định trong vòng trong)
      const tryN = Math.min(E.length, FL); let placed = false;
      for (let i = 0; i < tryN && !placed; i++) {
        const c = E[i]; let undo;
        if (kind === "bh") { it.bh.push({ x: c.x, y: c.y }); undo = () => it.bh.pop(); }
        else if (kind === "corner") { it.corner.push({ x: c.x, y: c.y, type: Object.keys(CORNER_OPEN)[rnd(4)] }); undo = () => it.corner.pop(); }
        else if (kind === "wb") { it.wb.push({ x: c.x, y: c.y, n: 1 + rnd(Math.min(6, s.length)) }); undo = () => it.wb.pop(); }
        const okSolve = kind === "bh" || solvableWith(s, it, W, H, elevators); // BH chỉ hỗ trợ -> không phá solvable (xét cả Elevator)
        if (okSolve && anyFlip(s, it, W, H, before)) { added++; placed = true; } else undo();   // PHẢI ĐẢO tính hợp lệ ≥1 con
      }
      if (!placed) break;   // không ô nào trong FL ô đặt được -> loại này bão hòa
    }
    return added;
  }
  // Đặt pipe CHẮN NGANG đường 1 con rắn: thân (ô giữa) nằm trên lane rắn -> con đó bị chặn,
  // PHẢI phá ống (cho rắn khác chui 2 đầu vuông góc) trước mới đi được.
  function pipeBlockingSnake(s, it, W, H, mask, elevators) {
    const used = cellsUsed(s, it);
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !used.has(x + "," + y) && (!mask || mask.has(x + "," + y));
    const cand = s.filter(sn => !sn.mother && !sn.link).slice().sort(() => Math.random() - .5); let budget = 24;
    const before = escStates(s, it, W, H);   // tính 1 lần (các combo chỉ thêm/bớt 1 pipe thử)
    for (const sn of cand) {
      const d = DZ[sn.dir], perp = (sn.dir === "up" || sn.dir === "down") ? { x: 1, y: 0 } : { x: 0, y: 1 };
      let x = sn.cells[0].x, y = sn.cells[0].y; const lane = [];
      for (let k = 0; k < W + H; k++) { x += d.x; y += d.y; if (x < 0 || y < 0 || x >= W || y >= H) break; if (!free(x, y)) break; lane.push({ x, y }); }
      for (const mid of lane.sort(() => Math.random() - .5)) {
        const e1 = { x: mid.x + perp.x, y: mid.y + perp.y }, e2 = { x: mid.x - perp.x, y: mid.y - perp.y };
        if (!free(e1.x, e1.y) || !free(e2.x, e2.y)) continue;
        if (budget-- <= 0) return false;
        const pipe = { cells: [e1, { x: mid.x, y: mid.y }, e2], n: 1 + rnd(2) }; it.pipe.push(pipe);   // đầu vào e1, ra e2, thân chắn lane
        if (solvableWith(s, it, W, H, elevators) && anyFlip(s, it, W, H, before)) return true;
        it.pipe.pop();
      }
    }
    return false;
  }
  // PIPE = đường hầm CONG như rắn (random-walk ưu tiên rẽ), 2 đầu là miệng, thân chặn.
  function tryAddPipes(s, it, W, H, mask, want, elevators, maxFails) {
    let made = 0, fails = 0; const FL = maxFails || 18;
    while (made < want && fails < FL) {   // KHÔNG trần cứng: dừng khi FL lần liên tiếp thất bại
      let ok = false;
      if (Math.random() < .6 && pipeBlockingSnake(s, it, W, H, mask, elevators)) ok = true;   // 60% pipe chắn đường rắn
      else {
        const used = cellsUsed(s, it);
        const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !used.has(x + "," + y) && (!mask || mask.has(x + "," + y));
        const starts = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (free(x, y)) starts.push({ x, y });
        if (!starts.length) break;
        let st = starts[rnd(starts.length)], path = [st], occ = new Set([st.x + "," + st.y]); const len = 3 + rnd(3);
        let cx = st.x, cy = st.y, last = null;
        for (let k = 1; k < len; k++) {
          let opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => free(cx + dx, cy + dy) && !occ.has((cx + dx) + "," + (cy + dy)));
          if (!opts.length) break;
          if (last) { const turns = opts.filter(([dx, dy]) => dx * last[0] + dy * last[1] === 0); if (turns.length && Math.random() < .65) opts = turns; }   // 65% RẼ -> cong như rắn
          const mv = opts[rnd(opts.length)]; cx += mv[0]; cy += mv[1]; last = mv; path.push({ x: cx, y: cy }); occ.add(cx + "," + cy);
        }
        if (path.length >= 2) {
          const before = escStates(s, it, W, H);
          const pipe = { cells: path, n: 1 + rnd(Math.min(5, s.length)) }; it.pipe.push(pipe);
          if (solvableWith(s, it, W, H, elevators) && anyFlip(s, it, W, H, before)) ok = true; else it.pipe.pop();   // PHẢI ĐẢO tính hợp lệ ≥1 con
        }
      }
      if (ok) { made++; fails = 0; } else fails++;
    }
    return made;
  }
  // Đường thoát của cụm Linked có dính HỐ ĐEN / ĐƯỜNG HẦM không? (rắn dính nhau, item lẻ làm tách -> không nhận)
  function linkedRouteBad(g, items, W, H) {
    const ri = { wb: [], bh: items.bh, corner: items.corner, pipe: items.pipe };   // bỏ wb (chặn tạm) để thấy bh/pipe phía sau; bỏ rắn khác để xem đường đi thật của cụm
    return g.some(m => { const r = rayResolve(m, [], ri, W, H); return r.reason === "bh" || (r.pipes && r.pipes.length > 0); });
  }
  // Dời 1 cụm Linked (g) sang ô trống khác sao cho KHÔNG thoát ngay + đường thoát KHÔNG dính bh/pipe + map VẪN giải được. Thành công -> cập nhật cells/dir tại chỗ.
  function relocateLinked(g, snakes, items, W, H, mask, elevators) {
    const k = g.length, L = g[0].cells.length, others = snakes.filter(o => g.indexOf(o) < 0);
    const used = cellsUsed(others, items);   // ô bị chiếm (KHÔNG tính cụm g -> được tái dùng chỗ cũ)
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (!mask || mask.has(x + "," + y)) && !used.has(x + "," + y);
    const open = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (free(x, y)) open.push({ x, y });
    for (let i = open.length - 1; i > 0; i--) { const j = rnd(i + 1), t = open[i]; open[i] = open[j]; open[j] = t; }
    let budget = 160, solveTries = 0;   // chặn cả số ô thử lẫn số lần kiểm giải-được (tránh chậm)
    for (const head of open) {
      const dirs = ["up", "right", "down", "left"]; for (let i = 3; i > 0; i--) { const j = rnd(i + 1), t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t; }
      for (const dir of dirs) {
        if (budget-- <= 0) return false;
        const D = DZ[dir], perp = (dir === "up" || dir === "down") ? { x: 1, y: 0 } : { x: 0, y: 1 };
        const lines = []; let ok = true;
        for (let s = 0; s < k && ok; s++) { const line = []; for (let t = 0; t < L; t++) { const X = head.x + perp.x * s - D.x * t, Y = head.y + perp.y * s - D.y * t; if (!free(X, Y)) { ok = false; break; } line.push({ x: X, y: Y }); } if (ok) lines.push(line); }
        if (!ok) continue;
        g.forEach((sn, s) => { sn.dir = dir; sn.cells = lines[s]; });   // đặt thử
        if (g.every(m => { const r = rayResolve(m, others, items, W, H); return r.ok && r.removed; })) continue;   // còn thoát ngay -> chỗ khác
        if (linkedRouteBad(g, items, W, H)) continue;                                                              // route dính bh/pipe -> chỗ khác
        if (++solveTries > 8) return false;                                                                        // quá nhiều lần kiểm giải-được -> bỏ
        if (solvableWith(snakes, items, W, H, elevators)) return true;                                             // kẹt + sạch + giải được -> chốt
      }
    }
    return false;
  }
  // Đặt 1 cụm Linked TRONG VÒNG round (sau khi đã có rắn ngoài/item): chọn đầu từ ô trống, k≥2 song song dài L≥2,
  // hướng bất kỳ; CHỈ chốt khi: KẸT lúc đầu + đường thoát sạch bh/pipe + map VẪN giải được. Trả true nếu đặt được.
  function placeOneLinked(snakes, items, W, H, mask, elevators) {
    const used = cellsUsed(snakes, items);
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (!mask || mask.has(x + "," + y)) && !used.has(x + "," + y);
    const open = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (free(x, y)) open.push({ x, y });
    for (let i = open.length - 1; i > 0; i--) { const j = rnd(i + 1), t = open[i]; open[i] = open[j]; open[j] = t; }
    const lid = 1 + snakes.reduce((m, s) => s.link ? Math.max(m, s.link) : m, 0), base = 700 + snakes.filter(s => s.link).length;
    let budget = 140, solveTries = 0;
    for (const head of open) {
      const dirs = ["up", "right", "down", "left"]; for (let i = 3; i > 0; i--) { const j = rnd(i + 1), t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t; }
      for (const dir of dirs) {
        if (budget-- <= 0) return false;
        const D = DZ[dir], perp = (dir === "up" || dir === "down") ? { x: 1, y: 0 } : { x: 0, y: 1 };
        const k = 2 + rnd(2), L = 2 + rnd(2), lines = []; let ok = true;
        for (let s = 0; s < k && ok; s++) { const line = []; for (let t = 0; t < L; t++) { const X = head.x + perp.x * s - D.x * t, Y = head.y + perp.y * s - D.y * t; if (!free(X, Y)) { ok = false; break; } line.push({ x: X, y: Y }); } if (ok) lines.push(line); }
        if (!ok) continue;
        const grp = lines.map((line, idx) => ({ id: base + idx, dir, cells: line, link: lid }));
        grp.forEach(s => snakes.push(s));
        const others = snakes.filter(o => grp.indexOf(o) < 0);
        const escapes = grp.every(m => { const r = rayResolve(m, others, items, W, H); return r.ok && r.removed; });
        let good = false;
        if (!escapes && !linkedRouteBad(grp, items, W, H)) {
          if (++solveTries > 8) { grp.forEach(s => { const i = snakes.indexOf(s); if (i >= 0) snakes.splice(i, 1); }); return false; }
          if (solvableWith(snakes, items, W, H, elevators)) good = true;
        }
        if (good) return true;
        grp.forEach(s => { const i = snakes.indexOf(s); if (i >= 0) snakes.splice(i, 1); });   // undo, thử chỗ khác
      }
    }
    return false;
  }
  // TÔ MÀU THEO VÙNG (BFS-Voronoi) -> fixedColor mỗi rắn (y tinh thần Snake 1)
  function zoneColor(snakes, W, H) {
    const cells = []; snakes.forEach(s => { if (!s.mother) s.cells.forEach(c => cells.push(c)); });
    if (!cells.length) return;
    const K = clamp(3 + Math.round(cells.length / 90), 3, 6), seeds = []; for (let i = 0; i < K; i++) seeds.push(cells[rnd(cells.length)]);
    const off = rnd(48), zc = seeds.map((_, i) => ((PALETTE[i % PALETTE.length] - 1 + off) % 48) + 1);
    snakes.forEach(s => { if (s.mother) { s.fixedColor = 0; return; } const h = s.cells[0]; let bi = 0, bd = 1e9; seeds.forEach((sd, i) => { const d = (sd.x - h.x) ** 2 + (sd.y - h.y) ** 2; if (d < bd) { bd = d; bi = i; } }); s.fixedColor = zc[bi]; });
  }

  // Lane phía trước mỗi rắn link (ô thẳng từ đầu tới rìa) — cấm đặt vật phẩm ở đây.
  function linkedLanes(snakes, W, H) {
    const f = new Set();
    snakes.filter(s => s.link).forEach(s => { let x = s.cells[0].x, y = s.cells[0].y; const d = DZ[s.dir]; for (let k = 0; k < W + H; k++) { x += d.x; y += d.y; if (x < 0 || y < 0 || x >= W || y >= H) break; f.add(x + "," + y); } });
    return f;
  }
  // ELEVATOR: chọn vùng chữ nhật >5×5 đặt BẤT KỲ trên bàn; tránh `avoid` (vùng elevator khác) + chừa 1 ô đệm.
  function placeElevator(W, H, shapeMask, avoid) {
    for (let tries = 0; tries < 70; tries++) {
      const ew = 5 + rnd(2), eh = 5 + rnd(2); if (ew > W - 2 || eh > H - 2) continue;
      const ex = rnd(W - ew + 1), ey = rnd(H - eh + 1);
      let ok = true; const cells = new Set();
      if (avoid && avoid.size) for (let y = ey - 1; y <= ey + eh && ok; y++) for (let x = ex - 1; x <= ex + ew; x++) if (avoid.has(x + "," + y)) { ok = false; break; }
      for (let y = ey; y < ey + eh && ok; y++) for (let x = ex; x < ex + ew; x++) { if (shapeMask && !shapeMask.has(x + "," + y)) { ok = false; break; } cells.add(x + "," + y); }
      if (ok) return { x: ex, y: ey, w: ew, h: eh, cells };
    }
    return null;
  }
  function evList(o) { return o.elevators || (o.elevator ? [o.elevator] : []); }   // đọc tương thích cả dạng cũ (đơn) lẫn mới (mảng)
  // Tầng ẩn: rắn map BÌNH THƯỜNG (generateMap) GIAM trong vùng -> bố trí đa dạng, hướng tự nhiên, dài ≥2, tương tác như thường.
  function buildElevatorLayers(elCells, nLayers, W, H, diff, startId) {
    const layers = []; let id = startId || 3000;
    for (let li = 0; li < nLayers; li++) {
      const m = generateMap(W, H, 45, diff, 0, { fill: 0.82, mask: elCells });
      if (!m || !m.length) return null;
      layers.push(m.map(p => ({ id: id++, dir: p.dir, cells: p.cells.map(c => ({ x: c.x, y: c.y })), ev: 1 })));
    }
    return layers;
  }
  function genOne(target) {
    const W = S.W, H = S.H, shapeMask = buildMask(S.shape, W, H);
    let elRects = [];
    if (S.items.elevator) {   // ĐẶT NHIỀU vùng Elevator tới khi không nhét được nữa (không giới hạn)
      const avoid = new Set(), elCap = clamp(Math.round((shapeMask ? shapeMask.size : W * H) / 90), 1, 3);   // mỗi vùng = 1 ràng buộc "giải được" -> giới hạn khả thi
      for (let i = 0; i < elCap; i++) { const r = placeElevator(W, H, shapeMask, avoid); if (!r) break; r.cells.forEach(k => avoid.add(k)); elRects.push(r); }
    }   // không đặt nổi vùng nào (board nhỏ) -> elRects rỗng -> map thường, KHÔNG loại
    const base = generateMap(W, H, S.longPref, target != null ? target : (S.diffMin + S.diffMax) / 2, 0, { fill: S.fill / 100, mask: shapeMask, minLen: S.minL, maxLen: S.maxL });   // sinh ĐÚNG dải độ dài ngay từ đầu
    if (!base || base.length < 1) return null;
    const snakes = base.map((p, i) => ({ id: i + 1, dir: p.dir, cells: p.cells.map(c => ({ x: c.x, y: c.y })), link: null }));   // Linked đặt trong VÒNG round (không còn pre-placement)
    if (snakes.length < 2) return null;
    if (S.mother && typeof buildMother === "function") { const internal = snakes.map(s => ({ id: s.id, dir: s.dir, cells: s.cells.map(c => ({ ...c })) })); let mo = []; try { mo = buildMother(internal, W, H, 1, shapeMask ? Array.from(shapeMask) : null) || []; } catch (e) { mo = []; } mo.forEach((m, k) => snakes.push({ id: 900 + k, dir: m.dir, cells: m.cells.map(c => ({ x: c.x, y: c.y })), link: null, mother: true })); }
    let elevators = null;
    if (elRects.length) {
      const emptyIt = { wb: [], bh: [], corner: [], pipe: [] }, diff = target != null ? target : 50;
      if (S.elevatorTrap) {   // BẬT Bẫy: cần đúng hình bẫy (hiếm) -> giữ chặt all-or-nothing, dựng cả bộ tới khi có ≥1 bẫy
        for (let att = 0; att < 16; att++) {
          const evs = []; let bad = false;
          for (let ri = 0; ri < elRects.length; ri++) { const r = elRects[ri]; const layers = buildElevatorLayers(r.cells, 1, W, H, diff, 3000 + ri * 1000); if (!layers) { bad = true; break; } evs.push({ x: r.x, y: r.y, w: r.w, h: r.h, layers }); }
          if (bad || !solvableWith(snakes, emptyIt, W, H, evs)) continue;
          if (evs.reduce((a, e) => a + elevatorTrapCount(snakes, emptyIt, W, H, e), 0) > 0) { elevators = evs; break; }
        }
        if (!elevators) return null;   // không ra bẫy -> loại (đây là chế độ khó có chủ đích)
      } else {   // TẮT Bẫy (thường): dựng TỪNG vùng độc lập, GIỮ vùng nào còn giải được, vùng nào fail -> BỎ (thành board thường), KHÔNG loại map
        const kept = [];
        for (let ri = 0; ri < elRects.length; ri++) { const r = elRects[ri];
          for (let att = 0; att < 8; att++) {
            const layers = buildElevatorLayers(r.cells, 1, W, H, diff, 3000 + ri * 1000); if (!layers) continue;
            const ev = { x: r.x, y: r.y, w: r.w, h: r.h, layers };
            if (solvableWith(snakes, emptyIt, W, H, kept.concat([ev]))) { kept.push(ev); break; }
          }
        }
        if (kept.length) elevators = kept;
      }
    }   // mỗi vùng CHỈ 1 tầng ẩn
    const area = shapeMask ? shapeMask.size : W * H;
    let cov = 0; snakes.forEach(s => cov += s.cells.length);
    if (area > 0 && Math.round(cov / area * 100) < S.fill - 3) return null;   // fill thực phải >= (X−3)%
    const items = { wb: [], bh: [], corner: [], pipe: [] };
    {   // đặt vật phẩm KỂ CẢ khi có Elevator; chỉ chừa lane Linked + toàn bộ ô trong vùng Elevator
      const forbid = linkedLanes(snakes, W, H);
      if (elevators) elevators.forEach(el => { for (let y = el.y; y < el.y + el.h; y++) for (let x = el.x; x < el.x + el.w; x++) forbid.add(x + "," + y); });
      let itemMask = shapeMask;
      if (forbid.size) { itemMask = new Set(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = x + "," + y; if ((!shapeMask || shapeMask.has(k)) && !forbid.has(k)) itemMask.add(k); } }
      const A = (itemMask ? itemMask.size : W * H);   // ĐẶT THEO VÒNG: mỗi lượt qua từng loại đặt 1 cái; dừng khi cả vòng không loại nào đặt được
      const bhCap = Math.max(1, Math.round(W * H / 80));   // HỐ ĐEN có trần theo diện tích board (20×20 -> 5)
      const kinds = []; if (S.items.link) kinds.push("link"); if (S.items.corner) kinds.push("corner"); if (S.items.wb) kinds.push("wb"); if (S.items.pipe) kinds.push("pipe"); if (S.items.bh) kinds.push("bh");   // 🔗 Linked Ở TRONG VÒNG (đặt đầu vì cụm to, cần chỗ trước)
      let progress = true, rounds = 0;
      while (progress && rounds++ < A + 4) {
        progress = false;
        for (const k of kinds) {   // lia qua từng loại dù đặt được hay không (thử tới 18 ô khác nhau/lượt)
          if (k === "bh" && items.bh.length >= bhCap) continue;   // 🕳 đã đủ trần -> bỏ qua
          const got = k === "link" ? (placeOneLinked(snakes, items, W, H, itemMask, elevators) ? 1 : 0)
                    : k === "pipe" ? tryAddPipes(snakes, items, W, H, itemMask, 1, elevators, 18)
                    : tryAddItems(snakes, items, W, H, itemMask, k, 1, elevators, 18);
          if (got > 0) progress = true;
        }
      }
    }
    if (!solvableWith(snakes, items, W, H, elevators)) {   // map bí -> thử BỎ cụm Linked gây bí (thay vì loại cả map)
      const drop = g => g.forEach(m => { const i = snakes.indexOf(m); if (i >= 0) snakes.splice(i, 1); });
      let solved = false;
      for (const g of groupsOf(snakes).filter(gr => gr.length > 1)) {   // (1) thử bỏ TỪNG cụm; cứu được thì giữ bỏ, không thì trả lại
        drop(g);
        if (solvableWith(snakes, items, W, H, elevators)) { solved = true; break; }
        g.forEach(m => snakes.push(m));   // cụm này không phải thủ phạm -> trả lại, thử cụm khác
      }
      if (!solved) {   // (2) không cụm đơn nào cứu -> bỏ HẾT linked thử lần cuối; vẫn bí (không do linked) -> mới loại map
        groupsOf(snakes).filter(gr => gr.length > 1).forEach(drop);
        if (!solvableWith(snakes, items, W, H, elevators)) return null;
      }
    }
    // Cụm Linked phải: (a) BỊ CHẶN lúc mới vào, (b) đường thoát KHÔNG dính bh/pipe (rắn dính nhau, item lẻ làm tách).
    // Vi phạm -> DỜI sang chỗ khác; không dời được -> BỎ riêng cụm đó (KHÔNG loại map).
    for (const g of groupsOf(snakes).filter(gr => gr.length > 1)) {
      const others = snakes.filter(o => g.indexOf(o) < 0);
      const escapesNow = g.every(m => { const r = rayResolve(m, others, items, W, H); return r.ok && r.removed; });
      if (!escapesNow && !linkedRouteBad(g, items, W, H)) continue;   // kẹt + đường thoát sạch -> giữ
      if (!relocateLinked(g, snakes, items, W, H, shapeMask, elevators)) g.forEach(m => { const i = snakes.indexOf(m); if (i >= 0) snakes.splice(i, 1); });   // dời được thì thôi, không thì bỏ cụm
    }
    const d = sg2Difficulty(snakes, items, W, H, elevators); if (d.tier === "KẸT") return null;
    if (S.items.elevator && S.elevatorTrap && !d.trap) return null;   // CHỈ ép khi BẬT Bẫy; tắt thì nhận cả bẫy ngẫu nhiên (không loại oan)
    zoneColor(snakes, W, H);
    if (elevators) elevators.forEach((el, ej) => el.layers.forEach((layer, li) => layer.forEach((s, i) => { s.fixedColor = ((PALETTE[i % PALETTE.length] - 1 + (li + ej) * 7) % 48) + 1; })));   // tô màu tầng
    return { id: nextId++, W, H, snakes, items, score: d.score, tier: d.tier, emoji: d.emoji, shapeName: S.shape, ...(elevators ? { elevators } : {}), ...(d.trap ? { trap: d.trap } : {}) };
  }

  // ============================ ĐƯỜNG CONG ============================
  function evalCurve(p, t) { if (t <= p[0].t) return p[0].v; if (t >= p[p.length - 1].t) return p[p.length - 1].v; for (let i = 0; i < p.length - 1; i++) if (t >= p[i].t && t <= p[i + 1].t) { const f = (t - p[i].t) / ((p[i + 1].t - p[i].t) || 1); return p[i].v + (p[i + 1].v - p[i].v) * f; } return p[p.length - 1].v; }
  function sampleCurve(pts, n) { const p = pts.slice().sort((a, b) => a.t - b.t), out = []; for (let i = 0; i < n; i++) out.push(clamp(Math.round(evalCurve(p, n === 1 ? .5 : i / (n - 1))), 0, 100)); return out; }
  function drawCurve() {
    const cv = $("sg2Curve"); if (!cv) return; const g = cv.getContext("2d"), W = cv.width, H = cv.height, PAD = { l: 26, r: 10, t: 10, b: 18 };
    const cX = t => PAD.l + t * (W - PAD.l - PAD.r), cY = v => H - PAD.b - v / 100 * (H - PAD.t - PAD.b);
    g.clearRect(0, 0, W, H); g.fillStyle = "#0e1424"; g.fillRect(0, 0, W, H); g.strokeStyle = "rgba(255,255,255,.08)"; g.fillStyle = "rgba(255,255,255,.3)"; g.font = "10px sans-serif";
    [0, 20, 40, 60, 80, 100].forEach(v => { const y = cY(v); g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke(); g.fillText(String(v), 4, y + 3); });
    const p = S.curve.slice().sort((a, b) => a.t - b.t); g.strokeStyle = "#5b9dff"; g.lineWidth = 2; g.beginPath(); for (let i = 0; i <= 80; i++) { const t = i / 80, x = cX(t), y = cY(evalCurve(p, t)); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    S.curve.forEach((pt, i) => { g.beginPath(); g.arc(cX(pt.t), cY(pt.v), 5, 0, 7); g.fillStyle = (i === 0 || i === S.curve.length - 1) ? "#e0b84f" : "#e6e9ef"; g.fill(); g.strokeStyle = "#0f1115"; g.lineWidth = 1.5; g.stroke(); });
  }
  function curvePx(e) { const cv = $("sg2Curve"), r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; }
  function curveInvT(px) { const cv = $("sg2Curve"); return clamp((px - 26) / (cv.width - 36), 0, 1); }
  function curveInvV(py) { const cv = $("sg2Curve"); return clamp((cv.height - 18 - py) / (cv.height - 28) * 100, 0, 100); }

  // ============================ CHẠY SINH ============================
  function runGen() {
    if (genBusy) return; genBusy = true; genCancel = false;
    const count = clamp(S.count, 1, 300), lo = Math.min(S.diffMin, S.diffMax), hi = Math.max(S.diffMin, S.diffMax), curveT = S.diffMode === "curve" ? sampleCurve(S.curve, count) : null;
    $("sg2Gen").disabled = true; $("sg2Cancel").style.display = "inline-flex";
    let made = 0, tried = 0; const maxTries = count * 320 + 800;
    const tick = () => {
      if (genCancel || made >= count || tried >= maxTries) { finishGen(made, tried); return; }
      const t0 = now();
      while (now() - t0 < 28 && made < count && !genCancel) {
        const tgt = curveT ? curveT[made] : lo + (hi - lo) * Math.random(); const lvl = genOne(tgt); tried++;
        const ok = lvl && (curveT ? Math.abs(lvl.score - tgt) <= 4 : (lvl.score >= lo && lvl.score <= hi));
        if (ok) { LIB.push(lvl); made++; addCard(lvl); }
      }
      $("sg2Prog").style.width = Math.round(made / count * 100) + "%"; $("sg2ProgInfo").textContent = `Đã sinh ${made}/${count} · thử ${tried}`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function finishGen(made, tried) { genBusy = false; $("sg2Gen").disabled = false; $("sg2Cancel").style.display = "none"; $("sg2ProgInfo").textContent = `Xong: ${made} level (thử ${tried}).`; saveLib(); }

  // ============================ RENDER ============================
  function colorFor(s, i) { if (s.mother) return "#e8c25a"; if (typeof gameColor === "function" && s.fixedColor >= 1) { const c = gameColor(s.fixedColor); if (c) return c; } if (typeof gameColor === "function") { const c = gameColor(((s.id || i + 1) % 48) + 1); if (c) return c; } return ["#4a7dff", "#13a673", "#cf9a1e", "#e34d6b", "#9869ff", "#0fb2b8"][(s.id || i) % 6]; }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function lbl(g, t, cx, cy, c, col) { g.fillStyle = col; g.font = `800 ${Math.max(8, c * .4)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(t), cx, cy); }
  function drawGrid(g, W, H, c) { g.fillStyle = "#0e1424"; g.fillRect(0, 0, W * c, H * c); g.strokeStyle = "rgba(120,150,210,.1)"; g.lineWidth = 1; for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(x * c + .5, 0); g.lineTo(x * c + .5, H * c); g.stroke(); } for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(0, y * c + .5); g.lineTo(W * c, y * c + .5); g.stroke(); } }
  function drawItems(g, it, c) {
    it.bh.forEach(o => { const cx = o.x * c + c / 2, cy = o.y * c + c / 2, gr = g.createRadialGradient(cx, cy, c * .05, cx, cy, c * .5); gr.addColorStop(0, "#000"); gr.addColorStop(.65, "#2a1b4d"); gr.addColorStop(1, "rgba(140,90,240,.18)"); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, c * .46, 0, 7); g.fill(); g.strokeStyle = "#9a7bff"; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, c * .46, 0, 7); g.stroke(); });
    it.corner.forEach(o => { const cx = o.x * c + c / 2, cy = o.y * c + c / 2, op = CORNER_OPEN[o.type]; g.fillStyle = "rgba(255,150,40,.14)"; g.fillRect(o.x * c, o.y * c, c, c); g.strokeStyle = "#ff9d3c"; g.lineWidth = Math.max(2, c * .15); g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); g.moveTo(cx + DZ[op[0]].x * c * .42, cy + DZ[op[0]].y * c * .42); g.lineTo(cx, cy); g.lineTo(cx + DZ[op[1]].x * c * .42, cy + DZ[op[1]].y * c * .42); g.stroke(); });
    it.wb.forEach(o => { const x = o.x * c, y = o.y * c, p = c * .1; g.fillStyle = "#8a5a2b"; rrect(g, x + p, y + p, c - 2 * p, c - 2 * p, c * .14); g.fill(); g.strokeStyle = "#5e3c1a"; g.lineWidth = Math.max(1, c * .05); g.stroke(); g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x + p, y + c / 2); g.lineTo(x + c - p, y + c / 2); g.stroke(); lbl(g, o.n, x + c / 2, y + c / 2, c, "#fff"); });
    it.pipe.forEach(p => drawPipe(g, p, c));
  }
  function drawPipe(g, p, c) {
    const pts = p.cells.map(cc => ({ x: cc.x * c + c / 2, y: cc.y * c + c / 2 })); g.lineCap = "round"; g.lineJoin = "round";
    [[.72, "#2a86e6"], [.5, "#5cb0ff"], [.14, "rgba(255,255,255,.45)"]].forEach(([w, col]) => { g.strokeStyle = col; g.lineWidth = c * w; g.beginPath(); pts.forEach((pt, k) => k ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)); g.stroke(); });
    const tri = (px, py, d, col, sz) => { const ppx = -d.y, ppy = d.x; g.fillStyle = col; g.beginPath(); g.moveTo(px + d.x * sz, py + d.y * sz); g.lineTo(px + ppx * sz * .8, py + ppy * sz * .8); g.lineTo(px - ppx * sz * .8, py - ppy * sz * .8); g.closePath(); g.fill(); };
    const ex = pts[pts.length - 1], exd = DZ[dirOf(p.cells[p.cells.length - 2], p.cells[p.cells.length - 1])];   // ĐẦU RA: bịt + mũi tên ra
    g.fillStyle = "#0c2f5c"; g.beginPath(); g.arc(ex.x, ex.y, c * .24, 0, 7); g.fill(); g.strokeStyle = "#7fb0e6"; g.lineWidth = Math.max(1.5, c * .07); g.beginPath(); g.arc(ex.x, ex.y, c * .27, 0, 7); g.stroke();
    tri(ex.x + exd.x * c * .3, ex.y + exd.y * c * .3, exd, "#bfe0ff", c * .16);
    const en = pts[0], end = DZ[dirOf(p.cells[0], p.cells[1])];   // ĐẦU VÀO: badge số + mũi tên chỉ VÀO (hướng phải khớp)
    g.fillStyle = "#1565c8"; g.beginPath(); g.arc(en.x, en.y, c * .36, 0, 7); g.fill(); g.fillStyle = "#eaf4ff"; g.beginPath(); g.arc(en.x, en.y, c * .27, 0, 7); g.fill(); lbl(g, p.n != null ? p.n : "", en.x, en.y, c, "#1565c8");
    tri(en.x - end.x * c * .52, en.y - end.y * c * .52, end, "#1565c8", c * .17);
  }
  function drawSnakeBody(g, s, i, c, opt) {
    opt = opt || {}; const color = opt.color || colorFor(s, i), ox = opt.ox || 0, oy = opt.oy || 0;
    g.save(); if (opt.alpha != null) g.globalAlpha = opt.alpha; if (opt.glow) { g.shadowColor = opt.glow; g.shadowBlur = c * .8; }
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(2, c * .44); g.lineCap = "round"; g.lineJoin = "round";
    const pts = s.cells.map(cc => ({ x: cc.x * c + c / 2 + ox, y: cc.y * c + c / 2 + oy }));
    if (pts.length > 1) { g.beginPath(); g.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y); for (let k = pts.length - 2; k >= 0; k--) g.lineTo(pts[k].x, pts[k].y); g.stroke(); }
    const d = DZ[s.dir], h = pts[0], t = c * .52, b = c * .36, px = -d.y, py = d.x;
    g.beginPath(); g.moveTo(h.x + d.x * t, h.y + d.y * t); g.lineTo(h.x + px * b, h.y + py * b); g.lineTo(h.x - px * b, h.y - py * b); g.closePath(); g.fill(); g.restore();
  }
  function drawLinkAnchors(g, snakes, c) {
    const G = {}; snakes.forEach(s => { if (s.link) (G[s.link] = G[s.link] || []).push(s); });
    Object.values(G).forEach(grp => { if (grp.length < 2) return; let a = 1e9, b = 1e9, x2 = -1e9, y2 = -1e9; grp.forEach(s => s.cells.forEach(cc => { a = Math.min(a, cc.x); b = Math.min(b, cc.y); x2 = Math.max(x2, cc.x); y2 = Math.max(y2, cc.y); }));
      g.save(); g.strokeStyle = "rgba(255,255,255,.6)"; g.setLineDash([5, 4]); g.lineWidth = 2; rrect(g, a * c + 2.5, b * c + 2.5, (x2 - a + 1) * c - 5, (y2 - b + 1) * c - 5, c * .28); g.stroke(); g.setLineDash([]);
      g.fillStyle = "rgba(255,255,255,.92)"; g.font = `700 ${Math.max(9, c * .34)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("🔗", (a + x2 + 1) / 2 * c, b * c + c * .16); g.restore(); });
  }
  function drawElevator(g, el, c, cur, nLayers) {
    const x = el.x * c, y = el.y * c, w = el.w * c, h = el.h * c; g.save();
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, "rgba(255,190,70,.20)"); gr.addColorStop(1, "rgba(255,140,40,.10)"); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(255,190,70,.85)"; g.lineWidth = Math.max(2, c * .1); g.setLineDash([7, 5]); g.strokeRect(x + 1, y + 1, w - 2, h - 2); g.setLineDash([]);
    g.strokeStyle = "#ffd27a"; g.lineWidth = Math.max(2, c * .13); const L = c * .55; g.lineCap = "round";
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => { g.beginPath(); g.moveTo(cx + sx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * L); g.stroke(); });
    const bw = Math.min(w, c * 2.6), bh = Math.max(12, c * .46); g.fillStyle = "rgba(20,12,0,.62)"; rrect(g, x, y, bw, bh, 6); g.fill();
    g.fillStyle = "#ffd98a"; g.font = `800 ${Math.max(9, c * .3)}px sans-serif`; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(`🛗 ${cur + 2}/${nLayers + 1}`, x + 4, y + bh / 2 + 1);   // stage: top + N tầng ẩn
    g.restore();
  }
  function drawLevel(g, level, c, runtime, hide, selSet) {
    const W = level.W, H = level.H, it = runtime ? runtime.items : level.items; let snakes = runtime ? runtime.snakes : level.snakes;
    if (hide) snakes = snakes.filter(s => !hide.has(s.id));
    drawGrid(g, W, H, c);
    const els = runtime ? (runtime.elevators || []) : evList(level);
    els.forEach(el => drawElevator(g, el, c, runtime ? el.cur : -1, el.layers.length));
    drawItems(g, it, c);
    snakes.forEach((s, i) => drawSnakeBody(g, s, i, c, selSet && selSet.has(s.id) ? { glow: "#fff" } : null));
    drawLinkAnchors(g, snakes, c);
  }

  // ============================ THƯ VIỆN + TOOLBAR ============================
  function tierIdx(t) { return Math.max(0, TIERS.findIndex(x => x[1] === t)); }
  function visibleList() { let l = LIB.slice(); if (filterTier !== "all") l = l.filter(x => String(TIER_NUM[x.tier] || 0) === filterTier); if (sortMode === "scoreAsc") l.sort((a, b) => a.score - b.score); else if (sortMode === "scoreDesc") l.sort((a, b) => b.score - a.score); else l.sort((a, b) => a.id - b.id); return l; }
  function drawThumb(cv, lvl) { const px = Math.max(4, Math.floor(150 / Math.max(lvl.W, lvl.H))); cv.width = lvl.W * px; cv.height = lvl.H * px; drawLevel(cv.getContext("2d"), lvl, px, null); }
  function addCard(lvl) {
    const grid = $("sg2Lib"); if (!grid) return;
    const card = document.createElement("div"); card.className = "sg2-card" + (SEL.has(lvl.id) ? " sel" : ""); card._lvl = lvl;
    const top = document.createElement("div"); top.className = "sg2-card-top";
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.className = "sg2-chk"; chk.checked = SEL.has(lvl.id); chk.addEventListener("click", e => e.stopPropagation());
    chk.addEventListener("change", () => { chk.checked ? SEL.add(lvl.id) : SEL.delete(lvl.id); card.classList.toggle("sel", chk.checked); updateSelInfo(); });
    const badge = document.createElement("span"); badge.className = "tierbadge " + (TIER_CLASS[tierIdx(lvl.tier)] || "tier1"); badge.textContent = lvl.score + " " + (lvl.emoji || "");
    top.append(chk, badge); card.appendChild(top);
    const wrap = document.createElement("div"); wrap.className = "sg2-card-cv"; const cc = document.createElement("canvas"); cc._card = card; drawThumb(cc, lvl);
    const ov = document.createElement("div"); ov.className = "sg2-card-ov"; ov.textContent = "▶"; wrap.append(cc, ov);
    if (lvl.trap) { const tf = document.createElement("div"); tf.className = "sg2-trap-flag"; tf.textContent = "⚠️ BẪY" + (lvl.trap > 1 ? " ×" + lvl.trap : ""); tf.title = "Có bẫy giải-phóng-sớm: " + lvl.trap; wrap.appendChild(tf); }
    wrap.addEventListener("click", () => openPlay(lvl)); card.appendChild(wrap);
    const meta = document.createElement("div"); meta.className = "sg2-card-meta"; const items = []; const I = lvl.items;
    if (I.wb.length) items.push("📦" + I.wb.length); if (I.bh.length) items.push("🕳" + I.bh.length); if (I.corner.length) items.push("⌐" + I.corner.length); if (I.pipe.length) items.push("🛢" + I.pipe.length);
    const nLink = new Set(lvl.snakes.filter(s => s.link).map(s => s.link)).size; if (nLink) items.push("🔗" + nLink);
    { const e = evList(lvl); if (e.length) items.push("🛗" + e.length); }
    if (lvl.trap) items.push("⚠️" + lvl.trap);
    meta.innerHTML = `<span>#${lvl.id} · ${lvl.snakes.length}🐍</span><span>${items.join(" ")}</span>`; card.appendChild(meta);
    const act = document.createElement("div"); act.className = "sg2-card-act";
    const mk = (t, fn, cls) => { const b = document.createElement("button"); b.textContent = t; if (cls) b.className = cls; b.title = t; b.addEventListener("click", e => { e.stopPropagation(); fn(); }); return b; };
    act.append(mk("▶", () => openPlay(lvl)), mk("🎨", () => openColorEd(lvl)), mk("⧉", () => cloneLevel(lvl)), mk("🗑", () => delLevel(lvl.id), "danger")); card.appendChild(act);
    grid.appendChild(card); $("sg2LibCount").textContent = LIB.length;
  }
  function refreshThumb(lvl) { const grid = $("sg2Lib"); if (!grid) return; grid.querySelectorAll(".sg2-card").forEach(card => { if (card._lvl === lvl) { const cv = card.querySelector("canvas"); if (cv) drawThumb(cv, lvl); } }); }
  function rebuildLib() { const grid = $("sg2Lib"); if (!grid) return; grid.innerHTML = ""; visibleList().forEach(addCard); $("sg2LibCount").textContent = LIB.length; updateSelInfo(); }
  function updateSelInfo() { const el = $("sg2SelInfo"); if (el) el.textContent = `${SEL.size} chọn / ${LIB.length}`; const tg = $("sg2SelAll"); if (tg) { const v = visibleList(); tg.textContent = v.length && v.every(l => SEL.has(l.id)) ? "Bỏ chọn" : "Chọn hết"; } }
  function delLevel(id) { LIB = LIB.filter(l => l.id !== id); SEL.delete(id); saveLib(); rebuildLib(); }
  function delSelected() { if (!SEL.size) return; LIB = LIB.filter(l => !SEL.has(l.id)); SEL.clear(); saveLib(); rebuildLib(); }
  function selAllToggle() { const v = visibleList(), all = v.length && v.every(l => SEL.has(l.id)); v.forEach(l => all ? SEL.delete(l.id) : SEL.add(l.id)); rebuildLib(); }
  // CLONE: giữ layout rắn, RE-ROLL vật phẩm theo toggle hiện tại + tô lại màu (vật phẩm đổi tùy ý)
  function cloneLevel(lvl) {
    const W = lvl.W, H = lvl.H, snakes = lvl.snakes.map(s => ({ id: s.id, dir: s.dir, cells: s.cells.map(c => ({ ...c })), link: s.link, mother: s.mother }));
    const items = { wb: [], bh: [], corner: [], pipe: [] }, mask = buildMask(lvl.shapeName || "rect", W, H), area = mask ? mask.size : W * H;
    if (S.items.corner) tryAddItems(snakes, items, W, H, mask, "corner", area);
    if (S.items.wb) tryAddItems(snakes, items, W, H, mask, "wb", area);
    if (S.items.pipe) tryAddPipes(snakes, items, W, H, mask, area);
    if (S.items.bh) tryAddItems(snakes, items, W, H, mask, "bh", Math.max(1, Math.round(W * H / 80)));   // 🕳 có trần (20×20 -> 5)
    if (!solvableWith(snakes, items, W, H)) { items.wb = []; items.bh = []; items.corner = []; items.pipe = []; }
    zoneColor(snakes, W, H);
    const d = sg2Difficulty(snakes, items, W, H);
    LIB.push({ id: nextId++, W, H, snakes, items, score: d.score, tier: d.tier, emoji: d.emoji }); saveLib(); rebuildLib();
  }

  // ============================ TRÌNH SỬA MÀU (🎨) ============================
  const CE = { lvl: null, sel: new Set(), cv: null, ctx: null };
  function ensureColorEd() {
    if ($("sg2CeBd")) return;
    const bd = document.createElement("div"); bd.id = "sg2CeBd"; bd.className = "cedit-backdrop";
    bd.innerHTML = `<div class="cedit-modal"><div class="cedit-head"><h3>🎨 Sửa màu rắn — <span id="sg2CeTitle"></span></h3><button id="sg2CeClose" class="cedit-x">✕</button></div>
      <div class="cedit-body"><div class="cedit-canvas-wrap"><canvas id="sg2CeCv" width="440" height="440"></canvas></div>
        <div class="cedit-side"><div class="cedit-hint" id="sg2CeHint"></div><div class="cedit-swatches" id="sg2CeSw"></div></div></div>
      <div class="cedit-foot"><button id="sg2CeAll">Chọn hết</button><button id="sg2CeNone">Bỏ chọn</button><button id="sg2CeRand">🎲 Tô lại vùng</button><span class="cedit-spacer"></span><button id="sg2CeCancel">Hủy</button><button id="sg2CeSave" class="primary">Lưu</button></div></div>`;
    document.body.appendChild(bd);
    const sw = $("sg2CeSw"); for (let i = 1; i <= (typeof GAME_COLORS !== "undefined" ? GAME_COLORS.length : 48); i++) { const b = document.createElement("button"); b.className = "cedit-sw"; b.style.background = (typeof gameColor === "function" ? gameColor(i) : "#888"); b.dataset.ci = i; b.addEventListener("click", () => ceApply(i)); sw.appendChild(b); }
    CE.cv = $("sg2CeCv"); CE.ctx = CE.cv.getContext("2d"); CE.cv.addEventListener("click", ceClick);
    $("sg2CeClose").addEventListener("click", ceClose); $("sg2CeCancel").addEventListener("click", ceClose);
    $("sg2CeSave").addEventListener("click", ceSave); $("sg2CeAll").addEventListener("click", () => { CE.sel = new Set(CE.lvl.snakes.filter(s => !s.mother).map(s => s.id)); ceHint(); ceDraw(); });
    $("sg2CeNone").addEventListener("click", () => { CE.sel.clear(); ceHint(); ceDraw(); }); $("sg2CeRand").addEventListener("click", () => { zoneColor(CE.lvl.snakes, CE.lvl.W, CE.lvl.H); ceDraw(); });
    bd.addEventListener("click", e => { if (e.target === bd) ceClose(); });
  }
  function openColorEd(lvl) { ensureColorEd(); CE.lvl = lvl; CE.sel.clear(); $("sg2CeTitle").textContent = "#" + lvl.id; ceHint(); ceDraw(); $("sg2CeBd").classList.add("show"); }
  function ceClose() { const bd = $("sg2CeBd"); if (bd) bd.classList.remove("show"); CE.lvl = null; CE.sel.clear(); }
  function ceGeom() { const lvl = CE.lvl, S2 = CE.cv.width; return { c: S2 / Math.max(lvl.W, lvl.H), ox: (S2 - S2 / Math.max(lvl.W, lvl.H) * lvl.W) / 2, oy: (S2 - S2 / Math.max(lvl.W, lvl.H) * lvl.H) / 2 }; }
  function ceDraw() { const lvl = CE.lvl; if (!lvl) return; const { c, ox, oy } = ceGeom(); const g = CE.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, CE.cv.width, CE.cv.height); g.fillStyle = "#0e1424"; g.fillRect(0, 0, CE.cv.width, CE.cv.height); g.translate(ox, oy); drawLevel(g, lvl, c, null, null, CE.sel); g.setTransform(1, 0, 0, 1, 0, 0); const cur = CE.sel.size ? [...CE.sel].map(id => { const s = lvl.snakes.find(x => x.id === id); return s ? s.fixedColor : -1; }) : []; const same = cur.length && cur.every(v => v === cur[0]) ? cur[0] : -1; $("sg2CeSw").querySelectorAll(".cedit-sw").forEach(b => b.classList.toggle("on", +b.dataset.ci === same)); }
  function ceHint(msg) { const el = $("sg2CeHint"); if (el) el.innerHTML = msg || (CE.sel.size ? `Đang chọn <b>${CE.sel.size} rắn</b> — bấm 1 ô màu. Bấm con đã chọn để bỏ.` : "Bấm 1 hay nhiều <b>con rắn</b> để chọn, rồi bấm 1 ô màu."); }
  function ceClick(e) { if (!CE.lvl) return; const r = CE.cv.getBoundingClientRect(), { c, ox, oy } = ceGeom(); const px = (e.clientX - r.left) * (CE.cv.width / r.width), py = (e.clientY - r.top) * (CE.cv.height / r.height); const x = Math.floor((px - ox) / c), y = Math.floor((py - oy) / c); let hit = -1; CE.lvl.snakes.forEach(s => { if (s.mother) return; if (s.cells.some(cc => cc.x === x && cc.y === y)) hit = s.id; }); if (hit >= 0) { CE.sel.has(hit) ? CE.sel.delete(hit) : CE.sel.add(hit); ceHint(); ceDraw(); } }
  function ceApply(ci) { if (!CE.sel.size) { ceHint("⚠ Chọn ít nhất 1 con rắn trước."); return; } CE.sel.forEach(id => { const s = CE.lvl.snakes.find(x => x.id === id); if (s) s.fixedColor = ci; }); ceDraw(); }
  function ceSave() { if (CE.lvl) { saveLib(); refreshThumb(CE.lvl); } ceClose(); }

  // ============================ CHƠI THỬ + ANIMATION ============================
  const PLAY = { lvl: null, R: null, stars: 3, cv: null, ctx: null, anims: [], loopOn: false, bumpingIds: new Set() }; let fxRAF = null;
  function ensurePlayModal() {
    if ($("sg2PlayBd")) return;
    const bd = document.createElement("div"); bd.id = "sg2PlayBd"; bd.className = "sg2-play-bd";
    bd.innerHTML = `<div class="sg2-play-modal" id="sg2PlayModal"><div class="sg2-flash" id="sg2Flash"></div>
      <div class="sg2-play-head"><h3>🎮 <span id="sg2PlayTitle"></span></h3><div class="sg2-hud"><span class="sg2-stars" id="sg2PlayStars">⭐⭐⭐</span><span class="pill" id="sg2PlayLeft"></span></div><button id="sg2PlayClose" class="cedit-x">✕</button></div>
      <div class="sg2-play-body"><div class="sg2-board-glow"><canvas id="sg2PlayCv"></canvas></div><div class="sg2-win" id="sg2Win"></div></div>
      <div class="sg2-play-foot"><span class="sg2-msg" id="sg2PlayMsg"></span><button id="sg2PlayReset">⟲ Chơi lại</button></div></div>`;
    document.body.appendChild(bd);
    PLAY.cv = $("sg2PlayCv"); PLAY.ctx = PLAY.cv.getContext("2d"); PLAY.cv.addEventListener("click", onPlayClick);
    $("sg2PlayClose").addEventListener("click", closePlay); $("sg2PlayReset").addEventListener("click", () => startRun(PLAY.lvl));
    bd.addEventListener("click", e => { if (e.target === bd) closePlay(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && $("sg2PlayBd").classList.contains("show")) closePlay(); });
  }
  function openPlay(lvl) { ensurePlayModal(); $("sg2PlayTitle").textContent = `#${lvl.id} · ${lvl.tier} (${lvl.score})`; startRun(lvl); $("sg2PlayBd").classList.add("show"); }
  function closePlay() { const bd = $("sg2PlayBd"); if (bd) bd.classList.remove("show"); cancelAnimationFrame(fxRAF); PLAY.loopOn = false; PLAY.anims = []; PLAY.bumpingIds.clear(); PLAY.lvl = null; PLAY.R = null; }
  function promoteElevator(R) {   // mỗi vùng trống -> trồi tầng kế; trả về [{el, ids}] các vùng vừa trồi (cho hiệu ứng)
    const els = R.elevators || []; let pops = null;
    els.forEach(el => { let ids = null;
      while (el.cur < el.layers.length - 1 && !R.snakes.some(sn => sn.cells.some(c => inRect(c, el)))) { el.cur++; const added = el.layers[el.cur].map(cloneSnake); added.forEach(s => R.snakes.push(s)); ids = ids || new Set(); added.forEach(s => ids.add(s.id)); }
      if (ids) { pops = pops || []; pops.push({ el, ids }); }
    });
    return pops;
  }
  function startRun(lvl) {
    cancelAnimationFrame(fxRAF); PLAY.loopOn = false; PLAY.anims = []; PLAY.bumpingIds.clear(); PLAY.lvl = lvl; PLAY.stars = 3;
    PLAY.R = { snakes: lvl.snakes.map(cloneSnake), items: cloneItems(lvl.items) };
    const els = evList(lvl); if (els.length) { PLAY.R.elevators = els.map(e => ({ x: e.x, y: e.y, w: e.w, h: e.h, layers: e.layers, cur: -1 })); promoteElevator(PLAY.R); }   // tầng trên = rắn ngoài (đã lấn vùng); tầng ẩn trồi sau
    const w = $("sg2Win"); if (w) w.classList.remove("show"); setPlayMsg("Bấm 1 con rắn để bắn nó ra khỏi bàn."); drawPlay();
  }
  function playGeom() { const lvl = PLAY.lvl, max = Math.min(560, (window.innerWidth || 800) - 80, (window.innerHeight || 800) - 230); return Math.max(14, Math.floor(max / Math.max(lvl.W, lvl.H))); }
  function syncHud() { $("sg2PlayStars").textContent = "⭐".repeat(PLAY.stars) + "☆".repeat(Math.max(0, 3 - PLAY.stars)); $("sg2PlayLeft").textContent = "🐍 " + PLAY.R.snakes.length; }
  function setCanvasSize() { const lvl = PLAY.lvl, c = playGeom(), dpr = Math.min(2, window.devicePixelRatio || 1); PLAY.cv.width = lvl.W * c * dpr; PLAY.cv.height = lvl.H * c * dpr; PLAY.cv.style.width = lvl.W * c + "px"; PLAY.cv.style.height = lvl.H * c + "px"; PLAY.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return c; }
  function drawPlay() { if (!PLAY.lvl) return; const c = setCanvasSize(); drawLevel(PLAY.ctx, PLAY.lvl, c, PLAY.R, PLAY.bumpingIds.size ? PLAY.bumpingIds : null); syncHud(); return c; }
  function setPlayMsg(m) { const el = $("sg2PlayMsg"); if (el) el.textContent = m; }
  function onPlayClick(e) { if (!PLAY.R) return; const r = PLAY.cv.getBoundingClientRect(), c = playGeom(); const x = Math.floor((e.clientX - r.left) * (PLAY.lvl.W * c / r.width) / c), y = Math.floor((e.clientY - r.top) * (PLAY.lvl.H * c / r.height) / c); const s = PLAY.R.snakes.find(s => s.cells.some(cc => cc.x === x && cc.y === y)); if (s && !PLAY.bumpingIds.has(s.id)) tryMove(s); }
  // Đường đầu rắn đi được TỚI vật cản (theo corner/pipe), dừng TRƯỚC chỗ chặn -> để trượt tới rồi dội.
  function blockRoute(snake, others, it, W, H) {
    let { x, y } = snake.cells[0], dir = snake.dir; const route = []; const body = new Set(snake.cells.slice(1).map(c => c.x + "," + c.y)); let guard = 0, max = (W + H) * 6;
    while (guard++ < max) {
      const nx = x + DZ[dir].x, ny = y + DZ[dir].y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
      const cor = it.corner.find(c => c.x === nx && c.y === ny);
      if (cor) { const nd = cornerOut(cor.type, dir); if (!nd) break; route.push({ x: nx, y: ny }); dir = nd; x = nx; y = ny; continue; }
      let ph = null, pk = -1; for (const p of it.pipe) { const k = p.cells.findIndex(c => c.x === nx && c.y === ny); if (k >= 0) { ph = p; pk = k; break; } }
      if (ph) { if (pk === 0 && dir === dirOf(ph.cells[0], ph.cells[1])) { ph.cells.forEach(c => route.push({ x: c.x, y: c.y })); const oe = ph.cells[ph.cells.length - 1], oa = ph.cells[ph.cells.length - 2]; dir = dirOf(oa, oe); x = oe.x; y = oe.y; continue; } break; }
      if (it.bh.some(b => b.x === nx && b.y === ny)) break;
      if (it.wb.some(w => w.x === nx && w.y === ny)) break;
      if (body.has(nx + "," + ny)) break;
      if (others.some(o => o.cells.some(c => c.x === nx && c.y === ny))) break;
      route.push({ x: nx, y: ny }); x = nx; y = ny;
    }
    return { route, dir };
  }
  function addBump(group) {
    const c = playGeom(), R = PLAY.R, W = PLAY.lvl.W, H = PLAY.lvl.H, others = R.snakes.filter(o => group.indexOf(o) < 0);
    const bumps = group.map(m => { const bd = blockRoute(m, others, R.items, W, H); return { traj: buildTraj(m, bd.route, "block", bd.dir, c, colorFor(m, 0)), id: m.id }; });
    group.forEach(m => PLAY.bumpingIds.add(m.id)); PLAY.anims.push({ bump: true, bumps, t0: now() }); ensureFxLoop();
  }
  function buildTraj(snake, route, end, endDir, c, color) {
    const ctr = (x, y) => ({ x: x * c + c / 2, y: y * c + c / 2 });
    const track = snake.cells.map(cc => ctr(cc.x, cc.y)).reverse(); route.forEach(rc => track.push(ctr(rc.x, rc.y)));
    if (end === "edge") { let last = route.length ? route[route.length - 1] : snake.cells[0]; for (let k = 1; k <= 4; k++) track.push(ctr(last.x + DZ[endDir].x * k, last.y + DZ[endDir].y * k)); }
    else if (end === "block") { const last = route.length ? route[route.length - 1] : snake.cells[0], lc = ctr(last.x, last.y); track.push({ x: lc.x + DZ[endDir].x * c * .6, y: lc.y + DZ[endDir].y * c * .6 }); }   // lao nhẹ chạm vật cản
    const R = c * .4, sm = [track[0]];
    for (let i = 1; i < track.length - 1; i++) { const p0 = track[i - 1], p1 = track[i], p2 = track[i + 1]; const v1x = p1.x - p0.x, v1y = p1.y - p0.y, l1 = Math.hypot(v1x, v1y) || 1, v2x = p2.x - p1.x, v2y = p2.y - p1.y, l2 = Math.hypot(v2x, v2y) || 1, rr = Math.min(R, l1 / 2, l2 / 2); const ax = p1.x - v1x / l1 * rr, ay = p1.y - v1y / l1 * rr, bx = p1.x + v2x / l2 * rr, by = p1.y + v2y / l2 * rr; sm.push({ x: ax, y: ay }); if (Math.abs(v1x * v2y - v1y * v2x) > .5) for (let s = 1; s < 7; s++) { const tt = s / 7, mt = 1 - tt; sm.push({ x: mt * mt * ax + 2 * mt * tt * p1.x + tt * tt * bx, y: mt * mt * ay + 2 * mt * tt * p1.y + tt * tt * by }); } sm.push({ x: bx, y: by }); }
    sm.push(track[track.length - 1]); const cum = [0]; for (let i = 1; i < sm.length; i++) cum.push(cum[i - 1] + Math.hypot(sm[i].x - sm[i - 1].x, sm[i].y - sm[i - 1].y)); const total = cum[cum.length - 1];
    const pt = dist => { dist = clamp(dist, 0, total); let lo = 1, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < dist) lo = m + 1; else hi = m; } const t = (dist - cum[lo - 1]) / ((cum[lo] - cum[lo - 1]) || 1); return { x: sm[lo - 1].x + (sm[lo].x - sm[lo - 1].x) * t, y: sm[lo - 1].y + (sm[lo].y - sm[lo - 1].y) * t }; };
    return { pt, total, bodyLen: Math.max(c * .5, (snake.cells.length - 1) * c), color };
  }
  function drawSliding(g, tr, slid, c) {
    const headD = slid + tr.bodyLen, tailD = slid; if (tailD >= tr.total) return false;
    const pts = [], step = c / 5; for (let d = Math.min(headD, tr.total); d > tailD; d -= step) pts.push(tr.pt(d)); pts.push(tr.pt(Math.max(0, tailD)));
    g.save(); g.strokeStyle = tr.color; g.fillStyle = tr.color; g.lineWidth = Math.max(2, c * .44); g.lineCap = "round"; g.lineJoin = "round";
    if (pts.length > 1) { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k].x, pts[k].y); g.stroke(); }
    const a = pts[0], b = pts[1] || pts[0]; let dx = a.x - b.x, dy = a.y - b.y, L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; const t = c * .5, bb = c * .36, px = -dy, py = dx; g.beginPath(); g.moveTo(a.x + dx * t, a.y + dy * t); g.lineTo(a.x + px * bb, a.y + py * bb); g.lineTo(a.x - px * bb, a.y - py * bb); g.closePath(); g.fill(); g.restore(); return true;
  }
  function tryMove(snake) {
    const R = PLAY.R, W = PLAY.lvl.W, H = PLAY.lvl.H;
    const group = snake.link ? R.snakes.filter(o => o.link === snake.link) : [snake];
    const others = R.snakes.filter(o => group.indexOf(o) < 0);
    const res = group.map(m => rayResolve(m, others, R.items, W, H));
    if (!res.every(r => r.ok && r.removed)) {
      const wbHit = res.some(r => r.reason === "wb"), pipeHit = res.some(r => r.reason === "pipebody");
      PLAY.stars = Math.max(0, PLAY.stars - 1);   // MỌI va chạm (kể cả tông rắn khác) đều mất 1 ⭐
      setPlayMsg(wbHit ? "📦 Bị hộp gỗ chặn — mất ⭐" : pipeHit ? "🛢 Bị THÂN ỐNG chặn — phá ống trước! mất ⭐" : (group.length > 1 ? "🔗 Linked Snake kẹt — mất ⭐" : "💥 Tông phải vật cản — mất ⭐"));
      flashLose(); addBump(group); syncHud(); return;
    }
    const c = playGeom();
    const trajs = group.map(m => { const er = escapeRoute(m, others, R.items, W, H); return buildTraj(m, er.route, er.end, er.endDir, c, colorFor(m, 0)); });
    group.forEach(m => { R.snakes = R.snakes.filter(o => o !== m); });
    const rings = [];
    for (let i = 0; i < group.length; i++) R.items.wb.forEach(w => w.n--);
    R.items.wb.filter(w => w.n <= 0).forEach(w => rings.push({ x: w.x, y: w.y, color: "#caa06a" })); R.items.wb = R.items.wb.filter(w => w.n > 0);
    const usedPipes = []; res.forEach(r => r.pipes && r.pipes.forEach(p => usedPipes.push(p)));   // pipe đã chui qua -> giảm số
    usedPipes.forEach(p => p.n--); R.items.pipe.filter(p => p.n <= 0).forEach(p => p.cells.forEach(cc => rings.push({ x: cc.x, y: cc.y, color: "#5cb0ff" }))); R.items.pipe = R.items.pipe.filter(p => p.n > 0);
    const pop = promoteElevator(R);   // ELEVATOR: mỗi vùng trống -> trồi tầng kế
    if (pop) pop.forEach(pp => { pp.ids.forEach(id => PLAY.bumpingIds.add(id)); PLAY.anims.push({ elpop: true, el: pp.el, ids: pp.ids, t0: now() }); });   // 1 hiệu ứng trồi / vùng
    PLAY.anims.push({ trajs, rings, t0: now() }); syncHud();
    if (!R.snakes.length) celebrate(); else if (!anySnakeCanEscape(R)) showLoss(); else setPlayMsg(pop ? "🛗 Tầng trong vừa trồi lên!" : "");
    ensureFxLoop();
  }
  function ensureFxLoop() {
    if (PLAY.loopOn) return; PLAY.loopOn = true; const speed = playGeom() / 68, accelT = 150;
    const step = () => {
      if (!PLAY.R) { PLAY.loopOn = false; return; }
      const c = drawPlay(), g = PLAY.ctx, tnow = now();
      PLAY.anims = PLAY.anims.filter(an => {
        const e = tnow - an.t0;
        if (an.elpop) {   // ELEVATOR: tầng mới TRỒI LÊN (trong vùng) + chớp viền
          const el = an.el, dur = 460; if (!el || e >= dur) { an.ids.forEach(id => PLAY.bumpingIds.delete(id)); return false; }
          const p = e / dur, ease = 1 - (1 - p) * (1 - p), ra = 1 - ease;
          g.save();
          g.strokeStyle = `rgba(255,215,100,${0.9 * (1 - p)})`; g.lineWidth = c * .2 * (1 - p) + 2; g.strokeRect(el.x * c, el.y * c, el.w * c, el.h * c);
          g.beginPath(); g.rect(el.x * c, el.y * c, el.w * c, el.h * c); g.clip();
          const oy = ra * el.h * c;   // tầng ẩn TRỒI LÊN từ dưới vùng
          PLAY.R.snakes.forEach((s, i) => { if (an.ids.has(s.id)) drawSnakeBody(g, s, i, c, { oy, alpha: Math.min(1, p * 1.6), glow: "rgba(255,210,90,.5)" }); });
          g.restore(); return true;
        }
        if (an.bump) {   // TRƯỢT TỚI vật cản -> BẬT NGƯỢC -> CHOÁNG 💫
          const dur = 440; if (e >= dur) { an.bumps.forEach(b => PLAY.bumpingIds.delete(b.id)); return false; }
          const p = e / dur; let f; if (p < .4) { const t = p / .4; f = 1 - (1 - t) * (1 - t); } else { const q = (p - .4) / .6; f = Math.cos(q * Math.PI) * (1 - q); }   // tiến (ease-out) rồi dội về, tắt dần
          g.save(); an.bumps.forEach(b => { const tr = b.traj, ms = Math.max(0, tr.total - tr.bodyLen); drawSliding(g, tr, f * ms, c); }); g.restore();
          if (p > .38) { g.font = `${Math.max(11, c * .5)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; an.bumps.forEach(b => { const tr = b.traj, ms = Math.max(0, tr.total - tr.bodyLen), hp = tr.pt(Math.min(f * ms + tr.bodyLen, tr.total)); g.fillText("💫", hp.x + (Math.random() * 2 - 1) * 2, hp.y - c * .55); }); }
          return true;
        }
        const slid = e < accelT ? .5 * speed * (e * e / accelT) : speed * (e - accelT / 2); let alive = false; an.trajs.forEach(tr => { if (drawSliding(g, tr, slid, c)) alive = true; }); const rt = Math.min(1, e / 340); if (rt < 1) { g.save(); an.rings.forEach(rg => { g.globalAlpha = 1 - rt; g.strokeStyle = rg.color; g.lineWidth = 3; g.beginPath(); g.arc(rg.x * c + c / 2, rg.y * c + c / 2, c * .25 + rt * c, 0, 7); g.stroke(); }); g.restore(); } return alive || rt < 1;
      });
      if (PLAY.anims.length) fxRAF = requestAnimationFrame(step); else { PLAY.loopOn = false; drawPlay(); }
    };
    fxRAF = requestAnimationFrame(step);
  }
  function flashLose() { const m = $("sg2PlayModal"), f = $("sg2Flash"); if (m) { m.classList.remove("shake"); void m.offsetWidth; m.classList.add("shake"); } if (f) { f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); } }
  function celebrate() { const w = $("sg2Win"); if (!w) return; w.innerHTML = `<div class="sg2-win-emo">🎉</div><div class="sg2-win-title">Hoàn thành!</div><div class="sg2-win-stars">${"⭐".repeat(PLAY.stars)}${"☆".repeat(Math.max(0, 3 - PLAY.stars))}</div>`; w.classList.remove("show"); void w.offsetWidth; w.classList.add("show"); setPlayMsg("🎉 Hoàn thành!"); }
  function anySnakeCanEscape(R) { const W = PLAY.lvl.W, H = PLAY.lvl.H; return groupsOf(R.snakes).some(g => { const others = R.snakes.filter(o => g.indexOf(o) < 0); return g.every(m => { const r = rayResolve(m, others, R.items, W, H); return r.ok && r.removed; }); }); }
  function showLoss() { const w = $("sg2Win"); if (!w) return; w.innerHTML = `<div class="sg2-win-emo">💀</div><div class="sg2-win-title">Bí rồi!</div><div class="sg2-win-stars" style="font-size:15px;letter-spacing:0">Không nước nào thoát — Chơi lại</div>`; w.classList.remove("show"); void w.offsetWidth; w.classList.add("show"); setPlayMsg("💀 Bí rồi! (giải phóng Elevator quá sớm?)"); }

  // ============================ GIAO DIỆN (params trái · preview giữa · vật phẩm+sinh phải · thư viện full) ============================
  function mount() {
    if (mounted) return; mounted = true;
    $("sg2View").innerHTML = `
      <div class="sg2-wrap">
        <div class="sg2-settings">
          <div class="card"><h2><span class="step-no">1</span> Bàn & hình</h2>
            <div class="row"><label class="fld" style="flex:2">Hình bàn<select id="sg2Shape">${SHAPES.map(s => `<option value="${s[0]}">${s[1]}</option>`).join("")}</select></label></div>
            <div id="sg2ImgRow" style="display:none;margin-top:8px"><div class="row"><input type="file" id="sg2ImgFile" accept="image/*" hidden><button id="sg2ImgBtn" style="flex:1">🖼️ Chọn ảnh</button></div>
              <div class="row" style="margin-top:6px"><label class="fld" style="flex:1">Ngưỡng tối: <b id="sg2ThV">128</b><input type="range" id="sg2Th" min="0" max="255" value="128"></label></div></div>
            <div class="row" style="margin-top:8px"><label class="fld">Rộng <input type="number" id="sg2W" min="6" max="30" value="${S.W}"></label><label class="fld">Cao <input type="number" id="sg2H" min="6" max="30" value="${S.H}"></label></div>
            <div class="row" style="margin-top:8px"><label class="fld" style="flex:1">Độ lấp đầy: <b id="sg2FillV">${S.fill}</b>%<input type="range" id="sg2Fill" min="35" max="90" value="${S.fill}"></label></div>
            <div class="sg2-prev-wrap"><canvas id="sg2Prev" class="layout-preview"></canvas></div>
          </div>
          <div class="card"><h2><span class="step-no">2</span> Độ khó</h2>
            <div class="row" style="align-items:flex-end"><label class="fld" style="flex:0 0 auto">Kiểu<select id="sg2DiffMode"><option value="range">Khoảng (min–max)</option><option value="curve">Đường cong</option></select></label></div>
            <div id="sg2RangeWrap" class="row" style="margin-top:8px;align-items:flex-end"><label class="fld" style="flex:0 0 auto">Min <input type="number" id="sg2Min" min="0" max="100" value="0" style="width:62px"></label><label class="fld" style="flex:0 0 auto">Max <input type="number" id="sg2Max" min="0" max="100" value="100" style="width:62px"></label></div>
            <div id="sg2CurveWrap" style="display:none;margin-top:8px"><canvas id="sg2Curve" width="300" height="150" class="curve-canvas"></canvas>
              <div class="row" style="margin-top:6px"><span class="hint">Preset:</span><button class="sg2-prst" data-p="linear">Tuyến tính</button><button class="sg2-prst" data-p="easein">Ease-in</button><button class="sg2-prst" data-p="scurve">S-curve</button><button class="sg2-prst" data-p="steps">Bậc thang</button></div></div>
            <div class="row" style="margin-top:10px"><label class="fld">Số level <input type="number" id="sg2Count" min="1" max="300" value="${S.count}"></label></div>
          </div>
          <div class="card"><h2><span class="step-no">3</span> Tham số sinh</h2>
            <div class="row" style="align-items:flex-end"><label class="fld">Dài tối thiểu <input type="number" id="sg2MinL" min="2" max="40" value="2" style="width:66px"></label><label class="fld">Dài tối đa <input type="number" id="sg2MaxL" min="0" max="99" value="0" style="width:66px"></label></div>
            <div class="row" style="margin-top:6px"><label class="chk"><input type="checkbox" id="sg2Mother"> Rắn mẹ (viền ôm)</label></div>
          </div>
          <div class="card"><h2><span class="step-no">4</span> Vật phẩm</h2><div id="sg2Toggles"></div></div>
          <div class="card"><h2><span class="step-no">5</span> Sinh</h2>
            <div class="row"><button id="sg2Gen" class="primary" style="flex:1">🎲 Sinh hàng loạt</button><button id="sg2Cancel" class="danger" style="display:none">■ Hủy</button></div>
            <div class="progress" style="margin-top:10px"><div class="progress-bar" id="sg2Prog" style="width:0%"></div></div>
            <div class="hint" id="sg2ProgInfo" style="margin-top:6px"></div>
          </div>
        </div>

        <div class="sg2-work"><div class="card sg2-lib-card">
          <div class="lib-toolbar"><h2 style="margin:0"><span class="h2-icon">📚</span> Thư viện <span class="pill" id="sg2LibCount">0</span></h2>
            <div class="lib-tools"><label class="fld" style="flex:0 0 auto">Sắp xếp<select id="sg2Sort"><option value="id">Theo thứ tự</option><option value="scoreAsc">Khó tăng</option><option value="scoreDesc">Khó giảm</option></select></label>
              <label class="fld" style="flex:0 0 auto">Lọc tier<select id="sg2Filter"><option value="all">Tất cả</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option><option value="4">★★★★</option><option value="5">★★★★★</option></select></label></div></div>
          <div class="row" style="margin-top:8px"><button id="sg2SelAll">Chọn hết</button><button id="sg2DelSel" class="danger">Xóa đã chọn</button><span class="hint" id="sg2SelInfo" style="align-self:center"></span>
            <span style="flex:1"></span><button id="sg2ExportSel" class="primary">⬇ Export (đã chọn)</button><input type="file" id="sg2ImportFile" accept=".json" multiple hidden><button id="sg2ImportBtn">⬆ Import</button></div>
          <div class="sg2-lib" id="sg2Lib"></div>
        </div></div>
      </div>`;

    const tg = $("sg2Toggles");
    TOGGLE.forEach(t => { const box = document.createElement("div"); box.className = "sg2-itemrow";
      const sub = t.key === "elevator"   // bỏ Mật độ; Elevator chỉ còn ô tích Bẫy
        ? `<label class="chk sg2-dens" style="display:${S.items[t.key] ? "flex" : "none"};font-size:12px"><input type="checkbox" id="sg2ElTrap"${S.elevatorTrap ? " checked" : ""}> ⚠️ Bẫy elevator (ép sinh — giải phóng sớm = thua)</label>`
        : "";
      box.innerHTML = `<label class="chk sg2-toggle"><input type="checkbox" data-tk="${t.key}"${S.items[t.key] ? " checked" : ""}> ${t.label} <span class="sg2-unlock">lv ${t.unlock}</span></label>${sub}`;
      box.querySelector("input[type=checkbox][data-tk]").addEventListener("change", e => { S.items[t.key] = e.target.checked; const d = box.querySelector(".sg2-dens"); if (d) d.style.display = e.target.checked ? "flex" : "none"; });
      const tr = box.querySelector("#sg2ElTrap"); if (tr) tr.addEventListener("change", e => S.elevatorTrap = e.target.checked);
      tg.appendChild(box); });

    $("sg2Shape").addEventListener("change", e => { S.shape = e.target.value; $("sg2ImgRow").style.display = e.target.value === "image" ? "block" : "none"; drawPreview(); });
    $("sg2ImgBtn").addEventListener("click", () => $("sg2ImgFile").click());
    $("sg2ImgFile").addEventListener("change", e => { const f = e.target.files[0]; if (f) loadImageMask(f); });
    $("sg2Th").addEventListener("input", e => { S.imgTh = +e.target.value; $("sg2ThV").textContent = e.target.value; });
    $("sg2W").addEventListener("input", e => { S.W = clamp(+e.target.value || 13, 6, 30); drawPreview(); });
    $("sg2H").addEventListener("input", e => { S.H = clamp(+e.target.value || 13, 6, 30); drawPreview(); });
    $("sg2Fill").addEventListener("input", e => { S.fill = +e.target.value; $("sg2FillV").textContent = e.target.value; });
    $("sg2DiffMode").addEventListener("change", e => { S.diffMode = e.target.value; $("sg2RangeWrap").style.display = e.target.value === "range" ? "flex" : "none"; $("sg2CurveWrap").style.display = e.target.value === "curve" ? "block" : "none"; if (e.target.value === "curve") drawCurve(); });
    $("sg2Min").addEventListener("input", e => S.diffMin = clamp(+e.target.value || 0, 0, 100));
    $("sg2Max").addEventListener("input", e => S.diffMax = clamp(+e.target.value || 100, 0, 100));
    $("sg2Count").addEventListener("input", e => S.count = clamp(+e.target.value || 40, 1, 300));
    $("sg2MinL").addEventListener("input", e => S.minL = clamp(+e.target.value || 2, 2, 40));
    $("sg2MaxL").addEventListener("input", e => S.maxL = clamp(+e.target.value || 0, 0, 99));
    $("sg2Mother").addEventListener("change", e => S.mother = e.target.checked);
    $("sg2Gen").addEventListener("click", runGen); $("sg2Cancel").addEventListener("click", () => { genCancel = true; });
    document.querySelectorAll(".sg2-prst").forEach(b => b.addEventListener("click", () => { S.curve = PRESETS[b.dataset.p].map(p => ({ ...p })); drawCurve(); }));
    $("sg2Sort").addEventListener("change", e => { sortMode = e.target.value; rebuildLib(); });
    $("sg2Filter").addEventListener("change", e => { filterTier = e.target.value; rebuildLib(); });
    $("sg2SelAll").addEventListener("click", selAllToggle); $("sg2DelSel").addEventListener("click", delSelected); $("sg2ExportSel").addEventListener("click", exportSel);
    $("sg2ImportBtn").addEventListener("click", () => $("sg2ImportFile").click());
    $("sg2ImportFile").addEventListener("change", () => { importFiles([...$("sg2ImportFile").files]); $("sg2ImportFile").value = ""; });

    const cc = $("sg2Curve");
    cc.addEventListener("pointerdown", e => { const { x, y } = curvePx(e); let bi = -1, bd = 200; S.curve.forEach((p, i) => { const dx = (26 + p.t * (cc.width - 36)) - x, dy = (cc.height - 18 - p.v / 100 * (cc.height - 28)) - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }); if (bi >= 0) { dragIdx = bi; cc.setPointerCapture(e.pointerId); } });
    cc.addEventListener("pointermove", e => { if (dragIdx < 0) return; const { x, y } = curvePx(e), i = dragIdx, last = S.curve.length - 1; S.curve[i].v = Math.round(curveInvV(y)); if (i > 0 && i < last) S.curve[i].t = clamp(curveInvT(x), S.curve[i - 1].t + .02, S.curve[i + 1].t - .02); drawCurve(); });
    cc.addEventListener("pointerup", () => dragIdx = -1); cc.addEventListener("pointercancel", () => dragIdx = -1);
    cc.addEventListener("dblclick", e => { const { x, y } = curvePx(e); S.curve.push({ t: curveInvT(x), v: Math.round(curveInvV(y)) }); S.curve.sort((a, b) => a.t - b.t); drawCurve(); });

    loadLib(); drawPreview();
  }
  function drawPreview() { const cv = $("sg2Prev"); if (!cv) return; const W = S.W, H = S.H, c = Math.max(4, Math.floor(400 / Math.max(W, H))), mask = buildMask(S.shape, W, H); cv.width = W * c; cv.height = H * c; const g = cv.getContext("2d"); drawGrid(g, W, H, c); g.fillStyle = "rgba(74,125,255,.32)"; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!mask || mask.has(x + "," + y)) g.fillRect(x * c + 1, y * c + 1, c - 2, c - 2); }
  function loadImageMask(file) {
    const img = new Image(); img.onload = () => {
      const W = S.W, H = S.H, off = document.createElement("canvas"); off.width = W; off.height = H; const g = off.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); const sc = Math.min(W / img.width, H / img.height), dw = img.width * sc, dh = img.height * sc; g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      let data; try { data = g.getImageData(0, 0, W, H).data; } catch (e) { return; }
      const m = new Set(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, lum = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114; if (lum < S.imgTh) m.add(x + "," + y); }
      S.imageMask = m.size >= 8 ? m : null; drawPreview();
    }; img.src = URL.createObjectURL(file);
  }

  // ============================ LƯU / IMPORT-EXPORT ============================
  function saveLib() { try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, lib: LIB, nextId })); } catch (e) {} }
  function loadLib() { try { const r = localStorage.getItem(LS_KEY); if (r) { const d = JSON.parse(r); if (d && Array.isArray(d.lib)) { LIB = d.lib; nextId = d.nextId || (LIB.reduce((m, l) => Math.max(m, l.id), 0) + 1); } } } catch (e) {} rebuildLib(); }
  function dl(obj, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function exportSel() { const sel = LIB.filter(l => SEL.has(l.id)), list = sel.length ? sel : LIB; if (!list.length) { $("sg2SelInfo").textContent = "Chưa có level."; return; } dl({ v: 1, game: "snakego2", levels: list }, `snakego2-${list.length}.json`); }
  async function importFiles(files) { if (!files.length) return; let added = 0, bad = 0; for (const f of files) { try { const d = JSON.parse(await f.text()), arr = Array.isArray(d) ? d : (Array.isArray(d.levels) ? d.levels : null); if (!arr) { bad++; continue; } arr.forEach(lv => { if (lv && lv.snakes && lv.items) { lv.id = nextId++; LIB.push(lv); added++; } }); } catch (e) { bad++; } } saveLib(); rebuildLib(); $("sg2SelInfo").textContent = `✓ Import ${added}` + (bad ? ` · lỗi ${bad}` : ""); }

  // ============================ TAB ============================
  function showOthers(show) { [".board-area", ".side"].forEach(s => { const el = document.querySelector(s); if (el && !show) el.style.display = "none"; }); ["batchView", "playControls", "playHint", "libPlayBar"].forEach(id => { const el = $(id); if (el && !show) el.style.display = "none"; }); }
  function enterSG2() { showOthers(false); $("sg2View").style.display = "block"; $("tabSG2").classList.add("tab-active"); const tb = $("tabBatch"), tp = $("tabPlay"); if (tb) tb.classList.remove("tab-active"); if (tp) tp.classList.remove("tab-active"); mount(); }
  function exitSG2() { const v = $("sg2View"); if (v) v.style.display = "none"; const t = $("tabSG2"); if (t) t.classList.remove("tab-active"); }
  function init() { const ts = $("tabSG2"); if (!ts) return; ts.addEventListener("click", enterSG2); const tb = $("tabBatch"), tp = $("tabPlay"); if (tb) tb.addEventListener("click", exitSG2); if (tp) tp.addEventListener("click", exitSG2); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
