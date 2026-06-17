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

// ---------- Format game Snake Escape (chuẩn) <-> nội bộ ----------
// Bảng 48 màu game chính thức (ColorType 1..48), index 1-based -> GAME_COLORS[idx-1].
const GAME_COLORS = ['#4285F4','#2874F1','#6DA1F7','#C83F45','#C72E35','#E3595F','#FFC315','#E4A802','#FECF47','#48B06A','#31A256','#5DC57F','#9869FF','#8C5CF3','#A57DFD','#E365B0','#E752AB','#E87ABC','#EF8314','#E97600','#FB9D3C','#FF6F61','#FD5E4E','#FB8074','#0FB2B8','#00A6AC','#50CFD4','#35D8FF','#10C5EF','#65E2FF','#9EE338','#88D910','#AEE956','#8D6E3F','#8F6526','#A0865F','#5A6B7A','#4E6273','#69757F','#694714','#62400C','#775725','#2C5FCC','#1C56D1','#3D6ACB','#959595','#807E7E','#B0ADAD'];
function gameColor(idx) { return (idx >= 1 && idx <= GAME_COLORS.length) ? GAME_COLORS[idx - 1] : null; }
let colorMode = "rainbow";   // 'rainbow' (mỗi rắn 1 màu, dễ design) | 'game' (theo fixedColor 48 màu)
function dirFromDelta(dx, dy) { if (dx === 1) return "right"; if (dx === -1) return "left"; if (dy === 1) return "down"; return "up"; }
function countBends(cells) {
  let b = 0;
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1], m = cells[i], c = cells[i + 1];
    if ((m.x - a.x) !== (c.x - m.x) || (m.y - a.y) !== (c.y - m.y)) b++;
  }
  return b;
}
// Nhận diện format game (có XSize/Arrows) vs format cũ của mình ({w,h,pieces} / grid).
function isGameFormat(d) { return !!(d && (d.XSize != null || Array.isArray(d.Arrows))); }
// pieces nội bộ -> object JSON đúng format game (Y-FLIP: Y_game = h-1-y; idx = x + Y_game*w).
function toGameLevel(pieces, w, h, difficulty) {
  const flipY = y => h - 1 - y;
  const norm = c => Array.isArray(c) ? { x: c[0], y: c[1] } : { x: c.x, y: c.y };
  return {
    Difficulty: difficulty || 0, XSize: w, YSize: h,
    Arrows: pieces.map(p => {
      const cells = p.cells.map(norm), head = cells[0], dd = DELTA[p.dir] || { x: 0, y: -1 };
      return {
        Dx: dd.x, Dy: -dd.y, X: head.x, Y: flipY(head.y),
        fixedColor: (typeof p.fixedColor === "number") ? p.fixedColor : -1,
        Indices: cells.map(c => c.x + flipY(c.y) * w),
        BendCount: (typeof p.bends === "number") ? p.bends : countBends(cells)
      };
    }),
    Colors: []
  };
}
// object JSON format game -> { w, h, pieces:[{dir, cells:[{x,y}], fixedColor, bends}] }.
// Y-FLIP ngược lại + LUÔN suy hd từ cells (bỏ qua Dx/Dy của file — quy ước game không khớp solver).
function fromGameLevel(data) {
  const w = data.XSize, h = data.YSize, pieces = [];
  for (const arrow of (data.Arrows || [])) {
    const indices = arrow.Indices || [];
    if (indices.length < 1) continue;
    const cells = indices.map(idx => ({ x: idx % w, y: h - 1 - Math.floor(idx / w) }));
    let dir;
    if (cells.length >= 2) dir = dirFromTo(cells[1], cells[0]);
    else dir = dirFromDelta(arrow.Dx || 0, -(arrow.Dy || 0));   // 1 ô: dùng Dx/Dy (đảo Dy)
    const fc = (typeof arrow.fixedColor === "number") ? arrow.fixedColor : -1;
    pieces.push({ dir, cells, fixedColor: fc, bends: (typeof arrow.BendCount === "number") ? arrow.BendCount : countBends(cells) });
  }
  return { w, h, pieces };
}

