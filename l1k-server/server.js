/* =========================================================================
   l1k-server · BACKEND "chính chủ" (OAuth web + refresh token) cho tab 1000 Levels
   ---------------------------------------------------------------------------
   MỌI thứ ở server: OAuth client (credentials.json {web}), refresh token
   (token.json), Sheet ID + Folder ID (hardcode dưới). Giao diện KHÔNG cấu hình gì.
   Chạy BẰNG QUYỀN CHÍNH CHỦ (đăng nhập 1 lần) -> KHÔNG cần share cho bot.
   Dùng native fetch (KHÔNG dùng googleapis — lib đó lỗi HTTP ở vài môi trường).

   Đăng nhập 1 lần:  mở http://localhost:8787/auth  -> chọn tài khoản -> xong.
   Endpoints:
     GET  /auth                    -> chuyển tới Google consent
     GET  /oauth2callback?code=... -> đổi code lấy refresh_token, lưu token.json
     GET  /api/health              -> { ok, loggedIn, sheetId, folderId, authUrl? }
     GET  /api/whoami              -> email tài khoản đang đăng nhập
     GET  /api/sheet               -> { rows }
     POST /api/sheet/patch         -> { changes }
     GET  /api/dataset?which=opponent|ours
     POST /api/dataset?which=...   -> { levels }
   ========================================================================= */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const DIR = __dirname, ROOT = path.join(DIR, "..");
const PORT = process.env.PORT || 8787;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets openid email";

// ID cố định (đổi ở đây nếu cần):
const SHEET_ID = process.env.SHEET_ID || "1VC02rPqLq9DA7d-1gbNTgxHRANwRZyiqH7sEfnU26VI";
const FOLDER_ID = process.env.FOLDER_ID || "1L2J8iOqkHkJu-Vk-lP8gt4cSF1c3cIFy";

/* ---------- web OAuth client ---------- */
function loadWeb() {
  for (const p of [path.join(ROOT, "credentials.json"), path.join(DIR, "credentials.json")]) {
    if (fs.existsSync(p)) { const j = JSON.parse(fs.readFileSync(p, "utf8")); const w = j.web || j.installed || j; if (w && w.client_id && w.client_secret) return w; }
  }
  console.error("\n[!] Không thấy OAuth web client. Đặt credentials.json ({ \"web\": { client_id, client_secret } }) ở gốc repo.\n");
  process.exit(1);
}
const WEB = loadWeb();
const TOKEN_URI = WEB.token_uri || "https://oauth2.googleapis.com/token";
const AUTH_URI = WEB.auth_uri || "https://accounts.google.com/o/oauth2/auth";

const TOKEN_PATH = path.join(DIR, "token.json");
let TOK = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")) : {};
function saveTok() { fs.writeFileSync(TOKEN_PATH, JSON.stringify(TOK, null, 2)); }

function authUrl() {
  const p = new URLSearchParams({ client_id: WEB.client_id, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true" });
  return AUTH_URI + "?" + p.toString();
}
async function exchangeCode(code) {
  const r = await fetch(TOKEN_URI, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: WEB.client_id, client_secret: WEB.client_secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }) });
  const j = await r.json(); if (!j.access_token) throw new Error(JSON.stringify(j));
  if (j.refresh_token) TOK.refresh_token = j.refresh_token;
  TOK.access_token = j.access_token; TOK.exp = Date.now() + (j.expires_in || 3600) * 1000; saveTok(); return j;
}
async function accessToken() {
  if (TOK.access_token && Date.now() < TOK.exp - 60000) return TOK.access_token;
  if (!TOK.refresh_token) throw new Error("NEED_AUTH");
  const r = await fetch(TOKEN_URI, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: WEB.client_id, client_secret: WEB.client_secret, refresh_token: TOK.refresh_token, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("refresh failed: " + JSON.stringify(j));
  TOK.access_token = j.access_token; TOK.exp = Date.now() + (j.expires_in || 3600) * 1000; saveTok(); return TOK.access_token;
}
async function gapi(url, opts) {
  opts = opts || {}; const t = await accessToken();
  const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: "Bearer " + t }, opts.headers || {}) }));
  if (!r.ok) { const e = await r.text(); throw new Error("Google " + r.status + ": " + e.slice(0, 300)); }
  if (opts.raw) return r; const tx = await r.text(); return tx ? JSON.parse(tx) : {};
}

