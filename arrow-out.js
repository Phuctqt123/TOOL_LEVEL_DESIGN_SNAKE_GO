"use strict";

/* ============================================================
   Arrow Out — logic + rendering
   Mỗi "mũi tên" là một con rắn: { dir, cells:[{x,y}...] } (cells[0] = đầu).
   Vẽ bằng SVG: thân = nét polyline bo tròn theo các ô, đầu = mũi nhọn tam giác.
   ============================================================ */

const DIRS = ["up", "right", "down", "left"];
const DELTA = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} };
const GLYPH = { up:"↑", down:"↓", left:"←", right:"→" };
// hướng đi từ ô a -> ô b (hai ô kề nhau)
function dirFromTo(a, b) {
  if (b.x - a.x === 1) return "right";
  if (b.x - a.x === -1) return "left";
  if (b.y - a.y === 1) return "down";
  return "up";
}
// Ràng buộc thẩm mỹ: rắn dài >=2 thì hướng đầu = hướng từ cổ (cells[1]) tới đầu (cells[0]).
function enforceHeadDir(piece) {
  if (piece.cells.length >= 2) piece.dir = dirFromTo(piece.cells[1], piece.cells[0]);
  return piece;
}
const PALETTE = ["#4f9fff","#46c08a","#e0b84f","#e0586a","#b06ae0","#4fd0e0","#e08a4f","#88c850","#e04fa0","#7a86e0","#c0a44f","#4fc0a0"];
function pieceColor(id) { return PALETTE[id % PALETTE.length]; }

// ---------- Built-in levels ----------
function P(dir, ...cells) { return { dir, cells: cells.map(c => ({ x:c[0], y:c[1] })) }; }
function LV(w, h, pieces) { return { w, h, pieces, par: pieces.length }; }

const LEVELS = [
  LV(5, 5, [
    P("right",[1,2]), P("right",[2,2]), P("right",[3,2]),
    P("up",[0,0]), P("down",[4,4]),
  ]),
  LV(6, 6, [
    P("left",[1,1]), P("left",[1,2]),
    P("right",[4,1]), P("right",[4,2]),
    P("up",[2,4]), P("up",[2,5]), P("up",[3,4]), P("up",[3,5]),
  ]),
  LV(7, 7, [
    P("up",[2,1]), P("up",[2,2]), P("up",[2,3]),
    P("down",[4,3]), P("down",[4,4]), P("down",[4,5]),
    P("right",[4,2]), P("right",[5,2]),
    P("left",[0,6]), P("left",[1,6]),
  ]),
  LV(8, 8, [
    P("up",[1,3]), P("up",[1,4]), P("up",[1,5]),
    P("down",[6,2]), P("down",[6,3]), P("down",[6,4]),
    P("left",[3,1]), P("left",[4,1]), P("left",[5,1]),
    P("right",[2,6]), P("right",[3,6]), P("right",[4,6]),
  ]),
  LV(8, 8, [
    P("up",[1,2]), P("up",[1,3]), P("up",[1,4]),
    P("down",[6,3]), P("down",[6,4]), P("down",[6,5]),
    P("left",[3,1]), P("left",[4,1]), P("left",[5,1]),
    P("right",[2,6]), P("right",[3,6]), P("right",[4,6]),
    P("up",[0,0]), P("down",[7,7]),
  ]),
  // 6 — DEMO RẮN: thân nhiều ô, có cái bẻ cong (L) nhưng ĐẦU LUÔN THẲNG, có chuỗi phụ thuộc.
  LV(6, 6, [
    P("right",[4,1],[3,1],[2,1]),   // ngang, thoát ngay
    P("up",[1,4],[1,5],[2,5]),      // bẻ cong (đầu thẳng lên, thân quẹo phải)
    P("up",[3,3],[3,4],[3,5]),      // bị con #1 chặn (phụ thuộc)
    P("left",[4,4],[5,4],[5,5]),    // bẻ cong, bị con #3 chặn (phụ thuộc)
  ]),
];

// ---------- State ----------
const state = {
  mode: "play",
  levelIndex: 0,
  W: 7, H: 7,
  pieces: [],
  moves: 0, par: 0,
  history: [],
  status: "playing",
  nextId: 1,
  tool: "up",
  editW: 7, editH: 7,
  editPieces: [],
  draft: null,
  showDeps: false,
  _editorInit: false,
  testSnapshot: null,
  maskImg: null,        // ảnh đang nạp cho "Ảnh -> Map"
  maskCells: null,      // Set "x,y" vùng ô '1' của ảnh (xem trước)
  difficulty: null,     // {score,tier,emoji} của level/map hiện tại
};

const $ = id => document.getElementById(id);
const board = $("board");
const elMsg = $("msg");
let CELL = 56, GAP = 5;
let pieceEls = new Map();   // id -> { g, line, tri }

const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag) { return document.createElementNS(SVGNS, tag); }

// ---------- Geometry ----------
function dims() { return state.mode === "edit" ? { w: state.editW, h: state.editH } : { w: state.W, h: state.H }; }
function curPieces() { return state.mode === "edit" ? state.editPieces : state.pieces; }
function computeCellSize(w) {
  GAP = w > 30 ? 1 : w > 18 ? 2 : 5;
  const avail = Math.min(board.parentElement.clientWidth || 560, 820);
  CELL = Math.max(8, Math.min(70, Math.floor((avail - (w + 1) * GAP) / w)));
}
function cellPos(x, y) { return { left: GAP + x * (CELL + GAP), top: GAP + y * (CELL + GAP) }; }
function cellCenter(x, y) { const p = cellPos(x, y); return { x: p.left + CELL / 2, y: p.top + CELL / 2 }; }
function inBoard(x, y, w, h) { return x >= 0 && y >= 0 && x < w && y < h; }

// ---------- Path / blocking ----------
function pathInfo(p, pieces, w, h) {
  const d = DELTA[p.dir];
  const head = p.cells[0];
  const own = new Set(p.cells.map(c => c.x + "," + c.y));
  const occ = new Map();
  pieces.forEach(o => { if (o.id !== p.id) o.cells.forEach(c => occ.set(c.x + "," + c.y, o.id)); });
  let x = head.x + d.x, y = head.y + d.y;
  while (inBoard(x, y, w, h)) {
    const k = x + "," + y;
    if (own.has(k)) return { blocked: true, self: true };
    if (occ.has(k)) return { blocked: true, blockerId: occ.get(k) };
    x += d.x; y += d.y;
  }
  return { blocked: false };
}

// ---------- Solver ----------
// Tối ưu: xây occupancy map 1 lần MỖI VÒNG (thay vì mỗi con) -> chạy nổi map lớn.
function solve(pieces, w, h) {
  let rest = pieces.slice();
  const total = rest.length; let guard = 0;
  while (rest.length && guard++ < total + 2) {
    const occ = new Map();
    for (const p of rest) for (const c of p.cells) occ.set(c.x + "," + c.y, p.id);
    const movable = new Set();
    for (const p of rest) {
      const d = DELTA[p.dir], head = p.cells[0];
      let x = head.x + d.x, y = head.y + d.y, blocked = false;
      while (x >= 0 && y >= 0 && x < w && y < h) {
        if (occ.has(x + "," + y)) { blocked = true; break; }  // rắn khác hoặc thân mình
        x += d.x; y += d.y;
      }
      if (!blocked) movable.add(p.id);
    }
    if (!movable.size) break;
    rest = rest.filter(p => !movable.has(p.id));
  }
  return { solvable: rest.length === 0, par: total, stuck: rest.length };
}

