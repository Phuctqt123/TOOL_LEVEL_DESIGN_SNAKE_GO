# Audit & kế hoạch hợp nhất — Tool mình (Arrow Out) vs Tool anh (difficulty-gen.html)

> Soạn sau khi giải nén `files.zip` (gồm `difficulty-gen.html` ~123KB + `KIEN_THUC_TOOL_DIFFICULTY_GEN.md`).
> Tool anh ấy chính là **bản gốc/chuẩn** cho game **Snake Escape**; tool mình là bản port (thêm batch, curve, thư viện…).
> Tài liệu này trả lời 5 việc bạn giao + danh sách câu hỏi cần chốt (mục cuối).

---

## 0. Bối cảnh nhanh
| | Tool ANH (`difficulty-gen.html`) | Tool MÌNH (`arrow-out`) |
|---|---|---|
| Dạng | 1 file HTML offline | 4 file (html/css/2 js) |
| Mục tiêu | Thiết kế + đo độ khó 1 level, **xuất đúng format game** | Sinh **hàng loạt** theo layout + curve, thư viện, export ZIP |
| Công thức độ khó | `0.10·turns + 0.20·snakes + 0.10·rate + 0.60·perc` | **GIỐNG HỆT** (đã đồng bộ) ✅ |
| Format file | **Format game thật** (XSize/YSize/Arrows + Y-FLIP) | Format riêng `{w,h,pieces[]}` ❌ KHÁC |
| Màu game (48 ColorType) | Có | **Chưa có** ❌ |
| Presets hình | rect/heart/diamond/star/circle/donut/puppy | tròn/thoi + tự vẽ + ảnh (chưa có heart/star/donut/puppy) |
| Đo dải độ khó (measureRange) | Có | **Chưa có** ❌ |
| Lấy hình từ snake | Có | Chưa có (nhưng mình có layout/mask sẵn nên ít cần) |

---

## 1. ✅ IMPORT / EXPORT — đây là "rule flip" bạn nhắc (QUAN TRỌNG NHẤT)

### Vấn đề
Tool mình export ra **format riêng**, game KHÔNG đọc được. Phải đổi sang **đúng format game** như tool anh.

### Format game (chuẩn — phải theo)
```json
{
  "Difficulty": <int>,
  "XSize": <Cols>, "YSize": <Rows>,
  "Arrows": [
    { "Dx":<int>, "Dy":<int>, "X":<headX>, "Y":<headY>,
      "fixedColor":<int>, "Indices":[idx,...], "BendCount":<int> }
  ],
  "Colors": []
}
```

### 3 "rule flip" / quy ước phải đúng
1. **Y-FLIP**: game gốc Y=0 ở **đáy**, editor Y=0 ở **đỉnh**.
   - Export: `Y_game = R - 1 - y_editor`.
   - Import: `y_editor = R - 1 - Y_game`.
2. **Index ô**: `idx = y * XSize + x` (đã flip Y). `Indices[]` là danh sách ô của snake.
3. **Hướng đầu (hd)**: **LUÔN suy lại từ cells** (`cells[1] → cells[0]`), **KHÔNG tin `Dx/Dy` trong file** — vì Dx/Dy của game không khớp quy ước solver, từng làm nhiều snake raycast sai hướng → báo "stuck". (Lúc export vẫn ghi Dx/Dy cho game, nhưng lúc import thì bỏ qua, tính lại từ cells.)

### So sánh trực tiếp
| Trường | Tool anh (game) | Tool mình hiện tại |
|---|---|---|
| Kích thước | `XSize`,`YSize` | `w`,`h` (hoặc `grid`) |
| Danh sách rắn | `Arrows[]` | `pieces[]` |
| Toạ độ rắn | `Indices[]` (idx, có Y-flip) | `cells:[[x,y]]` (không flip) |
| Đầu rắn | `Dx,Dy,X,Y` | `dir` |
| Màu | `fixedColor` (1..48 / -1) | (không có) |
| Số gập | `BendCount` | (không có) |

