# Hướng dẫn test từng tính năng vừa thêm

> Mở tool: chạy **Live Server** trên `arrow-out.html` (hoặc mở file). **Ctrl+F5** trước khi test.
> Mở tool anh để đối chiếu: `_teammate/difficulty-gen.html`.
> Ký hiệu kết quả: ✅ = đạt · ❌ = sai (chụp lại báo mình).

---

## A. CHUẨN BỊ
1. Mở `arrow-out.html` → đang ở tab **✎ Editor** (mặc định).
2. Mở thêm 1 tab `_teammate/difficulty-gen.html` (để đối chiếu round-trip).

---

## B. IMPORT / EXPORT — FORMAT GAME (quan trọng nhất)

### B1. Export ra đúng format game
1. Editor → chọn hướng **↑** → bấm 1 ô trống (đặt đầu) → bấm ô **kề dưới** nó (nối thân) → bấm **✓ Xong rắn**. (Giờ có 1 rắn 2 ô, đầu hướng lên.)
2. Vẽ thêm 1 rắn **bẻ cong** (chữ L): chọn **→**, bấm 1 ô, bấm ô bên phải, bấm ô phía trên → ✓ Xong rắn.
3. Bấm **Export JSON**.
4. Nhìn ô textarea bên dưới (`jsonBox`).

**✅ Đạt khi** thấy đúng cấu trúc:
```json
{
  "Difficulty": <số>,
  "XSize": <rộng>, "YSize": <cao>,
  "Arrows": [
    { "Dx":.., "Dy":.., "X":.., "Y":.., "fixedColor":-1, "Indices":[..], "BendCount":.. }
  ],
  "Colors": []
}
```
**❌ Sai nếu** thấy `{"grid":..,"pieces":..}` (format cũ).

### B2. Kiểm Y-FLIP (đảo trục Y) bằng tay
1. Editor → **Đổi cỡ** về 5×5 (Rộng 5, Cao 5, Đổi cỡ).
2. Vẽ 1 rắn dài 2 ô ở **góc TRÊN-TRÁI**: đầu ở ô (cột 0, hàng 0 — sát mép trên trái).
3. Export → xem `Indices` của rắn đó.

**✅ Đạt khi**: ô trên-cùng của editor cho `Y = YSize-1 = 4` (tức **idx = 0 + 4×5 = 20** trở lên), KHÔNG phải idx 0.
*(Game gốc Y=0 ở đáy; ô trên-trái editor → đáy-trên trong game → Y lớn.)*
**❌ Sai nếu** ô trên-trái cho idx nhỏ (0,5,10…) → chưa flip.

### B3. Round-trip trong tool mình
1. Sau B1, **copy** toàn bộ JSON trong textarea.
2. **Xóa hết** (nút Xóa hết) → dán JSON lại vào textarea → **Import JSON**.
3. Bấm **Export JSON** lần nữa.

**✅ Đạt khi**: level hiện lại **đúng vị trí + hướng** như trước; JSON export lần 2 có `Indices` **trùng** lần 1.
**❌ Sai nếu**: rắn lệch vị trí, đảo trên-dưới, hoặc hướng đầu đổi.

### B4. Cross-tool: tool mình → tool anh
1. Copy JSON export từ tool mình.
2. Sang tab tool anh → **📂 Import JSON** → chọn/dán file đó (anh import bằng file, nên có thể cần lưu .json: bấm Export ở tool mình sẽ chỉ ghi vào textarea — copy ra, lưu thành `test.json`).
3. Tool anh hiển thị level.

**✅ Đạt khi**: tool anh vẽ **đúng vị trí + đúng hướng đầu**, log không báo lỗi/stuck.
**❌ Sai nếu**: lệch vị trí / đảo Y / báo "stuck".

### B5. Cross-tool: tool anh → tool mình
1. Tool anh → vẽ/gen 1 level → **💾 Export JSON** (tải file `.json`).
2. Mở file đó bằng Notepad → copy nội dung.
3. Tool mình → Editor → dán vào textarea → **Import JSON**.

**✅ Đạt khi**: tool mình hiện **đúng** + báo "✓ Đã import (format game)".

### B6. Import file game THẬT + chơi thử
1. Có file level game thật (hoặc file B5) → Import vào tool mình.
2. Bấm **▶ Test thử** → bấm lần lượt các rắn để giải.

**✅ Đạt khi**: giải được **sạch bàn** (không còn con kẹt ở bước cuối).
**❌ Sai nếu**: tới cuối còn 1-2 con không thoát (lỗi hd/Y-flip).

### B7. Vẫn đọc format CŨ
1. Tìm 1 file cũ `arrowout-pack-*.json` (nếu còn) — hoặc bỏ qua.
2. Batch → **⬆ Import pack** → chọn file đó.

**✅ Đạt khi**: vẫn nạp được vào thư viện (không mất dữ liệu cũ).

### B8. Batch export ZIP = mỗi file 1 level game
1. Batch → Sinh vài level → **Chọn hết** → **⬇ Export ZIP**.
2. Giải nén file `.zip` tải về → mở 1 file `levelNNN.json`.