// ---------- Dependency graph ----------
function directDep(p, pieces, w, h) {
  const info = pathInfo(p, pieces, w, h);
  return (info.blocked && !info.self) ? info.blockerId : null;
}
// Đo đặc trưng đồ thị phụ thuộc.
//  edges  = số con có phụ thuộc trực tiếp
//  cross  = số phụ thuộc khác hướng
//  wrap   = "độ bọc": tổng (in-degree - 1) của các con bị >=2 con khác cùng phụ thuộc
//  hubs   = số con bị >=2 con khác phụ thuộc (nút thắt)
//  depth  = chuỗi phụ thuộc dài nhất
function depMetrics(pieces, w, h) {
  const occ = new Map(), byId = new Map();
  for (const p of pieces) { byId.set(p.id, p); for (const c of p.cells) occ.set(c.x + "," + c.y, p.id); }
  const dep = new Map();          // pid -> blocker pid (phụ thuộc trực tiếp)
  const indeg = new Map();
  let edges = 0, cross = 0;
  for (const p of pieces) {
    const d = DELTA[p.dir], head = p.cells[0];
    let x = head.x + d.x, y = head.y + d.y, bid = null;
    while (x >= 0 && y >= 0 && x < w && y < h) {
      const o = occ.get(x + "," + y);
      if (o !== undefined) { if (o !== p.id) bid = o; break; }   // gặp thân mình -> tự kẹt, không tính cạnh
      x += d.x; y += d.y;
    }
    if (bid != null) {
      edges++; dep.set(p.id, bid); indeg.set(bid, (indeg.get(bid) || 0) + 1);
      const b = byId.get(bid); if (b && b.dir !== p.dir) cross++;
    }
  }
  let wrap = 0, hubs = 0;
  indeg.forEach(c => { if (c >= 2) { wrap += c - 1; hubs++; } });
  const memo = new Map();
  const dd = (pid, seen) => {
    if (memo.has(pid)) return memo.get(pid);
    if (seen.has(pid)) return 0;
    seen.add(pid);
    const b = dep.get(pid); const v = (b != null) ? 1 + dd(b, seen) : 0;
    seen.delete(pid); memo.set(pid, v); return v;
  };
  let depth = 0; for (const p of pieces) depth = Math.max(depth, dd(p.id, new Set()));
  return { edges, cross, wrap, hubs, depth };
}

// ---------- Đo độ khó (port từ tool difficulty-gen) ----------
// Mô hình: solver "natural-turn" (mỗi lượt MỌI rắn thoát được thì thoát đồng thời),
// kết hợp "bẫy thị giác" (perceptual) — nhìn tưởng đi được nhưng bị chặn lệch góc nhỏ.
// Điểm = 0.16·turns + 0.08·snakes + 0.16·rate + 0.60·perceptualĐộng. Tier 5 mức.
// (số lượng rắn cố ý NHẸ CÂN: độ khó đến từ chuỗi phụ thuộc/tốc độ giải/bẫy thị giác, không phải nhồi rắn)
function movableList(rest, w, h) {
  const occ = new Map();
  for (const p of rest) for (const c of p.cells) occ.set(c.x + "," + c.y, p.id);
  const out = [];
  for (const p of rest) {
    const d = DELTA[p.dir], head = p.cells[0];
    let x = head.x + d.x, y = head.y + d.y, ok = true;
    while (x >= 0 && y >= 0 && x < w && y < h) { if (occ.has(x + "," + y)) { ok = false; break; } x += d.x; y += d.y; }
    if (ok) out.push(p);
  }
  return out;
}
function analyzeSolve(pieces, w, h) {
  let rest = pieces.slice();
  const turnData = []; let stuck = 0, t1Avail = 0, turn = 0;
  while (rest.length && turn < 2000) {
    const avail = movableList(rest, w, h);
    if (!avail.length) { stuck = rest.length; break; }
    turn++;
    if (turn === 1) t1Avail = avail.length;
    turnData.push({ moved: avail.length, remaining: rest.length, rate: avail.length / rest.length * 100 });
    const ids = new Set(avail.map(p => p.id));
    rest = rest.filter(p => !ids.has(p.id));
  }
  return { turns: turnData.length, turnData, stuck, t1Avail, snakes: pieces.length };
}
// Rủi ro thị giác thô trung bình mỗi rắn tại 1 trạng thái (raycast đầu -> kẻ chặn).
function percRisk(pieces, w, h) {
  if (!pieces.length) return 0;
  const occ = new Map(), byId = new Map();
  for (const p of pieces) { byId.set(p.id, p); for (const c of p.cells) occ.set(c.x + "," + c.y, p.id); }
  let total = 0;
  for (const sn of pieces) {
    const d = DELTA[sn.dir], head = sn.cells[0];
    const body = new Set(); for (let i = 1; i < sn.cells.length; i++) body.add(sn.cells[i].x + "," + sn.cells[i].y);
    let x = head.x + d.x, y = head.y + d.y, dAlong = 0, blocker = null;
    while (x >= 0 && y >= 0 && x < w && y < h) {
      const k = x + "," + y;
      if (occ.has(k)) { blocker = body.has(k) ? { x, y, self: true } : { x, y, id: occ.get(k) }; break; }
      dAlong++; x += d.x; y += d.y;
    }
    if (!blocker) continue;                 // thoát được -> không rủi ro
    let dPerp = 999;
    if (blocker.self) dPerp = d.x !== 0 ? Math.abs(blocker.y - head.y) : Math.abs(blocker.x - head.x);
    else {
      const b = byId.get(blocker.id);
      if (b) for (const c of b.cells) { const perp = d.x !== 0 ? Math.abs(c.y - head.y) : Math.abs(c.x - head.x); if (perp < dPerp) dPerp = perp; }
      else dPerp = 0;
    }
    const dCap = Math.min(dAlong, 15);
    const angle = Math.atan2(dPerp, dCap) * 180 / Math.PI;
    const confusion = Math.max(0, 1 - angle / 30);
    total += Math.min(confusion * dCap / 10, 0.5);
  }
  return total / pieces.length;
}
// Perceptual ĐỘNG: replay solver, lấy sustained top-30% × (1 + 0.5·freq).
function percDynamic(pieces, w, h) {
  if (!pieces.length) return 0;
  const MIN_REM = 3, RISKY = 0.10, K = 230, FREQ_BOOST = 0.5, TOP_FRAC = 0.30;
  let rest = pieces.slice(); const series = []; let t = 0;
  while (rest.length && t < 300) {
    if (rest.length >= MIN_REM) series.push(percRisk(rest, w, h));
    const mv = movableList(rest, w, h);
    if (!mv.length) break;
    t++;
    const ids = new Set(mv.map(p => p.id));
    rest = rest.filter(p => !ids.has(p.id));
  }
  if (!series.length) return 0;
  const freq = series.filter(r => r >= RISKY).length / series.length;
  const sorted = [...series].sort((a, b) => b - a);
  const topN = Math.max(1, Math.ceil(series.length * TOP_FRAC));
  const sustained = sorted.slice(0, topN).reduce((a, b) => a + b, 0) / topN;
  return Math.min(100, sustained * K * (1 + FREQ_BOOST * freq));
}
const DIFF_TIERS = [[20,"Rất dễ","★"],[40,"Dễ","★★"],[60,"Vừa","★★★"],[80,"Khó","★★★★"],[101,"Siêu khó","★★★★★"]];
function computeDifficulty(pieces, w, h) {
  if (!pieces.length) return { score: 0, tier: "—", emoji: "" };
  const a = analyzeSolve(pieces, w, h);
  if (a.stuck > 0) return { score: 0, tier: "KẸT", emoji: "✕", stuck: a.stuck, breakdown: null };
  const rates = a.turnData.map(d => d.rate);
  const avgRate = rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : 0;
  const rateScore  = Math.max(0, Math.min(100, (100 - avgRate) * 1.1));
  const turnsScore = Math.max(0, Math.min(100, Math.log2(Math.max(1, a.turns)) / Math.log2(50) * 100));
  const snakeScore = Math.max(0, Math.min(100, Math.log2(Math.max(1, a.snakes)) / Math.log2(140) * 100));
  const percScore  = percDynamic(pieces, w, h);
  const score = Math.round(0.16 * turnsScore + 0.08 * snakeScore + 0.16 * rateScore + 0.60 * percScore);
  const [, tier, emoji] = DIFF_TIERS.find(t => score < t[0]);
  return { score, tier, emoji, breakdown: { turnsScore, snakeScore, rateScore, percScore } };
}

