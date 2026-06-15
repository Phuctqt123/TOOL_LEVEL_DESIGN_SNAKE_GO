# Checklist kiểm tra — đợt hợp nhất tool (P0 + P1)

> Trạng thái: ✅ đã code · 🧪 cần test browser (mình không mở được) · ⏳ chưa làm · ❓ cần A chốt
> Cách test chung: **Hard-reload (Ctrl+F5)** trước. Tool anh để đối chiếu: `_teammate/difficulty-gen.html`.

---

## 1) Import / Export (rule flip)

### Code
- [x] ✅ Thêm `toGameLevel` / `fromGameLevel` / `isGameFormat` (arrow-out.js)
- [x] ✅ **Y-FLIP** 2 chiều: `Y_game = h-1-y`, `idx = x + Y_game·w`
- [x] ✅ **Suy `hd` từ cells** (cells[1]→cells[0]), **bỏ qua Dx/Dy** của file
- [x] ✅ Editor Export → format game (`XSize/YSize/Arrows/...`)
- [x] ✅ Editor Import **tự nhận** format game + format cũ `{w,h,pieces}`
- [x] ✅ Batch Export **ZIP = mỗi file 1 level format game** + `manifest.json`
- [x] ✅ Batch Export Pack (game + metadata) + Import tự nhận 2 format (cả file game lẻ)

### Cần test (browser)
- [ ] 🧪 Editor: vẽ 1 level (có rắn bẻ cong) → **Export JSON** → kiểm `jsonBox` có `XSize/YSize/Arrows/Indices/BendCount/fixedColor`
- [ ] 🧪 Lấy JSON đó **Import vào tool anh** (`difficulty-gen.html`) → hiển thị **đúng vị trí, đúng hướng đầu**, không báo "stuck"
- [ ] 🧪 Ngược lại: Export 1 level **từ tool anh** → **Import vào tool mình** → đúng vị trí/hướng
- [ ] 🧪 Round-trip: Import → Export lại → **toạ độ trùng khớp** (Indices không lệch Y)
- [ ] 🧪 Import **file game thật** (từ anh / từ game) → chơi thử → **giải được 100%** (không kẹt ở bước cuối)
- [ ] 🧪 Import lại **file format cũ** (vd `arrowout-pack-20.json`) → vẫn vào được (không mất dữ liệu cũ)
- [ ] 🧪 Batch: Export ZIP → giải nén → mở 1 file `levelNNN.json` → đúng format game

### Pass khi
> Level export ra **mở được trong game / tool anh, đúng vị trí + hướng + giải được**; import 2 chiều không lệch.

---

## 2) Độ Fill đúng setting + xuất chỉ số chi tiết

### Code
- [x] ✅ Đo `fillReal` = (ô có rắn trong layout) / (ô layout) × 100
- [x] ✅ Fill cố định: **thử lại nếu `fillReal` lệch > 3%** (FILL_TOL=3) — cả worker lẫn 1 luồng
- [x] ✅ Xuất chỉ số: `fillReal, empty, turns, t1Pct, stuck` (mỗi level)
- [x] ✅ Hiện trên thẻ thư viện: badge `… %` + **tooltip** đủ chỉ số

### Cần test (browser)
- [ ] 🧪 Batch: đặt **Độ lấp đầy = 80%** (cố định) → Sinh → các thẻ hiện `~80%` (lệch ≤ 3)
- [ ] 🧪 Đặt fill 60% rồi 95% → `fillReal` đổi theo, **khớp slider**
- [ ] 🧪 Rê chuột lên thẻ level → tooltip hiện `Điểm/Rắn/Lấp đầy/Trống/Lượt giải/Thoát ngay lượt 1/Kẹt`
- [ ] 🧪 Export ZIP → `manifest.json` có các chỉ số này
- [ ] 🧪 So sánh `fillReal` của mình với fill anh hiển thị trên cùng 1 layout (xấp xỉ nhau)

### Pass khi
> `fillReal` hiển thị **khớp slider ±3**, và file export có đủ chỉ số như tool anh (`silentGenScore`).

---

## 3) Wording tham số

### Code
- [x] ✅ "Thiên hướng" → **Độ phụ thuộc** (+tooltip) — cả Editor & Batch
- [x] ✅ "Độ bọc" → **Nút thắt** (+tooltip)
- [x] ✅ "Độ gắt" (ảnh) → **Ngưỡng phủ ô** (+tooltip) — cả Editor & Batch