**✅ Đạt khi**: file đó đúng format game (B1) + có `manifest.json` liệt kê chỉ số.

---

## C. FILL ĐÚNG SETTING

### C1. Fill cố định khớp slider
1. Batch → card **3 · Tham số sinh** → kéo **Độ lấp đầy = 80** (không phải 0).
2. **Số level = 10** → **🎲 Sinh hàng loạt**.
3. Nhìn các thẻ trong Thư viện: mỗi thẻ có dòng `… rắn · NN%`.

**✅ Đạt khi**: phần `%` của đa số thẻ nằm **77–83%** (80 ±3).
**❌ Sai nếu**: nhiều thẻ lệch xa (vd 50% hay 100%).

### C2. Đổi fill → fillReal đổi theo
1. Sinh lại với fill **60** → các thẻ ~`57–63%`.
2. Sinh lại với fill **95** → các thẻ ~`92–98%`.

**✅ Đạt khi**: `%` trên thẻ **bám theo** slider.

### C3. Fill = 0 (tự động)
1. Đặt **Độ lấp đầy = 0** → Sinh.

**✅ Đạt khi**: `%` thẻ **dao động** (vì lúc này fill chạy theo độ khó curve, không ép) — đúng thiết kế.

---

## D. CHỈ SỐ CHI TIẾT

### D1. Tooltip trên thẻ
1. Batch → sau khi sinh, **rê chuột** lên 1 thẻ level (giữ yên ~1s).

**✅ Đạt khi**: hiện tooltip nhiều dòng:
`Điểm .. <tier> (muốn ..)` / `Rắn .. · Lấp đầy ..% · Trống .. ô` / `Lượt giải .. · Thoát ngay lượt 1 ..% · Kẹt 0`.

### D2. Chỉ số trong file export
1. Export ZIP → mở `manifest.json`.

**✅ Đạt khi**: mỗi level có `score, tier, snakes, fillReal, empty, turns, t1Pct, stuck`.

---

## E. WORDING

1. Editor → nhìn các nhãn slider: phải là **"Độ phụ thuộc"**, **"Nút thắt"**, và ở mục Ảnh là **"Ngưỡng phủ ô"** (không còn "Thiên hướng/Độ bọc/Độ gắt").
2. **Rê chuột** lên từng nhãn → đọc tooltip giải thích.

**✅ Đạt khi**: đọc nhãn + tooltip là hiểu tham số làm gì.
**❓ Báo mình** nếu nhãn nào vẫn khó hiểu.

---

## F. BUTTONS (bấm thử từng cái)

### F1. Editor
Bấm lần lượt, mỗi nút phải có phản hồi:
- [ ] ↑↓←→⌫ (đổi hướng / xóa) · ✓ Xong rắn · ▶ Test thử · Kiểm tra · Xóa hết
- [ ] Đổi cỡ · 🎲 Sinh map · 🔗 Phụ thuộc (hiện mũi tên phụ thuộc) · Export/Import
- [ ] 🖼️ Chọn ảnh / Bỏ ảnh / Tạo map từ ảnh

### F2. Batch
- [ ] 📊 Đo dải độ khó · 🎲 Sinh hàng loạt · ■ Hủy (lúc đang sinh)
- [ ] Sort / Filter · Chọn hết / Bỏ chọn / Đảo chọn · Xóa đã chọn / Xóa thư viện
- [ ] ⬇ Export ZIP / Pack · ⬆ Import pack · ▶/🗑 trên thẻ

**✅ Đạt khi**: mọi nút **bấm là chạy**.
**❌ Báo mình** nút nào bấm **không ăn** hoặc thấy **thừa**.

---

## G. HỆ MÀU GAME (🎨)

### G1. Toggle khi không có màu
1. Editor → 🎲 Sinh map (level tự gen, fixedColor = -1).
2. Bấm **🎨 Màu** → đổi qua lại **Cầu vồng ⇄ Game**.

**✅ Đạt khi**: ở chế độ Game, rắn không-có-màu vẫn hiện màu cầu vồng (không xám), nút đổi chữ.

### G2. Màu thật từ file import
1. Import 1 file game **có màu** (`fixedColor ≥ 1`, vd file donut của anh).

**✅ Đạt khi**: tự bật **🎨 Màu: Game**, rắn hiện **đúng màu game** (vd hồng/nâu), không phải cầu vồng.
2. Export lại file đó → kiểm `fixedColor` **giữ nguyên** (round-trip màu).

---

## H. ĐO DẢI ĐỘ KHÓ (📊)

1. Batch → chọn layout (vd Vuông 20×20) → bấm **📊 Đo dải độ khó của board**.
2. Chờ vài giây (hiện "Đang đo…").

**✅ Đạt khi**: hiện dòng `Board này sinh được khó <min>–<max> (TB ..)`.
3. Đặt curve trong dải đó → Sinh → điểm các level **nằm trong/ gần dải** đã đo.

---

## TÓM TẮT ƯU TIÊN
> Test theo thứ tự: **B (import/export)** → **C (fill)** → **D/G/H** → **E/F**.
> Quan trọng & rủi ro nhất là **B4–B6** (cross-tool + import game thật). Xong báo mình kết quả từng mục để fix nếu sai.