// ---------- Generator ----------
const MAXSNAKES = 220;   // trần số rắn mỗi map (giữ thời gian sinh trong tầm; ảnh cần nhiều để phủ đẹp)
function rint(n) { return Math.floor(Math.random() * n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// allow(kk) = ô "x,y" có được phép đặt rắn không (gộp mask + lòi ra + bounds).
function growSnake(hx, hy, dir, len, pieces, w, h, id, allow) {
  if (!inBoard(hx, hy, w, h)) return null;
  const occ = new Set(); pieces.forEach(p => p.cells.forEach(c => occ.add(c.x + "," + c.y)));
  const hk = hx + "," + hy;
  if (occ.has(hk) || !allow(hk)) return null;
  const d = DELTA[dir]; const ray = new Set();
  let rx = hx + d.x, ry = hy + d.y;
  while (inBoard(rx, ry, w, h)) { ray.add(rx + "," + ry); rx += d.x; ry += d.y; }
  const cells = [{ x:hx, y:hy }]; const used = new Set([hk]); let cur = { x:hx, y:hy };
  // Ràng buộc: nếu định dài >=2, ô cổ phải nằm NGAY SAU đầu (ngược hướng dir) -> đầu thẳng.
  if (len >= 2) {
    const nx = hx - d.x, ny = hy - d.y, kk = nx + "," + ny;
    if (!inBoard(nx, ny, w, h) || occ.has(kk) || !allow(kk)) return null;   // không đặt được cổ -> bỏ (không tạo rắn 1 ô)
    cells.push({ x:nx, y:ny }); used.add(kk); cur = { x:nx, y:ny };
  }
  // các ô còn lại đi bộ ngẫu nhiên (tránh ô đã chiếm, thân, tia đi của đầu; tôn trọng allow)
  for (let k = cells.length; k < len; k++) {
    let nxt = null;
    for (const dd of shuffle([{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}])) {
      const nx = cur.x + dd.x, ny = cur.y + dd.y, kk = nx + "," + ny;
      if (!inBoard(nx, ny, w, h) || occ.has(kk) || used.has(kk) || ray.has(kk)) continue;
      if (!allow(kk)) continue;
      nxt = { x:nx, y:ny }; break;
    }
    if (!nxt) break;
    cells.push(nxt); used.add(nxt.x + "," + nxt.y); cur = nxt;
  }
  if (cells.length < 2) return null;   // không bao giờ trả rắn 1 ô
  return { id, dir, cells };
}

// Phân bố độ dài lệch theo longPref (0=ngắn, 1=dài). Trả độ dài trong [1, maxL].
function snakeLen(longPref, maxL) {
  const k = Math.pow(0.15, (longPref - 0.5) * 2);   // longPref 0 -> k lớn (ngắn); 1 -> k nhỏ (dài)
  let len = 1 + Math.floor(Math.pow(Math.random(), k) * maxL);
  return Math.min(maxL, Math.max(2, len));   // tối thiểu 2 ô = 1 cạnh (không sinh rắn 1 ô)
}

// Sinh rắn LẤP ĐẦY vùng chơi tới tỉ lệ `fill`. longPref/difficulty/wrapping: 0..100.
// opts: { mask, overflow, fill, bounds:{x0,y0,x1,y1} }
function generateMap(w, h, longPref, difficulty, wrapping, opts) {
  const t = clamp(difficulty, 0, 100) / 100, wp = clamp(wrapping, 0, 100) / 100, lp = clamp(longPref, 0, 100) / 100;
  const wEdges = t * 2.4, wCross = t * 2.0, wDepth = t * 4.0, wWrap = wp * 8.0, wLen = 0.3 + lp * 1.5;   // ưu tiên rắn DÀI mạnh hơn -> ít rắn vụn
  const mask = (opts && opts.mask) || null, overflow = (opts && opts.overflow) || 0;
  const fill = (opts && opts.fill != null) ? opts.fill : 0.65;
  const bounds = (opts && opts.bounds) || null;
  const maxL = mask ? 6 : 8;
  const inArea = k => !mask || mask.has(k);
  const allow = kk => {
    if (bounds) { const i = kk.indexOf(","), x = +kk.slice(0, i), y = +kk.slice(i + 1);
      if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) return false; }
    return !mask || mask.has(kk) || Math.random() < overflow;
  };
  const bx0 = bounds ? bounds.x0 : 0, by0 = bounds ? bounds.y0 : 0;
  const bx1 = bounds ? bounds.x1 : w - 1, by1 = bounds ? bounds.y1 : h - 1;
  const area = mask ? mask.size : (bx1 - bx0 + 1) * (by1 - by0 + 1);
  const maskKeys = mask ? Array.from(mask) : null;
  const covered = new Set();
  const targetCov = Math.ceil(fill * area);
  const cap = Math.min(area + 4, MAXSNAKES);
  const maxTries = area * 50 + 4000;

  function pickHead() {
    if (maskKeys) {
      let key = maskKeys[rint(maskKeys.length)];
      for (let t2 = 0; t2 < 6 && covered.has(key); t2++) key = maskKeys[rint(maskKeys.length)];
      return key.split(",").map(Number);
    }
    for (let t2 = 0; t2 < 6; t2++) { const x = bx0 + rint(bx1 - bx0 + 1), y = by0 + rint(by1 - by0 + 1); if (!covered.has(x + "," + y)) return [x, y]; }
    return [bx0 + rint(bx1 - bx0 + 1), by0 + rint(by1 - by0 + 1)];
  }

  let pieces = []; let id = 1, placed = 0, tries = 0;
  while (covered.size < targetCov && placed < cap && tries < maxTries) {
    let best = null, bestScore = -Infinity;
    for (let s = 0; s < 18; s++) {
      tries++;
      const [hx, hy] = pickHead();
      const cand = growSnake(hx, hy, DIRS[rint(4)], snakeLen(lp, maxL), pieces, w, h, id, allow);
      if (!cand) continue;
      const test = pieces.concat([cand]);
      if (!solve(test, w, h).solvable) continue;
      const m = depMetrics(test, w, h);
      let newCov = 0;
      for (const c of cand.cells) { const k = c.x + "," + c.y; if (inArea(k) && !covered.has(k)) newCov++; }
      const score = wEdges * m.edges + wCross * m.cross + wDepth * m.depth
                  + wWrap * m.wrap + wLen * cand.cells.length + newCov * 2 + Math.random() * 0.5;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    if (best) {
      pieces.push(best); id++; placed++;
      for (const c of best.cells) { const k = c.x + "," + c.y; if (inArea(k)) covered.add(k); }
    } else tries += 40;
  }
  return pieces;
}

function coverageCount(pieces, mask) {
  let c = 0; for (const p of pieces) for (const cell of p.cells) if (mask.has(cell.x + "," + cell.y)) c++;
  return c;
}

// longPref: ưu tiên rắn dài 0..100. bounds: vùng đặt rắn (chừa lề cho rắn mẹ).
function autoGenerate(w, h, diff, wrap, longPref, mask, overflow, fillFixed, target, bounds) {
  const opt = f => ({ mask, overflow, fill: f, bounds });
  // ===== ẢNH: lấp đầy là số 1 =====
  if (fillFixed != null && mask) {
    const big = mask.size > 800;
    const tries = (target || big) ? 2 : 3;
    let best = null, bestRank = -Infinity;
    for (let r = 0; r < tries; r++) {
      const cand = generateMap(w, h, longPref, diff, wrap, opt(fillFixed));
      if (cand.length < 2) continue;
      const covFrac = mask.size ? coverageCount(cand, mask) / mask.size : 0;
      const delta = target ? Math.abs(computeDifficulty(cand, w, h).score - target) : 0;
      const rank = Math.min(covFrac, fillFixed) * 1000 - delta;
      if (rank > bestRank) { bestRank = rank; best = cand; }
    }
    return best || generateMap(w, h, longPref, diff, wrap, opt(fillFixed));
  }

  // ===== BÀN THƯỜNG: nhắm điểm muốn bằng cách quét ĐỘ LẤP ĐẦY (mật độ) =====
  if (!target) return generateMap(w, h, longPref, diff, wrap, opt(0.65));
  const big = w * h > 1500;
  const fills = big ? [0.40, 0.62, 0.85] : [0.35, 0.50, 0.65, 0.80, 0.92];
  let best = null, bestDelta = Infinity, bestF = 0.65;
  for (const f of fills) {
    const cand = generateMap(w, h, longPref, diff, wrap, opt(f));
    if (cand.length < 2) continue;
    const delta = Math.abs(computeDifficulty(cand, w, h).score - target);
    if (delta < bestDelta) { bestDelta = delta; best = cand; bestF = f; }
    if (bestDelta <= 2) return best;
  }
  const refine = big ? 1 : 3;
  for (let r = 0; r < refine && bestDelta > 2; r++) {
    const cand = generateMap(w, h, longPref, diff, wrap, opt(bestF));
    if (cand.length < 2) continue;
    const delta = Math.abs(computeDifficulty(cand, w, h).score - target);
    if (delta < bestDelta) { bestDelta = delta; best = cand; }
  }
  return best || generateMap(w, h, longPref, diff, wrap, opt(bestF));
}

// ---------- Rắn mẹ (viền ôm sát hình) ----------
// Bám-tường (luật bàn tay phải): đi trên các ô trống NGOÀI sát hình, luôn giữ hình bên phải,
// nên lần đúng TOÀN BỘ đường bao ngoài thành một vòng khép kín — kể cả hình lõm phức tạp.
function traceBorder(region, w, h) {
  const inFree = (x, y) => x >= 0 && x < w && y >= 0 && y < h && !region.has(x + "," + y);
  // ô hình trên-trái nhất -> bắt đầu viền ở ô NGAY TRÊN nó, hướng Đông (hình nằm bên phải/dưới)
  let rx = null, ry = null;
  for (const k of region) { const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1);
    if (ry === null || y < ry || (y === ry && x < rx)) { rx = x; ry = y; } }
  if (rx === null || ry - 1 < 0 || !inFree(rx, ry - 1)) return null;
  const D = [[1,0],[0,1],[-1,0],[0,-1]];   // E, S, W, N (quay phải = +1)
  const sx = rx, sy = ry - 1;
  let cx = sx, cy = sy, heading = 0;
  // Bám-tường KHÉP KÍN: KHÔNG cấm đi vào ô đã thăm — nếu cấm thì gặp khe lõm cụt
  // (vd khe giữa các chân) là kẹt, viền đứt giữa chừng. Cho phép lùi -> đi đủ vòng,
  // rồi "xoá vòng lặp" (loop-erasure) để thân rắn vẫn là đường đơn (khe cụt bị cắt qua miệng).
  const stack = [];                         // đường đơn đã gom (loop-erased)
  const idx = new Map();                    // "x,y" -> vị trí trong stack
  const stateSeen = new Set();              // "x,y,heading" -> đảm bảo dừng (định lý bám tường)
  let guard = 0, lim = 8 * w * h + 32;
  while (guard++ < lim) {
    const k = cx + "," + cy;
    if (stack.length && cx === sx && cy === sy) break;   // về đúng ô đầu -> đóng vòng ngoài
    const st = k + "," + heading;
    if (stateSeen.has(st)) break;           // lặp lại trạng thái -> đã khép, dừng an toàn
    stateSeen.add(st);
    if (idx.has(k)) {                        // gặp lại ô (rẽ vào/ra khe cụt) -> cắt bỏ đoạn bong bóng
      for (let i = stack.length - 1; i > idx.get(k); i--) idx.delete(stack[i].x + "," + stack[i].y);
      stack.length = idx.get(k) + 1;
    } else { idx.set(k, stack.length); stack.push({ x: cx, y: cy }); }
    let moved = false;
    for (const t of [1, 0, 3, 2]) {         // thử: quay phải, đi thẳng, quay trái, lùi -> ôm hình
      const nh = (heading + t) % 4, nx = cx + D[nh][0], ny = cy + D[nh][1];
      if (inFree(nx, ny)) { cx = nx; cy = ny; heading = nh; moved = true; break; }
    }
    if (!moved) break;                       // ô cô lập (gần như không xảy ra)
  }
  return stack.length >= 4 ? stack : null;
}
// `loop` là VÒNG KÍN viền (loop[cuối] kề loop[0]). Cắt vòng tại ô mà ĐẦU chĩa ra ngoài THOÁT ĐƯỢC
// (tia không vướng hình & không vướng thân mình). Duyệt mọi ô + cả 2 hướng cạnh.
function motherFromLoop(loop, region, w, h) {
  const n = loop.length;
  if (n < 4) return null;
  const own = new Set(loop.map(c => c.x + "," + c.y));
  const rayClear = (head, d) => {
    let x = head.x + d.x, y = head.y + d.y;
    while (x >= 0 && x < w && y >= 0 && y < h) { const k = x + "," + y; if (region.has(k) || own.has(k)) return false; x += d.x; y += d.y; }
    return true;
  };
  for (let i = 0; i < n; i++) {
    const head = loop[i];
    for (const ni of [(i + 1) % n, (i - 1 + n) % n]) {
      const neck = loop[ni];
      if (Math.abs(head.x - neck.x) + Math.abs(head.y - neck.y) !== 1) continue;
      const dir = dirFromTo(neck, head);
      if (!rayClear(head, DELTA[dir])) continue;
      const cells = [];
      if (ni === (i + 1) % n) for (let s = 0; s < n; s++) cells.push(loop[(i + s) % n]);
      else for (let s = 0; s < n; s++) cells.push(loop[(i - s + n) % n]);
      return { dir, cells };   // head = cells[0], cổ = cells[1] -> đầu thẳng
    }
  }
  return null;
}
// Thêm `count` vòng rắn mẹ ÔM SÁT viền (lồng nhau).
// hugRegion = tập ô để ôm viền (ảnh: dùng MASK silhouette sạch). Không có -> dùng hợp các ô rắn.
function buildMother(pieces, w, h, count, hugRegion) {
  if (count < 1) return [];
  if (!hugRegion && !pieces.length) return [];
  const region = new Set(hugRegion || []);
  if (!hugRegion) pieces.forEach(p => p.cells.forEach(c => region.add(c.x + "," + c.y)));
  const occ = new Set(); pieces.forEach(p => p.cells.forEach(c => occ.add(c.x + "," + c.y)));   // ô rắn (mother không được đè)
  let nid = Math.max(0, ...(pieces.length ? pieces.map(p => p.id) : [0])) + 1;
  const mothers = [];
  for (let i = 1; i <= count; i++) {
    const path = traceBorder(region, w, h);
    if (!path || path.length < 4) break;
    if (path.some(c => occ.has(c.x + "," + c.y))) break;   // an toàn (không xảy ra khi lòi ra = 0)
    let cells = null, dir = null;
    // MỎ THOÁT: thêm ô NGAY TRÊN ô đầu (path[0] ở ngay trên đỉnh hình) -> đầu chĩa LÊN ra ngoài, thoát chắc.
    const sx = path[0].x, sy = path[0].y - 1, sk = sx + "," + sy;
    const inPath = (x, y) => path.some(c => c.x === x && c.y === y);
    if (sy >= 0 && !region.has(sk) && !occ.has(sk) && !inPath(sx, sy)) {
      let clear = true;
      for (let yy = sy - 1; yy >= 0; yy--) { if (region.has(sx + "," + yy) || inPath(sx, yy)) { clear = false; break; } }
      if (clear) { cells = [{ x: sx, y: sy }, ...path]; dir = "up"; }   // cổ = path[0] ngay dưới -> đầu thẳng lên
    }
    if (!cells) { const m = motherFromLoop(path, region, w, h); if (!m) break; cells = m.cells; dir = m.dir; }   // dự phòng: cắt vòng
    if (cells.some(c => occ.has(c.x + "," + c.y))) break;
    cells.forEach(c => region.add(c.x + "," + c.y));        // vòng kế ôm ngoài vòng này
    mothers.push({ id: nid++, dir, cells, mother: true });
  }
  return mothers;
}

// ---------- Ảnh -> mask (vùng ô "1") ----------
// Vẽ ảnh ở độ phân giải cao (ss×ss/ô), tính tỉ lệ tối mỗi ô; ô bật khi cov >= harsh.
function computeMask(img, W, H, th, harsh) {
  const ss = clamp(Math.round(900 / Math.max(W, H)), 1, 24);
  const BW = W * ss, BH = H * ss;
  const cv = document.createElement("canvas");
  cv.width = BW; cv.height = BH;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, BW, BH);
  // contain giữ tỉ lệ, canh giữa
  const s = Math.min(BW / img.naturalWidth, BH / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, (BW - dw) / 2, (BH - dh) / 2, dw, dh);
  const data = ctx.getImageData(0, 0, BW, BH).data;
  const sub = ss * ss; const set = new Set();
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    let dark = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const i = ((cy*ss + sy) * BW + (cx*ss + sx)) * 4;
      const a = data[i+3] / 255;
      const lum = (0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]) * a + 255 * (1 - a);
      if (lum < th) dark++;
    }
    if (dark / sub >= harsh) set.add(cx + "," + cy);
  }
  return set;
}