### Cần test / duyệt
- [ ] 🧪 Đọc lại từng nhãn + tooltip xem đã **dễ hiểu** chưa
- [ ] ❓ "Ưu tiên rắn dài", "Kích thước layout", "Điểm muốn" — giữ nguyên, OK chứ?
- [ ] ❓ "Độ lấp đầy (0 = tự động)" — có cần tách hẳn thành checkbox "Tự động" + slider "%" không?

### Pass khi
> Nhìn nhãn + hover tooltip là **hiểu ngay tham số làm gì**, không phải đoán.

---

## 4) Buttons (thừa / thiếu / bấm được)

### Đã rà code (đều wired)
- [x] ✅ Editor: Xong rắn · Test thử · Kiểm tra · Xóa hết · ↑↓←→⌫ · Đổi cỡ · Sinh map · Phụ thuộc · **🎨 Màu (mới)** · Chọn/Bỏ ảnh · Tạo map từ ảnh · Export/Import
- [x] ✅ Batch: Sinh/Hủy · **📊 Đo dải (mới)** · Sort/Filter · Chọn hết/Bỏ/Đảo/Xóa chọn/Xóa thư viện · Export ZIP/Pack/Import · play/xóa thẻ · libPlayBar
- [x] ✅ Đã **thêm** nút thiếu so với anh: 📊 Đo dải độ khó, 🎨 toggle màu Rainbow/Game

### Cần test bấm thực tế (browser)
- [ ] 🧪 Mỗi nút Editor: bấm có **phản hồi đúng** không (đặc biệt Export/Import sau khi đổi format)
- [ ] 🧪 Mỗi nút Batch: Sinh / Hủy / 📊 Đo dải / Export ZIP / Pack / Import
- [ ] 🧪 🎨 Màu: bấm đổi Cầu vồng ⇄ Game → màu rắn đổi (rõ nhất khi đã import file có màu)
- [ ] 🧪 Có nút nào **bấm không ăn / thừa** không → liệt kê để mình xử lý
- [ ] ❓ "🔗 Phụ thuộc", "Kiểm tra" — còn cần không, hay gộp/bỏ?

### Pass khi
> Mọi nút **bấm là chạy**, không nút chết; không thiếu nút so với tool anh (trừ P2 chưa làm).

---

## 5) Kéo hết tính năng tool anh sang

| Tính năng (anh) | Trạng thái | Test |
|---|---|---|
| Format game + Y-FLIP (import/export) | [x] ✅ | mục 1 |
| Đo & lọc `fillReal` (±3) | [x] ✅ | mục 2 |
| Xuất chỉ số chi tiết | [x] ✅ | mục 2 |
| Hệ màu **48 ColorType** + `fixedColor` round-trip | [x] ✅ | [ ] 🧪 import file có màu → màu đúng |
| Toggle **Rainbow ⇄ Game** | [x] ✅ | [ ] 🧪 mục 4 |
| **📊 Đo dải độ khó** (measureRange) | [x] ✅ | [ ] 🧪 bấm → báo `khó min–max (TB)` |
| Preset **rect / circle / diamond** | [x] ✅ (đã có) | [ ] 🧪 |
| Preset **heart / star / donut / puppy** | [ ] ⏳ chưa | — |
| **colorMap "Idea 3"** (gen lại giữ màu theo ô) | [ ] ⏳ chưa | — |
| **⬡ Lấy hình dạng từ snake** | [ ] ⏳ chưa (mình có layout/mask sẵn) | — |

### ❓ Cần A chốt
- [ ] ❓ Bảng **48 màu** mình lấy từ `GAME_COLORS[]` của anh — **đúng game chưa**?
- [ ] ❓ Trường **`Difficulty`** trong file: mình ghi **điểm khó 0–100 của mình** — game cần giá trị khác không?
- [ ] ❓ Có cần làm **P2** (heart/star/donut/puppy + colorMap + lấy-hình-từ-snake) không?

---

## Tổng kết nhanh
- ✅ Code xong: **P0 (format+fill) + P1 (màu + measureRange + chỉ số + wording)**.
- 🧪 Chờ bạn test browser: **round-trip với tool anh + import file game thật** (quan trọng nhất).
- ⏳ Chưa làm: **P2** (preset đặc biệt, colorMap, lấy-hình-từ-snake).
- ❓ Cần chốt: bảng màu, trường `Difficulty`, có làm P2 không.

> Test xong báo mình kết quả mục 1 (round-trip) — nếu OK mình **commit + push**.