/* ---------- Sheet ---------- */
const GRID_ROWS = 2001;   // sàn tối thiểu; tự nới thêm theo số level (dòng = level + 1)
let tabReady = false, targetRows = 0;
async function ensureTargetTab(needRows) {
  const need = Math.max(GRID_ROWS, (needRows || 0) + 1);
  if (tabReady && targetRows >= need) return;
  const meta = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`);
  const tab = (meta.sheets || []).find(s => s.properties && s.properties.title === "target");
  const batch = url => gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(url) });
  if (!tab) {
    await batch({ requests: [{ addSheet: { properties: { title: "target", gridProperties: { rowCount: need, columnCount: 26 } } } }] });
    targetRows = need;
  } else {
    targetRows = (tab.properties.gridProperties && tab.properties.gridProperties.rowCount) || 0;
    if (targetRows < need) { await batch({ requests: [{ updateSheetProperties: { properties: { sheetId: tab.properties.sheetId, gridProperties: { rowCount: need } }, fields: "gridProperties.rowCount" } }] }); targetRows = need; }
  }
  if (!tabReady) await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/target!A1:D1?valueInputOption=RAW`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [["Level", "Target", "Note", "Locked"]] }) });
  tabReady = true;
}
async function readSheet() {
  const j = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/target!A2:D`);
  const rows = {}; (j.values || []).forEach(row => { const lv = parseInt(row[0]); if (!lv) return; const o = {}; if (row[1] !== "" && row[1] != null) o.target = Number(row[1]); if (row[2]) o.note = String(row[2]); if (String(row[3]).toLowerCase() === "true") o.locked = true; rows[lv] = o; });
  return rows;
}
async function patchSheet(changes) {
  const keys = Object.keys(changes || {}).map(k => parseInt(k)).filter(Boolean);
  const maxLv = keys.length ? Math.max.apply(null, keys) : 0;
  await ensureTargetTab(maxLv);
  const data = [];
  for (const k of Object.keys(changes || {})) { const lv = parseInt(k); if (!lv) continue; const rowNo = lv + 1, v = changes[k]; data.push(v == null ? { range: `target!A${rowNo}:D${rowNo}`, values: [["", "", "", ""]] } : { range: `target!A${rowNo}:D${rowNo}`, values: [[lv, v.target != null ? v.target : "", v.note || "", v.locked ? "TRUE" : ""]] }); }
  if (data.length) await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "RAW", data }) });
  return { patched: data.length };
}
// GHI TOÀN BỘ target 1 lần (contiguous A2:D{total+1}) — nhanh cho vài nghìn level.
async function writeSheetBulk(rows, total) {
  total = Math.max(1, total | 0);
  await ensureTargetTab(total);
  const values = [];
  for (let lv = 1; lv <= total; lv++) { const r = rows && rows[lv]; values.push((r && r.target != null) ? [lv, r.target, r.note || "", r.locked ? "TRUE" : ""] : [lv, "", "", ""]); }
  await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/target!A2:D${total + 1}?valueInputOption=RAW`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
  return { written: total };
}

/* ---------- Tab độ khó phụ ("opponent" / "game_ta"): cột Level | Difficulty ---------- */
function safeTab(t) { return /^[a-zA-Z0-9_]+$/.test(t || "") ? t : "opponent"; }
async function ensureDiffTab(tab, needRows) {
  tab = safeTab(tab);
  const meta = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`);
  const found = (meta.sheets || []).find(s => s.properties && s.properties.title === tab);
  const need = Math.max((needRows || 0) + 1, GRID_ROWS);
  const batch = body => gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!found) await batch({ requests: [{ addSheet: { properties: { title: tab, gridProperties: { rowCount: need, columnCount: 26 } } } }] });
  else if (((found.properties.gridProperties && found.properties.gridProperties.rowCount) || 0) < need) await batch({ requests: [{ updateSheetProperties: { properties: { sheetId: found.properties.sheetId, gridProperties: { rowCount: need } }, fields: "gridProperties.rowCount" } }] });
  await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${tab}!A1:B1?valueInputOption=RAW`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [["Level", "Difficulty"]] }) });
}
async function writeDiffTab(tab, scores) {
  tab = safeTab(tab);
  const n = scores.length; if (!n) return { written: 0, tab };
  await ensureDiffTab(tab, n);
  const values = scores.map((s, i) => [i + 1, (s == null ? "" : s)]);
  await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${tab}!A2:B${n + 1}?valueInputOption=RAW`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
  return { written: n, tab };
}
async function readOppDiff() {
  const j = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/opponent!A2:B`);
  return (j.values || []).map(r => ({ level: parseInt(r[0]) || null, difficulty: r[1] === "" ? null : Number(r[1]) })).filter(x => x.level);
}

