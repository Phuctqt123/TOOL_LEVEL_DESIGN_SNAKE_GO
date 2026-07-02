/* =========================================================================
   1000 LEVELS · STORE  (L1K.Store)
   ---------------------------------------------------------------------------
   Lớp DỮ LIỆU thuần (tách khỏi UI & sync). Giữ trạng thái trong bộ nhớ +
   lưu bền bằng IndexedDB (fallback in-memory nếu trình duyệt chặn IDB trên
   file://). Mỗi "slice" (opponent / ours / sheet / versions / config / curves)
   được lưu thành 1 record kv riêng để PATCH nhỏ, không ghi đè toàn bộ.

   Mô hình:
     opponent : { levels:[rawGameLevel...], name, importedAt, count }   // bộ ĐỐI THỦ cần clone
     ours     : { levels:[gameLevel...],   updatedAt, count }           // bộ GAME TA (build dần từ gen)
     sheet    : { rows:{ [levelNo]:{target,note,locked} }, updatedAt }  // độ khó TARGET từng level
     versions : [ { id, ts, label, count, levels:[...] } ]              // snapshot ours để rollback
     curves   : { opponent:[score|null...], ours:[score|null...], computedAt } // cache đường độ khó
     config   : { sync:{...}, total }                                   // cấu hình
   ========================================================================= */
