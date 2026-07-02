/* =========================================================================
   1000 LEVELS · GOOGLE CLIENT  (L1K.GoogleClient)
   ---------------------------------------------------------------------------
   Đăng nhập Google bằng SERVICE ACCOUNT NGAY TRONG TRÌNH DUYỆT (không cần server):
     - Nhận credentials JSON (service account) dán trên UI / lưu localStorage.
     - Tự build + KÝ JWT bằng Web Crypto (RSASSA-PKCS1-v1_5 / SHA-256).
     - Đổi JWT -> access token tại oauth2.googleapis.com/token (jwt-bearer grant).
     - Gọi thẳng REST Drive + Sheets bằng Bearer token.

   ⚠️ Bảo mật: cách này để PRIVATE KEY chạy trong trình duyệt (theo yêu cầu dùng
      nội bộ). Ai mở trang + DevTools đều đọc được key. Chỉ dùng trong mạng nội bộ.
   ⚠️ Kỹ thuật: PHẢI mở trang qua http(s) (vd http://localhost), KHÔNG phải file://,
      để Google chấp nhận CORS ở token endpoint (origin "null" hay bị từ chối).

   Tạo cùng cấu trúc như l1k-server: folder gốc + doi_thu/game_ta + Sheet target.
   ========================================================================= */
