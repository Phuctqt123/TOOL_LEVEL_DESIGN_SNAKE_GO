# Arrow Out

Game puzzle lưới: mỗi "mũi tên" là một **con rắn nhiều ô** (`{ dir, cells:[{x,y}...] }`, `cells[0]` = đầu).
Bấm một con → đầu đi thẳng theo `dir` ra rìa bàn, thân trườn theo vệt đầu. Thoát được khi **tia thẳng từ đầu tới rìa trống** (không vướng rắn khác, không vướng thân mình). Dọn sạch hết là thắng. Mỗi con tốn đúng 1 nước, nên **par = số rắn**.

File:
- `arrow-out.html` — markup
- `arrow-out.css` — style
- `arrow-out.js` — toàn bộ logic + render (SVG)

---

## Logic sinh map tự động

Mục tiêu: sinh ngẫu nhiên một map **luôn giải được**, có các con rắn dài ngắn khác nhau và có quan hệ phụ thuộc đan xen.

### Nguyên lý nền: "giải được ⟺ đồ thị phụ thuộc không có vòng"

- **Phụ thuộc trực tiếp** của rắn A = con rắn **đầu tiên** mà tia đi của A đâm trúng (`directDep`). A chỉ đi được khi mọi rắn trên tia của nó đã đi.
- Việc một con thoát ra **chỉ làm thông đường** cho con khác, **không bao giờ chặn thêm**. Do đó:
  > Map giải được ⟺ đồ thị phụ thuộc là DAG (không có vòng).
- Hệ quả: không cần viết bộ phát hiện vòng riêng — chính hàm `solve()` đóng vai trò đó. `solve()` lặp: bóc hết các con đang "đi được" cho tới khi không bóc được nữa; nếu sạch bàn ⇒ giải được, ngược lại ⇒ còn vòng/kẹt.
- Vì mỗi con bóc đúng 1 lần nên **số nước tối thiểu (par) = số rắn**.

### Thuật toán: sinh-rồi-kiểm-tra từng bước (`generateMap`)

Không thể tự vẽ một DAG bất kỳ rồi "đặt vị trí cho khớp", vì trong game này **hình học quyết định quan hệ phụ thuộc** (đặt một con có thể vô tình tạo cạnh thừa → sinh vòng). Nên ta đặt **từng con một** và kiểm tra ngay:

```
generateMap(n, w, h, maxLen, difficulty, wrapping):
  # trọng số suy từ tham số (difficulty 1..5, wrapping 0..5)
  wEdges = (difficulty-1) * 0.6     # D=1 -> 0 (đặt ~ngẫu nhiên = dễ)
  wCross = (difficulty-1) * 0.5
  wDepth = (difficulty-1) * 1.0
  wWrap  = wrapping * 1.6
  wLen   = 0.3
  pieces = []
  lặp tới khi đủ n con (hoặc hết lượt thử):
    # với mỗi con mới, lấy ~18 ứng viên rồi chọn cái tốt nhất
    best = null
    lặp 18 lần:
      len  = ngẫu nhiên 1..maxLen
      cand = growSnake(ô ngẫu nhiên, hướng ngẫu nhiên, len)   # một con rắn hợp lệ
      nếu cand == null: bỏ qua
      nếu KHÔNG solve(pieces + cand).solvable: bỏ qua          # ← loại nếu tạo vòng
      m = depMetrics(pieces + cand)
      score = wEdges*m.edges + wCross*m.cross + wDepth*m.depth
            + wWrap*m.wrap + wLen*len + nhiễu ngẫu nhiên nhỏ
      giữ cand có score cao nhất
    nếu có best: thêm vào pieces
  trả về pieces
```

Hai điểm cốt lõi:
1. **Bộ lọc giải được** (`solve(...).solvable`): mọi con thêm vào đều phải giữ map không-vòng ⇒ map cuối **chắc chắn giải được**, par = số con.
2. **Hàm chấm điểm tham số hóa** bởi `difficulty` và `wrapping` (xem mục dưới).

### Tham số sinh

Số rắn và độ dài rắn **không còn là tham số tay** — generator **tự quét** chúng (xem `autoGenerate`). Các tham số người dùng còn lại:

Cả ba đều là **thanh kéo 0–100** trong UI cho trực quan:

| Tham số | Ý nghĩa |
|---|---|
| **Thiên hướng** (0–100) | thiên hướng **cấu trúc** lúc đặt rắn. 0: trọng số phụ thuộc = 0 (đặt gần ngẫu nhiên, nhiều con thoát ngay = thoáng); 100: ép chuỗi phụ thuộc sâu, dày. Nội bộ map sang trọng số `t = value/100` → `wEdges=2.4t, wCross=2.0t, wDepth=4.0t`. |
| **Độ bọc** (0–100) | thưởng tạo **"hub"** — con bị **nhiều con khác cùng phụ thuộc** (in-degree ≥ 2) → nút thắt. `wWrap = 8·(value/100)`. |
| **Ưu tiên rắn dài** (0–100) | lệch phân bố độ dài: 0 = ưu tiên rắn **ngắn** (lấp khít, hợp ảnh), 100 = ưu tiên **dài**. `snakeLen()` dùng `k = 0.15^((lp−0.5)·2)`, `len = 1 + ⌊rand^k · maxL⌋`. |
| **Điểm muốn** (0–100) | điểm độ khó muốn nhắm; 0 = tự chọn (lấp ~70% bàn). Xem dưới. |
| **Rắn mẹ (viền)** (0/1/2) | thêm 1–2 vòng rắn bao quanh hình (xem dưới). |
| (ảnh) **Độ lấp đầy** | tỉ lệ vùng ảnh được phủ. (Rắn luôn nằm GỌN trong mask — không lòi ra.) |

**`generateMap(w, h, longPref, difficulty, wrapping, opts)`** **lấp đầy** vùng chơi tới `opts.fill`; độ dài rắn theo `longPref`; `opts.bounds` giới hạn ô (chừa lề cho rắn mẹ). Trần số rắn `MAXSNAKES=220`.

### Rắn mẹ (viền ôm sát hình) — checkbox bật/tắt

Bật checkbox → thêm **1 viền ôm sát** bao quanh tất cả, có **mỏ thoát**. Ảnh thì ôm theo **mask** (silhouette sạch).
- `traceBorder`: **bám-tường (luật bàn tay phải)**, đi trên ô trống sát hình, **không quay lại ô đã đi** → bắc cầu qua các chỗ viền tự chạm (khe hẹp) thay vì đứt giữa chừng → lần được gần trọn đường bao ngoài (kể cả hình lõm).
- **Mỏ thoát**: thêm 1 ô ngay **trên đỉnh hình** làm ĐẦU, chĩa thẳng **lên ra ngoài** → thoát chắc chắn (đúng ý "ôm sát rồi tới đầu thì rẽ ra ngoài"). Dự phòng: `motherFromLoop` cắt vòng tại ô thoát được.

Vì viền kề sát cạnh ngoài, rắn bên trong chĩa ra bị chặn → **buộc click rắn mẹ trước**. `applyGenerated` **kiểm tra `solve`**; nếu rắn mẹ gây kẹt thì **bỏ** (an toàn). Rắn mẹ tô **màu vàng, nét dày hơn**.

Lưu ý: chế độ 🎲 thường lấp kín cả bàn nên không còn viền trống → rắn mẹ chủ yếu dùng với **Ảnh → Map**. Nếu hình có **khe hẹp 1 ô** ở rìa, viền có thể dừng sớm tại đó — khi đó giảm độ gắt/ngưỡng để hình mượt hơn.

**`autoGenerate(...)`** tự quét **"hồ sơ độ dài"** từ *ít rắn dài* (dễ) đến *nhiều rắn ngắn* (khó):
- Không nhắm điểm → dùng hồ sơ giữa (lấp ~70%).
- Nhắm điểm → sinh thử từng hồ sơ, chấm `computeDifficulty`, giữ map gần điểm nhất, rồi tinh chỉnh quanh hồ sơ tốt nhất. Bàn lớn (>1500 ô) quét ít hồ sơ hơn cho nhanh.
- Ảnh: giữ `fill` theo slider Độ lấp đầy, chỉ quét độ dài.

`depMetrics(pieces)` đo: `edges`, `cross`, `depth`, **`wrap`** = Σ(in-degree − 1) trên các con bị ≥ 2 con phụ thuộc, và `hubs`.

