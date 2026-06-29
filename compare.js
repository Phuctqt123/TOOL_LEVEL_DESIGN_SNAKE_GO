/* =========================================================================
   SO SÁNH 2 BỘ LEVEL — tìm điểm khác biệt giữa level tương ứng (kiểm tra update)
   - Module độc lập (IIFE) + tab riêng (#tabCompare / #compareView), theo pattern SG2.
   - Tái dùng global: gameColor / GAME_COLORS (arrow-out.js).
   - Làm việc TRỰC TIẾP trên format game "ArrowsOut" ({XSize,YSize,AllIndices,Arrows}).
   ========================================================================= */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);

  /* ---------- Màu theo ColorType (port từ snakego2.js) ---------- */
  const AO_COLOR = { Blue: 1, DarkBlue: 2, Aqua: 28, SeaGreen: 25, Green: 10, ParrotGreen: 31, Yellow: 7, Orange: 19, Peach: 24, Red: 5, Pink: 16, Purple: 13, LightBrown: 34, DarkBrown: 40, Gray: 46, BlueishGray: 37, OffWhite: 48 };
  function aoColorIndex(name) { if (!name) return 0; if (AO_COLOR[name]) return AO_COLOR[name]; let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return (h % 48) + 1; }
  function colorHex(colorType) { const ci = aoColorIndex(colorType); const c = (typeof gameColor === "function") ? gameColor(ci) : null; return c || "#8aa0c0"; }

  /* ---------- Giải nén ZIP (STORE + DEFLATE) — port từ snakego2.js ---------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("Trình duyệt không hỗ trợ giải nén DEFLATE.");
    const ds = new DecompressionStream("deflate-raw");
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf); let eo = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
    if (eo < 0) throw new Error("Không phải ZIP hợp lệ (thiếu EOCD).");
    const cdCount = dv.getUint16(eo + 10, true); let p = dv.getUint32(eo + 16, true); const td = new TextDecoder(), out = [];
    for (let n = 0; n < cdCount; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true), dataStart = lho + 30 + lNameLen + lExtraLen, comp = u8.subarray(dataStart, dataStart + compSize);
      if (method === 0) out.push({ name, bytes: comp });
      else if (method === 8) { try { out.push({ name, bytes: await inflateRaw(comp) }); } catch (e) { console.error("[cmp unzip]", name, e); } }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  /* ---------- Bóc level thô từ 1 file đã parse ---------- */
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
    const cand = levelCandidates(JSON.parse(await file.text()));
    return cand || [];
  }

  /* ---------- Chuẩn hoá 1 level ---------- */
  function normLevel(raw, idx) {
    const W = raw.XSize | 0, H = raw.YSize | 0;
    const arrows = (raw.Arrows || []).map(a => {
      const indices = Array.isArray(a.Indices) ? a.Indices.slice() : [];
      return {
        dir: a.Direction || "", indices, head: indices.length ? indices[0] : -1,
        color: a.ColorType || "", type: a.ArrowType || "",
        mech: (a.Mechanic && a.Mechanic.MechanicType) || ""
      };
    });
    const all = Array.isArray(raw.AllIndices) ? raw.AllIndices.slice().sort((x, y) => x - y) : [];
    const key = raw.LevelId != null ? "id:" + raw.LevelId
      : raw._name ? "nm:" + raw._name
      : raw.LevelUId != null ? "uid:" + raw.LevelUId : "ix:" + idx;
    const name = raw._name || (raw.LevelId != null ? "level_" + raw.LevelId : "#" + (idx + 1));
    return { raw, idx, W, H, arrows, all, key, name };
  }
  // Chữ ký để phân loại nhanh "giống / khác" (không cần diff đầy đủ).
  function signature(lv) {
    const ar = lv.arrows.map(a => a.head + "|" + a.dir + "|" + a.color + "|" + a.type + "|" + a.mech + "|" + a.indices.join("."))
      .sort();
    return lv.W + "x" + lv.H + ";" + lv.all.join(",") + ";" + ar.join("/");
  }

  /* ---------- Diff đầy đủ 1 cặp ---------- */
  function groupByHead(arrows) { const m = new Map(); arrows.forEach(a => { if (!m.has(a.head)) m.set(a.head, []); m.get(a.head).push(a); }); return m; }
  function arrowFieldDiff(a, b) {
    const ch = [];
    if (a.dir !== b.dir) ch.push({ k: "hướng", from: a.dir, to: b.dir });
    if (a.color !== b.color) ch.push({ k: "màu", from: a.color, to: b.color });
    if (a.type !== b.type) ch.push({ k: "loại", from: a.type, to: b.type });
    if (a.mech !== b.mech) ch.push({ k: "cơ chế", from: a.mech, to: b.mech });
    if (a.indices.length !== b.indices.length || a.indices.some((v, i) => v !== b.indices[i]))
      ch.push({ k: "đường đi", from: a.indices.length + " ô", to: b.indices.length + " ô" });
    return ch;
  }
  function diffPair(a, b) {
    const sizeChanged = (a.W !== b.W || a.H !== b.H);
    const sa = new Set(a.all), sb = new Set(b.all);
    const cellsAdded = b.all.filter(i => !sa.has(i));     // có ở B, thiếu ở A
    const cellsRemoved = a.all.filter(i => !sb.has(i));   // có ở A, mất ở B
    const ga = groupByHead(a.arrows), gb = groupByHead(b.arrows);
    const heads = new Set([...ga.keys(), ...gb.keys()]);
    const arrowsAdded = [], arrowsRemoved = [], arrowsChanged = [];
    heads.forEach(h => {
      const la = ga.get(h) || [], lb = gb.get(h) || [], n = Math.max(la.length, lb.length);
      for (let i = 0; i < n; i++) {
        const x = la[i], y = lb[i];
        if (x && !y) arrowsRemoved.push(x);
        else if (!x && y) arrowsAdded.push(y);
        else { const fd = arrowFieldDiff(x, y); if (fd.length) arrowsChanged.push({ a: x, b: y, fields: fd }); }
      }
    });
    const identical = !sizeChanged && !cellsAdded.length && !cellsRemoved.length
      && !arrowsAdded.length && !arrowsRemoved.length && !arrowsChanged.length;
    return { identical, sizeChanged, cellsAdded, cellsRemoved, arrowsAdded, arrowsRemoved, arrowsChanged };
  }

  /* ---------- Vẽ 1 level từ format game ---------- */
  function idxXY(i, W) { return { x: i % W, y: Math.floor(i / W) }; }
  function dirDelta(cells) {
    if (cells.length < 2) return { x: 0, y: -1 };
    const dx = cells[0].x - cells[1].x, dy = cells[0].y - cells[1].y;
    const n = Math.abs(dx) + Math.abs(dy) || 1; return { x: dx / n, y: dy / n };
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // mark: Map(idx -> 'add'|'rem'); arrowMarkCells: Set(idx) các ô thuộc arrow đổi/thêm/bớt.
  function drawLevel(cv, lv, maxPx, mark, arrowMarkCells) {
    const W = Math.max(1, lv.W), H = Math.max(1, lv.H);
    const c = Math.max(4, Math.min(26, Math.floor(maxPx / Math.max(W, H))));
    cv.width = W * c; cv.height = H * c;
    const g = cv.getContext("2d");
    g.fillStyle = "#0e1424"; g.fillRect(0, 0, W * c, H * c);
    // ô vùng chơi (AllIndices)
    g.fillStyle = "rgba(120,150,210,.16)";
    lv.all.forEach(i => { const { x, y } = idxXY(i, W); if (x < W && y < H) { rrect(g, x * c + 1, y * c + 1, c - 2, c - 2, Math.max(1, c * .15)); g.fill(); } });
    // rắn (arrows)
    g.lineCap = "round"; g.lineJoin = "round";
    lv.arrows.forEach(a => {
      const cells = a.indices.map(i => idxXY(i, W)); if (!cells.length) return;
      const col = colorHex(a.color), pts = cells.map(cc => ({ x: cc.x * c + c / 2, y: cc.y * c + c / 2 }));
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(2, c * .44);
      if (pts.length > 1) { g.beginPath(); g.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y); for (let k = pts.length - 2; k >= 0; k--) g.lineTo(pts[k].x, pts[k].y); g.stroke(); }
      const d = dirDelta(cells), h = pts[0], t = c * .5, b = c * .34, px = -d.y, py = d.x;
      g.beginPath(); g.moveTo(h.x + d.x * t, h.y + d.y * t); g.lineTo(h.x + px * b, h.y + py * b); g.lineTo(h.x - px * b, h.y - py * b); g.closePath(); g.fill();
    });
    // đánh dấu arrow đổi (viền đứt vàng quanh ô)
    if (arrowMarkCells && arrowMarkCells.size) {
      g.save(); g.strokeStyle = "#ffcf5a"; g.lineWidth = Math.max(1.5, c * .12); g.setLineDash([Math.max(2, c * .3), Math.max(2, c * .2)]);
      arrowMarkCells.forEach(i => { const { x, y } = idxXY(i, W); if (x < W && y < H) g.strokeRect(x * c + 1.5, y * c + 1.5, c - 3, c - 3); });
      g.restore();
    }
    // đánh dấu ô thêm (xanh) / mất (đỏ)
    if (mark && mark.size) {
      g.save(); g.lineWidth = Math.max(1.5, c * .14);
      mark.forEach((kind, i) => {
        const { x, y } = idxXY(i, W); if (x >= W || y >= H) return;
        if (kind === "add") { g.fillStyle = "rgba(34,200,120,.30)"; g.strokeStyle = "#1ba85f"; }
        else { g.fillStyle = "rgba(220,70,60,.30)"; g.strokeStyle = "#d8443f"; }
        rrect(g, x * c + 1, y * c + 1, c - 2, c - 2, Math.max(1, c * .15)); g.fill(); g.stroke();
      });
      g.restore();
    }
  }

  /* ============================ STATE ============================ */
  const SIDE = { a: { name: "A", levels: [], files: 0 }, b: { name: "B", levels: [], files: 0 } };
  let RESULT = null;     // { matched:[{key,name,a,b,diff?}], onlyA:[], onlyB:[], same, changed }
  let filterMode = "changed";
  let selKey = null;

  /* ---------- Nạp file vào 1 phía ---------- */
  async function ingest(sideId, files) {
    const side = SIDE[sideId], info = $("cmp" + sideId.toUpperCase() + "Files");
    if (!files || !files.length) return;
    info.textContent = "⏳ Đang đọc…";
    let levels = [], nf = 0;
    for (const f of files) {
      try { const lv = await fileToLevels(f); levels.push(...lv); nf++; }
      catch (e) { console.error("[cmp]", f.name, e); }
    }
    side.levels = levels.map(normLevel); side.files = nf;
    info.innerHTML = `<span class="cmp-cnt">${side.levels.length}</span> level · ${nf} file`;
    RESULT = null; renderList(); renderDetail();
  }

  /* ---------- So sánh ---------- */
  function runCompare() {
    const mode = $("cmpMatch").value;   // "key" | "index"
    const A = SIDE.a.levels, B = SIDE.b.levels;
    if (!A.length || !B.length) { $("cmpSummary").textContent = "Cần nạp cả 2 bộ level trước."; return; }
    const keyOf = (lv, i) => mode === "index" ? "ix:" + i : lv.key;
    const mapB = new Map(); B.forEach((lv, i) => { const k = keyOf(lv, i); if (!mapB.has(k)) mapB.set(k, lv); });
    const usedB = new Set(), matched = [], onlyA = [];
    A.forEach((lv, i) => {
      const k = keyOf(lv, i), b = mapB.get(k);
      if (b && !usedB.has(k)) { usedB.add(k); matched.push({ key: k, name: lv.name, a: lv, b }); }
      else onlyA.push({ key: k, name: lv.name, a: lv });
    });
    const onlyB = [];
    B.forEach((lv, i) => { const k = keyOf(lv, i); if (!usedB.has(k)) onlyB.push({ key: "B:" + k, name: lv.name, b: lv }); });
    // tính diff (rẻ — làm luôn)
    let same = 0, changed = 0;
    matched.forEach(m => { m.diff = diffPair(m.a, m.b); if (m.diff.identical) same++; else changed++; });
    RESULT = { matched, onlyA, onlyB, same, changed };
    selKey = null;
    renderStats(); renderList(); renderDetail();
    $("cmpSummary").textContent = `Khớp ${matched.length} cặp · ${changed} khác · ${same} giống · +${onlyB.length} mới · −${onlyA.length} mất.`;
  }

  function renderStats() {
    const wrap = $("cmpStats"); if (!RESULT) { wrap.innerHTML = ""; return; }
    const defs = [
      ["changed", "Khác", RESULT.changed],
      ["added", "Chỉ B (mới)", RESULT.onlyB.length],
      ["removed", "Chỉ A (mất)", RESULT.onlyA.length],
      ["same", "Giống nhau", RESULT.same]
    ];
    wrap.innerHTML = "";
    defs.forEach(([k, t, n]) => {
      const el = document.createElement("button");
      el.className = "cmp-stat " + k + (filterMode === k ? " active" : "");
      el.innerHTML = `<span class="dot"></span>${t} <span class="n">${n}</span>`;
      el.addEventListener("click", () => { filterMode = k; renderStats(); renderList(); });
      wrap.appendChild(el);
    });
  }

  function rowsForFilter() {
    if (!RESULT) return [];
    if (filterMode === "added") return RESULT.onlyB.map(m => ({ ...m, status: "added" }));
    if (filterMode === "removed") return RESULT.onlyA.map(m => ({ ...m, status: "removed" }));
    if (filterMode === "same") return RESULT.matched.filter(m => m.diff.identical).map(m => ({ ...m, status: "same" }));
    return RESULT.matched.filter(m => !m.diff.identical).map(m => ({ ...m, status: "changed" }));
  }

  function diffSummaryText(d) {
    const p = [];
    if (d.sizeChanged) p.push("cỡ");
    const nc = d.cellsAdded.length + d.cellsRemoved.length; if (nc) p.push(nc + " ô");
    const na = d.arrowsAdded.length + d.arrowsRemoved.length + d.arrowsChanged.length; if (na) p.push(na + " mũi tên");
    return p.join(" · ");
  }

  function renderList() {
    const list = $("cmpList"); if (!list) return;
    list.innerHTML = "";
    const rows = rowsForFilter();
    rows.forEach(m => {
      const row = document.createElement("div");
      row.className = "cmp-row" + (m.key === selKey ? " sel" : "");
      let sub = "";
      if (m.status === "changed") sub = diffSummaryText(m.diff);
      else if (m.status === "same") sub = "không đổi";
      else if (m.status === "added") sub = (m.b.W + "×" + m.b.H) + " · " + m.b.arrows.length + " mũi tên";
      else sub = (m.a.W + "×" + m.a.H) + " · " + m.a.arrows.length + " mũi tên";
      const chip = { changed: "✏️ KHÁC", added: "➕ MỚI", removed: "➖ MẤT", same: "✓ GIỐNG" }[m.status];
      row.innerHTML = `<span class="cmp-rname">${m.name}</span><span class="cmp-rsub">${sub}</span>`
        + `<span class="cmp-chip ${m.status}">${chip}</span>`;
      row.addEventListener("click", () => { selKey = m.key; renderList(); renderDetail(m); });
      list.appendChild(row);
    });
    if (RESULT && !rows.length) {
      const e = document.createElement("div"); e.style.cssText = "color:var(--faint);font-size:13px;text-align:center;padding:30px 12px";
      e.textContent = "Không có level nào ở nhóm này."; list.appendChild(e);
    }
  }

  function cellsOfArrows(arrows) { const s = new Set(); arrows.forEach(a => a.indices.forEach(i => s.add(i))); return s; }

  function renderDetail(m) {
    const host = $("cmpDetail"); if (!host) return;
    if (!m) { host.innerHTML = `<div class="cmp-empty">Chọn 1 level ở danh sách bên trái để xem khác biệt.</div>`; return; }
    const d = m.diff;
    // chuẩn bị mark cells
    let markA = new Map(), markB = new Map(), arrA = new Set(), arrB = new Set();
    if (d) {
      d.cellsRemoved.forEach(i => markA.set(i, "rem"));
      d.cellsAdded.forEach(i => markB.set(i, "add"));
      arrA = cellsOfArrows([...d.arrowsRemoved, ...d.arrowsChanged.map(c => c.a)]);
      arrB = cellsOfArrows([...d.arrowsAdded, ...d.arrowsChanged.map(c => c.b)]);
    }
    host.innerHTML = `
      <div class="cmp-boards">
        <div class="cmp-board a"><div class="cmp-bhd"><span class="cmp-tag">A</span> ${m.a ? m.a.name + " · " + m.a.W + "×" + m.a.H : "—"}</div>
          <div class="cmp-canv-wrap"><canvas id="cmpCanvA"></canvas></div></div>
        <div class="cmp-board b"><div class="cmp-bhd"><span class="cmp-tag">B</span> ${m.b ? m.b.name + " · " + m.b.W + "×" + m.b.H : "—"}</div>
          <div class="cmp-canv-wrap"><canvas id="cmpCanvB"></canvas></div></div>
      </div>
      <div class="cmp-legend">
        <span><i class="add"></i> ô thêm (B)</span><span><i class="rem"></i> ô mất (A)</span><span><i class="chg"></i> mũi tên đổi</span>
      </div>
      <div class="card cmp-changes" id="cmpChanges"></div>`;
    const MAX = 360;
    if (m.a) drawLevel($("cmpCanvA"), m.a, MAX, markA, arrA);
    else { const cv = $("cmpCanvA"); cv.width = cv.height = 1; }
    if (m.b) drawLevel($("cmpCanvB"), m.b, MAX, markB, arrB);
    else { const cv = $("cmpCanvB"); cv.width = cv.height = 1; }
    renderChanges(m);
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function renderChanges(m) {
    const host = $("cmpChanges"); if (!host) return;
    if (m.status === "added") { host.innerHTML = `<h3>Khác biệt</h3><ul><li><span class="add-t">Level MỚI</span> — chỉ có ở bộ B (${m.b.arrows.length} mũi tên, ${m.b.all.length} ô).</li></ul>`; return; }
    if (m.status === "removed") { host.innerHTML = `<h3>Khác biệt</h3><ul><li><span class="rem-t">Level BỊ XOÁ</span> — chỉ có ở bộ A (${m.a.arrows.length} mũi tên, ${m.a.all.length} ô).</li></ul>`; return; }
    const d = m.diff, items = [];
    if (d.identical) { host.innerHTML = `<h3>Khác biệt</h3><ul><li class="ok">✓ Hai level giống hệt nhau — không có thay đổi.</li></ul>`; return; }
    if (d.sizeChanged) items.push(`<span class="chg-t">Đổi kích thước:</span> <code>${m.a.W}×${m.a.H}</code> → <code>${m.b.W}×${m.b.H}</code>`);
    if (d.cellsAdded.length) items.push(`<span class="add-t">+${d.cellsAdded.length} ô</span> vùng chơi (có ở B).`);
    if (d.cellsRemoved.length) items.push(`<span class="rem-t">−${d.cellsRemoved.length} ô</span> vùng chơi (mất ở B).`);
    if (d.arrowsAdded.length) items.push(`<span class="add-t">+${d.arrowsAdded.length} mũi tên</span> mới: ` + d.arrowsAdded.map(a => `<code>${esc(a.color || "?")} ${esc(a.dir)}</code>`).join(", "));
    if (d.arrowsRemoved.length) items.push(`<span class="rem-t">−${d.arrowsRemoved.length} mũi tên</span> bị bỏ: ` + d.arrowsRemoved.map(a => `<code>${esc(a.color || "?")} ${esc(a.dir)}</code>`).join(", "));
    d.arrowsChanged.forEach(c => {
      const at = idxXY(c.a.head, m.a.W);
      const fields = c.fields.map(f => `${f.k} <code>${esc(f.from || "∅")}</code>→<code>${esc(f.to || "∅")}</code>`).join(", ");
      items.push(`<span class="chg-t">Mũi tên</span> tại ô (${at.x},${at.y}): ${fields}`);
    });
    host.innerHTML = `<h3>Khác biệt (${items.length})</h3><ul>` + items.map(t => `<li>${t}</li>`).join("") + `</ul>`;
  }

  /* ============================ MOUNT / TAB ============================ */
  let mounted = false;
  function mount() {
    if (mounted) return; mounted = true;
    const host = $("compareView"); if (!host) return;
    host.innerHTML = `
      <div class="cmp-wrap">
        <div class="cmp-io">
          ${ioCard("a", "A", "Bộ gốc / cũ")}
          ${ioCard("b", "B", "Bộ cần kiểm tra / mới")}
        </div>
        <div class="card">
          <div class="cmp-bar">
            <label class="fld" style="flex:0 0 auto">Ghép cặp theo
              <select id="cmpMatch">
                <option value="key">LevelId / tên (tương ứng)</option>
                <option value="index">Thứ tự trong danh sách</option>
              </select>
            </label>
            <button id="cmpRun" class="primary">🔍 So sánh</button>
            <span class="hint" id="cmpSummary" style="align-self:center"></span>
          </div>
          <div class="cmp-stats" id="cmpStats" style="margin-top:12px"></div>
        </div>
        <div class="cmp-main">
          <div class="card" style="padding:10px">
            <div class="cmp-list" id="cmpList"></div>
          </div>
          <div class="cmp-detail" id="cmpDetail"></div>
        </div>
      </div>`;
    // sự kiện 2 phía
    ["a", "b"].forEach(s => {
      const U = s.toUpperCase();
      const inp = $("cmp" + U + "Input"), drop = $("cmp" + U + "Drop");
      $("cmp" + U + "Btn").addEventListener("click", () => inp.click());
      inp.addEventListener("change", () => { ingest(s, inp.files); inp.value = ""; });
      drop.addEventListener("click", () => inp.click());
      drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
      drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) ingest(s, e.dataTransfer.files); });
    });
    $("cmpRun").addEventListener("click", runCompare);
    renderDetail();
  }
  function ioCard(s, tag, desc) {
    const U = s.toUpperCase();
    return `<div class="card cmp-side ${s}">
      <h2><span class="cmp-tag">${tag}</span> ${desc}</h2>
      <div class="cmp-drop" id="cmp${U}Drop"><b>Kéo–thả</b> hoặc bấm để chọn file<br><small>JSON / pack {levels} / ZIP — nhiều file</small></div>
      <input type="file" id="cmp${U}Input" accept=".json,.zip,application/json,application/zip" multiple hidden />
      <div class="row" style="margin-top:8px"><button id="cmp${U}Btn">📁 Chọn file bộ ${tag}</button></div>
      <div class="cmp-files" id="cmp${U}Files"></div>
    </div>`;
  }

  function showOthers(show) {
    [".board-area", ".side"].forEach(sel => { const el = document.querySelector(sel); if (el && !show) el.style.display = "none"; });
    ["batchView", "playControls", "playHint", "libPlayBar", "sg2View"].forEach(id => { const el = $(id); if (el && !show) el.style.display = "none"; });
  }
  function enterCompare() {
    showOthers(false);
    $("compareView").style.display = "block";
    $("tabCompare").classList.add("tab-active");
    ["tabBatch", "tabPlay", "tabSG2"].forEach(id => { const t = $(id); if (t) t.classList.remove("tab-active"); });
    mount();
  }
  function exitCompare() { const v = $("compareView"); if (v) v.style.display = "none"; const t = $("tabCompare"); if (t) t.classList.remove("tab-active"); }
  function init() {
    const tc = $("tabCompare"); if (!tc) return;
    tc.addEventListener("click", enterCompare);
    ["tabBatch", "tabPlay", "tabSG2"].forEach(id => { const t = $(id); if (t) t.addEventListener("click", exitCompare); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