// ---------- Render: grid ----------
function renderStatic() {
  const { w, h } = dims();
  computeCellSize(w);
  board.classList.toggle("play", state.mode === "play");
  board.style.width = (GAP + w * (CELL + GAP)) + "px";
  board.style.height = (GAP + h * (CELL + GAP)) + "px";
  [...board.querySelectorAll(".cell")].forEach(n => n.remove());
  const mask = (state.mode === "edit") ? state.maskCells : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = document.createElement("div");
    d.className = "cell" + (mask && mask.has(x + "," + y) ? " on" : "");
    const p = cellPos(x, y);
    d.style.left = p.left + "px"; d.style.top = p.top + "px";
    d.style.width = CELL + "px"; d.style.height = CELL + "px";
    d.addEventListener("click", () => handleCellClick(x, y));
    board.appendChild(d);
  }
}

// ---------- Render: lưới (đường kẻ + giao điểm) — rắn nằm TRÊN đường lưới ----------
function gLine(svg, x1, y1, x2, y2) {
  const l = svgEl("line");
  l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2);
  l.setAttribute("class", "grid-line");
  svg.appendChild(l);
}
function renderGrid() {
  const old = board.querySelector("#gridLayer"); if (old) old.remove();
  const { w, h } = dims();
  const svg = svgEl("svg");
  svg.id = "gridLayer";
  svg.setAttribute("width", parseFloat(board.style.width));
  svg.setAttribute("height", parseFloat(board.style.height));
  const mask = (state.mode === "edit") ? state.maskCells : null;
  // vùng mask (silhouette ảnh) — ô mờ để vẫn thấy hình
  if (mask) for (const k of mask) {
    const i = k.indexOf(","), x = +k.slice(0, i), y = +k.slice(i + 1);
    if (x >= w || y >= h) continue;
    const c = cellCenter(x, y), s = CELL + GAP;
    const r = svgEl("rect");
    r.setAttribute("x", c.x - s / 2); r.setAttribute("y", c.y - s / 2);
    r.setAttribute("width", s); r.setAttribute("height", s);
    r.setAttribute("rx", 4); r.setAttribute("class", "grid-mask");
    svg.appendChild(r);
  }
  // đường kẻ ngang/dọc nối các giao điểm
  for (let y = 0; y < h; y++) { const a = cellCenter(0, y), b = cellCenter(w - 1, y); gLine(svg, a.x, a.y, b.x, b.y); }
  for (let x = 0; x < w; x++) { const a = cellCenter(x, 0), b = cellCenter(x, h - 1); gLine(svg, a.x, a.y, b.x, b.y); }
  // giao điểm
  const rad = Math.max(1.5, CELL * 0.07);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = cellCenter(x, y);
    const dot = svgEl("circle");
    dot.setAttribute("cx", c.x); dot.setAttribute("cy", c.y); dot.setAttribute("r", rad);
    dot.setAttribute("class", "grid-dot");
    svg.appendChild(dot);
  }
  board.appendChild(svg);
}

