/* =========================================================================
   Test READ-ONLY: service account có đọc được folder + Sheet đã share chưa.
   Dùng ĐÚNG cơ chế của browser client (Web Crypto ký JWT + native fetch) —
   KHÔNG dùng thư viện googleapis (một số môi trường lỗi HTTP stack). Không ghi gì.
   Chạy:  cd l1k-server && node test-access.js
   (đổi ID:  FOLDER=... SHEET=... node test-access.js )
   ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const CRED = JSON.parse(fs.readFileSync(path.join(__dirname, "credentials.json"), "utf8"));
const FOLDER = process.env.FOLDER || "1L2J8iOqkHkJu-Vk-lP8gt4cSF1c3cIFy";
const SHEET = process.env.SHEET || "1VC02rPqLq9DA7d-1gbNTgxHRANwRZyiqH7sEfnU26VI";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly";

const b64urlBuf = b => { const u = new Uint8Array(b); let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64urlStr = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function pemToDer(pem) { const b = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, ""); const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

(async () => {
  console.log("Service account :", CRED.client_email);
  console.log("Project         :", CRED.project_id, "\n");

  // 1) JWT -> access token (native fetch)
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(CRED.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(Date.now() / 1000), exp = iat + 3600;
  const h = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const c = b64urlStr(JSON.stringify({ iss: CRED.client_email, scope: SCOPE, aud: CRED.token_uri, exp, iat }));
  const si = h + "." + c, bytes = new Uint8Array(si.length); for (let i = 0; i < si.length; i++) bytes[i] = si.charCodeAt(i);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, bytes);
  const jwt = si + "." + b64urlBuf(sig);
  const tr = await fetch(CRED.token_uri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  const tj = await tr.json();
  if (!tj.access_token) { console.log("TOKEN  ✗ đăng nhập thất bại:", JSON.stringify(tj)); console.log("\n==> Kiểm tra: key đúng chưa? đã bật Drive/Sheets API trong project chưa?"); return; }
  console.log("TOKEN  ✔ đăng nhập service account OK (API đã bật)\n");
  const tok = tj.access_token;

  // 2) đọc folder + sheet (read-only)
  const fr = await fetch(`https://www.googleapis.com/drive/v3/files/${FOLDER}?fields=id,name,mimeType&supportsAllDrives=true`, { headers: { Authorization: "Bearer " + tok } });
  const fj = await fr.json();
  const folderOK = fr.ok;
  console.log(folderOK ? "FOLDER ✔ đọc được: " + fj.name : "FOLDER ✗ " + fr.status + " — " + (fj.error ? fj.error.message : "") + "  (chưa share folder cho SA?)");

  const sr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=properties.title,sheets.properties.title`, { headers: { Authorization: "Bearer " + tok } });
  const sj = await sr.json();
  const sheetOK = sr.ok;
  console.log(sheetOK ? "SHEET  ✔ đọc được: " + sj.properties.title + " · tabs: " + (sj.sheets || []).map(x => x.properties.title).join(", ") : "SHEET  ✗ " + sr.status + " — " + (sj.error ? sj.error.message : "") + "  (chưa share sheet cho SA?)");

  console.log("");
  if (folderOK && sheetOK) console.log("==> OK HẾT: đã share đúng. App dùng được ngay.");
  else console.log("==> Còn thiếu: Share " + (!folderOK ? "FOLDER " : "") + (!sheetOK ? "SHEET " : "") + "cho " + CRED.client_email + " quyền Editor (copy-paste email cho chuẩn), rồi chạy lại.");
})().catch(e => console.log("ERROR:", e.message));