### → Việc cần làm
- **Viết lại `importJSON` / `exportJSON`** (editor) và **`levelExport` / `importPack` / ZIP** (batch) theo format game ở trên (kèm Y-FLIP + suy hd từ cells).
- Cân nhắc **giữ song song**: import nhận CẢ 2 format (tự nhận diện theo `XSize` vs `w`); export ra format game là mặc định.
- **HỎI A:** game đọc từng file 1 level, hay đọc 1 file nhiều level? (ảnh hưởng cách export ZIP/pack). → xem mục Câu hỏi.

---

## 2. ✅ ĐỘ LẤP ĐẦY (fill) — so setting + xuất chỉ số chi tiết

### Khác biệt cốt lõi
| | Tool anh | Tool mình |
|---|---|---|
| Slider | `Fill Target` **50–100%** | `Độ lấp đầy` **0–100**, trong đó **0 = tự động (theo curve)** |
| Ngữ nghĩa | Sinh ra level có fill **khớp slider ±3** (`FILL_TOL=3`) | 0 = quét fill để đạt độ khó; >0 = cố định fill |
| Đảm bảo đúng setting | Có — nhận level nếu `fillReal ∈ [uf-3, uf+3]` | **Không kiểm `fillReal`** sau khi sinh |

→ **Đúng lo ngại của bạn**: tool mình hiện **không xác nhận fill thực tế khớp setting**. Khi để fill cố định, mình gọi `generateMap` ở mức đó nhưng **không đo lại `fillReal`** rồi lọc. Tool anh có vòng kiểm `fillReal` (±3) nên "target = setting" được đảm bảo.

### → Việc cần làm
1. **Đo `fillReal`** sau khi sinh = (số ô có rắn trong layout) / (số ô layout) × 100.
2. Khi fill cố định: **lọc/sinh lại** nếu `fillReal` lệch quá `FILL_TOL` (đề xuất 3, giống anh).
3. Hiện `fillReal` ra UI để người dùng thấy đúng/sai.

### Xuất chỉ số chi tiết level (như tool anh `silentGenScore` trả về)
Tool anh có sẵn các chỉ số mỗi level — nên thêm vào export/preview của mình:
| Chỉ số | Ý nghĩa |
|---|---|
| `score` + `tier` | điểm khó + bậc sao ✅ (mình có) |
| `fillReal` | % lấp đầy thực tế ❌ (cần thêm) |
| `empty` | số ô trống còn lại trong layout ❌ |
| `snakes` (n) | số rắn ✅ |
| `turns` | số lượt giải ❌ (đang ẩn) |
| `t1Pct` | % rắn thoát ngay lượt 1 (đầu dễ/khó) ❌ |
| `stuck` | số rắn kẹt (0 = giải được) ❌ |
| breakdown perc/turns/rate/snake | ✅ (mình có trong `computeDifficulty.breakdown`, chưa export) |

→ Đề xuất: thêm các chỉ số này vào **mỗi level khi export** (manifest/pack) và hiện trên thẻ thư viện.

---

## 3. ✅ WORDING THAM SỐ — đang khó hiểu

| Tên hiện tại (mình) | Vấn đề | Đề xuất đổi |
|---|---|---|
| **Thiên hướng** (`genDiff`/`bDiff`) | Không rõ là gì (thực ra điều khiển trọng số *cấu trúc phụ thuộc* khi đặt rắn) | **"Độ phụ thuộc / Độ rối"** + tooltip "Cao = nhiều chuỗi phụ thuộc, rắn chặn nhau nhiều" |
| **Độ bọc** (`genWrap`) | Mơ hồ | **"Nút thắt"** + tooltip "Cao = 1 rắn bị nhiều rắn khác cùng phụ thuộc" |
| **Ưu tiên rắn dài** (`genLong`) | OK nhưng có thể rõ hơn | giữ, thêm "(cao = ít rắn, dài; thấp = nhiều rắn ngắn)" |
| **Điểm muốn** (`genTarget`/curve) | OK | giữ — đồng bộ với anh ("Điểm muốn") |
| **Độ lấp đầy** | Lẫn lộn 0=auto | tách rõ: checkbox **"Tự động theo độ khó"** vs slider **"Fill cố định %"** |
| **Độ gắt** (ảnh, `imgHarsh`) | Khó hiểu | **"Ngưỡng phủ ô"** + tooltip "% diện tích ô phải tối thì mới tính là vùng đặt rắn" |
| **Kích thước layout** (scale) | OK | giữ |

