/* =========================================================================
   1000 LEVELS · SHEET  (L1K.Sheet)
   ---------------------------------------------------------------------------
   Mô hình "sheet độ khó TARGET" từng level. Nguồn target cho workflow gen.
   - Lưu dạng map thưa rows[levelNo] = { target, note, locked } (chỉ lưu ô có dữ liệu).
   - PATCH nhỏ: sửa 1 ô -> cập nhật đúng ô đó + markDirty + persist + đẩy patch
     qua Sync (không re-sync toàn sheet).
   - Đồng bộ 2 chiều với đường cong: seed target từ 1 hàm curve; xuất mảng target.
   ========================================================================= */
(function () {
  "use strict";
  const L1K = (window.L1K = window.L1K || {});
  const clamp = L1K.util ? L1K.util.clamp : (v, a, b) => Math.max(a, Math.min(b, v));

  const Sheet = {
    rows() { return L1K.Store.M.sheet.rows; },

    get(levelNo) {
      const r = L1K.Store.M.sheet.rows[levelNo];
      return r ? r : null;
    },
    /** Lấy target (số) hoặc null nếu chưa đặt. */
    target(levelNo) {
      const r = L1K.Store.M.sheet.rows[levelNo];
      return r && typeof r.target === "number" ? r.target : null;
    },

    /** PATCH: đặt target 1 level. Trả {levelNo, target} đã ghi. */
    async setTarget(levelNo, value, opts) {
      opts = opts || {};
      levelNo = Math.round(levelNo);
      const v = clamp(Math.round(value), 0, 100);
      const rows = L1K.Store.M.sheet.rows;
      const cur = rows[levelNo] || {};
      if (cur.locked && !opts.force) return { levelNo, target: cur.target, locked: true, skipped: true };
      rows[levelNo] = Object.assign({}, cur, { target: v });
      L1K.Store.M.sheet.updatedAt = Date.now();
      await L1K.Store.persistSheet();
      if (!opts.silent && L1K.Sync) L1K.Sync.patch("sheet", { [levelNo]: rows[levelNo] });
      return { levelNo, target: v };
    },

    async setNote(levelNo, note) {
      const rows = L1K.Store.M.sheet.rows, cur = rows[levelNo] || {};
      rows[levelNo] = Object.assign({}, cur, { note: String(note || "") });
      L1K.Store.M.sheet.updatedAt = Date.now();
      await L1K.Store.persistSheet();
      if (L1K.Sync) L1K.Sync.patch("sheet", { [levelNo]: rows[levelNo] });
    },

    async setLocked(levelNo, locked) {
      const rows = L1K.Store.M.sheet.rows, cur = rows[levelNo] || {};
      rows[levelNo] = Object.assign({}, cur, { locked: !!locked });
      L1K.Store.M.sheet.updatedAt = Date.now();
      await L1K.Store.persistSheet();
      if (L1K.Sync) L1K.Sync.patch("sheet", { [levelNo]: rows[levelNo] });
    },

    async clear(levelNo) {
      const rows = L1K.Store.M.sheet.rows;
      if (rows[levelNo]) { delete rows[levelNo]; L1K.Store.M.sheet.updatedAt = Date.now(); await L1K.Store.persistSheet(); if (L1K.Sync) L1K.Sync.patch("sheet", { [levelNo]: null }); }
    },

    /** Seed nhiều target từ 1 hàm curve(levelNo)->score, cho dải [from,to].
        Bỏ qua ô locked. Ghi 1 lần (persist 1 lần) để nhanh. */
    async seedFromCurve(from, to, fn, opts) {
      opts = opts || {};
      const rows = L1K.Store.M.sheet.rows; let changed = 0; const patch = {};
      for (let n = from; n <= to; n++) {
        const cur = rows[n] || {};
        if (cur.locked && !opts.force) continue;
        const v = clamp(Math.round(fn(n)), 0, 100);
        if (cur.target === v) continue;
        rows[n] = Object.assign({}, cur, { target: v });
        patch[n] = rows[n]; changed++;
      }
      if (changed) { L1K.Store.M.sheet.updatedAt = Date.now(); await L1K.Store.persistSheet(); if (L1K.Sync) L1K.Sync.patch("sheet", patch); }
      return changed;
    },

    /** Mảng target 1..total (null nếu chưa đặt). */
    toArray(total) {
      const rows = L1K.Store.M.sheet.rows, out = new Array(total).fill(null);
      for (let n = 1; n <= total; n++) { const r = rows[n]; if (r && typeof r.target === "number") out[n - 1] = r.target; }
      return out;
    },

    /** Số ô đã đặt target. */
    count() { let c = 0; const rows = L1K.Store.M.sheet.rows; for (const k in rows) if (typeof rows[k].target === "number") c++; return c; },

    /** Import nguyên rows (vd từ JSON sheet). */
    async importRows(rows) {
      L1K.Store.M.sheet.rows = rows || {};
      L1K.Store.M.sheet.updatedAt = Date.now();
      await L1K.Store.persistSheet();
      if (L1K.Sync) L1K.Sync.push("sheet", L1K.Store.M.sheet);
    },
    exportRows() { return L1K.util.deepClone(L1K.Store.M.sheet.rows); }
  };

  L1K.Sheet = Sheet;
})();
