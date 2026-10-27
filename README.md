# Fruitopia

Game ghép quả kiểu Suika: HTML5 Canvas + JavaScript + Matter.js. Giao diện pastel, 12 loại quả, 3 độ khó, combo, nhiệm vụ ngày, cửa hàng skin, nhạc lofi.

## Chạy game
Cần internet lần đầu (tải Matter.js và font từ CDN).
- Nhanh nhất: mở `index.html` bằng Chrome/Edge/Firefox.
- Nếu trình duyệt chặn: chạy `python3 -m http.server 8000` trong thư mục này rồi mở `http://localhost:8000`.
- Chơi offline: tải https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js, lưu thành `matter.min.js` cạnh `index.html` (game tự dùng khi CDN không tải được).

## Điều khiển
Chuột/ngón tay: kéo để di chuyển, nhả để thả. Bàn phím: ← → di chuyển, Space thả, P tạm dừng.

## Luật
- Hai quả giống nhau chạm nhau sẽ ghép thành quả lớn hơn. Điểm: cherry 1, kiwi 3, chanh 5, hồng 10, táo 15, đào 20, dừa 30, dưa lưới 40, khóm 50, dưa hấu 60, dâu tây vàng 100.
- Ghép liên tiếp trong 1 giây = combo: thưởng 5 × (combo − 1) điểm, tối đa 50.
- Tạo dâu tây vàng: pháo hoa xoá sạch khung, chơi tiếp.
- Quả chạm vạch đỏ quá 3 giây: quả nổ tung và Game Over.
- Mỗi ngày 3 nhiệm vụ; điểm ★ dùng đổi skin quả.

## Chỉnh nhanh (đầu `game.js`)
`CFG`: `DANGER_SECONDS` (3), `COMBO_WINDOW` (1000 ms), `COMBO_BONUS`, `COMBO_BONUS_MAX`, `MOVE_SPEED`, `SCORES`. `DIFFICULTY`: số loại quả thả được. `MUSIC_FILE`: tên file mp3/ogg nếu muốn dùng nhạc riêng.

## Sơ đồ luồng game
`docs/flow-simple.png` (bắt đầu → chơi → điểm → kết thúc → chơi lại) và `docs/flow-detail.png`. Mã nguồn Mermaid: `docs/*.mmd`.

## Dữ liệu lưu
localStorage: `fruitopia.profile` (điểm ★, skin, top 5, nhiệm vụ), `fruitopia.best`, `fruitopia.diff`, `fruitopia.audio`. Xoá để chơi lại từ đầu.

## Thanh tiến hoá
Dưới khung có hàng 12 quả nối nhau bằng mũi tên: quả chưa tạo được thì mờ, dâu tây vàng là bóng đen "?" cho tới khi bạn tạo ra nó.

## Kiểm thử
`window.FRUITOPIA_DEBUG` dùng cho kiểm thử, có thể xoá dòng này ở cuối `game.js` khi phát hành.