// ---------- Render: mũi tên (SVG line + arrowhead) ----------
// Hình học một con rắn: nét nối tâm các ô (đuôi -> đầu) + tam giác đầu.
function arrowTri(head, d) {
  const px = -d.y, py = d.x;        // vector vuông góc
  const t = CELL * 0.30, b = CELL * 0.15, back = CELL * 0.02;
  const tip = (head.x + d.x * t).toFixed(1) + "," + (head.y + d.y * t).toFixed(1);
  const bl = (head.x - d.x * back + px * b).toFixed(1) + "," + (head.y - d.y * back + py * b).toFixed(1);
  const br = (head.x - d.x * back - px * b).toFixed(1) + "," + (head.y - d.y * back - py * b).toFixed(1);
  return tip + " " + bl + " " + br;
}
function pieceGeom(cells, dir) {
  const cs = cells.map(c => cellCenter(c.x, c.y));
  const d = DELTA[dir];
  const head = cs[0];
  let pts;
  if (cs.length === 1) {
    const stub = CELL * 0.30;
    pts = [{ x: head.x - d.x * stub, y: head.y - d.y * stub }, head];
  } else {
    pts = cs.slice().reverse(); // đuôi -> đầu
  }
  const linePts = pts.map(p => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
  return { linePts, tri: arrowTri(head, d) };
}

function drawPiece(svg, piece, opts) {
  const color = (opts && opts.color) || (piece.mother ? "#e8c25a" : pieceColor(piece.id));
  const sw = Math.max(2, CELL * (piece.mother ? 0.15 : 0.10));   // rắn mẹ dày hơn (viền)
  const geom = pieceGeom(piece.cells, piece.dir);
  const g = svgEl("g");
  const line = svgEl("polyline");
  line.setAttribute("points", geom.linePts);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", sw);
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  if (opts && opts.draft) { line.setAttribute("stroke-dasharray", "1 " + (sw * 0.9).toFixed(0)); g.setAttribute("opacity", "0.75"); }
  g.appendChild(line);
  const tri = svgEl("polygon");
  tri.setAttribute("points", geom.tri);
  tri.setAttribute("fill", color);
  g.appendChild(tri);
  svg.appendChild(g);
  return { g, line, tri };
}

function buildPieces() {
  const old = board.querySelector("#pieceLayer"); if (old) old.remove();
  pieceEls = new Map();
  const svg = svgEl("svg");
  svg.id = "pieceLayer";
  svg.setAttribute("width", parseFloat(board.style.width));
  svg.setAttribute("height", parseFloat(board.style.height));
  board.appendChild(svg);
  curPieces().forEach(p => pieceEls.set(p.id, drawPiece(svg, p)));
  if (state.mode === "edit" && state.draft) drawPiece(svg, state.draft, { draft: true, color: "#e0b84f" });
}

function renderDeps() {
  const old = board.querySelector("#depLayer"); if (old) old.remove();
  if (!state.showDeps) return;
  const { w, h } = dims(); const pieces = curPieces();
  const svg = svgEl("svg");
  svg.id = "depLayer";
  svg.setAttribute("width", parseFloat(board.style.width));
  svg.setAttribute("height", parseFloat(board.style.height));
  const defs = svgEl("defs");
  defs.innerHTML = '<marker id="dh" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#e0b84f"/></marker>';
  svg.appendChild(defs);
  pieces.forEach(p => {
    const bid = directDep(p, pieces, w, h); if (!bid) return;
    const b = pieces.find(x => x.id === bid); if (!b) return;
    const a = cellCenter(p.cells[0].x, p.cells[0].y), bc = cellCenter(b.cells[0].x, b.cells[0].y);
    const dx = bc.x - a.x, dy = bc.y - a.y, len = Math.hypot(dx, dy) || 1, off = CELL * 0.34;
    const line = svgEl("line");
    line.setAttribute("x1", a.x + dx/len*off); line.setAttribute("y1", a.y + dy/len*off);
    line.setAttribute("x2", bc.x - dx/len*off); line.setAttribute("y2", bc.y - dy/len*off);
    line.setAttribute("stroke", "#e0b84f"); line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4 3"); line.setAttribute("opacity", "0.9");
    line.setAttribute("marker-end", "url(#dh)");
    svg.appendChild(line);
  });
  board.appendChild(svg);
}

function render() { renderStatic(); renderGrid(); buildPieces(); renderDeps(); updateStatus(); }

function updateStatus() {
  $("levelLabel").textContent = state.mode === "edit" ? "Editor" : (state.levelIndex === -1 ? "Test" : state.levelIndex + 1);
  $("moveCount").textContent = state.moves;
  $("parCount").textContent = state.mode === "edit" ? "—" : state.par;
  $("leftCount").textContent = curPieces().length;
  $("moveCount").style.color = state.status === "win"
    ? (state.moves <= state.par ? "var(--good)" : "var(--warn)")
    : (state.moves > state.par ? "var(--warn)" : "var(--text)");
  if (state.mode === "play" && state.status === "win") {
    elMsg.className = "msg win";
    elMsg.textContent = state.moves <= state.par ? "✓ Hoàn hảo! Đúng par." : "✓ Xong! (vượt par)";
  } else if (state.mode === "play") { elMsg.className = "msg"; elMsg.textContent = ""; }
}

// ---------- Input routing ----------
function handleCellClick(x, y) {
  if (state.mode === "edit") { editClick(x, y); return; }
  const p = state.pieces.find(pc => pc.cells.some(c => c.x === x && c.y === y));
  if (p) onPieceTap(p.id);
}

// ---------- Play ----------
function liveFrom(pieces) { return pieces.map(p => ({ id: state.nextId++, dir: p.dir, cells: p.cells.map(c => ({...c})), mother: !!p.mother })); }

function loadLevel(i) {
  const lv = LEVELS[i];
  state.fromLibrary = null;
  state.levelIndex = i; state.W = lv.w; state.H = lv.h;
  state.pieces = liveFrom(lv.pieces);
  state.moves = 0; state.par = lv.par; state.history = []; state.status = "playing";
  highlightLevels(); render();
  refreshDifficulty(state.pieces, state.W, state.H);
  const s = solve(state.pieces, state.W, state.H);
  if (!s.solvable) { elMsg.className = "msg warn"; elMsg.textContent = "⚠ Level này hiện bị kẹt (không giải được)"; }
}
function snapshot() { return { pieces: state.pieces.map(p => ({ id:p.id, dir:p.dir, cells:p.cells.map(c=>({...c})) })), moves: state.moves, status: state.status }; }

function onPieceTap(id) {
  if (state.mode !== "play" || state.status !== "playing") return;
  const p = state.pieces.find(x => x.id === id); if (!p) return;
  const info = pathInfo(p, state.pieces, state.W, state.H);
  state.history.push(snapshot());
  state.moves++;
  if (info.blocked) { bump(p, info.blockerId); updateStatus(); }
  else escapePiece(p);
}

function escapePiece(p) {
  const refs = pieceEls.get(p.id);
  state.pieces = state.pieces.filter(x => x.id !== p.id);
  pieceEls.delete(p.id);

  // Quỹ đạo: đuôi -> ... -> đầu -> kéo dài thẳng ra ngoài bàn.
  // Cả con rắn là một đoạn dài Lbody trượt dọc quỹ đạo này -> trườn mượt.
  const d = DELTA[p.dir];
  const n = p.cells.length;
  const spacing = CELL + GAP;
  const centers = p.cells.map(c => cellCenter(c.x, c.y));
  const track = centers.slice().reverse();              // tail .. head
  const head = centers[0];
  const ext = state.W + state.H + n + 3;
  for (let k = 1; k <= ext; k++) track.push({ x: head.x + d.x * spacing * k, y: head.y + d.y * spacing * k });
  const Lbody = (n - 1) * spacing;
  const wpx = parseFloat(board.style.width), hpx = parseFloat(board.style.height);

  function arcPoint(dist) {
    if (dist <= 0) return track[0];
    let acc = 0;
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i], b = track[i + 1];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= dist) { const t = (dist - acc) / seg; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
      acc += seg;
    }
    return track[track.length - 1];
  }

  const speed = spacing / 75;     // px mỗi ms (~1 ô / 75ms)
  let startT = null;
  function frame(ts) {
    if (startT === null) startT = ts;
    const slid = (ts - startT) * speed;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(arcPoint(Lbody + slid - i * spacing));  // pts[0]=đầu
    if (refs) {
      refs.line.setAttribute("points", pts.map(q => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" "));
      refs.tri.setAttribute("points", arrowTri(pts[0], d));
    }
    const tail = pts[n - 1];
    const off = tail.x < -CELL || tail.x > wpx + CELL || tail.y < -CELL || tail.y > hpx + CELL;
    if (off) { if (refs && refs.g) refs.g.remove(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (!state.pieces.length) state.status = "win";
  updateStatus();
}

function bump(p, blockerId) {
  const d = DELTA[p.dir]; const refs = pieceEls.get(p.id);
  if (refs) { refs.g.style.transform = `translate(${d.x*CELL*0.22}px, ${d.y*CELL*0.22}px)`;
    setTimeout(() => { if (refs.g) refs.g.style.transform = "none"; }, 150); }
  if (blockerId != null) {
    const b = pieceEls.get(blockerId);
    if (b) { b.g.classList.add("flash"); setTimeout(() => b.g.classList.remove("flash"), 330); }
  }
}

function undo() {
  if (!state.history.length) return;
  const s = state.history.pop();
  state.pieces = s.pieces; state.moves = s.moves; state.status = "playing";
  buildPieces(); renderDeps(); updateStatus();
}
function resetLevel() {
  if (state.levelIndex === -1) {
    if (!state.testSnapshot) return;
    state.pieces = liveFrom(state.testSnapshot);
    state.moves = 0; state.history = []; state.status = "playing";
    buildPieces(); updateStatus(); return;
  }
  loadLevel(state.levelIndex);
}
function hint() {
  if (state.mode !== "play" || state.status !== "playing") return;
  const m = state.pieces.find(p => !pathInfo(p, state.pieces, state.W, state.H).blocked);
  if (!m) { elMsg.className = "msg warn"; elMsg.textContent = "Không còn con nào đi được — Hoàn tác/Chơi lại"; return; }
  const refs = pieceEls.get(m.id);
  if (refs) { refs.g.classList.remove("hintp"); void refs.g.getBBox(); refs.g.classList.add("hintp"); }
}

// ---------- Editor ----------
function enterEditor(fromCurrent) {
  state.mode = "edit"; state.draft = null; state.fromLibrary = null;
  if (fromCurrent && state.levelIndex >= 0) {
    const lv = LEVELS[state.levelIndex];
    state.editW = lv.w; state.editH = lv.h;
    state.editPieces = liveFrom(lv.pieces);
  } else if (!state._editorInit) {
    state.editW = 7; state.editH = 7; state.editPieces = [];
  }
  state._editorInit = true;
  $("gridW").value = state.editW; $("gridH").value = state.editH;
  $("parInput").value = Math.max(1, state.editPieces.length);
  refreshMask();
  refreshDifficulty(state.editPieces, state.editW, state.editH);
  syncModeUI(); render();
}
function enterPlay() { state.mode = "play"; state.draft = null; syncModeUI(); loadLevel(state.levelIndex < 0 ? 0 : state.levelIndex); }

function syncModeUI() {
  const edit = state.mode === "edit", batch = state.mode === "batch", play = state.mode === "play";
  $("modePlay").classList.toggle("active", play);
  $("modeEdit").classList.toggle("active", edit);
  const mb = $("modeBatch"); if (mb) mb.classList.toggle("active", batch);
  // Ẩn/hiện khu chơi-editor vs khu hàng loạt
  const ba = document.querySelector(".board-area"); if (ba) ba.style.display = batch ? "none" : "flex";
  const sd = document.querySelector(".side"); if (sd) sd.style.display = batch ? "none" : "flex";
  const bv = $("batchView"); if (bv) bv.style.display = batch ? "grid" : "none";
  $("playControls").style.display = (edit || batch) ? "none" : "flex";
  $("editControls").style.display = edit ? "flex" : "none";
  $("playHint").style.display = (edit || batch) ? "none" : "block";
  $("editorCard").style.display = edit ? "block" : "none";
  $("levelCard").style.display = (edit || batch) ? "none" : "block";
  const lpb = $("libPlayBar"); if (lpb) lpb.style.display = (play && state.fromLibrary != null) ? "flex" : "none";
}

function occupiedAt(x, y) {
  const p = state.editPieces.find(pc => pc.cells.some(c => c.x === x && c.y === y));
  return p ? p.id : null;
}
function inDraft(x, y) { return state.draft && state.draft.cells.some(c => c.x === x && c.y === y); }
function isAdj(x, y, c) { return Math.abs(x - c.x) + Math.abs(y - c.y) === 1; }

function finalizeDraft() {
  if (state.draft && state.draft.cells.length) {
    const piece = { id: state.nextId++, dir: state.draft.dir, cells: state.draft.cells.map(c => ({...c})) };
    enforceHeadDir(piece);   // dài >=2 -> đầu thẳng theo cổ
    state.editPieces.push(piece);
    $("parInput").value = state.editPieces.length;
  }
  state.draft = null;
}

function editClick(x, y) {
  if (state.mode !== "edit") return;
  if (state.tool === "erase") {
    state.editPieces = state.editPieces.filter(pc => !pc.cells.some(c => c.x === x && c.y === y));
    state.draft = null; $("parInput").value = Math.max(1, state.editPieces.length); render(); return;
  }
  if (!state.draft) {
    if (occupiedAt(x, y)) return;
    state.draft = { dir: state.tool, cells: [{ x, y }] }; render(); return;
  }
  const dr = state.draft, head = dr.cells[0], last = dr.cells[dr.cells.length - 1];
  if (x === head.x && y === head.y) { finalizeDraft(); render(); return; }
  if (isAdj(x, y, last) && !occupiedAt(x, y) && !inDraft(x, y)) {
    dr.cells.push({ x, y });
    enforceHeadDir(dr);   // khi đã có cổ, hướng đầu auto = cổ -> đầu
    render(); return;
  }
  finalizeDraft();
  if (!occupiedAt(x, y)) state.draft = { dir: state.tool, cells: [{ x, y }] };
  render();
}

function resizeGrid() {
  finalizeDraft();
  state.editW = clamp(+$("gridW").value, 3, 50);
  state.editH = clamp(+$("gridH").value, 3, 50);
  state.editPieces = state.editPieces.filter(p => p.cells.every(c => c.x < state.editW && c.y < state.editH));
  refreshMask();   // mask phụ thuộc kích thước -> tính lại
  render();
}
function clearGrid() { state.editPieces = []; state.draft = null; $("parInput").value = 1; $("genInfo").textContent = ""; refreshDifficulty([], state.editW, state.editH); render(); }

// ---------- Ảnh -> Map ----------
function loadMaskImage(file) {
  if (!file || !file.type.startsWith("image/")) { setMaskInfo("Không phải ảnh.", "warn"); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); state.maskImg = img; refreshMask(); render();
    setMaskInfo(`Ảnh ${img.naturalWidth}×${img.naturalHeight}. Chỉnh Ngưỡng/Độ gắt rồi bấm "Tạo map".`); };
  img.onerror = () => setMaskInfo("Không nạp được ảnh.", "warn");
  img.src = url;
}
function refreshMask() {
  if (!state.maskImg) { state.maskCells = null; return; }
  const th = clamp(+$("imgTh").value, 0, 255);
  const harsh = clamp(+$("imgHarsh").value, 1, 100) / 100;
  state.maskCells = computeMask(state.maskImg, state.editW, state.editH, th, harsh);
}
function clearMaskImage() {
  state.maskImg = null; state.maskCells = null; setMaskInfo(""); render();
}
function setMaskInfo(msg, kind) {
  const el = $("maskInfo"); if (!el) return;
  el.textContent = msg;
  el.style.color = kind === "warn" ? "var(--danger)" : kind === "good" ? "var(--good)" : "var(--muted)";
}
// đọc các tham số chung của bộ sinh
function genParams() {
  return {
    diff: clamp(+$("genDiff").value, 0, 100),
    wrap: clamp(+$("genWrap").value, 0, 100),
    longPref: clamp(+$("genLong").value, 0, 100),
    target: clamp(+$("genTarget").value, 0, 100),
    motherN: $("genMother").checked ? 1 : 0,
  };
}
// ghép rắn mẹ (nếu có) rồi nạp vào editPieces. hugRegion = vùng để ôm viền (mask của ảnh).
function applyGenerated(arr, W, H, motherN, hugRegion) {
  let mothers = motherN > 0 ? buildMother(arr, W, H, motherN, hugRegion) : [];
  let all = arr.concat(mothers), note = "";
  if (mothers.length && !solve(all, W, H).solvable) { mothers = []; all = arr; note = " · ⚠ rắn mẹ gây kẹt, đã bỏ"; }
  else if (motherN > 0 && mothers.length < motherN) note = ` · rắn mẹ ${mothers.length}/${motherN}`;
  state.editPieces = all.map(p =>
    ({ id: state.nextId++, dir: p.dir, cells: p.cells.map(c => ({...c})), mother: !!p.mother }));
  return { motherCount: mothers.length, note };
}

function doGenerateFromImage() {
  finalizeDraft();
  if (!state.maskImg) { setMaskInfo("Chưa có ảnh.", "warn"); return; }
  refreshMask();
  const mask = state.maskCells;
  if (!mask || !mask.size) { setMaskInfo("Mask rỗng — giảm Độ gắt hoặc tăng Ngưỡng.", "warn"); return; }
  const { diff, wrap, longPref, target, motherN } = genParams();
  const fill = clamp(+$("imgFill").value, 0, 100) / 100;
  const W = state.editW, H = state.editH;
  const arr = autoGenerate(W, H, diff, wrap, longPref, mask, 0, fill, target, null);
  const cellsIn = arr.reduce((a, p) => a + p.cells.filter(c => mask.has(c.x + "," + c.y)).length, 0);
  const { motherCount, note } = applyGenerated(arr, W, H, motherN, mask);   // rắn mẹ ôm theo MASK (silhouette sạch)
  $("parInput").value = Math.max(1, state.editPieces.length);
  const s = solve(state.editPieces, W, H);
  const d = refreshDifficulty(state.editPieces, W, H);
  const covPct = mask.size ? (100 * cellsIn / mask.size).toFixed(0) : 0;
  render();
  setMaskInfo(`✓ ${arr.length} rắn${motherCount ? " + " + motherCount + " mẹ" : ""} · phủ ${covPct}% · khó ${d.score} ${d.emoji} ${d.tier} · ${s.solvable ? "giải được ✓" : "KẸT ✗"}${note}`, s.solvable ? "good" : "warn");
}

function doGenerate() {
  finalizeDraft();
  const { diff, wrap, longPref, target, motherN } = genParams();
  const W = state.editW, H = state.editH;
  const arr = autoGenerate(W, H, diff, wrap, longPref, null, 0, null, target, null);
  const { motherCount, note } = applyGenerated(arr, W, H, motherN);
  $("parInput").value = Math.max(1, state.editPieces.length);
  const got = state.editPieces.length;
  const s = solve(state.editPieces, W, H);
  const m = depMetrics(state.editPieces, W, H);
  const d = refreshDifficulty(state.editPieces, W, H);
  const cellTotal = state.editPieces.reduce((a, p) => a + p.cells.length, 0);
  render();
  const avg = got ? (cellTotal / got).toFixed(1) : 0;
  $("genInfo").innerHTML =
    `<b>${arr.length}</b> rắn${motherCount ? " + " + motherCount + " mẹ" : ""} · ${diffText(d)} · dài TB ${avg} · sâu ${m.depth}` +
    (s.solvable ? "" : " · <span style='color:var(--danger)'>kẹt ✗</span>");
  elMsg.className = "msg win";
  elMsg.textContent = (target ? `✓ Sinh xong · điểm ${d.score} (muốn ${target})` : `✓ Đã sinh ${got} rắn`) + note;
}
function toggleDeps() { state.showDeps = !state.showDeps; $("depBtn").classList.toggle("active", state.showDeps); renderDeps(); }

function buildExportLevel() {
  const grid = Array.from({ length: state.editH }, () => Array.from({ length: state.editW }, () => 0));
  return { grid, pieces: state.editPieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => [c.x, c.y]), ...(p.mother ? { mother: true } : {}) })), par: clamp(+$("parInput").value, 1, 999) };
}
function validateLevel(lv, w, h) {
  const e = [];
  if (!lv || !Array.isArray(lv.pieces) || !lv.pieces.length) { e.push("chưa có rắn nào"); return e; }
  const occ = new Map();
  lv.pieces.forEach((p, i) => {
    if (!DIRS.includes(p.dir)) e.push(`rắn[${i}] sai hướng`);
    if (!p.cells || !p.cells.length) { e.push(`rắn[${i}] rỗng`); return; }
    p.cells.forEach((c, j) => {
      const cx = Array.isArray(c) ? c[0] : c.x, cy = Array.isArray(c) ? c[1] : c.y;
      if (!inBoard(cx, cy, w, h)) e.push(`rắn[${i}] ô ngoài bàn`);
      const k = cx + "," + cy; if (occ.has(k)) e.push(`chồng ô (${cx},${cy})`); occ.set(k, i);
      if (j > 0) { const pc = p.cells[j-1]; const px = Array.isArray(pc)?pc[0]:pc.x, py = Array.isArray(pc)?pc[1]:pc.y;
        if (Math.abs(px - cx) + Math.abs(py - cy) !== 1) e.push(`rắn[${i}] thân không liền nhau`); }
    });
  });
  return e;
}
function normPieces(pieces) { return pieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => Array.isArray(c) ? { x:c[0], y:c[1] } : { x:c.x, y:c.y }), mother: !!p.mother })); }