### Vẽ một con rắn hợp lệ (`growSnake`)

Đi bộ ngẫu nhiên tự-tránh-thân từ đầu rắn:

```
growSnake(hx, hy, dir, len):
  nếu (hx,hy) ngoài bàn hoặc đã có rắn khác: trả null
  ray = tập ô trên tia đi thẳng của đầu (từ đầu theo dir tới rìa)
  cells = [(hx,hy)]
  cur = (hx,hy)
  lặp len-1 lần:
    chọn ngẫu nhiên một ô kề `cur` thỏa: trong bàn, chưa bị chiếm,
        chưa nằm trong thân con này, và KHÔNG nằm trên `ray`
    nếu không có ô nào hợp lệ: dừng (con ngắn hơn len → tạo độ dài đa dạng)
    nối ô đó vào thân
  trả về { dir, cells }
```

Ràng buộc **"thân không được nằm trên tia đi của đầu"** đảm bảo đầu luôn có đường thoát — con rắn **không bao giờ tự chặn thân mình** (nếu tự chặn thì nó vĩnh viễn kẹt ⇒ map không giải được).

Ràng buộc thẩm mỹ **"đầu phải thẳng"**: với rắn dài ≥ 2 ô, ô thân đầu tiên (cổ) bị ép nằm **ngay sau đầu** (ngược hướng `dir`), nên hướng đầu luôn trùng hướng từ cổ tới đầu — đầu **không quẹo gấp 90°**. Thân có thể bẻ cong tùy ý từ ô thứ ba trở đi. Ràng buộc này áp dụng cả khi vẽ tay trong editor (hàm `enforceHeadDir` / `dirFromTo`): từ ô thứ hai trở đi hướng đầu tự khớp theo cổ, nút ↑↓←→ chỉ đổi được hướng khi rắn mới có 1 ô.

### Thông tin sau khi sinh

Bảng `genInfo` hiển thị: số rắn, **điểm độ khó + tier**, độ dài trung bình, **độ sâu chuỗi phụ thuộc**, số phụ thuộc, **độ bọc**, và xác nhận giải được.

## Đo độ khó

Game chấm **điểm độ khó 0–100 + tier** (Rất dễ → Siêu khó), hiển thị ở pill **"Khó"** trên thanh trạng thái và trong info sau khi sinh / Kiểm tra / nạp level.

`computeDifficulty(pieces, w, h)`:

```
score = 0.10·turnsScore + 0.20·snakeScore + 0.10·rateScore + 0.60·percScore
```

- **turnsScore** — số "lượt" của solver natural-turn (mỗi lượt mọi rắn thoát được thoát đồng thời), `log2(turns)/log2(50)`.
- **snakeScore** — số rắn, `log2(snakes)/log2(140)`.
- **rateScore** — `(100 − tốc độ giải TB)·1.1` (giải càng "nhỏ giọt" mỗi lượt càng khó).
- **percScore** (chiếm 60%) — **"bẫy thị giác"**: với mỗi rắn bị chặn, raycast đầu → kẻ chặn, đo `dAlong` (quãng đi) và `dPerp` (lệch ngang), góc nhỏ → "nhìn tưởng đi được nhưng không" → rủi ro cao. Lấy **sustained top-30%** các lượt rủi ro nhất × (1 + 0.5·tần suất). Đây là trục tương quan mạnh nhất với tỉ lệ thua thật.

Map **kẹt** (không giải được) → điểm 0, tier `KẸT ✕`.

Tier: `<20` Rất dễ ★ · `<40` Dễ ★★ · `<60` Vừa ★★★ · `<80` Khó ★★★★ · `≥80` Siêu khó ★★★★★.

### Sinh theo điểm muốn

Ô **Điểm muốn (0–100)** trong Editor: khi >0, `autoGenerate` **quét các hồ sơ độ dài** (ít rắn dài → nhiều rắn ngắn), chấm `computeDifficulty` từng map và **giữ map gần điểm nhất** (dừng sớm nếu lệch ≤ 2, rồi tinh chỉnh quanh hồ sơ tốt nhất). 0 = tự chọn hồ sơ giữa (lấp ~70% bàn).

