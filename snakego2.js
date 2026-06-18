/* ============================================================================
 * SNAKE GO 2 — Bộ SINH HÀNG LOẠT cho phiên bản có VẬT PHẨM
 * (Wooden Box, Black Hole, Linked Snake, Corner, Pipe).
 *
 * TÁCH RIÊNG: không sửa logic arrow-out.js / arrow-batch.js. Tái dùng
 * generateMap() (global) để sinh base layout, rồi tự chèn vật phẩm + solver
 * riêng (hiểu vật phẩm) để bảo đảm GIẢI ĐƯỢC + chấm độ khó theo MÔ HÌNH MỚI.
 *
 * Vật phẩm chỉ tồn tại khi tích ô bật (toggle) — kèm unlock level theo spec.
 * ==========================================================================*/
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  const DZ = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const DIRS = ["up", "right", "down", "left"];
  const ARROW = { up: "↑", right: "→", down: "↓", left: "←" };
  const opp = d => ({ up: "down", down: "up", left: "right", right: "left" }[d]);
  const CORNER_OPEN = { NE: ["up", "right"], NW: ["up", "left"], SE: ["down", "right"], SW: ["down", "left"] };
  const TIERS = (typeof DIFF_TIERS !== "undefined") ? DIFF_TIERS
    : [[20, "Rất dễ", "★"], [40, "Dễ", "★★"], [60, "Vừa", "★★★"], [80, "Khó", "★★★★"], [101, "Siêu khó", "★★★★★"]];
  const TIER_CLASS = ["tier1", "tier2", "tier3", "tier4", "tier5"];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = n => Math.floor(Math.random() * n);
  const $ = id => document.getElementById(id);
  const LS_KEY = "sg2-batch-v1";

  function cornerOut(type, travelDir) {
    const open = CORNER_OPEN[type], enter = opp(travelDir);
    if (enter === open[0]) return open[1];
    if (enter === open[1]) return open[0];
    return null;
  }

  // Cấu hình sinh
  const S = {
    W: 12, H: 12, fill: 62, diffMin: 0, diffMax: 100, count: 40,
    items: { link: false, corner: false, wb: false, bh: false, pipe: false },
    dens: { link: 30, corner: 25, wb: 25, bh: 15, pipe: 15 },   // mật độ % (xấp xỉ)
  };
  const TOGGLE = [
    { key: "link", label: "🔗 Linked Snake", unlock: 6 },
    { key: "corner", label: "⌐ Corner", unlock: 11 },
    { key: "wb", label: "📦 Wooden Box", unlock: 15 },
    { key: "bh", label: "🕳 Black Hole", unlock: 31 },
    { key: "pipe", label: "🛢 Pipe", unlock: 41 },
  ];

  let LIB = [];           // [{id,W,H,snakes,items,score,tier,emoji,breakdown}]
  let genBusy = false, genCancel = false, nextId = 1;
  let cv, ctx, mounted = false;

  // ============================ SOLVER SG2 (hiểu vật phẩm) ============================
  // Ray-march đầu rắn: trả {ok, removed, reason, pipe?}. otherSnakes: rắn KHÁC (loại cùng nhóm).
  function rayResolve(snake, otherSnakes, it, W, H) {
    let { x, y } = snake.cells[0], dir = snake.dir;
    const body = new Set(snake.cells.slice(1).map(c => c.x + "," + c.y));
    let guard = 0, max = (W + H) * 4;
    while (guard++ < max) {
      x += DZ[dir].x; y += DZ[dir].y;
      if (x < 0 || y < 0 || x >= W || y >= H) return { ok: true, removed: true, reason: "edge" };
      const cor = it.corner.find(c => c.x === x && c.y === y);
      if (cor) { const nd = cornerOut(cor.type, dir); if (!nd) return { ok: false, reason: "cornerwall" }; dir = nd; continue; }
      if (it.bh.some(b => b.x === x && b.y === y)) return { ok: true, removed: true, reason: "bh" };
      const pe = it.pipe.find(p => p.ex === x && p.ey === y);
      if (pe) return { ok: true, removed: true, reason: "pipe", pipe: pe };
      if (it.pipe.some(p => p.ox === x && p.oy === y)) return { ok: false, reason: "pipeexit" };
      if (it.wb.some(w => w.x === x && w.y === y)) return { ok: false, reason: "wb" };
      if (body.has(x + "," + y)) return { ok: false, reason: "self" };
      if (otherSnakes.some(o => o.cells.some(c => c.x === x && c.y === y))) return { ok: false, reason: "snake" };
    }
    return { ok: false, reason: "loop" };
  }
  function groupsOf(snakes) {
    const byLink = new Map(), solo = [];
    snakes.forEach(s => { if (s.link) { (byLink.get(s.link) || byLink.set(s.link, []).get(s.link)).push(s); } else solo.push([s]); });
    return [...byLink.values(), ...solo];
  }
  // Mô phỏng giải theo từng đợt (wave): mỗi đợt cho MỌI nhóm thoát được rời bàn cùng lúc.
  function sg2Solve(snakes, items, W, H) {
    let work = snakes.map(s => ({ id: s.id, dir: s.dir, cells: s.cells.map(c => ({ ...c })), link: s.link }));
    const it = { wb: items.wb.map(o => ({ ...o })), bh: items.bh.map(o => ({ ...o })), corner: items.corner.map(o => ({ ...o })), pipe: items.pipe.map(o => ({ ...o })) };
    const turnData = []; let guard = 0; const N0 = work.length + 4;
    while (work.length && guard++ < N0) {
      const groups = groupsOf(work);
      const escaping = [];
      for (const g of groups) {
        const others = work.filter(o => g.indexOf(o) < 0);
        if (g.every(m => { const r = rayResolve(m, others, it, W, H); return r.ok && r.removed; })) escaping.push(g);
      }
      const flat = escaping.flat();
      if (!flat.length) break;
      const remaining = work.length;
      // pipe countdown (đánh giá lại reason để biết con nào chui pipe)
      flat.forEach(m => { const r = rayResolve(m, work.filter(o => o !== m), it, W, H); if (r.reason === "pipe" && r.pipe) { r.pipe.n--; if (r.pipe.n <= 0) it.pipe = it.pipe.filter(p => p !== r.pipe); } });
      work = work.filter(o => flat.indexOf(o) < 0);
      for (let i = 0; i < flat.length; i++) it.wb.forEach(w => w.n--);
      it.wb = it.wb.filter(w => w.n > 0);
      turnData.push({ remaining, moved: flat.length });
    }
    return { solvable: work.length === 0, waves: turnData.length, turnData };
  }

  // ============================ MÔ HÌNH ĐỘ KHÓ MỚI (SG2) ============================
  function sg2Difficulty(snakes, items, W, H) {
    const N = snakes.length;
    if (!N) return { score: 0, tier: "—", emoji: "" };
    const sim = sg2Solve(snakes, items, W, H);
    if (!sim.solvable) return { score: 0, tier: "KẸT", emoji: "✕" };
    // siết: tỉ lệ rắn thoát TB mỗi đợt -> ít -> khó
    const esc = sim.turnData.map(d => d.moved / Math.max(1, d.remaining));
    const avgEsc = esc.length ? esc.reduce((a, b) => a + b, 0) / esc.length : 1;
    const squeeze = clamp((1 - avgEsc) * 100, 0, 100);
    const moveScore = squeeze * squeeze / 100;
    // bẫy thị giác: rắn đang BỊ CHẶN ở trạng thái đầu
    let blocked = 0;
    snakes.forEach(s => { const r = rayResolve(s, snakes.filter(o => o !== s), items, W, H); if (!(r.ok && r.removed)) blocked++; });
    const percScore = clamp(blocked / N * 100, 0, 100);
    const snakeScore = clamp(Math.log2(Math.max(1, N)) / Math.log2(140) * 100, 0, 100);
    const base = 0.30 * percScore + 0.22 * moveScore + 0.10 * snakeScore;
    const playable = 0.6 + 0.4 * (moveScore / 100);
    let score = base * playable * (1 / (0.30 + 0.22 + 0.10));   // chuẩn hoá phần nền về ~0..100

    // ----- cộng/trừ theo vật phẩm -----
    const wbTerm = clamp(items.wb.reduce((a, w) => a + 3 + 1.4 * Math.min(w.n, N), 0), 0, 24);
    const grp = groupsOf(snakes).filter(g => g.length > 1);
    const lsTerm = clamp(grp.reduce((a, g) => a + (g.length - 1) * 4, 0), 0, 20);
    const cnTerm = clamp(items.corner.length * 2.5, 0, 14);
    const piTerm = clamp(items.pipe.reduce((a, p) => a + 3 + 0.8 * Math.min(p.n, N), 0), 0, 14);
    const bhRelief = clamp(items.bh.length * 4, 0, 16);
    score = clamp(Math.round(score + wbTerm + lsTerm + cnTerm + piTerm - bhRelief), 0, 100);
    const [, tier, emoji] = TIERS.find(t => score < t[0]);
    return { score, tier, emoji, breakdown: { percScore: Math.round(percScore), moveScore: Math.round(moveScore), snakeScore: Math.round(snakeScore), wbTerm: Math.round(wbTerm), lsTerm: Math.round(lsTerm), cnTerm: Math.round(cnTerm), piTerm: Math.round(piTerm), bhRelief: Math.round(bhRelief) }, waves: sim.waves };
  }

  // ============================ SINH 1 LEVEL ============================
  function emptyCells(snakes, items, W, H) {
    const used = new Set();
    snakes.forEach(s => s.cells.forEach(c => used.add(c.x + "," + c.y)));
    items.wb.forEach(o => used.add(o.x + "," + o.y)); items.bh.forEach(o => used.add(o.x + "," + o.y));
    items.corner.forEach(o => used.add(o.x + "," + o.y));
    items.pipe.forEach(p => { used.add(p.ex + "," + p.ey); used.add(p.ox + "," + p.oy); });
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!used.has(x + "," + y)) out.push({ x, y });
    return out;
  }
  function solvableWith(snakes, items, W, H) { return sg2Solve(snakes, items, W, H).solvable; }

  // chèn 1 loại vật phẩm với "số lượng mong muốn", mỗi cái phải GIỮ solvable
  function tryAddItems(snakes, items, W, H, kind, want) {
    let added = 0, attempts = want * 6 + 4;
    while (added < want && attempts-- > 0) {
      const empties = emptyCells(snakes, items, W, H); if (!empties.length) break;
      const cell = empties[rnd(empties.length)];
      let undo;
      if (kind === "bh") { items.bh.push({ x: cell.x, y: cell.y }); undo = () => items.bh.pop(); }
      else if (kind === "corner") { items.corner.push({ x: cell.x, y: cell.y, type: Object.keys(CORNER_OPEN)[rnd(4)] }); undo = () => items.corner.pop(); }
      else if (kind === "wb") { items.wb.push({ x: cell.x, y: cell.y, n: 1 + rnd(Math.min(6, snakes.length)) }); undo = () => items.wb.pop(); }
      else if (kind === "pipe") {
        const e2 = emptyCells(snakes, items, W, H).filter(c => !(c.x === cell.x && c.y === cell.y)); if (e2.length < 1) break;
        const exit = e2[rnd(e2.length)];
        items.pipe.push({ ex: cell.x, ey: cell.y, ox: exit.x, oy: exit.y, n: 1 + rnd(Math.min(5, snakes.length)) }); undo = () => items.pipe.pop();
      }
      // BH luôn an toàn (chỉ hỗ trợ). Loại khác phải verify.
      if (kind === "bh" || solvableWith(snakes, items, W, H)) added++;
      else undo();
    }
    return added;
  }
  function tryLinkSnakes(snakes, W, H, wantGroups) {
    // gom rắn THẲNG, cùng hướng, cùng dài, KỀ SONG SONG thành nhóm
    let made = 0, link = 1;
    const straight = snakes.filter(s => s.cells.length >= 1 && isStraight(s));
    const byKey = new Map();
    straight.forEach(s => { const k = s.dir + ":" + s.cells.length; (byKey.get(k) || byKey.set(k, []).get(k)).push(s); });
    for (const arr of byKey.values()) {
      if (made >= wantGroups) break;
      // tìm các rắn song song kề nhau (đầu lệch 1 ô theo phương vuông góc hướng)
      for (let i = 0; i < arr.length && made < wantGroups; i++) {
        if (arr[i].link) continue;
        const g = [arr[i]];
        for (let j = 0; j < arr.length; j++) {
          if (j === i || arr[j].link) continue;
          if (parallelAdjacent(g[g.length - 1], arr[j])) g.push(arr[j]);
          if (g.length >= 3) break;
        }
        if (g.length >= 2) { const id = link++; g.forEach(s => s.link = id); made++; }
      }
    }
    return made;
  }
  function isStraight(s) {
    if (s.cells.length < 2) return true;
    const dx = Math.sign(s.cells[1].x - s.cells[0].x), dy = Math.sign(s.cells[1].y - s.cells[0].y);
    for (let i = 2; i < s.cells.length; i++) { if (Math.sign(s.cells[i].x - s.cells[i - 1].x) !== dx || Math.sign(s.cells[i].y - s.cells[i - 1].y) !== dy) return false; }
    return true;
  }
  function parallelAdjacent(a, b) {
    if (a.dir !== b.dir || a.cells.length !== b.cells.length) return false;
    const ah = a.cells[0], bh = b.cells[0];
    const perp = (a.dir === "up" || a.dir === "down");   // hướng dọc -> lệch theo x
    if (perp) return ah.x !== bh.x && Math.abs(ah.x - bh.x) === 1 && ah.y === bh.y;
    return ah.y !== bh.y && Math.abs(ah.y - bh.y) === 1 && ah.x === bh.x;
  }

  function genOne(target) {
    const W = S.W, H = S.H;
    const diffHint = target != null ? target : (S.diffMin + S.diffMax) / 2;
    const base = generateMap(W, H, 55, diffHint, 0, { fill: S.fill / 100 });
    if (!base || base.length < 2) return null;
    const snakes = base.map((p, i) => ({ id: i + 1, dir: p.dir, cells: p.cells.map(c => ({ x: c.x, y: c.y })), link: null }));
    const items = { wb: [], bh: [], corner: [], pipe: [] };
    const area = W * H;
    if (S.items.link) tryLinkSnakes(snakes, W, H, Math.max(1, Math.round(S.dens.link / 100 * 3)));
    if (S.items.corner) tryAddItems(snakes, items, W, H, "corner", Math.max(1, Math.round(S.dens.corner / 100 * area / 16)));
    if (S.items.wb) tryAddItems(snakes, items, W, H, "wb", Math.max(1, Math.round(S.dens.wb / 100 * area / 18)));
    if (S.items.pipe) tryAddItems(snakes, items, W, H, "pipe", Math.max(1, Math.round(S.dens.pipe / 100 * area / 30)));
    if (S.items.bh) tryAddItems(snakes, items, W, H, "bh", Math.max(1, Math.round(S.dens.bh / 100 * area / 30)));
    if (!solvableWith(snakes, items, W, H)) return null;
    const d = sg2Difficulty(snakes, items, W, H);
    if (d.tier === "KẸT") return null;
    return { id: nextId++, W, H, snakes, items, score: d.score, tier: d.tier, emoji: d.emoji, breakdown: d.breakdown };
  }

  // ============================ CHẠY SINH (chunked, không treo UI) ============================
  function runGen() {
    if (genBusy) return;
    genBusy = true; genCancel = false;
    const count = clamp(S.count, 1, 300);
    const lo = Math.min(S.diffMin, S.diffMax), hi = Math.max(S.diffMin, S.diffMax);
    $("sg2Gen").disabled = true; $("sg2Cancel").style.display = "inline-flex";
    let made = 0, tried = 0;
    const maxTries = count * 250 + 500;   // trần: khoảng khó bất khả thi -> dừng, không treo
    const tick = () => {
      if (genCancel || made >= count || tried >= maxTries) { finishGen(made, tried); return; }
      const t0 = Date.now();
      while (Date.now() - t0 < 28 && made < count && !genCancel) {   // ~28ms/khung
        const target = lo + (hi - lo) * Math.random();
        const lvl = genOne(target); tried++;
        if (lvl && lvl.score >= lo && lvl.score <= hi) { LIB.push(lvl); made++; addCard(lvl); }
      }
      $("sg2Prog").style.width = Math.round(made / count * 100) + "%";
      $("sg2ProgInfo").textContent = `Đã sinh ${made}/${count} · thử ${tried}`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function finishGen(made, tried) {
    genBusy = false; $("sg2Gen").disabled = false; $("sg2Cancel").style.display = "none";
    $("sg2ProgInfo").textContent = `Xong: ${made} level (thử ${tried}).`;
    saveLib();
  }

  // ============================ RENDER ============================
  function drawLevel(g2, level, cellPx, runtime, flashSet) {
    const W = level.W, H = level.H, c = cellPx;
    g2.clearRect(0, 0, W * c, H * c);
    g2.fillStyle = "#0f1320"; g2.fillRect(0, 0, W * c, H * c);
    g2.strokeStyle = "rgba(255,255,255,.07)"; g2.lineWidth = 1;
    for (let x = 0; x <= W; x++) { g2.beginPath(); g2.moveTo(x * c + .5, 0); g2.lineTo(x * c + .5, H * c); g2.stroke(); }
    for (let y = 0; y <= H; y++) { g2.beginPath(); g2.moveTo(0, y * c + .5); g2.lineTo(W * c, y * c + .5); g2.stroke(); }
    const it = runtime ? runtime.items : level.items;
    const snakes = runtime ? runtime.snakes : level.snakes;
    drawItems(g2, it, c);
    snakes.forEach((s, i) => drawSnake(g2, s, i, c, flashSet));
  }
  function drawItems(g2, it, c) {
    it.bh.forEach(o => { const cx = o.x * c + c / 2, cy = o.y * c + c / 2; const gr = g2.createRadialGradient(cx, cy, c * .05, cx, cy, c * .5); gr.addColorStop(0, "#000"); gr.addColorStop(.7, "#2a1b4d"); gr.addColorStop(1, "rgba(120,80,220,.15)"); g2.fillStyle = gr; g2.beginPath(); g2.arc(cx, cy, c * .46, 0, 7); g2.fill(); g2.strokeStyle = "#9a7bff"; g2.lineWidth = 1.4; g2.stroke(); });
    it.corner.forEach(o => { const cx = o.x * c + c / 2, cy = o.y * c + c / 2, open = CORNER_OPEN[o.type]; g2.fillStyle = "rgba(255,150,40,.14)"; g2.fillRect(o.x * c, o.y * c, c, c); g2.strokeStyle = "#ff9d3c"; g2.lineWidth = Math.max(1.5, c * .14); g2.lineCap = "round"; g2.lineJoin = "round"; g2.beginPath(); g2.moveTo(cx + DZ[open[0]].x * c * .42, cy + DZ[open[0]].y * c * .42); g2.lineTo(cx, cy); g2.lineTo(cx + DZ[open[1]].x * c * .42, cy + DZ[open[1]].y * c * .42); g2.stroke(); });
    it.wb.forEach(o => { const x = o.x * c, y = o.y * c, p = c * .1; g2.fillStyle = "#8a5a2b"; rrect(g2, x + p, y + p, c - 2 * p, c - 2 * p, c * .12); g2.fill(); g2.strokeStyle = "#5e3c1a"; g2.lineWidth = Math.max(1, c * .05); g2.stroke(); lbl(g2, o.n, x + c / 2, y + c / 2, c, "#fff"); });
    it.pipe.forEach(p => { cellFill(g2, p.ox, p.oy, c, "#1d6b70"); cellFill(g2, p.ex, p.ey, c, "#0fb2b8"); lbl(g2, p.n, p.ex * c + c / 2, p.ey * c + c / 2, c, "#04222a"); g2.strokeStyle = "rgba(15,178,184,.5)"; g2.lineWidth = 2; g2.setLineDash([4, 4]); g2.beginPath(); g2.moveTo(p.ex * c + c / 2, p.ey * c + c / 2); g2.lineTo(p.ox * c + c / 2, p.oy * c + c / 2); g2.stroke(); g2.setLineDash([]); });
  }
  function drawSnake(g2, s, i, c, flashSet) {
    const color = colorFor(s, i), flashing = flashSet && flashSet.has(s.id);
    g2.save(); if (flashing) { g2.shadowColor = "#ff5050"; g2.shadowBlur = c * .8; }
    g2.strokeStyle = color; g2.fillStyle = color; g2.lineWidth = Math.max(2, c * .42); g2.lineCap = "round"; g2.lineJoin = "round";
    const pts = s.cells.map(cc => ({ x: cc.x * c + c / 2, y: cc.y * c + c / 2 }));
    if (pts.length > 1) { g2.beginPath(); g2.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y); for (let k = pts.length - 2; k >= 0; k--) g2.lineTo(pts[k].x, pts[k].y); g2.stroke(); }
    const d = DZ[s.dir], h = pts[0], t = c * .5, b = c * .34, px = -d.y, py = d.x;
    g2.beginPath(); g2.moveTo(h.x + d.x * t, h.y + d.y * t); g2.lineTo(h.x + px * b, h.y + py * b); g2.lineTo(h.x - px * b, h.y - py * b); g2.closePath(); g2.fill();
    g2.restore();
    if (s.link) { g2.fillStyle = "rgba(255,255,255,.9)"; g2.font = `700 ${Math.max(7, c * .3)}px sans-serif`; g2.textAlign = "center"; g2.textBaseline = "middle"; g2.fillText("🔗", h.x, h.y); }
  }
  function colorFor(s, i) {
    if (typeof gameColor === "function") { const idx = s.link ? ((s.link * 7) % 48) + 1 : (i % 48) + 1; const col = gameColor(idx); if (col) return col; }
    const hues = ["#4a7dff", "#13a673", "#cf9a1e", "#e34d6b", "#9869ff", "#0fb2b8"]; return hues[i % hues.length];
  }
  function rrect(g2, x, y, w, h, r) { g2.beginPath(); g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r); g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath(); }
  function cellFill(g2, x, y, c, col) { g2.fillStyle = col; rrect(g2, x * c + c * .08, y * c + c * .08, c * .84, c * .84, c * .14); g2.fill(); }
  function lbl(g2, t, cx, cy, c, col) { g2.fillStyle = col; g2.font = `800 ${Math.max(8, c * .42)}px sans-serif`; g2.textAlign = "center"; g2.textBaseline = "middle"; g2.fillText(String(t), cx, cy); }

  // ============================ THƯ VIỆN + CARD ============================
  function tierIdx(tier) { return Math.max(0, TIERS.findIndex(t => t[1] === tier)); }
  function addCard(lvl) {
    const grid = $("sg2Lib"); if (!grid) return;
    const card = document.createElement("div"); card.className = "sg2-card";
    const wrap = document.createElement("div"); wrap.className = "sg2-card-cv";
    const cc = document.createElement("canvas"); const px = Math.max(4, Math.floor(150 / Math.max(lvl.W, lvl.H)));
    cc.width = lvl.W * px; cc.height = lvl.H * px; drawLevel(cc.getContext("2d"), lvl, px, null, null);
    const ov = document.createElement("div"); ov.className = "sg2-card-ov"; ov.textContent = "▶";
    wrap.append(cc, ov); card.appendChild(wrap);
    const meta = document.createElement("div"); meta.className = "sg2-card-meta";
    meta.innerHTML = `<span class="tierbadge ${TIER_CLASS[tierIdx(lvl.tier)] || "tier1"}">${lvl.score} ${lvl.emoji || ""}</span><span>#${lvl.id} · ${lvl.snakes.length}🐍</span>`;
    card.appendChild(meta);
    const items = [];
    if (lvl.items.wb.length) items.push("📦" + lvl.items.wb.length);
    if (lvl.items.bh.length) items.push("🕳" + lvl.items.bh.length);
    if (lvl.items.corner.length) items.push("⌐" + lvl.items.corner.length);
    if (lvl.items.pipe.length) items.push("🛢" + lvl.items.pipe.length);
    const nLink = new Set(lvl.snakes.filter(s => s.link).map(s => s.link)).size; if (nLink) items.push("🔗" + nLink);
    if (items.length) { const ir = document.createElement("div"); ir.className = "sg2-card-items"; ir.textContent = items.join("  "); card.appendChild(ir); }
    card.title = `Điểm ${lvl.score} (${lvl.tier})\n` + (lvl.breakdown ? `perc ${lvl.breakdown.percScore} · move ${lvl.breakdown.moveScore} · WB+${lvl.breakdown.wbTerm} · LS+${lvl.breakdown.lsTerm} · ⌐+${lvl.breakdown.cnTerm} · pipe+${lvl.breakdown.piTerm} · BH−${lvl.breakdown.bhRelief}` : "");
    card.addEventListener("click", () => openPlay(lvl));
    grid.appendChild(card);
    $("sg2LibCount").textContent = LIB.length;
  }
  function rebuildLib() { const grid = $("sg2Lib"); if (grid) { grid.innerHTML = ""; LIB.forEach(addCard); $("sg2LibCount").textContent = LIB.length; } }

  // ============================ CHƠI THỬ (modal) ============================
  const PLAY = { lvl: null, R: null, stars: 3, cv: null, ctx: null, flash: null };
  function ensurePlayModal() {
    if ($("sg2PlayBd")) return;
    const bd = document.createElement("div"); bd.id = "sg2PlayBd"; bd.className = "sg2-play-bd";
    bd.innerHTML = `
      <div class="sg2-play-modal">
        <div class="sg2-play-head"><h3>🎮 Chơi thử — <span id="sg2PlayTitle"></span></h3><button id="sg2PlayClose" class="cedit-x">✕</button></div>
        <div class="sg2-play-body"><canvas id="sg2PlayCv"></canvas></div>
        <div class="sg2-play-foot">
          <span class="pill" id="sg2PlayStars">⭐⭐⭐</span>
          <span class="pill" id="sg2PlayLeft"></span>
          <span class="sg2-msg" id="sg2PlayMsg" style="flex:1"></span>
          <button id="sg2PlayReset">⟲ Chơi lại</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    PLAY.cv = $("sg2PlayCv"); PLAY.ctx = PLAY.cv.getContext("2d");
    PLAY.cv.addEventListener("click", onPlayClick);
    $("sg2PlayClose").addEventListener("click", closePlay);
    $("sg2PlayReset").addEventListener("click", () => startRun(PLAY.lvl));
    bd.addEventListener("click", e => { if (e.target === bd) closePlay(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && $("sg2PlayBd").classList.contains("show")) closePlay(); });
  }
  function openPlay(lvl) { ensurePlayModal(); $("sg2PlayTitle").textContent = `#${lvl.id} · ${lvl.tier} (${lvl.score})`; startRun(lvl); $("sg2PlayBd").classList.add("show"); }
  function closePlay() { const bd = $("sg2PlayBd"); if (bd) bd.classList.remove("show"); PLAY.lvl = null; PLAY.R = null; }
  function startRun(lvl) {
    PLAY.lvl = lvl; PLAY.stars = 3; PLAY.flash = null;
    PLAY.R = { snakes: lvl.snakes.map(s => ({ id: s.id, dir: s.dir, cells: s.cells.map(c => ({ ...c })), link: s.link })), items: { wb: lvl.items.wb.map(o => ({ ...o })), bh: lvl.items.bh.map(o => ({ ...o })), corner: lvl.items.corner.map(o => ({ ...o })), pipe: lvl.items.pipe.map(o => ({ ...o })) } };
    setPlayMsg("Bấm 1 con rắn để bắn ra."); drawPlay();
  }
  function playGeom() { const lvl = PLAY.lvl, max = Math.min(560, window.innerWidth - 80); return Math.max(12, Math.floor(max / Math.max(lvl.W, lvl.H))); }
  function drawPlay() {
    const lvl = PLAY.lvl; if (!lvl) return;
    const c = playGeom(), dpr = Math.min(2, window.devicePixelRatio || 1);
    PLAY.cv.width = lvl.W * c * dpr; PLAY.cv.height = lvl.H * c * dpr;
    PLAY.cv.style.width = lvl.W * c + "px"; PLAY.cv.style.height = lvl.H * c + "px";
    PLAY.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLevel(PLAY.ctx, lvl, c, PLAY.R, PLAY.flash);
    $("sg2PlayStars").textContent = "⭐".repeat(PLAY.stars) + "☆".repeat(Math.max(0, 3 - PLAY.stars));
    $("sg2PlayLeft").textContent = "Rắn còn " + PLAY.R.snakes.length;
  }
  function setPlayMsg(m) { const el = $("sg2PlayMsg"); if (el) el.textContent = m; }
  function onPlayClick(e) {
    if (!PLAY.R) return;
    const r = PLAY.cv.getBoundingClientRect(), c = playGeom();
    const x = Math.floor((e.clientX - r.left) * (PLAY.lvl.W * c / r.width) / c);
    const y = Math.floor((e.clientY - r.top) * (PLAY.lvl.H * c / r.height) / c);
    const s = PLAY.R.snakes.find(s => s.cells.some(cc => cc.x === x && cc.y === y));
    if (s) tryMove(s);
  }
  function tryMove(snake) {
    const R = PLAY.R, W = PLAY.lvl.W, H = PLAY.lvl.H;
    const group = snake.link ? R.snakes.filter(o => o.link === snake.link) : [snake];
    const others = R.snakes.filter(o => group.indexOf(o) < 0);
    const res = group.map(m => rayResolve(m, others, R.items, W, H));
    if (!res.every(r => r.ok && r.removed)) {
      const wbHit = res.some(r => r.reason === "wb");
      if (wbHit || group.length > 1) PLAY.stars = Math.max(0, PLAY.stars - 1);
      setPlayMsg(wbHit ? "📦 WB chặn — mất ⭐" : (group.length > 1 ? "🔗 Linked kẹt — mất ⭐" : "⛔ Bị chặn"));
      PLAY.flash = new Set(group.map(g => g.id)); drawPlay();
      setTimeout(() => { PLAY.flash = null; if (PLAY.R) drawPlay(); }, 220);
      return;
    }
    group.forEach(m => { R.snakes = R.snakes.filter(o => o !== m); });
    res.forEach(r => { if (r.reason === "pipe" && r.pipe) { r.pipe.n--; if (r.pipe.n <= 0) R.items.pipe = R.items.pipe.filter(p => p !== r.pipe); } });
    for (let i = 0; i < group.length; i++) R.items.wb.forEach(w => w.n--);
    R.items.wb = R.items.wb.filter(w => w.n > 0);
    setPlayMsg(R.snakes.length === 0 ? "🎉 Hoàn thành! ⭐×" + PLAY.stars : ""); drawPlay();
  }

  // ============================ DỰNG GIAO DIỆN ============================
  function mount() {
    if (mounted) return; mounted = true;
    const root = $("sg2View");
    root.innerHTML = `
      <div class="sg2-wrap">
        <div class="sg2-panel">
          <div class="card">
            <h2><span class="h2-icon">✨</span> Snake Go 2 — Sinh hàng loạt</h2>
            <div class="hint" style="margin-bottom:10px">Sinh map có vật phẩm + độ khó theo <b>mô hình riêng SG2</b>. Vật phẩm chỉ xuất hiện khi tích ô bật.</div>
            <div class="row">
              <label class="fld">Rộng <input type="number" id="sg2W" min="6" max="30" value="12"></label>
              <label class="fld">Cao <input type="number" id="sg2H" min="6" max="30" value="12"></label>
            </div>
            <div class="row" style="margin-top:8px">
              <label class="fld" style="flex:1">Độ lấp đầy: <b id="sg2FillV">62</b>%<input type="range" id="sg2Fill" min="35" max="90" value="62"></label>
            </div>
          </div>

          <div class="card">
            <h2>Độ khó & số lượng</h2>
            <div class="row" style="align-items:flex-end">
              <label class="fld" style="flex:0 0 auto">Min <input type="number" id="sg2Min" min="0" max="100" value="0" style="width:64px"></label>
              <label class="fld" style="flex:0 0 auto">Max <input type="number" id="sg2Max" min="0" max="100" value="100" style="width:64px"></label>
              <label class="fld" style="flex:1">Số level <input type="number" id="sg2Count" min="1" max="300" value="40"></label>
            </div>
          </div>

          <div class="card">
            <h2>Vật phẩm (tích để bật)</h2>
            <div id="sg2Toggles"></div>
          </div>

          <div class="card">
            <h2>Sinh</h2>
            <div class="row">
              <button id="sg2Gen" class="primary" style="flex:1">🎲 Sinh hàng loạt</button>
              <button id="sg2Cancel" class="danger" style="display:none">■ Hủy</button>
            </div>
            <div class="progress" style="margin-top:10px"><div class="progress-bar" id="sg2Prog" style="width:0%"></div></div>
            <div class="hint" id="sg2ProgInfo" style="margin-top:6px"></div>
            <div class="row" style="margin-top:8px">
              <button id="sg2ClearLib" class="danger">🗑 Xóa thư viện</button>
              <button id="sg2ExportLib">⬇ JSON</button>
            </div>
          </div>
        </div>

        <div class="sg2-board">
          <div class="card">
            <div class="lib-toolbar"><h2 style="margin:0"><span class="h2-icon">📚</span> Thư viện <span class="pill" id="sg2LibCount">0</span></h2></div>
            <div class="sg2-lib" id="sg2Lib"></div>
          </div>
        </div>
      </div>`;

    // toggles + density
    const tg = $("sg2Toggles");
    TOGGLE.forEach(t => {
      const box = document.createElement("div"); box.className = "sg2-itemrow";
      box.innerHTML = `<label class="chk sg2-toggle"><input type="checkbox" data-tk="${t.key}"> ${t.label} <span class="sg2-unlock">lv ${t.unlock}</span></label>
        <label class="fld sg2-dens" style="display:none">Mật độ <b data-dv="${t.key}">${S.dens[t.key]}</b>%<input type="range" data-dk="${t.key}" min="5" max="100" value="${S.dens[t.key]}"></label>`;
      const chk = box.querySelector("input[type=checkbox]"), dens = box.querySelector(".sg2-dens");
      chk.addEventListener("change", e => { S.items[t.key] = e.target.checked; dens.style.display = e.target.checked ? "flex" : "none"; });
      box.querySelector("input[type=range]").addEventListener("input", e => { S.dens[t.key] = +e.target.value; box.querySelector("[data-dv='" + t.key + "']").textContent = e.target.value; });
      tg.appendChild(box);
    });

    $("sg2W").addEventListener("input", e => S.W = clamp(+e.target.value || 12, 6, 30));
    $("sg2H").addEventListener("input", e => S.H = clamp(+e.target.value || 12, 6, 30));
    $("sg2Fill").addEventListener("input", e => { S.fill = +e.target.value; $("sg2FillV").textContent = e.target.value; });
    $("sg2Min").addEventListener("input", e => S.diffMin = clamp(+e.target.value || 0, 0, 100));
    $("sg2Max").addEventListener("input", e => S.diffMax = clamp(+e.target.value || 100, 0, 100));
    $("sg2Count").addEventListener("input", e => S.count = clamp(+e.target.value || 40, 1, 300));
    $("sg2Gen").addEventListener("click", runGen);
    $("sg2Cancel").addEventListener("click", () => { genCancel = true; });
    $("sg2ClearLib").addEventListener("click", () => { if (confirm("Xóa toàn bộ thư viện SG2?")) { LIB = []; nextId = 1; rebuildLib(); saveLib(); } });
    $("sg2ExportLib").addEventListener("click", exportLib);

    loadLib();
  }

  // ============================ LƯU / XUẤT ============================
  function saveLib() { try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, lib: LIB, nextId })); } catch (e) {} }
  function loadLib() { try { const r = localStorage.getItem(LS_KEY); if (r) { const d = JSON.parse(r); if (d && Array.isArray(d.lib)) { LIB = d.lib; nextId = d.nextId || (LIB.reduce((m, l) => Math.max(m, l.id), 0) + 1); rebuildLib(); } } } catch (e) {} }
  function exportLib() {
    const blob = new Blob([JSON.stringify({ v: 1, game: "snakego2", levels: LIB }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "snakego2-levels.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ============================ TAB SWITCH (không đụng logic cũ) ============================
  function showOthers(show) {
    [".board-area", ".side"].forEach(sel => { const el = document.querySelector(sel); if (el && !show) el.style.display = "none"; });
    ["batchView", "playControls", "playHint", "libPlayBar"].forEach(id => { const el = $(id); if (el && !show) el.style.display = "none"; });
  }
  function enterSG2() {
    showOthers(false);
    $("sg2View").style.display = "block";
    $("tabSG2").classList.add("tab-active");
    const tb = $("tabBatch"), tp = $("tabPlay"); if (tb) tb.classList.remove("tab-active"); if (tp) tp.classList.remove("tab-active");
    mount();
  }
  function exitSG2() { const v = $("sg2View"); if (v) v.style.display = "none"; const t = $("tabSG2"); if (t) t.classList.remove("tab-active"); }

  function init() {
    const ts = $("tabSG2"); if (!ts) return;
    ts.addEventListener("click", enterSG2);
    const tb = $("tabBatch"), tp = $("tabPlay");
    if (tb) tb.addEventListener("click", exitSG2);
    if (tp) tp.addEventListener("click", exitSG2);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