function autoPar() {
  finalizeDraft();
  const s = solve(state.editPieces, state.editW, state.editH);
  $("parInput").value = s.par;
  const selfStuck = state.editPieces.filter(p => pathInfo(p, state.editPieces, state.editW, state.editH).self).length;
  const d = refreshDifficulty(state.editPieces, state.editW, state.editH);
  if (s.solvable) { elMsg.className = "msg win"; elMsg.innerHTML = `✓ Giải được — par ${s.par} · ${diffText(d)}`; }
  else { elMsg.className = "msg warn"; elMsg.textContent = `⚠ Kẹt: còn ${s.stuck} con không thoát` + (selfStuck ? ` (${selfStuck} con tự chặn thân)` : ""); }
}
function exportJSON() {
  finalizeDraft();
  const lv = buildExportLevel();
  $("jsonBox").value = JSON.stringify(lv, null, 2);
  const errs = validateLevel(lv, state.editW, state.editH);
  if (errs.length) { elMsg.className = "msg lose"; elMsg.textContent = "⚠ " + errs[0]; return; }
  const s = solve(state.editPieces, state.editW, state.editH);
  if (!s.solvable) { elMsg.className = "msg warn"; elMsg.textContent = `⚠ Đã export nhưng KẸT (còn ${s.stuck})`; }
  else { elMsg.className = "msg win"; elMsg.textContent = `✓ Export OK — giải được, par ${s.par}`; }
}
function importJSON() {
  let lv; try { lv = JSON.parse($("jsonBox").value); } catch { elMsg.className = "msg lose"; elMsg.textContent = "✗ JSON không hợp lệ"; return; }
  const w = (lv.grid && lv.grid[0]) ? lv.grid[0].length : lv.w;
  const h = lv.grid ? lv.grid.length : lv.h;
  if (!w || !h) { elMsg.className = "msg lose"; elMsg.textContent = "✗ Thiếu kích thước"; return; }
  if (!Array.isArray(lv.pieces)) { elMsg.className = "msg lose"; elMsg.textContent = "✗ Thiếu mảng pieces"; return; }
  const errs = validateLevel(lv, w, h);
  if (errs.length) { elMsg.className = "msg lose"; elMsg.textContent = "⚠ " + errs[0]; return; }
  state.editW = w; state.editH = h;
  state.editPieces = normPieces(lv.pieces).map(p => ({ id: state.nextId++, dir: p.dir, cells: p.cells }));
  state.draft = null;
  $("gridW").value = w; $("gridH").value = h; $("parInput").value = lv.par || state.editPieces.length;
  elMsg.className = "msg win"; elMsg.textContent = "✓ Đã import"; render();
}
function testPlay() {
  finalizeDraft();
  const lv = buildExportLevel();
  const errs = validateLevel(lv, state.editW, state.editH);
  if (errs.length) { elMsg.className = "msg lose"; elMsg.textContent = "⚠ " + errs[0]; return; }
  const s = solve(state.editPieces, state.editW, state.editH);
  state.mode = "play"; state.levelIndex = -1; state.W = state.editW; state.H = state.editH;
  state.testSnapshot = state.editPieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => ({...c})) }));
  state.pieces = liveFrom(state.testSnapshot);
  state.moves = 0; state.par = s.par; state.history = []; state.status = "playing";
  syncModeUI(); highlightLevels(); render();
  refreshDifficulty(state.pieces, state.W, state.H);
  if (!s.solvable) { elMsg.className = "msg warn"; elMsg.textContent = `⚠ Test: level bị kẹt (còn ${s.stuck})`; }
}