> Lưu ý (theo tài liệu gốc): perceptual 60% khiến điểm **dao động** giữa các lần sinh cùng cấu hình; điểm cao đôi khi do "bẫy nhìn" chứ chưa chắc khó hơn khi chơi tối ưu. Dùng làm tham chiếu, không tuyệt đối.

### Giới hạn

- Bàn hỗ trợ tới **50×50**. Vì giờ generator **lấp đầy** bàn (và nhắm điểm thì sinh nhiều lần), bàn lớn + Điểm muốn có thể mất **vài giây tới hàng chục giây** — trần `MAXSNAKES=150` chặn trường hợp tệ nhất. Bàn lớn nên để Điểm muốn = 0 hoặc giảm cỡ bàn.
- Trần số rắn 150 có thể làm **ảnh lớn không phủ hết**; giảm cỡ bàn để hình đầy hơn.

## Ảnh → Map (tích hợp Image → Matrix)

Cho phép tạo map có **hình dạng theo ảnh**: ảnh → ma trận 0/1 → rắn chỉ nằm trong vùng ô `1`.

Quy trình trong Editor:
1. **Chọn ảnh** (hoặc dán `Ctrl+V`). Bàn dùng **kích thước hiện tại** (W×H) làm ma trận.
2. Chỉnh **Ngưỡng** + **Độ gắt** — vùng ô `1` (nơi sẽ đặt rắn) hiện sáng ngay trên bàn để xem trước. *(`computeMask` lấy mẫu ảnh ở độ phân giải cao, ô bật khi tỉ lệ tối ≥ độ gắt.)*
3. Chỉnh **Độ lấp đầy %** — tỉ lệ ô `1` phải được phủ (không để trống). Càng cao map càng **giống ảnh** (nhiều rắn hơn). Đây là điều kiện dừng của generator ở chế độ ảnh.
4. (Tùy chọn) **Rắn mẹ** = 1 hoặc 2 để thêm viền ôm quanh hình.
5. Bấm **✓ Tạo map từ ảnh** để chốt.

**Khi có ảnh, độ lấp đầy là ưu tiên số 1** (để hình đẹp): `autoGenerate` xếp hạng theo độ phủ trước — `rank = min(độ_phủ, Độ_lấp_đầy)·1000 − |điểm − Điểm_muốn|`. Trần số rắn `MAXSNAKES=220`.

Cơ chế lấp đầy: đầu rắn **ưu tiên gieo vào ô `1` chưa được phủ**; chạy tới khi đạt **độ lấp đầy** mục tiêu. Rắn **luôn nằm gọn trong mask** (không lòi ra) nên silhouette sạch — và rắn mẹ ôm theo **mask** cho viền liền.

---

## Các hàm liên quan (trong `arrow-out.js`)

| Hàm | Vai trò |
|---|---|
| `pathInfo(p, pieces, w, h)` | Tia đi của đầu — trả về bị chặn bởi ai, hoặc tự chặn thân (`self`) |
| `solve(pieces, w, h)` | Bóc lặp để kiểm tra giải được + tính par (= số con) |
| `directDep(p, pieces, w, h)` | Phụ thuộc trực tiếp (con đầu tiên trên tia) |
| `depDepth(pieces, w, h)` | Độ sâu chuỗi phụ thuộc dài nhất |
| `depMetrics(pieces, w, h)` | Đo edges / cross / wrap / hubs / depth |
| `growSnake(...)` | Vẽ một con rắn ngẫu nhiên hợp lệ (đầu thẳng) |
| `generateMap(n, w, h, maxLen, difficulty, wrapping)` | Sinh cả map theo thuật toán trên |

## Định dạng level (JSON)

```json
{
  "grid": [[0, 0, ...], ...],
  "pieces": [
    { "dir": "right", "cells": [[4,2],[3,2],[2,2]] }
  ],
  "par": 4
}
```

- `cells[0]` là đầu (mang mũi tên). Thân phải liền nhau (các ô kề cạnh) và không chồng lên rắn khác.
- `grid` hiện chỉ dùng để lưu kích thước bàn (toàn số 0); mọi rìa bàn đều là lối ra nên không có ô `exit`.
- `dir` ∈ `up | down | left | right`.