// (Đã bỏ level mẫu — chỉ vào chế độ chơi khi Test level đang tạo hoặc chơi từ Thư viện hàng loạt)

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
// Điểm = 0.10·turns + 0.20·snakes + 0.10·rate + 0.60·perceptualĐộng. Tier 5 mức.
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
    let dPerp = 999, blockerLen = sn.cells.length;
    if (blocker.self) dPerp = d.x !== 0 ? Math.abs(blocker.y - head.y) : Math.abs(blocker.x - head.x);
    else {
      const b = byId.get(blocker.id);
      if (b) { blockerLen = b.cells.length; for (const c of b.cells) { const perp = d.x !== 0 ? Math.abs(c.y - head.y) : Math.abs(c.x - head.x); if (perp < dPerp) dPerp = perp; } }
      else dPerp = 0;
    }
    const dCap = Math.min(dAlong, 15);
    const angle = Math.atan2(dPerp, dCap) * 180 / Math.PI;
    const confusion = Math.max(0, 1 - angle / 30);
    // BẪY MẠNH HƠN khi con LỚN bị con NHỎ chặn ở XA: sizeBoost chỉ khuếch đại (≥1), dCap đã mã hóa khoảng cách.
    const sizeBoost = Math.max(1, Math.min(3, sn.cells.length / Math.max(1, blockerLen)));
    total += Math.min(confusion * dCap / 10 * sizeBoost, 1.0);
  }
  return total / pieces.length;
}
// Replay solver, trả 3 tín hiệu theo lượt (0..100):
//  perc   = bẫy "tưởng đi được mà bị chặn" (sustained top-30% × (1+0.5·freq))
//  hidden = bẫy "tưởng KHÔNG đi được mà LẠI đi được" (tia thoát luồn sát rắn khác = nhìn như bị chặn)
//  xa     = quãng đường rắn phải chạy để VA TRÚNG con chặn nó (phụ thuộc tầm xa -> khó nhìn ra)
function percDynamic(pieces, w, h) {
  if (!pieces.length) return { perc: 0, hidden: 0, xa: 0 };
  const MIN_REM = 3, RISKY = 0.10, K = 230, FREQ_BOOST = 0.5, TOP_FRAC = 0.30;
  let rest = pieces.slice(); const series = [], hSeries = [], dSeries = []; let t = 0;
  while (rest.length && t < 300) {
    const occ = new Map(); for (const p of rest) for (const c of p.cells) occ.set(c.x + "," + c.y, p.id);
    if (rest.length >= MIN_REM) series.push(percRisk(rest, w, h));
    const mv = []; let hidSum = 0, hidCnt = 0, depSum = 0, depCnt = 0;
    for (const p of rest) {
      const d = DELTA[p.dir], head = p.cells[0], px = -d.y, py = d.x, id = p.id;
      let x = head.x + d.x, y = head.y + d.y, ok = true, nearMiss = 0, dist = 0;
      while (x >= 0 && y >= 0 && x < w && y < h) {
        if (occ.has(x + "," + y)) { ok = false; break; }
        const s1 = occ.get((x + px) + "," + (y + py)), s2 = occ.get((x - px) + "," + (y - py));   // ô sát BÊN tia
        if ((s1 !== undefined && s1 !== id) || (s2 !== undefined && s2 !== id)) nearMiss++;          // luồn sát rắn khác
        dist++; x += d.x; y += d.y;
      }
      if (rest.length >= MIN_REM) {
        if (ok) { hidSum += Math.min(1, nearMiss / 3); hidCnt++; }     // thoát được nhưng luồn sát: tưởng-chặn-mà-đi
        else { depSum += Math.min(dist, 15) / 15; depCnt++; }           // bị chặn: quãng đường tới con chặn (XA = khó)
      }
      if (ok) mv.push(p);
    }
    if (hidCnt) hSeries.push(hidSum / hidCnt);
    if (depCnt) dSeries.push(depSum / depCnt);
    if (!mv.length) break;
    t++;
    const ids = new Set(mv.map(p => p.id));
    rest = rest.filter(p => !ids.has(p.id));
  }
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  let perc = 0;
  if (series.length) {
    const freq = series.filter(r => r >= RISKY).length / series.length;
    const sorted = [...series].sort((a, b) => b - a);
    const topN = Math.max(1, Math.ceil(series.length * TOP_FRAC));
    const sustained = sorted.slice(0, topN).reduce((a, b) => a + b, 0) / topN;
    perc = Math.min(100, sustained * K * (1 + FREQ_BOOST * freq));
  }
  return { perc, hidden: avg(hSeries) * 100, xa: avg(dSeries) * 100 };
}
const DIFF_TIERS = [[20,"Rất dễ","★"],[40,"Dễ","★★"],[60,"Vừa","★★★"],[80,"Khó","★★★★"],[101,"Siêu khó","★★★★★"]];
// VÙNG RỜI: đếm các cụm ô KHÔNG liên thông (4-hướng) + độ XA giữa tâm các vùng -> bonus độ khó NHẸ.
// Layout nhiều hình rời / map import có nhiều mảnh cách xa -> phải dõi mắt nhiều nơi -> khó hơn chút.
// Map 1 vùng liền (đa số) -> bonus 0 (không đổi hành vi cũ). Tự động áp dụng cả khi sinh lẫn import.
function regionSeparation(pieces, w, h) {
  const occ = new Set(), cells = [];
  for (const p of pieces) { if (!p || !p.cells) continue; for (const c of p.cells) { const x = c.x !== undefined ? c.x : c[0], y = c.y !== undefined ? c.y : c[1]; const k = x + "," + y; if (!occ.has(k)) { occ.add(k); cells.push([x, y]); } } }
  if (!cells.length) return { regions: 0, bonus: 0 };
  const comp = new Set(), cents = []; let R = 0;
  for (const [sx, sy] of cells) {
    const sk = sx + "," + sy; if (comp.has(sk)) continue;
    R++; const q = [[sx, sy]]; comp.add(sk); let hi = 0, mx = 0, my = 0, cnt = 0;
    while (hi < q.length) { const [x, y] = q[hi++]; mx += x; my += y; cnt++; for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nk = (x + dx) + "," + (y + dy); if (occ.has(nk) && !comp.has(nk)) { comp.add(nk); q.push([x + dx, y + dy]); } } }
    cents.push([mx / cnt, my / cnt]);
  }
  if (R <= 1) return { regions: R, bonus: 0 };
  const diag = Math.hypot(w, h) || 1;
  let sumD = 0, pairs = 0; for (let i = 0; i < cents.length; i++) for (let j = i + 1; j < cents.length; j++) { sumD += Math.hypot(cents[i][0] - cents[j][0], cents[i][1] - cents[j][1]); pairs++; }
  const spreadNorm = pairs ? Math.min(1, (sumD / pairs) / diag * 1.6) : 0;   // khoảng cách TB tâm vùng / đường chéo
  const regTerm = Math.min(1, (R - 1) / 3);                                   // 2 vùng->0.33 · 4+ vùng->1
  const bonus = Math.round(12 * regTerm * (0.4 + 0.6 * spreadNorm));          // tối đa ~12 điểm (tăng nhẹ)
  return { regions: R, bonus };
}
function computeDifficulty(pieces, w, h) {
  if (!pieces.length) return { score: 0, tier: "—", emoji: "" };
  const a = analyzeSolve(pieces, w, h);
  if (a.stuck > 0) return { score: 0, tier: "KẸT", emoji: "✕", stuck: a.stuck, breakdown: null };
  // Số cách đi mỗi lượt (TRUNG BÌNH): ít rắn thoát được/lượt -> bị siết -> KHÓ CHƠI. Thành phần #2.
  const rates = a.turnData.map(d => d.rate);   // mỗi lượt: % rắn còn lại thoát được (chuẩn hóa theo cỡ bàn)
  const avgRate = rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : 0;
  const moveRaw    = Math.max(0, Math.min(100, (100 - avgRate) * 1.1));
  const moveScore  = Math.round(moveRaw * moveRaw / 100);   // BÌNH PHƯƠNG: siết mạnh (lỏng -> rớt sâu)
  const snakeScore = Math.max(0, Math.min(100, Math.log2(Math.max(1, a.snakes)) / Math.log2(140) * 100));
  const sig = percDynamic(pieces, w, h);
  const percScore = sig.perc, hiddenScore = sig.hidden, xaScore = sig.xa;
  // Trọng số: bẫy "đi-được-mà-bị-chặn" 0.30 = ẩn "tưởng-chặn-mà-đi-được" 0.30 · số cách đi/lượt 0.20
  //          · phụ-thuộc-XA (quãng đường tới con chặn) 0.10 · số rắn 0.10
  const raw = 0.30 * percScore + 0.30 * hiddenScore + 0.20 * moveScore + 0.10 * xaScore + 0.10 * snakeScore;
  // TRẦN KHẢ-CHƠI: map mỗi lượt đi được NHIỀU (moveScore thấp) thì dù nhìn rối vẫn DỄ chơi -> kéo điểm xuống.
  const playable = 0.6 + 0.4 * (moveScore / 100);   // 0.6 (lỏng) .. 1.0 (siết chặt)
  const sep = regionSeparation(pieces, w, h);   // bonus NHẸ theo số vùng rời + độ xa (layout tự do / import nhiều mảnh)
  const score = Math.min(100, Math.round(raw * playable) + sep.bonus);
  const [, tier, emoji] = DIFF_TIERS.find(t => score < t[0]);
  return { score, tier, emoji, regions: sep.regions, sepBonus: sep.bonus, breakdown: { snakeScore, moveScore, percScore, hiddenScore, xaScore } };
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
    // Độ dài MONG MUỐN giảm dần theo độ phủ -> ĐẶT RẮN DÀI TRƯỚC, rắn ngắn lấp khe sau.
    // longPref cao -> giữ rắn dài lâu hơn (ít rắn vụn). Vẫn ưu tiên rắn dài hơn qua wLen + chấm điểm.
    const frac = targetCov ? covered.size / targetCov : 1;
    const Lwant = Math.max(2, Math.round(maxL - frac * (1 - lp * 0.5) * (maxL - 2)));
    let best = null, bestScore = -Infinity;
    for (let s = 0; s < 18; s++) {
      tries++;
      const [hx, hy] = pickHead();
      const cand = growSnake(hx, hy, DIRS[rint(4)], Lwant, pieces, w, h, id, allow);
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
function traceBorder(region, w, h, blocked) {
  const inFree = (x, y) => x >= 0 && x < w && y >= 0 && y < h && !region.has(x + "," + y) && (!blocked || !blocked.has(x + "," + y));   // blocked = ô của hình/mẹ KHÁC -> viền không lấn sang
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
// Tách 1 tập ô thành các VÙNG LIÊN THÔNG (4-hướng) — mỗi vùng rời 1 (bộ) rắn mẹ riêng.
function connectedComponents(region, w, h) {
  const seen = new Set(), comps = [];
  for (const k of region) {
    if (seen.has(k)) continue;
    const comp = [], q = [k]; seen.add(k);
    while (q.length) { const cur = q.pop(); comp.push(cur); const i = cur.indexOf(","), x = +cur.slice(0, i), y = +cur.slice(i + 1);
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nk = (x + dx) + "," + (y + dy); if (region.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); } } }
    comps.push(comp);
  }
  return comps;
}
// Thêm `count` vòng rắn mẹ ÔM SÁT viền (lồng nhau) — cho TỪNG vùng liên thông rời nhau.
// hugRegion = tập ô để ôm viền (ảnh: dùng MASK silhouette sạch). Không có -> dùng hợp các ô rắn.
function buildMother(pieces, w, h, count, hugRegion) {
  if (count < 1) return [];
  if (!hugRegion && !pieces.length) return [];
  const full = new Set(hugRegion || []);
  if (!hugRegion) pieces.forEach(p => p.cells.forEach(c => full.add(c.x + "," + c.y)));
  if (!full.size) return [];
  const occ = new Set(); pieces.forEach(p => p.cells.forEach(c => occ.add(c.x + "," + c.y)));   // ô rắn (mother không được đè)
  let nid = Math.max(0, ...(pieces.length ? pieces.map(p => p.id) : [0])) + 1;
  const mothers = [];
  const block = new Set(full);   // chặn TOÀN CỤC: mọi ô hình (tất cả vùng) + mẹ đã đặt -> ray không xuyên hình khác, không chồng
  for (const comp of connectedComponents(full, w, h)) {   // mỗi VÙNG RỜI -> 1 (bộ) rắn mẹ riêng
    const region = new Set(comp);   // viền bám RIÊNG vùng này
    for (let i = 1; i <= count; i++) {
      const others = block.size > region.size ? new Set([...block].filter(k => !region.has(k))) : null;   // hình/mẹ vùng khác -> viền tránh
      const path = traceBorder(region, w, h, others);
      if (!path || path.length < 4) break;
      if (path.some(c => occ.has(c.x + "," + c.y))) break;   // an toàn (không xảy ra khi lòi ra = 0)
      let cells = null, dir = null;
      // MỎ THOÁT: thêm ô NGAY TRÊN ô đầu (path[0] ở ngay trên đỉnh hình) -> đầu chĩa LÊN ra ngoài, thoát chắc.
      const sx = path[0].x, sy = path[0].y - 1, sk = sx + "," + sy;
      const inPath = (x, y) => path.some(c => c.x === x && c.y === y);
      if (sy >= 0 && !block.has(sk) && !occ.has(sk) && !inPath(sx, sy)) {
        let clear = true;
        for (let yy = sy - 1; yy >= 0; yy--) { if (block.has(sx + "," + yy) || inPath(sx, yy)) { clear = false; break; } }
        if (clear) { cells = [{ x: sx, y: sy }, ...path]; dir = "up"; }   // cổ = path[0] ngay dưới -> đầu thẳng lên
      }
      if (!cells) { const m = motherFromLoop(path, block, w, h); if (!m) break; cells = m.cells; dir = m.dir; }   // dự phòng: cắt vòng (ray theo block toàn cục)
      if (cells.some(c => occ.has(c.x + "," + c.y))) break;
      cells.forEach(c => { region.add(c.x + "," + c.y); block.add(c.x + "," + c.y); });   // vòng kế ôm ngoài + chặn cho vùng khác
      mothers.push({ id: nid++, dir, cells, mother: true });
    }
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
// Đường đi BO TRÒN qua các điểm: mỗi góc gập -> cung tròn (mềm mại, dễ chịu hơn nét gãy vuông).
function roundedPath(pts, r) {
  const f = n => n.toFixed(1);
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M${f(pts[0].x)},${f(pts[0].y)} L${f(pts[1].x)},${f(pts[1].y)}`;
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const v1x = p1.x - p0.x, v1y = p1.y - p0.y, l1 = Math.hypot(v1x, v1y) || 1;
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y, l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = p1.x - v1x / l1 * rr, ay = p1.y - v1y / l1 * rr;   // điểm vào cung
    const bx = p1.x + v2x / l2 * rr, by = p1.y + v2y / l2 * rr;   // điểm ra cung
    d += ` L${f(ax)},${f(ay)} Q${f(p1.x)},${f(p1.y)} ${f(bx)},${f(by)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${f(last.x)},${f(last.y)}`;
  return d;
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
  return { d: roundedPath(pts, (CELL + GAP) * 0.4), tri: arrowTri(head, d) };
}

function drawPiece(svg, piece, opts) {
  // màu rainbow theo colorIdx (vị trí ổn định trong mảng) để ĐỒNG NHẤT với thumbnail thư viện;
  // fallback id nếu chưa có colorIdx (rắn nháp/editor).
  const cidx = (piece.colorIdx != null) ? piece.colorIdx : piece.id;
  const color = (opts && opts.color) || (piece.mother ? "#e8c25a"
    : ((colorMode === "game" && piece.fixedColor >= 1 && gameColor(piece.fixedColor)) || pieceColor(cidx)));
  const sw = Math.max(2, CELL * (piece.mother ? 0.15 : 0.10));   // rắn mẹ dày hơn (viền)
  const geom = pieceGeom(piece.cells, piece.dir);
  const g = svgEl("g");
  const line = svgEl("path");
  line.setAttribute("d", geom.d);
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
function liveFrom(pieces) { return pieces.map((p, i) => ({ id: state.nextId++, colorIdx: i, dir: p.dir, cells: p.cells.map(c => ({...c})), mother: !!p.mother, ...(typeof p.fixedColor === "number" ? { fixedColor: p.fixedColor } : {}) })); }

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

  // Quỹ đạo MƯỢT: bo tròn các góc rồi rải mẫu dày -> thân rắn là 1 dải liền, không gãy thành mảnh.
  const R = spacing * 0.4;
  const smooth = [track[0]];
  for (let i = 1; i < track.length - 1; i++) {
    const p0 = track[i - 1], p1 = track[i], p2 = track[i + 1];
    const v1x = p1.x - p0.x, v1y = p1.y - p0.y, l1 = Math.hypot(v1x, v1y) || 1;
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y, l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(R, l1 / 2, l2 / 2);
    const ax = p1.x - v1x / l1 * rr, ay = p1.y - v1y / l1 * rr;
    const bx = p1.x + v2x / l2 * rr, by = p1.y + v2y / l2 * rr;
    smooth.push({ x: ax, y: ay });
    if (Math.abs(v1x * v2y - v1y * v2x) > 0.5) {   // có gập -> rải cung cho mượt
      for (let s = 1; s < 8; s++) { const tt = s / 8, mt = 1 - tt;
        smooth.push({ x: mt*mt*ax + 2*mt*tt*p1.x + tt*tt*bx, y: mt*mt*ay + 2*mt*tt*p1.y + tt*tt*by }); }
    }
    smooth.push({ x: bx, y: by });
  }
  smooth.push(track[track.length - 1]);
  const cum = [0];
  for (let i = 1; i < smooth.length; i++) cum.push(cum[i - 1] + Math.hypot(smooth[i].x - smooth[i - 1].x, smooth[i].y - smooth[i - 1].y));
  const totalLen = cum[cum.length - 1];
  function smoothPoint(dist) {
    dist = dist < 0 ? 0 : dist > totalLen ? totalLen : dist;
    let lo = 1, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < dist) lo = mid + 1; else hi = mid; }
    const t = (dist - cum[lo - 1]) / ((cum[lo] - cum[lo - 1]) || 1);
    return { x: smooth[lo - 1].x + (smooth[lo].x - smooth[lo - 1].x) * t, y: smooth[lo - 1].y + (smooth[lo].y - smooth[lo - 1].y) * t };
  }

  const Lbody = totalLen - ext * spacing;   // chiều dài thân theo quỹ đạo mượt (đuôi -> đầu)
  const wpx = parseFloat(board.style.width), hpx = parseFloat(board.style.height);
  const speed = spacing / 78, accelT = 170, bodyStep = spacing / 6;   // rải dày 6 mẫu/ô
  let startT = null;
  function frame(ts) {
    if (startT === null) startT = ts;
    const e = ts - startT;
    // ease-in: tăng tốc 0 -> tối đa rồi trượt đều (liên tục cả vị trí lẫn vận tốc)
    const slid = e < accelT ? 0.5 * speed * (e * e / accelT) : speed * (e - accelT / 2);
    const headD = slid + Lbody, tailD = slid;
    const pts = [];
    for (let dist = headD; dist > tailD; dist -= bodyStep) pts.push(smoothPoint(dist));
    pts.push(smoothPoint(tailD));
    if (refs) {
      refs.line.setAttribute("d", "M" + pts.map(q => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" L"));
      refs.tri.setAttribute("points", arrowTri(pts[0], d));
    }
    const tail = pts[pts.length - 1];
    if (tail.x < -CELL || tail.x > wpx + CELL || tail.y < -CELL || tail.y > hpx + CELL) { if (refs && refs.g) refs.g.remove(); return; }
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
  if (!state.testSnapshot) return;
  state.pieces = liveFrom(state.testSnapshot);
  state.moves = 0; state.history = []; state.status = "playing";
  buildPieces(); updateStatus();
}
function hint() {
  if (state.mode !== "play" || state.status !== "playing") return;
  const m = state.pieces.find(p => !pathInfo(p, state.pieces, state.W, state.H).blocked);
  if (!m) { elMsg.className = "msg warn"; elMsg.textContent = "Không còn con nào đi được — Hoàn tác/Chơi lại"; return; }
  const refs = pieceEls.get(m.id);
  if (refs) { refs.g.classList.remove("hintp"); void refs.g.getBBox(); refs.g.classList.add("hintp"); }
}

// ---------- Editor ----------
function enterEditor() {
  state.mode = "edit"; state.draft = null; state.fromLibrary = null;
  if (!state._editorInit) {
    state.editW = 7; state.editH = 7; state.editPieces = [];
  }
  state._editorInit = true;
  $("gridW").value = state.editW; $("gridH").value = state.editH;
  $("parInput").value = Math.max(1, state.editPieces.length);
  refreshMask();
  refreshDifficulty(state.editPieces, state.editW, state.editH);
  syncModeUI(); render();
}

function syncModeUI() {
  // Chỉ còn 2 chế độ: 'batch' (sinh hàng loạt) và 'play' (chơi 1 level từ thư viện).
  const batch = state.mode === "batch", play = state.mode === "play";
  const ba = document.querySelector(".board-area"); if (ba) ba.style.display = batch ? "none" : "flex";
  const sd = document.querySelector(".side"); if (sd) sd.style.display = batch ? "none" : "flex";
  const bv = $("batchView"); if (bv) bv.style.display = batch ? "grid" : "none";
  const pc = $("playControls"); if (pc) pc.style.display = batch ? "none" : "flex";
  const ph = $("playHint"); if (ph) ph.style.display = batch ? "none" : "block";
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
    diff: 50, wrap: 20, longPref: 55,   // mặc định cố định (đã bỏ slider — tập trung vào "Điểm muốn")
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
  const mask = (state.maskCells && state.maskCells.size) ? state.maskCells : null;   // hình từ ảnh / lấy-từ-rắn
  const arr = autoGenerate(W, H, diff, wrap, longPref, mask, 0, null, target, null);
  const { motherCount, note } = applyGenerated(arr, W, H, motherN, mask);
  applyColorMap();   // gán màu game cho rắn mới theo bản đồ màu của level đã import (nếu có)
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
function syncColorBtn() { const b = $("colorModeBtn"); if (b) { b.textContent = colorMode === "game" ? "🎨 Màu: Game" : "🎨 Màu: Cầu vồng"; b.classList.toggle("active", colorMode === "game"); } }
function toggleColorMode() { colorMode = colorMode === "game" ? "rainbow" : "game"; syncColorBtn(); render(); }

// ---------- colorMap (Idea 3): nhớ màu theo ô của level import, gen lại tô màu tương tự ----------
function buildColorMap() {
  const W = state.editW, H = state.editH;
  const cm = Array.from({ length: H }, () => Array(W).fill(-1)); const freq = {};
  for (const p of state.editPieces) if (p.fixedColor >= 1) for (const c of p.cells)
    if (c.y >= 0 && c.y < H && c.x >= 0 && c.x < W) { cm[c.y][c.x] = p.fixedColor; freq[p.fixedColor] = (freq[p.fixedColor] || 0) + 1; }
  let dom = -1, domN = 0; for (const k in freq) if (freq[k] > domN) { domN = freq[k]; dom = +k; }
  state.colorMap = cm; state.colorMapDominant = dom; state.colorMapW = W; state.colorMapH = H;
}
// Gán fixedColor cho rắn MỚI theo bình chọn đa số màu các ô nó nằm (chỉ khi bản đồ khớp kích thước).
function applyColorMap() {
  if (!state.colorMap || state.colorMapW !== state.editW || state.colorMapH !== state.editH) return;
  const W = state.editW, H = state.editH;
  for (const p of state.editPieces) {
    const vote = {};
    for (const c of p.cells) if (c.y >= 0 && c.y < H && c.x >= 0 && c.x < W) { const col = state.colorMap[c.y][c.x]; if (col >= 1) vote[col] = (vote[col] || 0) + 1; }
    let best = -1, bestN = 0; for (const k in vote) if (vote[k] > bestN) { bestN = vote[k]; best = +k; }
    p.fixedColor = best >= 1 ? best : (state.colorMapDominant >= 1 ? state.colorMapDominant : -1);
  }
  if (state.editPieces.some(p => p.fixedColor >= 1)) { colorMode = "game"; syncColorBtn(); }
}
// ⬡ Lấy hình dạng từ rắn: mask = đúng ô có rắn (giữ lỗ), xóa rắn -> Sinh map fill lại trên hình đó.
function shapeFromSnakes() {
  finalizeDraft();
  if (!state.editPieces.length) { elMsg.className = "msg warn"; elMsg.textContent = "Chưa có rắn nào để lấy hình dạng."; return; }
  const set = new Set();
  for (const p of state.editPieces) for (const c of p.cells) if (inBoard(c.x, c.y, state.editW, state.editH)) set.add(c.x + "," + c.y);
  state.maskImg = null; state.maskCells = set;   // mask 'hình từ rắn' (không phải ảnh); colorMap giữ nguyên
  state.editPieces = []; state.draft = null;
  $("parInput").value = 1; refreshDifficulty([], state.editW, state.editH); render();
  elMsg.className = "msg win"; elMsg.textContent = `⬡ Lấy hình ${set.size} ô (giữ lỗ). Bấm 🎲 Sinh map để sinh rắn mới trên hình này.`;
}

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
function normPieces(pieces) { return pieces.map(p => ({ dir: p.dir, cells: p.cells.map(c => Array.isArray(c) ? { x:c[0], y:c[1] } : { x:c.x, y:c.y }), mother: !!p.mother, ...(typeof p.fixedColor === "number" ? { fixedColor: p.fixedColor } : {}) })); }

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
  const errs = validateLevel(lv, state.editW, state.editH);
  if (errs.length) { elMsg.className = "msg lose"; elMsg.textContent = "⚠ " + errs[0]; return; }
  const d = state.difficulty || computeDifficulty(state.editPieces, state.editW, state.editH);
  const game = toGameLevel(state.editPieces, state.editW, state.editH, d && d.tier !== "KẸT" ? d.score : 0);
  $("jsonBox").value = JSON.stringify(game, null, 2);   // FORMAT GAME (XSize/YSize/Arrows + Y-FLIP)
  const s = solve(state.editPieces, state.editW, state.editH);
  if (!s.solvable) { elMsg.className = "msg warn"; elMsg.textContent = `⚠ Đã export (format game) nhưng KẸT (còn ${s.stuck})`; }
  else { elMsg.className = "msg win"; elMsg.textContent = `✓ Export format game — giải được, par ${s.par}`; }
}
function importJSON() {
  let lv; try { lv = JSON.parse($("jsonBox").value); } catch { elMsg.className = "msg lose"; elMsg.textContent = "✗ JSON không hợp lệ"; return; }
  let w, h, pieces, fmt;
  if (isGameFormat(lv)) {                                  // format game thật
    const g = fromGameLevel(lv); w = g.w; h = g.h; pieces = g.pieces; fmt = "format game";
    if (!w || !h) { elMsg.className = "msg lose"; elMsg.textContent = "✗ Thiếu XSize/YSize"; return; }
  } else {                                                 // format cũ {grid|w,h, pieces}
    w = (lv.grid && lv.grid[0]) ? lv.grid[0].length : lv.w;
    h = lv.grid ? lv.grid.length : lv.h;
    if (!w || !h) { elMsg.className = "msg lose"; elMsg.textContent = "✗ Thiếu kích thước"; return; }
    if (!Array.isArray(lv.pieces)) { elMsg.className = "msg lose"; elMsg.textContent = "✗ Thiếu mảng pieces"; return; }
    pieces = normPieces(lv.pieces); fmt = "format cũ";
  }
  const errs = validateLevel({ pieces }, w, h);
  if (errs.length) { elMsg.className = "msg lose"; elMsg.textContent = "⚠ " + errs[0]; return; }
  state.editW = w; state.editH = h;
  state.editPieces = pieces.map(p => ({ id: state.nextId++, dir: p.dir, cells: p.cells.map(c => ({ ...c })),
    ...(typeof p.fixedColor === "number" ? { fixedColor: p.fixedColor } : {}), ...(p.mother ? { mother: true } : {}) }));
  state.draft = null;
  if (state.editPieces.some(p => p.fixedColor >= 1)) { colorMode = "game"; syncColorBtn(); buildColorMap(); }   // file có màu -> bật Màu Game + nhớ bản đồ màu
  $("gridW").value = w; $("gridH").value = h; $("parInput").value = state.editPieces.length;
  elMsg.className = "msg win"; elMsg.textContent = "✓ Đã import (" + fmt + ")"; render();
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
  syncModeUI(); render();
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
    (b ? ` <span style="color:var(--muted)">(bẫy ${Math.round(b.percScore)}·ẩn ${Math.round(b.hiddenScore)}·đi/lượt ${Math.round(b.moveScore)}·xa ${Math.round(b.xaScore)}·rắn ${Math.round(b.snakeScore)})</span>` : "");
}

// ---------- Wire up (chỉ còn điều khiển khi CHƠI 1 level từ thư viện) ----------
$("hintBtn").addEventListener("click", hint);
$("undoBtn").addEventListener("click", undo);
$("resetBtn").addEventListener("click", resetLevel);

document.addEventListener("keydown", e => {
  if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
  if (state.mode !== "play") return;
  if (e.key === "z" || e.key === "Z") { undo(); e.preventDefault(); }
  else if (e.key === "h" || e.key === "H") { hint(); e.preventDefault(); }
  else if (e.key === "r" || e.key === "R") { resetLevel(); e.preventDefault(); }
});
window.addEventListener("resize", () => render());

// ---------- Boot ---------- (mặc định vào chế độ Hàng loạt; arrow-batch.js sẽ syncModeUI + render)
state.mode = "batch";