> Tool anh wording gọn & có hint ngay dưới mỗi mục — nên bắt chước: **mỗi tham số 1 dòng hint ngắn**.

---

## 4. ✅ AUDIT BUTTON — thừa / thiếu / hoạt động

### Tool mình — Editor
| Button | Trạng thái | Ghi chú |
|---|---|---|
| ✓ Xong rắn, ▶ Test thử, Kiểm tra, Xóa hết | wired ✓ | OK |
| Tool ↑↓←→⌫ | wired ✓ | OK |
| Đổi cỡ, 🎲 Sinh map, 🔗 Phụ thuộc | wired ✓ | OK |
| 🖼️ Chọn ảnh / Bỏ ảnh / Tạo map từ ảnh | wired ✓ | OK |
| Export/Import JSON | wired ✓ nhưng **SAI FORMAT** (mục 1) | cần sửa |

### Tool mình — Batch
| Button | Trạng thái | Ghi chú |
|---|---|---|
| Sinh hàng loạt / Hủy | ✓ | OK |
| Sort / Filter / Chọn hết / Bỏ chọn / Đảo / Xóa đã chọn / Xóa thư viện | ✓ | OK |
| Export ZIP / Pack JSON / Import pack | ✓ nhưng **SAI FORMAT** | cần sửa theo format game |
| Curve presets, paint controls, play/delete thẻ | ✓ | OK |

### Thiếu so với tool anh (nên thêm nút)
- **📊 Đo dải độ khó** (measureRange) — đo board sinh được điểm từ bao nhiêu → bao nhiêu, trước khi đặt "Điểm muốn". **Rất hữu ích, mình chưa có.**
- **🎨 Toggle màu Rainbow ⇄ Game** (cần hệ màu 48 trước).
- Preset **heart / star / donut / puppy**.

> Chưa thấy nút nào **thừa** hẳn ở tool mình. Cần bạn **test bấm thực tế** giúp (mình không mở được browser) — đặc biệt các nút mới (drag-drop ảnh, kéo curve, export ZIP).

---

## 5. ⏳ KÉO TÍNH NĂNG TOOL ANH SANG (checklist port)

Xếp theo độ ưu tiên / quan trọng để game dùng được:

| # | Tính năng | Vì sao cần | Độ khó port | Ghi chú |
|---|---|---|---|---|
| **P0** | **Format game + Y-FLIP** (import/export) | Không có thì game KHÔNG đọc được level | Trung bình | Bắt buộc làm đầu tiên |
| **P0** | **Đo & lọc `fillReal`** (±FILL_TOL) | Đảm bảo "target = setting" | Thấp | |
| **P1** | **Hệ màu game 48 ColorType** + import/export `fixedColor` | Để khớp màu game + round-trip | Trung bình | Cần bảng 48 hex từ file anh |
| **P1** | **📊 measureRange** (đo dải độ khó board) | Đặt "Điểm muốn" cho chuẩn | Trung bình | |
| **P1** | **Xuất chỉ số chi tiết** (fillReal, empty, turns, t1, stuck) | Bạn yêu cầu | Thấp | |
| **P2** | Presets **heart / star / donut / puppy** | Đa dạng layout | Thấp | Copy `mkMaskRaw` + `smoothShape` |
| **P2** | **Toggle Rainbow ⇄ Game**, colorMap (Idea 3) | Tô màu nhất quán khi gen lại | Trung bình | Phụ thuộc P1 màu |
| **P3** | **Lấy hình dạng từ snake** | Mình đã có layout/mask nên ít cần | Thấp | Cân nhắc bỏ qua |

**Những thứ mình CÓ mà tool anh KHÔNG** (giữ nguyên, lợi thế của mình): sinh **hàng loạt**, **difficulty curve**, **thư viện** quản lý, **export ZIP**, **xử lý song song**, **kéo-thả ảnh**, rắn-dài-trước, animation mượt.

---

## 6. ❓ CÂU HỎI CẦN A CHỐT (trước khi code)