(function () {
  "use strict";
  const L1K = (window.L1K = window.L1K || {});

  /* ---------- base64url + PEM ---------- */
  function b64urlFromBuf(buf) {
    const u = new Uint8Array(buf); let bin = "";
    for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlFromStr(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function strToBytes(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function pemToDer(pem) {
    const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  const SCOPE = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets";

  // MẶC ĐỊNH DÀI HẠN: Sheet + folder do user tạo sẵn & share cho service account.
  // (đổi ở đây nếu sau này dùng Sheet/folder khác)
  const DEFAULTS = { sheetId: "1VC02rPqLq9DA7d-1gbNTgxHRANwRZyiqH7sEfnU26VI", folderId: "1L2J8iOqkHkJu-Vk-lP8gt4cSF1c3cIFy" };
  // OAuth Client ID (Web application) — client_id CÔNG KHAI, an toàn để nhúng. (KHÔNG nhúng client_secret.)
  const DEFAULT_OAUTH_CLIENT_ID = "754569139655-6fedeilclh0sljsddt2c36kqfr7n6ios.apps.googleusercontent.com";

  const GC = {
    DEFAULTS,
    authMode: "oauth",    // "oauth" = đăng nhập chính chủ (GIS, khuyến nghị) | "sa" = service account key
    cred: null,           // credentials JSON (mode sa)
    _key: null,           // CryptoKey đã import (mode sa)
    _tok: null, _exp: 0,  // access token SA + hết hạn (ms)
    oauth: { clientId: DEFAULT_OAUTH_CLIENT_ID, token: "", exp: 0 },   // mode oauth (client_id mặc định)
    cfg: { folderId: DEFAULTS.folderId, oppFolderId: DEFAULTS.folderId, oursFolderId: DEFAULTS.folderId, sheetId: DEFAULTS.sheetId, shareWithEmail: "" },

    hasCred() { return this.authMode === "oauth" ? !!this.oauth.clientId : !!(this.cred && this.cred.private_key && this.cred.client_email); },
    email() { return this.authMode === "oauth" ? "chính chủ (OAuth)" : (this.cred ? this.cred.client_email : ""); },

    /* ---------- OAuth (đăng nhập chính chủ, Google Identity Services) ---------- */
    // Chỉ cần OAuth Client ID (Web application). KHÔNG dùng client_secret trong browser.
    loadGis() {
      return new Promise((resolve, reject) => {
        if (window.google && google.accounts && google.accounts.oauth2) return resolve();
        let s = document.getElementById("l1k-gis");
        if (!s) { s = document.createElement("script"); s.id = "l1k-gis"; s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true; document.head.appendChild(s); }
        s.addEventListener("load", () => resolve());
        s.addEventListener("error", () => reject(new Error("Không tải được Google Identity Services (mạng?)")));
      });
    },
    async oauthToken(interactive) {
      if (this.oauth.token && Date.now() < this.oauth.exp - 60000) return this.oauth.token;
      if (!this.oauth.clientId) throw new Error("Chưa có OAuth Client ID (loại Web application)");
      await this.loadGis();
      return new Promise((resolve, reject) => {
        try {
          const tc = google.accounts.oauth2.initTokenClient({
            client_id: this.oauth.clientId, scope: SCOPE,
            callback: (resp) => {
              if (resp.error) { reject(new Error(resp.error + (resp.error_description ? ": " + resp.error_description : ""))); return; }
              this.oauth.token = resp.access_token; this.oauth.exp = Date.now() + (resp.expires_in || 3600) * 1000;
              resolve(this.oauth.token);
            }
          });
          tc.requestAccessToken({ prompt: interactive ? "consent" : "" });   // lần đầu cần user click (gesture)
        } catch (e) { reject(e); }
      });
    },

    /** Nạp credentials (object hoặc chuỗi JSON). Không gọi mạng. */
    async setCredentials(credOrStr) {
      const cred = typeof credOrStr === "string" ? JSON.parse(credOrStr) : credOrStr;
      if (!cred || !cred.private_key || !cred.client_email) throw new Error("Credentials thiếu private_key/client_email");
      if (cred.type && cred.type !== "service_account") throw new Error("Không phải service account JSON");
      this.cred = cred; this._key = null; this._tok = null; this._exp = 0;
      if (!window.crypto || !window.crypto.subtle) throw new Error("Trình duyệt không có Web Crypto (mở qua http(s), không phải file://)");
      this._key = await crypto.subtle.importKey("pkcs8", pemToDer(cred.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
      return true;
    },
    setConfig(patch) { Object.assign(this.cfg, patch || {}); },

    /** Lấy access token (cache tới khi sắp hết hạn). */
    async token() {
      if (this.authMode === "oauth") return this.oauthToken(false);
      if (this._tok && Date.now() < this._exp - 60000) return this._tok;
      if (!this.hasCred()) throw new Error("Chưa nạp credentials");
      if (!this._key) await this.setCredentials(this.cred);
      const iat = Math.floor(Date.now() / 1000), exp = iat + 3600;
      const header = b64urlFromStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claim = b64urlFromStr(JSON.stringify({ iss: this.cred.client_email, scope: SCOPE, aud: this.cred.token_uri || "https://oauth2.googleapis.com/token", exp, iat }));
      const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, this._key, strToBytes(header + "." + claim));
      const jwt = header + "." + claim + "." + b64urlFromBuf(sig);
      const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt });
      let r;
      try { r = await fetch(this.cred.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); }
      catch (e) { throw new Error("Không gọi được token endpoint (CORS?). Hãy mở trang qua http://localhost, đừng dùng file://. " + e.message); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw new Error("Lấy token thất bại: " + (j.error_description || j.error || r.status));
      this._tok = j.access_token; this._exp = Date.now() + (j.expires_in || 3600) * 1000;
      return this._tok;
    },

    async _api(url, opts) {
      opts = opts || {};
      const tok = await this.token();
      const headers = Object.assign({ Authorization: "Bearer " + tok }, opts.headers || {});
      const r = await fetch(url, Object.assign({}, opts, { headers }));
      if (!r.ok) { let t = ""; try { t = JSON.stringify((await r.json()).error); } catch (e) {} throw new Error(`Google API ${r.status}: ${t}`); }
      if (opts.raw) return r;
      const txt = await r.text(); return txt ? JSON.parse(txt) : {};
    },

    /* ---------- Drive ---------- */
    async driveList(q) {
      const u = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) + "&fields=" + encodeURIComponent("files(id,name)") + "&supportsAllDrives=true&includeItemsFromAllDrives=true";
      const j = await this._api(u); return j.files || [];
    },
    async ensureFolder(name, parentId) {
      let q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
      if (parentId) q += ` and '${parentId}' in parents`;
      const f = await this.driveList(q); if (f[0]) return f[0].id;
      const meta = { name, mimeType: "application/vnd.google-apps.folder" }; if (parentId) meta.parents = [parentId];
      const j = await this._api("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
      return j.id;
    },
    async findFile(name, parentId) { const f = await this.driveList(`name='${name}' and trashed=false and '${parentId}' in parents`); return f[0] ? f[0].id : null; },
    async upsertJson(name, parentId, obj) {
      const content = JSON.stringify(obj), existing = await this.findFile(name, parentId);
      if (existing) {
        await this._api(`https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: content });
        return existing;
      }
      const boundary = "l1k" + Math.floor(Date.now()).toString(36);
      const meta = JSON.stringify({ name, parents: [parentId] });
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
      const j = await this._api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: multipart });
      return j.id;
    },
    async downloadJson(fileId) { const r = await this._api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, { raw: true }); return r.json(); },
    async share(fileId, email) {
      const body = email ? { role: "writer", type: "user", emailAddress: email } : { role: "writer", type: "anyone" };
      try { await this._api(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
      catch (e) { console.warn("[share]", e.message); }
    },

    /* ---------- Sheets ---------- */
    async createSheet(title) {
      const j = await this._api("https://sheets.googleapis.com/v4/spreadsheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: "target" } }] }) });
      await this._api(`https://sheets.googleapis.com/v4/spreadsheets/${j.spreadsheetId}/values/target!A1:D1?valueInputOption=RAW`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [["Level", "Target", "Note", "Locked"]] }) });
      return j.spreadsheetId;
    },

    /* ---------- High-level (mirror l1k-server) ---------- */
    async provision(shareEmail) {
      shareEmail = shareEmail || this.cfg.shareWithEmail || "";
      if (!this.cfg.folderId) this.cfg.folderId = await this.ensureFolder("SnakeGo_1000Levels", null);
      this.cfg.oppFolderId = await this.ensureFolder("doi_thu", this.cfg.folderId);
      this.cfg.oursFolderId = await this.ensureFolder("game_ta", this.cfg.folderId);
      if (!this.cfg.sheetId) this.cfg.sheetId = await this.createSheet("SnakeGo_DoKho_Target");
      if (shareEmail) this.cfg.shareWithEmail = shareEmail;
      await this.share(this.cfg.folderId, shareEmail);
      await this.share(this.cfg.sheetId, shareEmail);
      return Object.assign({}, this.cfg);
    },

    /** DÙNG DÀI HẠN: gán Sheet/folder CÓ SẴN (do bạn tạo + share cho SA) — KHÔNG tạo mới.
        Kiểm tra quyền truy cập rồi đảm bảo Sheet có tab "target" + header. Không tốn quota SA. */
    async useExisting(sheetId, folderId) {
      this.cfg.sheetId = sheetId || this.cfg.sheetId || "";
      this.cfg.folderId = folderId || this.cfg.folderId || "";
      this.cfg.oppFolderId = this.cfg.folderId;   // gộp: lưu cả 2 dataset trong 1 folder
      this.cfg.oursFolderId = this.cfg.folderId;
      if (!this.cfg.sheetId) throw new Error("Cần Sheet ID");
      // xác nhận đọc được (share đúng chưa)
      await this._api(`https://sheets.googleapis.com/v4/spreadsheets/${this.cfg.sheetId}?fields=spreadsheetId,sheets.properties.title`);
      if (this.cfg.folderId) await this._api(`https://www.googleapis.com/drive/v3/files/${this.cfg.folderId}?fields=id,name&supportsAllDrives=true`);
      await this.ensureTargetTab();
      return Object.assign({}, this.cfg);
    },
    /** Đảm bảo Sheet có tab "target" + header (chỉ SỬA sheet có sẵn, không tạo file). */
    async ensureTargetTab() {
      const meta = await this._api(`https://sheets.googleapis.com/v4/spreadsheets/${this.cfg.sheetId}?fields=sheets.properties.title`);
      const has = (meta.sheets || []).some(s => s.properties && s.properties.title === "target");
      if (!has) await this._api(`https://sheets.googleapis.com/v4/spreadsheets/${this.cfg.sheetId}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "target" } } }] }) });
      await this._api(`https://sheets.googleapis.com/v4/spreadsheets/${this.cfg.sheetId}/values/target!A1:D1?valueInputOption=RAW`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [["Level", "Target", "Note", "Locked"]] }) });
    },
    async readSheet() {
      if (!this.cfg.sheetId) throw new Error("Chưa provision sheet");
      const j = await this._api(`https://sheets.googleapis.com/v4/spreadsheets/${this.cfg.sheetId}/values/target!A2:D`);
      const rows = {}; (j.values || []).forEach(row => {
        const lv = parseInt(row[0]); if (!lv) return; const o = {};
        if (row[1] !== "" && row[1] != null) o.target = Number(row[1]);
        if (row[2]) o.note = String(row[2]);
        if (String(row[3]).toLowerCase() === "true" || row[3] === "1") o.locked = true;
        rows[lv] = o;
      });
      return rows;
    },
    async patchSheet(changes) {
      if (!this.cfg.sheetId) throw new Error("Chưa provision sheet");
      const data = [];
      for (const k of Object.keys(changes || {})) {
        const lv = parseInt(k); if (!lv) continue; const rowNo = lv + 1, v = changes[k];
        if (v == null) data.push({ range: `target!A${rowNo}:D${rowNo}`, values: [["", "", "", ""]] });
        else data.push({ range: `target!A${rowNo}:D${rowNo}`, values: [[lv, v.target != null ? v.target : "", v.note || "", v.locked ? "TRUE" : ""]] });
      }
      if (data.length) await this._api(`https://sheets.googleapis.com/v4/spreadsheets/${this.cfg.sheetId}/values:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "RAW", data }) });
      return { patched: data.length };
    },
    async getDataset(which) {
      const folderId = which === "ours" ? this.cfg.oursFolderId : this.cfg.oppFolderId;
      if (!folderId) throw new Error("Chưa provision folder");
      const id = await this.findFile(which === "ours" ? "ours.json" : "opponent.json", folderId);
      return id ? this.downloadJson(id) : null;
    },
    async putDataset(which, obj) {
      const folderId = which === "ours" ? this.cfg.oursFolderId : this.cfg.oppFolderId;
      if (!folderId) throw new Error("Chưa provision folder (bấm 'Tạo Sheet/Folder' trước)");
      const id = await this.upsertJson(which === "ours" ? "ours.json" : "opponent.json", folderId, obj);
      return { id };
    }
  };

  L1K.GoogleClient = GC;
})();