/* ---------- Drive dataset (owner nên tạo/ghi file trong folder thoải mái) ---------- */
async function findFile(name) { const q = `name='${name}' and trashed=false and '${FOLDER_ID}' in parents`; const j = await gapi(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&supportsAllDrives=true&includeItemsFromAllDrives=true`); return j.files && j.files[0] ? j.files[0].id : null; }
async function getDataset(which) { const id = await findFile(which === "ours" ? "ours.json" : "opponent.json"); if (!id) return null; return gapi(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`); }
async function putDataset(which, obj) {
  const name = which === "ours" ? "ours.json" : "opponent.json", content = JSON.stringify(obj), id = await findFile(name);
  if (id) { await gapi(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: content }); return { id }; }
  const b = "l1k" + Date.now().toString(36), body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [FOLDER_ID] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`;
  const j = await gapi("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body });
  return { id: j.id };
}
async function whoami() { const j = await gapi("https://www.googleapis.com/oauth2/v2/userinfo"); return j.email || j.name || "?"; }

/* ---------- HTTP ---------- */
function send(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }); res.end(JSON.stringify(obj)); }
function html(res, s) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(s); }
function readBody(req) { return new Promise(r => { let d = ""; req.on("data", c => { d += c; if (d.length > 120e6) req.destroy(); }); req.on("end", () => { try { r(d ? JSON.parse(d) : {}); } catch (e) { r({}); } }); }); }

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const u = new URL(req.url, `http://localhost:${PORT}`), p = u.pathname;
  try {
    if (p === "/auth") { res.writeHead(302, { Location: authUrl() }); return res.end(); }
    if (p === "/oauth2callback") {
      const code = u.searchParams.get("code"); if (!code) return html(res, "<h3>Thiếu code.</h3>");
      await exchangeCode(code); const em = await whoami().catch(() => "");
      return html(res, `<body style="font-family:sans-serif;padding:40px"><h2>✅ Đăng nhập xong${em ? " — " + em : ""}</h2><p>Đóng tab này và quay lại app. Backend giờ chạy bằng quyền của bạn.</p></body>`);
    }
    if (p === "/api/health") return send(res, 200, { ok: true, loggedIn: !!TOK.refresh_token, sheetId: SHEET_ID, folderId: FOLDER_ID, authUrl: TOK.refresh_token ? undefined : `http://localhost:${PORT}/auth` });
    if (p === "/api/whoami") return send(res, 200, { email: await whoami() });
    if (p === "/api/sheet" && req.method === "GET") { await ensureTargetTab(); return send(res, 200, { rows: await readSheet() }); }
    if (p === "/api/sheet/patch" && req.method === "POST") { const b = await readBody(req); return send(res, 200, await patchSheet(b.changes || {})); }
    if (p === "/api/sheet/bulk" && req.method === "POST") { const b = await readBody(req); return send(res, 200, await writeSheetBulk(b.rows || {}, b.total || 0)); }
    if (p === "/api/oppdiff" && req.method === "POST") { const b = await readBody(req); return send(res, 200, await writeDiffTab("opponent", Array.isArray(b.scores) ? b.scores : [])); }
    if (p === "/api/oppdiff" && req.method === "GET") { return send(res, 200, { rows: await readOppDiff() }); }
    if (p === "/api/diff" && req.method === "POST") { const b = await readBody(req); return send(res, 200, await writeDiffTab(b.tab || "opponent", Array.isArray(b.scores) ? b.scores : [])); }
    if (p === "/api/dataset" && req.method === "GET") { const d = await getDataset(u.searchParams.get("which") || "opponent"); return d ? send(res, 200, d) : send(res, 404, { error: "chưa có" }); }
    if (p === "/api/dataset" && req.method === "POST") { const b = await readBody(req); return send(res, 200, await putDataset(u.searchParams.get("which") || "opponent", b)); }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg === "NEED_AUTH") return send(res, 401, { error: "NEED_AUTH", authUrl: `http://localhost:${PORT}/auth` });
    console.error("[err]", p, msg); return send(res, 500, { error: msg });
  }
});
server.listen(PORT, () => {
  console.log(`\n  l1k-server (OAuth chính chủ) chạy: http://localhost:${PORT}`);
  console.log(`  Đăng nhập 1 lần:  http://localhost:${PORT}/auth`);
  console.log(`  Đã đăng nhập: ${!!TOK.refresh_token}  ·  Sheet ${SHEET_ID.slice(0, 8)}…  ·  Folder ${FOLDER_ID.slice(0, 8)}…\n`);
});