1. **Format file game**: game đọc **mỗi file = 1 level** đúng không? Vậy export ZIP của mình nên là **nhiều file `.json` đơn-level đúng format game** (đang gần đúng, chỉ sai nội dung)? Hay game có format "pack nhiều level"?
2. **Bảng 48 màu game**: có thể gửi mình danh sách 48 hex (hoặc xác nhận lấy từ `GAME_COLORS[]` trong file anh) để port hệ màu không?
3. **Ưu tiên port**: làm **P0 (format + fill)** trước rồi dừng để bạn kiểm, hay làm luôn tới P1 (màu + measureRange + chỉ số)?
4. **Giữ format cũ?**: import có cần vẫn đọc được file `{w,h,pieces}` cũ mình đã export (vd `arrowout-pack-20.json`) không, hay bỏ luôn?
5. **Difficulty (số) khi export**: ghi `Difficulty` = điểm khó (0-100) của mình vào file game, hay để game tự tính/đặt?

---

## 7. Đề xuất bước đi
1. Chốt 5 câu hỏi mục 6.
2. Làm **P0** (format game + Y-flip + đo/lọc fillReal) → bạn test round-trip với tool anh + import vào game.
3. Làm **P1** (màu 48 + measureRange + xuất chỉ số) → bạn test.
4. P2/P3 tùy nhu cầu.

---

## 8. ✅ ĐÃ TRIỂN KHAI (P0 + P1) — bạn chọn làm luôn

> Bạn chốt: **P0+P1**, mỗi file 1 level format game, import tự nhận 2 format.

**P0 — Format game + Y-FLIP** ([arrow-out.js](arrow-out.js)):
- Thêm `toGameLevel()` / `fromGameLevel()` / `isGameFormat()` — đúng format game (`XSize/YSize/Arrows/Indices/Dx/Dy/fixedColor/BendCount`), **Y-FLIP** 2 chiều, **suy hd từ cells** (bỏ Dx/Dy).
- **Editor** Export → ra format game; Import → **tự nhận** format game lẫn format cũ `{w,h,pieces}`.
- **Batch** Export **ZIP = mỗi file 1 level format game** + `manifest.json` (kèm chỉ số); Export **Pack** = format game + metadata; Import pack/zip-level **tự nhận 2 format** (kể cả 1 file game lẻ).

**P0 — Fill khớp setting**:
- `genLevelCore` đo `fillReal` = (ô có rắn trong layout)/(ô layout). Khi **fill cố định**, vòng sinh **thử lại nếu `fillReal` lệch > 3%** (FILL_TOL=3, giống anh) — cả ở worker lẫn 1 luồng.

**P1 — Chỉ số chi tiết**: mỗi level lưu + xuất `fillReal, empty, turns, t1Pct, stuck`; hiện trên thẻ thư viện (badge `%` + **tooltip** đầy đủ) và trong manifest/pack.

**P1 — Hệ màu 48 ColorType**: bảng `GAME_COLORS` (48), `gameColor()`, `fixedColor` round-trip (import đọc, export ghi), nút **🎨 Màu: Cầu vồng ⇄ Game** trong Editor (tự bật Game khi import file có màu); thumbnail batch cũng theo màu game.

**P1 — Đo dải độ khó**: nút **📊 Đo dải độ khó của board** (card Difficulty curve) — sinh thử vài map ở layout+tham số hiện tại, báo dải `khó min–max (TB)` để đặt curve cho đúng.

**Wording**: "Thiên hướng"→**Độ phụ thuộc**, "Độ bọc"→**Nút thắt**, "Độ gắt"→**Ngưỡng phủ ô** (đều thêm tooltip).

### Còn lại (chưa làm, chờ bạn)
- **P2**: preset heart/star/donut/puppy; colorMap "Idea 3" (gen lại giữ màu theo ô); "Lấy hình dạng từ snake".
- Câu hỏi mục 6 còn lại: (2) xác nhận bảng 48 màu đúng game? (5) `Difficulty` trong file ghi điểm của mình — **hiện đang ghi điểm khó (0-100) của mình**, nếu game cần giá trị khác thì báo.
- **Cần test browser** (mình không mở được): round-trip import↔export với tool anh, import file game thật, các nút mới.
