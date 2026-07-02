/* =========================================================================
   1000 LEVELS · SYNC  (L1K.Sync)
   ---------------------------------------------------------------------------
   Lớp ĐỒNG BỘ tách riêng. Trừu tượng hoá "nơi lưu đám mây" sau 1 INTERFACE
   chung để có thể CẮM Google Drive/Sheets sau mà KHÔNG đụng UI/data.

   Provider interface:
     name        : string  — tên hiển thị
     id          : string  — "local" | "google" | ...
     configured(): bool    — đã đủ cấu hình để dùng chưa
     status()    : { state:"ok"|"off"|"error", text }
     async pull(slice)            -> data | null     (kéo về)
     async push(slice, data)      -> { ok, text }    (đẩy toàn bộ slice)
     async patch(slice, changes)  -> { ok, text }    (đẩy PHẦN THAY ĐỔI — sheet)

   Mặc định = LocalProvider (mọi thứ đã nằm ở IndexedDB qua Store; cloud = no-op).
   GoogleProvider là STUB: báo "cần credentials"; khi user cung cấp OAuth Client
   ID / Apps Script URL thì hiện thực hoá đúng chỗ này, phần còn lại không đổi.
   ========================================================================= */
(function () {
  "use strict";
  const L1K = (window.L1K = window.L1K || {});

  /* ----------------- LOCAL: dữ liệu đã bền ở IndexedDB (Store) ----------------- */
  const LocalProvider = {
    name: "Bộ nhớ trình duyệt (Local)",
    id: "local",
    configured() { return true; },
    status() {
      const ok = L1K.Store && L1K.Store.idbAvailable && L1K.Store.idbAvailable();
      return ok
        ? { state: "ok", text: "Lưu bền tại trình duyệt (IndexedDB)" }
        : { state: "error", text: "Trình duyệt chặn IndexedDB — dữ liệu chỉ tạm thời, hãy Export thường xuyên" };
    },
    async pull() { return null; },                 // nguồn sự thật là Store; không có gì để kéo
    async push() { return { ok: true, text: "Đã lưu cục bộ" }; },
    async patch() { return { ok: true, text: "Đã lưu cục bộ" }; }
  };

  /* ----------------- GOOGLE: ký JWT ngay trong trình duyệt (L1K.GoogleClient) -----------------
     Theo yêu cầu dùng nội bộ: KHÔNG cần server. Credentials nhập trên UI, lưu vào
     Store.config (IndexedDB). Trình duyệt tự lấy token + gọi Drive/Sheets.
     ⚠️ key sống trong trình duyệt — chỉ dùng mạng nội bộ. Mở qua http://localhost.  */
  const GoogleProvider = {
    name: "Google Drive / Sheets (key trên UI)",
    id: "google",
    _ready: false, _err: null, _provisioned: false,
    gc() { return L1K.GoogleClient; },
    configured() { return !!(this.gc() && this.gc().hasCred()); },
    status() {
      const gc = this.gc();
      if (!gc) return { state: "error", text: "Thiếu google-client.js" };
      const oauth = gc.authMode === "oauth";
      if (!gc.hasCred()) return { state: "off", text: oauth ? "Chưa có OAuth Client ID. Dán Client ID (Web app) rồi bấm 'Đăng nhập Google'." : "Chưa nạp credentials. Import file JSON key." };
      if (this._err) return { state: "error", text: this._err };
      if (!this._ready) return { state: "off", text: oauth ? "Đã có Client ID. Bấm 'Đăng nhập Google'." : `Đã có key (${gc.email()}). Bấm 'Kết nối Google'.` };
      return this._provisioned
        ? { state: "ok", text: `OK · ${gc.email()} · đã gắn Sheet + folder` }
        : { state: "off", text: `Đăng nhập OK (${gc.email()}) nhưng chưa truy cập được Sheet/folder` };
    },
    /** Sau khi có token: gắn Sheet/folder (mặc định hoặc đã cấu hình) + lưu config. */
    async _bindAndFinish() {
      const gc = this.gc();
      const saved = (L1K.Store && L1K.Store.M.config.sync && L1K.Store.M.config.sync.google) || {};
      if (saved.cfg) { const c = {}; for (const k in saved.cfg) if (saved.cfg[k]) c[k] = saved.cfg[k]; gc.setConfig(c); }
      if (!gc.cfg.sheetId) gc.setConfig({ sheetId: gc.DEFAULTS.sheetId });
      if (!gc.cfg.folderId) gc.setConfig({ folderId: gc.DEFAULTS.folderId, oppFolderId: gc.DEFAULTS.folderId, oursFolderId: gc.DEFAULTS.folderId });
      this._ready = true;
      const who = gc.authMode === "oauth" ? "chính chủ" : "service account";
      try { await gc.useExisting(gc.cfg.sheetId, gc.cfg.folderId); this._provisioned = true; this._err = null; }
      catch (e) { this._provisioned = false; this._err = `Đăng nhập (${who}) OK nhưng chưa truy cập được Sheet/Folder: ` + (e.message || e) + (gc.authMode === "oauth" ? " (bật Drive/Sheets API + đúng scope?)" : " (đã Share cho SA + bật API chưa?)"); }
      await this._persist();
      return { ok: true, email: gc.email(), provisioned: this._provisioned, warn: this._err };
    },
    /** Mode SERVICE ACCOUNT: nạp key + lấy token + gắn Sheet/folder. */
    async connect(credStr) {
      this._err = null; this._ready = false;
      try {
        const gc = this.gc(); if (!gc) throw new Error("Thiếu google-client.js");
        gc.authMode = "sa";
        if (credStr) await gc.setCredentials(credStr);
        else if (!gc.hasCred()) throw new Error("Chưa có credentials");
        else if (!gc._key) await gc.setCredentials(gc.cred);
        await gc.token();
        return await this._bindAndFinish();
      } catch (e) { this._err = String(e.message || e); return { ok: false, text: this._err }; }
    },
    /** Mode OAUTH (chính chủ): login GIS (chỉ cần Client ID) rồi gắn Sheet/folder. */
    async connectOAuth(clientId, interactive) {
      this._err = null; this._ready = false;
      try {
        const gc = this.gc(); if (!gc) throw new Error("Thiếu google-client.js");
        gc.authMode = "oauth";
        if (clientId) gc.oauth.clientId = clientId;
        if (!gc.oauth.clientId) throw new Error("Chưa có OAuth Client ID");
        await gc.oauthToken(interactive !== false);   // mặc định interactive (cần user click)
        return await this._bindAndFinish();
      } catch (e) { this._err = String(e.message || e); this._ready = false; return { ok: false, text: this._err }; }
    },
    /** Tự kết nối lại khi mở tab — CHỈ với service account (im lặng, an toàn).
        OAuth client-side KHÔNG tự chạy (tránh lỗi 'no registered origin'/popup khi mở tab);
        chỉ chạy khi user bấm 'Đăng nhập Google'. */
    async autoReconnect() {
      const gc = this.gc(); if (!gc || !gc.hasCred()) return;
      if (gc.authMode === "oauth") return;
      try { return await this.connect(); } catch (e) {}
    },
    async provision(shareEmail) {
      const gc = this.gc(); const c = await gc.provision(shareEmail || "");
      this._provisioned = !!(c.folderId && c.sheetId); await this._persist();
      return { ok: true, config: c, sheetUrl: `https://docs.google.com/spreadsheets/d/${c.sheetId}`, folderUrl: `https://drive.google.com/drive/folders/${c.folderId}` };
    },
    /** DÙNG DÀI HẠN: gán Sheet/folder có sẵn (bạn tạo + share cho SA), không tạo mới. */
    async useExisting(sheetId, folderId) {
      const gc = this.gc(); const c = await gc.useExisting(sheetId, folderId);
      this._provisioned = !!c.sheetId; await this._persist();
      return { ok: true, config: c, sheetUrl: `https://docs.google.com/spreadsheets/d/${c.sheetId}`, folderUrl: c.folderId ? `https://drive.google.com/drive/folders/${c.folderId}` : "" };
    },
    async _persist() {
      if (!L1K.Store) return;
      const gc = this.gc();
      const sync = Object.assign({}, L1K.Store.M.config.sync || {});
      // lưu cả key + mode + oauth clientId (theo yêu cầu dùng nội bộ)
      sync.google = { authMode: gc.authMode, cred: gc.cred, oauthClientId: gc.oauth.clientId, cfg: gc.cfg };
      await L1K.Store.setConfig({ sync });
    },
    /** Khi hydrate: nạp lại mode + key/clientId + cfg đã lưu (chưa lấy token). */
    async hydrateFrom(saved) {
      const gc = this.gc(); if (!gc || !saved) return;
      if (saved.authMode) gc.authMode = saved.authMode;
      if (saved.oauthClientId) gc.oauth.clientId = saved.oauthClientId;
      if (saved.cfg) { const c = {}; for (const k in saved.cfg) if (saved.cfg[k]) c[k] = saved.cfg[k]; gc.setConfig(c); }  // giữ mặc định
      if (saved.cred) { try { if (gc.authMode !== "oauth") await gc.setCredentials(saved.cred); else gc.cred = saved.cred; this._provisioned = !!(gc.cfg.folderId && gc.cfg.sheetId); } catch (e) { this._err = String(e.message || e); } }
    },
    async pull(slice) {
      const gc = this.gc(); if (!gc || !gc.hasCred()) return null;
      if (slice === "sheet") return { rows: await gc.readSheet() };
      if (slice === "opponent" || slice === "ours") { try { return await gc.getDataset(slice); } catch (e) { return null; } }
      return null;
    },
    async push(slice, data) {
      const gc = this.gc(); if (!gc || !gc.hasCred()) return { ok: false, text: "Chưa kết nối Google" };
      if (slice === "opponent" || slice === "ours") {
        await gc.putDataset(slice, { levels: (data && data.levels) ? data.levels.filter(Boolean) : [] });
        return { ok: true, text: `Đã đẩy ${slice} lên Drive` };
      }
      if (slice === "sheet") return this.patch("sheet", (data && data.rows) || {});
      return { ok: true, text: "bỏ qua" };
    },
    async patch(slice, changes) {
      const gc = this.gc(); if (slice !== "sheet" || !gc || !gc.hasCred()) return { ok: true, text: "bỏ qua" };
      await gc.patchSheet(changes || {});
      return { ok: true, text: "Đã cập nhật sheet (patch)" };
    }
  };

  /* ----------------- BACKEND: mọi thứ ở server, giao diện KHÔNG cấu hình -----------------
     l1k-server chạy OAuth "chính chủ" (refresh token server-side). Trang chỉ gọi REST;
     không giữ credentials/sheet-id/folder-id gì ở client.  */
  const BackendProvider = {
    name: "Backend (chính chủ · localhost)",
    id: "backend",
    baseUrl: "http://localhost:8787",
    _health: null,
    configured() { return true; },
    status() {
      const h = this._health;
      if (!h) return { state: "off", text: "Chưa kiểm tra. Chạy `node server.js` rồi bấm 'Kiểm tra backend'." };
      if (!h.ok) return { state: "error", text: h.error || "Không thấy backend — đã chạy `node server.js`?" };
      return h.loggedIn
        ? { state: "ok", text: "Backend OK · đã đăng nhập chính chủ · Sheet/folder ở server" }
        : { state: "off", text: "Backend OK · CHƯA đăng nhập — bấm 'Đăng nhập Google'" };
    },
    authUrl() { return (this._health && this._health.authUrl) || this.baseUrl + "/auth"; },
    async _fetch(pathname, opts) {
      const r = await fetch(this.baseUrl.replace(/\/$/, "") + pathname, Object.assign({ headers: { "Content-Type": "application/json" } }, opts));
      if (!r.ok) { let e = ""; try { const j = await r.json(); e = j.error; } catch (x) {} throw new Error(e || ("HTTP " + r.status)); }
      return r.json();
    },
    async ping() { try { this._health = await this._fetch("/api/health"); } catch (e) { this._health = { ok: false, error: String(e.message || e) }; } return this._health; },
    async pull(slice) {
      if (slice === "sheet") { const r = await this._fetch("/api/sheet"); return { rows: r.rows || {} }; }
      if (slice === "opponent" || slice === "ours") { try { return await this._fetch("/api/dataset?which=" + slice); } catch (e) { return null; } }
      return null;
    },
    async push(slice, data) {
      if (slice === "opponent" || slice === "ours") { await this._fetch("/api/dataset?which=" + slice, { method: "POST", body: JSON.stringify({ levels: (data && data.levels) ? data.levels.filter(Boolean) : [] }) }); return { ok: true, text: "Đã đẩy " + slice + " lên (backend)" }; }
      if (slice === "sheet") return this.patch("sheet", (data && data.rows) || {});
      return { ok: true, text: "bỏ qua" };
    },
    async patch(slice, changes) {
      if (slice !== "sheet") return { ok: true, text: "bỏ qua" };
      await this._fetch("/api/sheet/patch", { method: "POST", body: JSON.stringify({ changes: changes || {} }) });
      return { ok: true, text: "Đã cập nhật sheet (backend)" };
    },
    /** Ghi TOÀN BỘ target 1 lần (contiguous, nhanh). rows = map level->{target,note,locked}. */
    async pushSheetBulk(rows, total) {
      await this._fetch("/api/sheet/bulk", { method: "POST", body: JSON.stringify({ rows: rows || {}, total: total || 0 }) });
      return { ok: true, text: "Đã cập nhật toàn bộ Sheet" };
    },
    /** Đẩy độ khó ĐỐI THỦ lên tab "opponent" của Sheet. scores = mảng theo level (index+1). */
    async pushOppDiff(scores) {
      await this._fetch("/api/oppdiff", { method: "POST", body: JSON.stringify({ scores: scores || [] }) });
      return { ok: true, text: "Đã ghi độ khó đối thủ vào Sheet" };
    },
    /** Đẩy độ khó lên 1 tab bất kỳ (vd "game_ta"). scores = mảng theo level. */
    async pushDiff(tab, scores) {
      await this._fetch("/api/diff", { method: "POST", body: JSON.stringify({ tab: tab || "opponent", scores: scores || [] }) });
      return { ok: true, text: "Đã ghi độ khó (" + tab + ") vào Sheet" };
    }
  };

  const providers = { local: LocalProvider, google: GoogleProvider, backend: BackendProvider };

  const Sync = {
    providers,
    currentId: "local",
    current() { return providers[this.currentId] || LocalProvider; },

    /** Đổi provider đang dùng + lưu vào config. */
    async use(id) {
      if (!providers[id]) return false;
      this.currentId = id;
      if (L1K.Store) await L1K.Store.setConfig({ sync: Object.assign({}, L1K.Store.M.config.sync, { provider: id }) });
      return true;
    },

    /** Nạp lựa chọn provider + key Google đã lưu trong config (IndexedDB). */
    async hydrate() {
      const cfg = (L1K.Store && L1K.Store.M.config.sync) || {};
      if (cfg.provider && providers[cfg.provider]) this.currentId = cfg.provider;
      if (cfg.google) await GoogleProvider.hydrateFrom(cfg.google);
    },

    status() { return this.current().status(); },

    /** Đẩy 1 slice (toàn bộ). Local = no-op thành công. */
    async push(slice, data) {
      try { return await this.current().push(slice, data); }
      catch (e) { return { ok: false, text: String(e && e.message || e) }; }
    },
    /** Patch nhỏ (vd sheet đổi 1 ô). */
    async patch(slice, changes) {
      try { return await this.current().patch(slice, changes); }
      catch (e) { return { ok: false, text: String(e && e.message || e) }; }
    },
    async pull(slice) {
      try { return await this.current().pull(slice); }
      catch (e) { return null; }
    }
  };

  L1K.Sync = Sync;
})();