// ---------- Utils ----------
function clamp(v, lo, hi) { v = isNaN(v) ? lo : v; return Math.max(lo, Math.min(hi, v)); }

// Tính & hiển thị điểm độ khó cho 1 bộ rắn.
function refreshDifficulty(pieces, w, h) {
  const d = computeDifficulty(pieces, w, h);
  state.difficulty = d;
  const el = $("diffLabel");
  if (el) el.innerHTML = (!pieces.length || d.tier === "—")
    ? "—"
    : `${d.score} ${d.emoji} <span style="color:var(--muted)">${d.tier}</span>`;
  return d;
}
function diffText(d) {
  if (!d) return "";
  if (d.tier === "KẸT") return "khó —";
  const b = d.breakdown;
  return `khó <b>${d.score}</b> ${d.emoji} ${d.tier}` +
    (b ? ` <span style="color:var(--muted)">(bẫy ${Math.round(b.percScore)}·lượt ${Math.round(b.turnsScore)}·rắn ${Math.round(b.snakeScore)}·tốc ${Math.round(b.rateScore)})</span>` : "");
}

// ---------- Level buttons ----------
function buildLevelButtons() {
  const list = $("levelList"); list.innerHTML = "";
  LEVELS.forEach((_, i) => {
    const b = document.createElement("button");
    b.className = "level-btn toggle"; b.textContent = i + 1;
    b.addEventListener("click", () => { if (state.mode !== "play") { state.mode = "play"; state.draft = null; syncModeUI(); } loadLevel(i); });
    list.appendChild(b);
  });
}
function highlightLevels() {
  [...$("levelList").children].forEach((b, i) => b.classList.toggle("active", state.mode === "play" && i === state.levelIndex));
}