(function () {
  "use strict";
  const L1K = (window.L1K = window.L1K || {});

  /* ---------- tiện ích dùng chung cả module ---------- */
  const util = (L1K.util = L1K.util || {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    now: () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()),
    uid: () => "v" + Math.floor((typeof performance !== "undefined" ? performance.now() : 0) * 1000).toString(36) + "_" + (L1K.util._c = (L1K.util._c || 0) + 1),
    fmtTime: (ts) => { try { return new Date(ts).toLocaleString("vi-VN"); } catch (e) { return String(ts); } },
    deepClone: (o) => { try { return structuredClone(o); } catch (e) { return JSON.parse(JSON.stringify(o)); } }
  });

  /* ================= IndexedDB wrapper (an toàn, có fallback) ================= */
  const DB_NAME = "l1k_db", DB_VER = 1, STORE = "kv";
  let _db = null, _idbOK = true;

  function openDB() {
    return new Promise((resolve) => {
      if (typeof indexedDB === "undefined") { _idbOK = false; resolve(null); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { _idbOK = false; resolve(null); return; }
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "k" }); };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => { _idbOK = false; console.warn("[L1K.Store] IndexedDB lỗi — chạy ở chế độ bộ nhớ tạm.", req.error); resolve(null); };
    });
  }
  function idbGet(k) {
    return new Promise((resolve) => {
      if (!_db) { resolve(undefined); return; }
      try {
        const tx = _db.transaction(STORE, "readonly"), st = tx.objectStore(STORE), r = st.get(k);
        r.onsuccess = () => resolve(r.result ? r.result.v : undefined);
        r.onerror = () => resolve(undefined);
      } catch (e) { resolve(undefined); }
    });
  }
  function idbSet(k, v) {
    return new Promise((resolve) => {
      if (!_db) { resolve(false); return; }
      try {
        const tx = _db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
        st.put({ k, v });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => { console.warn("[L1K.Store] ghi IDB lỗi", tx.error); resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  /* ================= Trạng thái bộ nhớ ================= */
  const M = {
    opponent: { levels: [], name: "", importedAt: 0, count: 0 },
    ours: { levels: [], updatedAt: 0, count: 0 },
    sheet: { rows: {}, updatedAt: 0 },
    versions: [],
    curves: { opponent: [], ours: [], computedAt: 0 },
    config: { sync: { provider: "local" }, total: 1000 }
  };
  const DIRTY = new Set();   // các slice đã đổi từ lần sync trước (cho patch sync)
  const MAX_VERSIONS = 25;

  const listeners = new Set();
  function emit(evt) { listeners.forEach(fn => { try { fn(evt); } catch (e) { console.error(e); } }); }

  /* ================= API ================= */
  let _readyP = null;
  const Store = {
    M,
    /** Mở DB + nạp toàn bộ slice vào bộ nhớ. Idempotent. */
    ready() {
      if (_readyP) return _readyP;
      _readyP = (async () => {
        await openDB();
        for (const key of ["opponent", "ours", "sheet", "versions", "curves", "config"]) {
          const v = await idbGet(key);
          if (v !== undefined) {
            if (key === "versions") M.versions = Array.isArray(v) ? v : [];
            else Object.assign(M[key], v);
          }
        }
        // chuẩn hoá count
        M.opponent.count = M.opponent.levels.length;
        M.ours.count = M.ours.levels.length;
        return Store;
      })();
      return _readyP;
    },
    idbAvailable() { return _idbOK; },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Ghi 1 slice xuống IDB (best-effort). */
    async persist(key) {
      if (!_idbOK) return false;
      const v = key === "versions" ? M.versions : M[key];
      return idbSet(key, v);
    },

    /* ---------- dirty tracking cho sync patch ---------- */
    markDirty(key) { DIRTY.add(key); },
    getDirty() { return Array.from(DIRTY); },
    clearDirty(keys) { if (!keys) DIRTY.clear(); else keys.forEach(k => DIRTY.delete(k)); },

    /* ---------- ĐỐI THỦ ---------- */
    async setOpponent(levels, name) {
      M.opponent.levels = levels || [];
      M.opponent.count = M.opponent.levels.length;
      M.opponent.name = name || M.opponent.name || "opponent";
      M.opponent.importedAt = Date.now();
      M.curves.opponent = [];   // invalidate cache đường độ khó đối thủ
      this.markDirty("opponent");
      await this.persist("opponent"); await this.persist("curves");
      emit({ type: "opponent" });
    },

    /* ---------- GAME TA ---------- */
    async setOurs(levels, opts) {
      M.ours.levels = levels || [];
      M.ours.count = M.ours.levels.length;
      M.ours.updatedAt = Date.now();
      M.curves.ours = [];
      this.markDirty("ours");
      await this.persist("ours"); await this.persist("curves");
      emit({ type: "ours" });
    },
    /** Ghi/đè 1 level trong bộ ours theo levelNo (1-based). Dùng cho regen 1 điểm. */
    async upsertOur(levelNo, gameLevel) {
      const idx = levelNo - 1;
      while (M.ours.levels.length < levelNo) M.ours.levels.push(null);
      M.ours.levels[idx] = gameLevel;
      M.ours.count = M.ours.levels.filter(Boolean).length;
      M.ours.updatedAt = Date.now();
      if (M.curves.ours) M.curves.ours[idx] = undefined; // chỉ invalidate điểm đó
      this.markDirty("ours");
      await this.persist("ours");
      emit({ type: "ours", levelNo });
    },

    /* ---------- VERSIONS / ROLLBACK ---------- */
    async pushVersion(label) {
      const snap = {
        id: util.uid(), ts: Date.now(), label: label || "snapshot",
        count: M.ours.levels.filter(Boolean).length,
        levels: util.deepClone(M.ours.levels)
      };
      M.versions.unshift(snap);
      if (M.versions.length > MAX_VERSIONS) M.versions.length = MAX_VERSIONS;
      this.markDirty("versions");
      await this.persist("versions");
      emit({ type: "versions" });
      return snap.id;
    },
    listVersions() { return M.versions.map(v => ({ id: v.id, ts: v.ts, label: v.label, count: v.count })); },
    async rollback(id) {
      const v = M.versions.find(x => x.id === id);
      if (!v) return false;
      M.ours.levels = util.deepClone(v.levels);
      M.ours.count = M.ours.levels.filter(Boolean).length;
      M.ours.updatedAt = Date.now();
      M.curves.ours = [];
      this.markDirty("ours");
      await this.persist("ours"); await this.persist("curves");
      emit({ type: "ours", rolledBack: id });
      return true;
    },
    async deleteVersion(id) {
      const i = M.versions.findIndex(x => x.id === id);
      if (i < 0) return false;
      M.versions.splice(i, 1);
      this.markDirty("versions");
      await this.persist("versions");
      emit({ type: "versions" });
      return true;
    },

    /* ---------- CURVES cache ---------- */
    async setCurve(which, arr) {
      M.curves[which] = arr;
      M.curves.computedAt = Date.now();
      await this.persist("curves");
      emit({ type: "curves", which });
    },

    /* ---------- CONFIG ---------- */
    async setConfig(patch) {
      Object.assign(M.config, patch);
      await this.persist("config");
      emit({ type: "config" });
    },

    /* ---------- sheet persist (Sheet module gọi vào) ---------- */
    async persistSheet() { this.markDirty("sheet"); return this.persist("sheet"); },

    /** Xoá sạch dữ liệu (giữ config). Dùng cho nút reset. */
    async wipe() {
      M.opponent = { levels: [], name: "", importedAt: 0, count: 0 };
      M.ours = { levels: [], updatedAt: 0, count: 0 };
      M.sheet = { rows: {}, updatedAt: 0 };
      M.versions = [];
      M.curves = { opponent: [], ours: [], computedAt: 0 };
      for (const k of ["opponent", "ours", "sheet", "versions", "curves"]) await this.persist(k);
      DIRTY.clear();
      emit({ type: "wipe" });
    }
  };

  L1K.Store = Store;
})();
