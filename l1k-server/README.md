# l1k-server — Backend "chính chủ" (OAuth) cho tab 1000 Levels

Backend giữ **mọi thứ**: OAuth client, refresh token, Sheet ID, Folder ID. Giao diện
**không cấu hình gì**. Chạy **bằng quyền chính chủ** (đăng nhập 1 lần) → **KHÔNG cần
share cho service account**. Dùng native `fetch` (không dùng thư viện googleapis).

## Chuẩn bị (1 lần)
1. **OAuth client (Web application)** — bạn đã tạo. File `credentials.json` ở **gốc repo**
   dạng `{ "web": { "client_id", "client_secret", ... } }` (đã .gitignore).
2. Thêm **Authorized redirect URIs** cho client đó:
   ```
   http://localhost:8787/oauth2callback
   ```
   (GCP → Credentials → sửa OAuth client → Authorized redirect URIs → ADD.)
3. Bật **Google Drive API** + **Google Sheets API** trong project.
4. OAuth consent screen: nếu đang **Testing** → thêm email của bạn vào **Test users**.

## Chạy
```bash
cd l1k-server
npm install          # (chỉ cần nếu muốn; server dùng native fetch, không bắt buộc googleapis)
node server.js       # cổng 8787 (PORT=9000 node server.js để đổi)
```
Đăng nhập 1 lần: mở **http://localhost:8787/auth** → chọn tài khoản → cấp quyền.
Sau đó refresh token lưu ở `token.json` (đã .gitignore), backend chạy dài hạn như bạn.

## Dùng trong app
Mở app qua http (vd `python -m http.server 8000` → `http://localhost:8000/arrow-out.html`)
→ tab **1000 Levels → mục 6** → Nơi lưu = **Backend (chính chủ · localhost)** →
**Kiểm tra backend** (thấy "đã đăng nhập") → sửa target tự ghi Sheet; nút Đẩy/Kéo dataset.

## Endpoints
| Method | Path | Việc |
|---|---|---|
| GET | `/auth` | chuyển tới Google consent |
| GET | `/oauth2callback` | đổi code → refresh token (lưu token.json) |
| GET | `/api/health` | `{ ok, loggedIn, sheetId, folderId, authUrl? }` |
| GET | `/api/whoami` | email đang đăng nhập |
| GET | `/api/sheet` | đọc rows target (tự tạo tab "target" nếu thiếu) |
| POST | `/api/sheet/patch` | `{ changes:{ level:{target,note,locked}\|null } }` |
| GET/POST | `/api/dataset?which=opponent\|ours` | đọc/ghi JSON dataset trong folder |

## Đổi Sheet/Folder
Sửa `SHEET_ID` / `FOLDER_ID` đầu `server.js`, hoặc chạy `SHEET_ID=... FOLDER_ID=... node server.js`.

## Ghi chú
- `test-access.js` là test READ-ONLY riêng cho **service account** (nhánh cũ) — không liên quan luồng OAuth này.
- Không commit: `credentials.json`, `token.json`, `config.json` (đã .gitignore).