// ---------- Wire up ----------
$("hintBtn").addEventListener("click", hint);
$("undoBtn").addEventListener("click", undo);
$("resetBtn").addEventListener("click", resetLevel);
$("modePlay").addEventListener("click", enterPlay);
$("modeEdit").addEventListener("click", () => enterEditor(false));
$("finishBtn").addEventListener("click", () => { finalizeDraft(); render(); });
$("testBtn").addEventListener("click", testPlay);
$("autoParBtn").addEventListener("click", autoPar);
$("clearBtn").addEventListener("click", clearGrid);
$("resizeBtn").addEventListener("click", resizeGrid);
$("genBtn").addEventListener("click", doGenerate);
$("depBtn").addEventListener("click", toggleDeps);
$("exportBtn").addEventListener("click", exportJSON);
$("importBtn").addEventListener("click", importJSON);

// Ảnh -> Map
$("mapImgBtn").addEventListener("click", () => $("mapImg").click());
$("mapImg").addEventListener("change", () => { if ($("mapImg").files[0]) loadMaskImage($("mapImg").files[0]); });
$("mapImgClear").addEventListener("click", clearMaskImage);
$("mapFromImgBtn").addEventListener("click", doGenerateFromImage);
$("imgTh").addEventListener("input", () => { $("imgThVal").textContent = $("imgTh").value; refreshMask(); render(); });
$("imgHarsh").addEventListener("input", () => { $("imgHarshVal").textContent = $("imgHarsh").value; refreshMask(); render(); });
$("imgFill").addEventListener("input", () => { $("imgFillVal").textContent = $("imgFill").value; });
$("genDiff").addEventListener("input", () => { $("genDiffVal").textContent = $("genDiff").value; });
$("genWrap").addEventListener("input", () => { $("genWrapVal").textContent = $("genWrap").value; });
$("genLong").addEventListener("input", () => { $("genLongVal").textContent = $("genLong").value; });
$("genTarget").addEventListener("input", () => { $("genTargetVal").textContent = +$("genTarget").value === 0 ? "0" : $("genTarget").value; });
window.addEventListener("paste", e => {
  if (state.mode !== "edit") return;
  const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
  if (it) loadMaskImage(it.getAsFile());
});

document.querySelectorAll(".tool").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.tool = btn.dataset.tool;
    // chỉ đổi được hướng đầu khi rắn nháp còn <2 ô; >=2 thì hướng đầu bị ép theo cổ
    if (state.tool !== "erase" && state.draft && state.draft.cells.length < 2) { state.draft.dir = state.tool; render(); }
    else if (state.tool === "erase") { finalizeDraft(); render(); }
  });
});

document.addEventListener("keydown", e => {
  if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
  if (state.mode === "edit") {
    if (e.key === "Enter") { finalizeDraft(); render(); e.preventDefault(); }
    return;
  }
  if (e.key === "z" || e.key === "Z") { undo(); e.preventDefault(); }
  else if (e.key === "h" || e.key === "H") { hint(); e.preventDefault(); }
  else if (e.key === "r" || e.key === "R") { resetLevel(); e.preventDefault(); }
});
window.addEventListener("resize", () => render());

// ---------- Boot ----------
buildLevelButtons(); syncModeUI(); loadLevel(0);
