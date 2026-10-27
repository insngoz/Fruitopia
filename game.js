/* =====================================================================
   FRUITOPIA - Giai đoạn 1
   Khung game, vật lý (Matter.js), thả quả, ghép quả, tính điểm,
   vạch nguy hiểm + thua, vẽ 12 loại quả bằng Canvas.
   ===================================================================== */
'use strict';

function fruitopiaMain() {
  const { Engine, Bodies, Body, Composite, Events } = Matter;
  const PI2 = Math.PI * 2;

  /* ===================================================================
     1. CẤU HÌNH (chỉnh các hằng số ở đây)
     =================================================================== */
  const CFG = {
    W: 420, H: 810,            // kích thước logic của canvas
    FLOOR_Y: 730,              // mặt đáy khung chứa
    JAR_TOP: 150,              // đỉnh khung chứa (chỉ để vẽ)
    DANGER_Y: 172,             // vạch nguy hiểm
    HAND_Y: 132,               // độ cao quả đang cầm trên tay

    // Bán kính 12 loại quả (nhỏ -> lớn)
    RADII: [13, 18, 24, 30, 37, 44, 52, 61, 70, 80, 91, 102],
    // Điểm nhận được khi TẠO RA quả đó từ việc ghép (việt quất không có điểm)
    SCORES: [0, 1, 3, 5, 10, 15, 20, 30, 40, 50, 60, 100],

    // Vật lý
    DENSITY: 0.001,
    FRICTION: 0.15,
    FRICTION_STATIC: 0.4,
    FRICTION_AIR: 0.012,
    MAX_SPEED: 24,             // giới hạn vận tốc để tránh xuyên vật thể
    STEP: 1000 / 60,           // bước vật lý cố định (ms)

    // Luật chơi
    DROP_COOLDOWN: 520,        // ms chờ trước khi có quả mới trên tay
    DANGER_SECONDS: 3,         // số giây quả chạm vạch trước khi thua
    SETTLE_AGE: 900,           // ms: quả mới thả/mới ghép chưa bị tính nguy hiểm
    SETTLE_SPEED: 2.2,         // chỉ tính nguy hiểm khi quả gần như đứng yên
    GOLD_CLEAR_DELAY: 0.9,     // giây từ lúc có dâu tây vàng đến lúc pháo hoa xoá quả
    MOVE_SPEED: 320,           // px/s khi di chuyển bằng bàn phím
    COMBO_WINDOW: 1000,        // ms: ghép liên tiếp trong khoảng này thì tính combo
    COMBO_BONUS: 5,            // điểm thưởng = COMBO_BONUS x (số combo - 1)
    COMBO_BONUS_MAX: 50,
  };

  const GOLD = 11; // chỉ số dâu tây vàng

  // Độ khó: số loại quả xuất hiện, tỉ lệ, độ rộng khung, vật lý, đường gợi ý
  const DIFFICULTY = {
    de:  { label: 'Dễ',  levels: 3, weights: [4, 3, 2],       jarW: 360, gravity: 1.2, restitution: 0.12, guide: true },
    vua: { label: 'Vừa', levels: 4, weights: [4, 3, 2.2, 1.4], jarW: 340, gravity: 1.4, restitution: 0.15, guide: true },
    kho: { label: 'Khó', levels: 5, weights: [3, 3, 3, 3, 3],  jarW: 310, gravity: 1.6, restitution: 0.22, guide: false },
  };
  // Độ khó mặc định: Vừa. (Giai đoạn 2 sẽ có nút chọn; tạm thời dùng ?diff=de|vua|kho)
  const urlDiff = new URLSearchParams(location.search).get('diff');
  function loadDiff() {
    try { return localStorage.getItem('fruitopia.diff'); } catch (e) { return null; }
  }
  let diffKey = DIFFICULTY[urlDiff] ? urlDiff : (DIFFICULTY[loadDiff()] ? loadDiff() : 'vua');
  let diff = DIFFICULTY[diffKey];

  const FRUIT_NAMES = ['Việt quất', 'Cherry', 'Kiwi', 'Chanh vàng', 'Hồng', 'Táo',
                       'Đào', 'Dừa', 'Dưa lưới', 'Khóm', 'Dưa hấu', 'Dâu tây vàng'];
  // Màu đại diện (dùng cho hạt hiệu ứng)
  const FRUIT_COLORS = ['#7b8cf0', '#d9264d', '#b8e06a', '#ffe45e', '#ffa24d', '#ff7a85',
                        '#ffb08f', '#c28d5d', '#bfe8a8', '#ffd24d', '#ff6d82', '#ffd54a'];

  /* ===================================================================
     2. THAM CHIẾU DOM
     =================================================================== */
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const nextCv = $('next');
  const nextCtx = nextCv.getContext('2d');
  const heroCv = $('hero');
  const scoreEl = $('score');
  const bestEl = $('best');
  const overlays = { start: $('ovStart'), how: $('ovHow'), set: $('ovSet'), rank: $('ovRank'), mis: $('ovMis'), shop: $('ovShop'), pause: $('ovPause'), over: $('ovOver') };

  /* ===================================================================
     3. VẼ QUẢ (Canvas) - phong cách kawaii pastel
        paintFruit(ctx, level, r) vẽ quả tại gốc (0,0), bán kính r
     =================================================================== */
  function rng(seed) { // bộ sinh số ngẫu nhiên cố định để hoạ tiết không nhấp nháy
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function disc(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, PI2); }

  // Thân quả: gradient tròn + viền
  function bodyDisc(c, r, base, light, dark) {
    const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
    g.addColorStop(0, light);
    g.addColorStop(0.55, base);
    g.addColorStop(1, dark);
    disc(c, 0, 0, r);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = Math.max(1.2, r * 0.06);
    c.strokeStyle = dark;
    c.stroke();
  }

  function leaf(c, x, y, len, ang, fill, stroke) {
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.5, -len * 0.45, len, 0);
    c.quadraticCurveTo(len * 0.5, len * 0.45, 0, 0);
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = Math.max(1, len * 0.06);
    c.strokeStyle = stroke;
    c.stroke();
    c.restore();
  }

  function shine(c, r) { // vệt sáng bóng bẩy
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = '#fff';
    c.beginPath();
    c.ellipse(-r * 0.42, -r * 0.45, r * 0.2, r * 0.11, -0.75, 0, PI2);
    c.fill();
    c.beginPath();
    c.arc(-r * 0.2, -r * 0.64, r * 0.05, 0, PI2);
    c.fill();
    c.restore();
  }

  function face(c, r, o = {}) { // mắt + má hồng + miệng cười
    const y = (o.y ?? 0.1) * r;
    const ex = (o.ex ?? 0.3) * r;
    const es = Math.max(1.3, r * (o.es ?? 0.1));
    const col = o.color || '#4b3340';
    c.save();
    c.fillStyle = o.cheek || 'rgba(255,120,150,.45)';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(s * ex * 1.55, y + es * 1.9, es * 1.35, es * 0.9, 0, 0, PI2);
      c.fill();
    }
    if (o.happy) {
      c.strokeStyle = col;
      c.lineWidth = Math.max(1.2, es * 0.7);
      c.lineCap = 'round';
      for (const s of [-1, 1]) {
        c.beginPath();
        c.arc(s * ex, y + es * 0.5, es * 1.1, Math.PI * 1.1, Math.PI * 1.9);
        c.stroke();
      }
    } else {
      for (const s of [-1, 1]) {
        c.fillStyle = col;
        c.beginPath();
        c.ellipse(s * ex, y, es * 0.85, es * 1.1, 0, 0, PI2);
        c.fill();
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(s * ex - es * 0.28, y - es * 0.4, es * 0.38, 0, PI2);
        c.fill();
      }
    }
    c.strokeStyle = col;
    c.lineWidth = Math.max(1.1, es * 0.55);
    c.lineCap = 'round';
    c.beginPath();
    c.arc(0, y + es * 1.5, es * 1.25, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    c.restore();
  }

  function polyStar(c, x, y, R, rr, n, rot = -Math.PI / 2) {
    c.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = rot + (i * Math.PI) / n;
      const rad = i % 2 ? rr : R;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath();
  }

  function clipDisc(c, r) { disc(c, 0, 0, r); c.clip(); }

  const PAINT = [
    // 0. Việt quất
    (c, r) => {
      bodyDisc(c, r, '#7b8cf0', '#a9b6ff', '#4f5fc4');
      c.fillStyle = 'rgba(52,62,150,.55)';
      polyStar(c, 0, -r * 0.62, r * 0.22, r * 0.09, 5);
      c.fill();
      shine(c, r);
      face(c, r, { y: 0.12, es: 0.12 });
    },
    // 1. Cherry
    (c, r) => {
      c.strokeStyle = '#5f9a3a';
      c.lineWidth = Math.max(1.5, r * 0.1);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, -r * 0.9);
      c.quadraticCurveTo(r * 0.1, -r * 1.3, r * 0.45, -r * 1.35);
      c.stroke();
      leaf(c, r * 0.4, -r * 1.33, r * 0.6, -0.35, '#8fd36a', '#5f9a3a');
      bodyDisc(c, r, '#d9264d', '#f2607f', '#a3153a');
      shine(c, r);
      face(c, r, { y: 0.12 });
    },
    // 2. Kiwi (lát cắt)
    (c, r) => {
      bodyDisc(c, r, '#b08a5a', '#c9a674', '#7d5c35');
      const g = c.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.9);
      g.addColorStop(0, '#e6fa9c');
      g.addColorStop(1, '#8fcf4a');
      disc(c, 0, 0, r * 0.88);
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = 'rgba(240,255,190,.7)';
      c.lineWidth = Math.max(1, r * 0.03);
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * PI2;
        c.beginPath();
        c.moveTo(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34);
        c.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
        c.stroke();
      }
      disc(c, 0, 0, r * 0.3);
      c.fillStyle = '#f6ffd8';
      c.fill();
      c.fillStyle = '#3d2d28';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * PI2;
        c.save();
        c.translate(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58);
        c.rotate(a);
        c.beginPath();
        c.ellipse(0, 0, r * 0.075, r * 0.04, 0, 0, PI2);
        c.fill();
        c.restore();
      }
      shine(c, r);
      face(c, r, { y: 0.02, es: 0.085, ex: 0.2 });
    },
    // 3. Chanh vàng
    (c, r) => {
      leaf(c, r * 0.05, -r * 0.92, r * 0.55, -0.6, '#8fd36a', '#5f9a3a');
      bodyDisc(c, r, '#ffe45e', '#fff4a3', '#e8b923');
      const R = rng(3);
      c.fillStyle = 'rgba(232,185,35,.45)';
      for (let i = 0; i < 16; i++) {
        const a = R() * PI2, d = Math.sqrt(R()) * r * 0.85;
        disc(c, Math.cos(a) * d, Math.sin(a) * d, Math.max(0.6, r * 0.02));
        c.fill();
      }
      shine(c, r);
      face(c, r, { y: 0.12 });
    },
    // 4. Hồng
    (c, r) => {
      bodyDisc(c, r, '#ffa24d', '#ffcc8a', '#e07a1f');
      c.save();
      c.translate(0, -r * 0.8);
      for (let i = 0; i < 4; i++) {
        c.save();
        c.rotate(-Math.PI / 2 + (i - 1.5) * 0.62 + Math.PI / 2);
        c.beginPath();
        c.ellipse(0, -r * 0.1, r * 0.14, r * 0.3, 0, 0, PI2);
        c.fillStyle = '#6fcf6f';
        c.fill();
        c.strokeStyle = '#3f9a4a';
        c.lineWidth = Math.max(1, r * 0.035);
        c.stroke();
        c.restore();
      }
      c.fillStyle = '#7a5a3a';
      c.fillRect(-r * 0.05, -r * 0.3, r * 0.1, r * 0.22);
      c.restore();
      shine(c, r);
      face(c, r, { y: 0.14 });
    },
    // 5. Táo
    (c, r) => {
      c.strokeStyle = '#8a5a3a';
      c.lineWidth = Math.max(1.5, r * 0.07);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, -r * 0.75);
      c.quadraticCurveTo(r * 0.03, -r * 1.0, r * 0.12, -r * 1.18);
      c.stroke();
      leaf(c, r * 0.1, -r * 1.05, r * 0.55, -0.45, '#8fd36a', '#5f9a3a');
      bodyDisc(c, r, '#ff7a85', '#ffb0b6', '#d9485a');
      c.fillStyle = 'rgba(160,40,60,.35)';
      c.beginPath();
      c.ellipse(0, -r * 0.84, r * 0.2, r * 0.07, 0, 0, PI2);
      c.fill();
      shine(c, r);
      face(c, r, { y: 0.12 });
    },
    // 6. Đào
    (c, r) => {
      bodyDisc(c, r, '#ffb08f', '#ffe3cf', '#ef8a6a');
      c.save();
      clipDisc(c, r);
      const g = c.createRadialGradient(r * 0.55, r * 0.4, r * 0.05, r * 0.55, r * 0.4, r * 0.9);
      g.addColorStop(0, 'rgba(255,110,140,.45)');
      g.addColorStop(1, 'rgba(255,110,140,0)');
      c.fillStyle = g;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.restore();
      c.strokeStyle = 'rgba(214,100,80,.45)';
      c.lineWidth = Math.max(1, r * 0.04);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(r * 0.08, -r * 0.92);
      c.quadraticCurveTo(r * 0.7, -r * 0.3, r * 0.42, r * 0.55);
      c.stroke();
      leaf(c, -r * 0.02, -r * 0.92, r * 0.6, -0.55, '#8fd36a', '#5f9a3a');
      shine(c, r);
      face(c, r, { y: 0.12 });
    },
    // 7. Dừa
    (c, r) => {
      bodyDisc(c, r, '#9b6b43', '#c28d5d', '#6f4527');
      const R = rng(7);
      c.strokeStyle = 'rgba(70,40,20,.5)';
      c.lineWidth = Math.max(1, r * 0.025);
      c.lineCap = 'round';
      for (let i = 0; i < 46; i++) {
        const a = R() * PI2, d = r * (0.72 + R() * 0.24);
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(a + 0.6) * r * 0.1, y + Math.sin(a + 0.6) * r * 0.1);
        c.stroke();
      }
      disc(c, 0, 0, r * 0.7);
      const g = c.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.05, 0, 0, r * 0.7);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#fff0d6');
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = '#e6d2ae';
      c.lineWidth = Math.max(1, r * 0.04);
      c.stroke();
      shine(c, r);
      face(c, r, { y: 0.08, ex: 0.24, es: 0.095 });
    },
    // 8. Dưa lưới
    (c, r) => {
      bodyDisc(c, r, '#bfe8a8', '#e6f8d6', '#86c274');
      c.save();
      clipDisc(c, r * 0.97);
      c.strokeStyle = 'rgba(255,255,255,.6)';
      c.lineWidth = Math.max(1, r * 0.03);
      const step = r * 0.3;
      for (let k = -r * 2; k < r * 2; k += step) {
        c.beginPath(); c.moveTo(k, -r * 1.2); c.lineTo(k + r * 1.4, r * 1.2); c.stroke();
        c.beginPath(); c.moveTo(k, r * 1.2); c.lineTo(k + r * 1.4, -r * 1.2); c.stroke();
      }
      c.strokeStyle = 'rgba(90,160,95,.38)';
      c.lineWidth = Math.max(1, r * 0.05);
      for (const w of [0.35, 0.7]) {
        c.beginPath(); c.ellipse(0, 0, r * w, r, 0, 0, PI2); c.stroke();
      }
      c.restore();
      c.strokeStyle = '#5f9a4a';
      c.lineWidth = Math.max(1.5, r * 0.07);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, -r * 0.94); c.lineTo(r * 0.08, -r * 1.12); c.stroke();
      shine(c, r);
      face(c, r, { y: 0.1 });
    },
    // 9. Khóm
    (c, r) => {
      const cols = ['#4fb35a', '#6fd072'];
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.3;
        const tipR = r * (i % 2 ? 1.28 : 1.42);
        const bx = Math.cos(a) * r * 0.78, by = Math.sin(a) * r * 0.78;
        const tx = Math.cos(a) * tipR, ty = Math.sin(a) * tipR;
        const nx = -Math.sin(a) * r * 0.16, ny = Math.cos(a) * r * 0.16;
        c.beginPath();
        c.moveTo(bx + nx, by + ny);
        c.lineTo(tx, ty);
        c.lineTo(bx - nx, by - ny);
        c.closePath();
        c.fillStyle = cols[i % 2];
        c.fill();
        c.strokeStyle = '#37964a';
        c.lineWidth = Math.max(1, r * 0.03);
        c.stroke();
      }
      bodyDisc(c, r, '#ffd24d', '#ffe98a', '#e0a114');
      c.save();
      clipDisc(c, r * 0.97);
      c.strokeStyle = 'rgba(214,140,20,.5)';
      c.lineWidth = Math.max(1, r * 0.035);
      const step = r * 0.34;
      for (let k = -r * 2; k < r * 2; k += step) {
        c.beginPath(); c.moveTo(k, -r * 1.2); c.lineTo(k + r * 1.4, r * 1.2); c.stroke();
        c.beginPath(); c.moveTo(k, r * 1.2); c.lineTo(k + r * 1.4, -r * 1.2); c.stroke();
      }
      c.restore();
      shine(c, r);
      face(c, r, { y: 0.14 });
    },
    // 10. Dưa hấu (lát cắt)
    (c, r) => {
      bodyDisc(c, r, '#6cc57a', '#8be09a', '#3f9150');
      c.strokeStyle = 'rgba(40,130,60,.45)';
      c.lineWidth = Math.max(1, r * 0.03);
      c.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * PI2;
        c.beginPath();
        c.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
        c.lineTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
        c.stroke();
      }
      disc(c, 0, 0, r * 0.86);
      c.fillStyle = '#f4ffe9';
      c.fill();
      const g = c.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.05, 0, 0, r * 0.8);
      g.addColorStop(0, '#ffa0ab');
      g.addColorStop(1, '#ff5d73');
      disc(c, 0, 0, r * 0.78);
      c.fillStyle = g;
      c.fill();
      c.fillStyle = '#3a2a30';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * PI2 + 0.3;
        c.save();
        c.translate(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        c.rotate(a + Math.PI / 2);
        c.beginPath();
        c.ellipse(0, 0, r * 0.035, r * 0.07, 0, 0, PI2);
        c.fill();
        c.restore();
      }
      shine(c, r);
      face(c, r, { y: 0.06, ex: 0.26, es: 0.095 });
    },
    // 11. Dâu tây vàng: hình dâu tây thật (đầu rộng, đáy nhọn bo tròn), nằm gọn trong vòng tròn bán kính r
    (c, r) => {
      const top = -r * 0.62, bot = r * 0.98;
      const body = () => {
        c.beginPath();
        c.moveTo(0, top);
        c.bezierCurveTo(r * 0.62, top - r * 0.16, r * 1.0, top + r * 0.2, r * 0.94, r * 0.12);
        c.bezierCurveTo(r * 0.9, r * 0.62, r * 0.38, bot - r * 0.05, 0, bot);
        c.bezierCurveTo(-r * 0.38, bot - r * 0.05, -r * 0.9, r * 0.62, -r * 0.94, r * 0.12);
        c.bezierCurveTo(-r * 1.0, top + r * 0.2, -r * 0.62, top - r * 0.16, 0, top);
        c.closePath();
      };
      // hào quang nhẹ phía sau để dễ nhận ra quả vàng
      body();
      const g = c.createRadialGradient(-r * 0.3, -r * 0.2, r * 0.1, 0, r * 0.1, r * 1.15);
      g.addColorStop(0, '#fff3a6');
      g.addColorStop(0.5, '#ffcf3a');
      g.addColorStop(1, '#e48f00');
      c.fillStyle = g;
      c.fill();
      c.lineWidth = Math.max(1.4, r * 0.06);
      c.strokeStyle = '#d98200';
      c.stroke();
      // hạt dâu xếp so le, né vùng khuôn mặt
      c.save();
      body(); c.clip();
      let row = 0;
      for (let y = -r * 0.4; y < r * 0.95; y += r * 0.25, row++) {
        const half = Math.max(0, r * (0.9 - Math.max(0, (y - r * 0.1) / r) * 1.05));
        for (let x = -half + r * 0.12 + (row % 2) * r * 0.15; x < half - r * 0.08; x += r * 0.3) {
          if (Math.abs(x) < r * 0.55 && y > -r * 0.12 && y < r * 0.44) continue;
          c.save();
          c.translate(x, y);
          c.fillStyle = 'rgba(190,105,0,.85)';
          c.beginPath(); c.ellipse(0, 0, r * 0.045, r * 0.075, 0, 0, PI2); c.fill();
          c.fillStyle = 'rgba(255,248,200,.95)';
          c.beginPath(); c.ellipse(-r * 0.01, -r * 0.016, r * 0.018, r * 0.032, 0, 0, PI2); c.fill();
          c.restore();
        }
      }
      c.restore();
      // bóng sáng
      c.save();
      c.globalAlpha = 0.55; c.fillStyle = '#fff';
      c.beginPath(); c.ellipse(-r * 0.55, -r * 0.2, r * 0.13, r * 0.2, 0.5, 0, PI2); c.fill();
      c.beginPath(); c.arc(-r * 0.42, -r * 0.46, r * 0.045, 0, PI2); c.fill();
      c.restore();
      face(c, r, { y: 0.1, happy: true, es: 0.105, ex: 0.3 });
      // đài lá xanh phủ đỉnh quả
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) / ((n - 1) / 2);
        const a = -Math.PI / 2 + t * 1.15;
        const len = r * (0.5 - Math.abs(t) * 0.1);
        c.save();
        c.translate(Math.cos(a) * r * 0.22 * (1 + Math.abs(t)), top + r * 0.02 + Math.abs(t) * r * 0.06);
        c.rotate(a);
        c.beginPath();
        c.moveTo(0, -r * 0.1);
        c.quadraticCurveTo(len * 0.55, -r * 0.18, len, 0);
        c.quadraticCurveTo(len * 0.55, r * 0.18, 0, r * 0.1);
        c.closePath();
        c.fillStyle = i % 2 ? '#6fcf5a' : '#8fe06a';
        c.fill();
        c.strokeStyle = '#3f9a3a';
        c.lineWidth = Math.max(1, r * 0.035);
        c.stroke();
        c.restore();
      }
      c.strokeStyle = '#4f8a2a';
      c.lineWidth = Math.max(1.6, r * 0.075);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, top + r * 0.02);
      c.quadraticCurveTo(r * 0.03, top - r * 0.2, r * 0.14, top - r * 0.3);
      c.stroke();
    },
  ];

  /* ===================================================================
     3b. GIAO DIỆN QUẢ (SKIN) - đổi bằng điểm tích lũy từ nhiệm vụ ngày
         Skin càng cầu kỳ thì giá càng cao (xem SKINS bên dưới).
     =================================================================== */
  const SKINS = [
    { id: 'default', name: 'Mặc định', desc: 'Trái cây kawaii nguyên bản', price: 0 },
    { id: 'jelly', name: 'Thạch rau câu', desc: 'Trong veo, mềm mịn', price: 100 },
    { id: 'candy', name: 'Kẹo ngọt', desc: 'Kẹo sọc nhiều màu', price: 200 },
    { id: 'cookie', name: 'Bánh quy', desc: 'Phủ kem, rắc cốm', price: 350 },
    { id: 'star', name: 'Ánh sao', desc: 'Lấp lánh như dải ngân hà', price: 600 },
  ];
  let skinId = 'default';
  // 12 màu riêng biệt (xếp theo cấp quả) để vẫn phân biệt được từng loại khi đổi skin
  const SKIN_PAL = ['#8fa4ff', '#ff6b8a', '#9be15d', '#ffdf4d', '#ff9f43', '#f06bd0',
                    '#ffb199', '#b5835a', '#5fd8bd', '#b79bff', '#4fc3f7', '#ffc933'];
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function tint(hex, t) { // t > 0: sáng hơn, t < 0: tối hơn
    const [r, g, b] = hexRgb(hex), k = t >= 0 ? 255 : 0, a = Math.abs(t);
    return `rgb(${Math.round(r + (k - r) * a)},${Math.round(g + (k - g) * a)},${Math.round(b + (k - b) * a)})`;
  }
  function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  const SKIN_PAINT = {
    // Thạch rau câu: trong veo, có bọt khí nhỏ bên trong
    jelly(c, lv, r) {
      const col = SKIN_PAL[lv];
      const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.08, 0, 0, r * 1.02);
      g.addColorStop(0, tint(col, 0.7)); g.addColorStop(0.55, col); g.addColorStop(1, tint(col, -0.2));
      disc(c, 0, 0, r);
      c.fillStyle = g; c.fill();
      c.lineWidth = Math.max(1.2, r * 0.06); c.strokeStyle = tint(col, -0.28); c.stroke();
      const R = rng(lv * 31 + 5);
      c.fillStyle = 'rgba(255,255,255,.4)';
      for (let i = 0; i < 6; i++) {
        const a = R() * PI2, d = Math.sqrt(R()) * r * 0.65;
        disc(c, Math.cos(a) * d, Math.sin(a) * d, r * (0.03 + R() * 0.05)); c.fill();
      }
      c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = r * 0.07; c.lineCap = 'round';
      c.beginPath(); c.arc(0, 0, r * 0.8, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
      shine(c, r);
      face(c, r, { y: 0.1 });
    },
    // Kẹo ngọt: sọc xoáy trắng
    candy(c, lv, r) {
      const col = SKIN_PAL[lv];
      bodyDisc(c, r, col, tint(col, 0.5), tint(col, -0.25));
      c.save(); clipDisc(c, r * 0.97);
      c.fillStyle = 'rgba(255,255,255,.4)';
      for (let i = 0; i < 8; i++) {
        c.beginPath(); c.moveTo(0, 0);
        c.arc(0, 0, r * 1.2, i * Math.PI / 4 + 0.2, i * Math.PI / 4 + 0.2 + Math.PI / 8);
        c.closePath(); c.fill();
      }
      c.restore();
      disc(c, 0, 0, r * 0.9); c.lineWidth = Math.max(1, r * 0.04); c.strokeStyle = 'rgba(255,255,255,.55)'; c.stroke();
      disc(c, 0, r * 0.12, r * 0.5); c.fillStyle = 'rgba(255,255,255,.5)'; c.fill();
      shine(c, r);
      face(c, r, { y: 0.1 });
    },
    // Bánh quy: nền bánh nâu, phủ kem màu, rắc cốm
    cookie(c, lv, r) {
      const col = SKIN_PAL[lv];
      bodyDisc(c, r, '#e3b27a', '#f6d3a2', '#b4793f');
      c.fillStyle = 'rgba(150,95,45,.35)';
      for (let i = 0; i < 18; i++) { const a = i / 18 * PI2; disc(c, Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93, r * 0.035); c.fill(); }
      const g = c.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 0.8);
      g.addColorStop(0, tint(col, 0.55)); g.addColorStop(1, tint(col, 0.05));
      disc(c, 0, 0, r * 0.8); c.fillStyle = g; c.fill();
      c.lineWidth = Math.max(1, r * 0.04); c.strokeStyle = tint(col, -0.2); c.stroke();
      const R = rng(lv * 17 + 3), sc = ['#fff', '#ffe27a', '#ff8fb1', '#8fd8ff'];
      for (let i = 0; i < 9; i++) {
        const a = R() * PI2, d = r * (0.58 + R() * 0.14);
        c.save(); c.translate(Math.cos(a) * d, Math.sin(a) * d); c.rotate(R() * Math.PI);
        c.fillStyle = sc[i % 4]; c.fillRect(-r * 0.07, -r * 0.022, r * 0.14, r * 0.044); c.restore();
      }
      c.fillStyle = '#7a4a28';
      for (let i = 0; i < 6; i++) { const a = i / 6 * PI2 + 0.4; disc(c, Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88, r * 0.05); c.fill(); }
      shine(c, r);
      face(c, r, { y: 0.1 });
    },
    // Ánh sao: nền thiên hà tối, viền phát sáng theo màu từng quả
    star(c, lv, r) {
      const col = SKIN_PAL[lv];
      const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.05);
      g.addColorStop(0, '#5d58c4'); g.addColorStop(0.6, '#34307d'); g.addColorStop(1, '#1f1d52');
      disc(c, 0, 0, r); c.fillStyle = g; c.fill();
      c.save(); clipDisc(c, r);
      const neb = c.createRadialGradient(r * 0.35, r * 0.4, r * 0.05, r * 0.35, r * 0.4, r * 0.9);
      neb.addColorStop(0, rgba(col, 0.55)); neb.addColorStop(1, rgba(col, 0));
      c.fillStyle = neb; c.fillRect(-r, -r, r * 2, r * 2);
      const R = rng(lv * 13 + 1);
      c.fillStyle = '#fff';
      for (let i = 0; i < 12; i++) {
        const a = R() * PI2, d = Math.sqrt(R()) * r * 0.9;
        polyStar(c, Math.cos(a) * d, Math.sin(a) * d, r * (0.04 + R() * 0.05), r * 0.015, 4);
        c.globalAlpha = 0.5 + R() * 0.5; c.fill();
      }
      c.globalAlpha = 1; c.restore();
      c.save();
      c.shadowColor = col; c.shadowBlur = r * 0.4;
      disc(c, 0, 0, r * 0.97); c.lineWidth = Math.max(1.5, r * 0.07); c.strokeStyle = col; c.stroke();
      c.restore();
      if (lv !== GOLD) { polyStar(c, 0, -r * 0.55, r * 0.2, r * 0.085, 5); c.fillStyle = tint(col, 0.45); c.fill(); }
      shine(c, r);
      face(c, r, { y: 0.14, color: '#ffeaa8', cheek: rgba(col, 0.5) });
    },
  };

  function paintSkin(c, id, level, r) {
    c.save();
    c.lineJoin = 'round';
    SKIN_PAINT[id](c, level, r);
    if (level === GOLD) { // quả vàng luôn có sao vương miện
      polyStar(c, 0, -r * 0.84, r * 0.2, r * 0.09, 5);
      c.fillStyle = '#fff3a0'; c.fill(); c.lineWidth = Math.max(1, r * 0.03); c.strokeStyle = '#d99a00'; c.stroke();
    }
    c.restore();
  }

  function paintFruit(c, level, r, forceSkin) {
    const id = forceSkin || skinId;
    if (id !== 'default' && SKIN_PAINT[id]) { paintSkin(c, id, level, r); return; }
    c.save();
    c.lineJoin = 'round';
    PAINT[level](c, r);
    c.restore();
  }

  /* --- Sprite cache: vẽ mỗi loại quả 1 lần vào canvas phụ cho nhanh --- */
  let spriteScale = 1;
  let sprites = [];
  function buildSprites() {
    spriteScale = canvas.width / CFG.W;
    sprites = CFG.RADII.map((r, level) => {
      const half = Math.ceil(r * 1.5 + 3);
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(half * 2 * spriteScale);
      cv.height = cv.width;
      const c = cv.getContext('2d');
      c.scale(spriteScale, spriteScale);
      c.translate(half, half);
      paintFruit(c, level, r);
      return { cv, half };
    });
    buildEvo();
  }

  /* Thanh tiến hoá dưới khung: 12 quả nhỏ + mũi tên, quả cuối là bóng đen "?" */
  const EVO = { R: 10, Y: 782, PITCH: 32 };
  let evo = [];
  function buildEvo() {
    const s = spriteScale, half = 20;
    evo = CFG.RADII.map((_, level) => {
      const mk = (secret) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = Math.ceil(half * 2 * s);
        const c = cv.getContext('2d');
        c.scale(s, s); c.translate(half, half);
        paintFruit(c, level, EVO.R);
        if (secret) { c.globalCompositeOperation = 'source-in'; c.fillStyle = '#3d2b3d'; c.fillRect(-half, -half, half * 2, half * 2); }
        return cv;
      };
      return { cv: mk(false), dark: level === GOLD ? mk(true) : null, half };
    });
  }

  /* ===================================================================
     4. TRẠNG THÁI GAME
     =================================================================== */
  const state = {
    mode: 'start',        // start | play | pause | over
    score: 0,
    best: loadBest(),
    hand: null,           // { level }
    nextLevel: 0,
    handX: CFG.W / 2,
    nextHandAt: 0,
    pendingClear: 0,      // giây còn lại trước khi pháo hoa xoá quả
    danger: 0,            // giây đã ở trạng thái nguy hiểm
    flash: 0,
    flashCol: '255,255,255',
    shake: 0,
    combo: 0,
    lastMergeAt: -1e9,
    bestCombo: 0,
    newRecord: false,
    dangerStep: 0,
    lastRank: 0,
  };
  let gt = 0;               // đồng hồ game (ms), chỉ chạy khi đang chơi
  let fxTime = 0;           // đồng hồ hiệu ứng (s)
  let overTimeout = 0;

  function loadBest() {
    try { return parseInt(localStorage.getItem('fruitopia.best') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('fruitopia.best', String(v)); } catch (e) { /* bỏ qua */ }
  }

  /* ===================================================================
     4b. ÂM THANH (Web Audio API)
         - Nhạc nền lofi không lời được TỔNG HỢP bằng code (không cần file mp3)
         - Mỗi cấp quả có tiếng "bong bóng" riêng, độ cao tăng dần
         Muốn dùng file nhạc riêng (mp3/ogg): điền tên file vào MUSIC_FILE bên dưới
         (nên chạy qua máy chủ web, mở thẳng file:// có thể không phát được).
     =================================================================== */
  const Sound = (() => {
    const KEY = 'fruitopia.audio';
    const cfg = { musicOn: true, sfxOn: true, musicVol: 0.6, sfxVol: 0.8 };
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && typeof o === 'object') {
        if (typeof o.musicOn === 'boolean') cfg.musicOn = o.musicOn;
        if (typeof o.sfxOn === 'boolean') cfg.sfxOn = o.sfxOn;
        if (typeof o.musicVol === 'number') cfg.musicVol = Math.max(0, Math.min(1, o.musicVol));
        if (typeof o.sfxVol === 'number') cfg.sfxVol = Math.max(0, Math.min(1, o.sfxVol));
      }
    } catch (e) { /* bỏ qua */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* bỏ qua */ } };

    // ----- Cấu hình nhạc -----
    const BPM = 74, BEAT = 60 / BPM, BAR = BEAT * 4, EIGHTH = BEAT / 2, SWING = 0.2;
    const MUSIC_GAIN = 0.95;     // độ to tổng của nhạc nền
    const SFX_GAIN = 1.0;        // độ to tổng của hiệu ứng
    const MUSIC_FILE = '';       // ví dụ 'lofi.mp3'. Để trống = dùng nhạc lofi tổng hợp
    let fileEl = null;
    const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const eighthTime = (t, i) => t + i * EIGHTH + (i % 2 ? EIGHTH * SWING : 0);

    const CHORDS = {
      Cmaj7: { root: 36, pad: [55, 59, 62, 64] },
      Am7:   { root: 33, pad: [55, 60, 64, 67] },
      Dm7:   { root: 38, pad: [53, 57, 60, 64] },
      G7:    { root: 43, pad: [53, 59, 62, 67] },
      Fmaj7: { root: 41, pad: [52, 57, 60, 65] },
      Em7:   { root: 40, pad: [55, 59, 62, 64] },
    };
    const PROGS = [
      ['Cmaj7', 'Am7', 'Dm7', 'G7'],
      ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'],
      ['Am7', 'Dm7', 'G7', 'Cmaj7'],
      ['Fmaj7', 'G7', 'Em7', 'Am7'],
    ];
    const MELODY_SCALE = [67, 69, 72, 74, 76, 79, 81, 84]; // ngũ cung C
    const SFX_NOTES = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 88];

    // ----- Dựng đồ thị âm thanh (dùng được cho cả AudioContext thật và OfflineAudioContext để test) -----
    function buildGraph(ctx) {
      const g = { ctx };
      g.master = ctx.createGain();
      g.master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 4;
      comp.attack.value = 0.01; comp.release.value = 0.2;
      g.master.connect(comp); comp.connect(ctx.destination);

      g.musicBus = ctx.createGain(); g.musicBus.gain.value = 0;
      g.sfxBus = ctx.createGain(); g.sfxBus.gain.value = 0;
      g.musicBus.connect(g.master); g.sfxBus.connect(g.master);

      // nhạc cụ -> tone (lowpass ấm) -> musicBus
      g.tone = ctx.createBiquadFilter();
      g.tone.type = 'lowpass'; g.tone.frequency.value = 2800; g.tone.Q.value = 0.4;
      g.tone.connect(g.musicBus);

      // echo mềm kiểu băng từ
      g.delay = ctx.createDelay(1.5);
      g.delay.delayTime.value = BEAT * 0.75;
      const fb = ctx.createGain(); fb.gain.value = 0.32;
      const dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 1700;
      g.delaySend = ctx.createGain(); g.delaySend.gain.value = 0.28;
      g.delaySend.connect(g.delay); g.delay.connect(dTone);
      dTone.connect(fb); fb.connect(g.delay); dTone.connect(g.musicBus);

      // bộ đệm nhiễu trắng dùng chung (trống, tiếng xì, vinyl)
      const len = Math.floor(ctx.sampleRate * 2);
      const nb = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      g.noise = nb;

      // "wobble" nhẹ của băng cassette
      g.lfo = ctx.createOscillator(); g.lfo.frequency.value = 0.55;
      g.wob = ctx.createGain(); g.wob.gain.value = 7;
      g.lfo.connect(g.wob); g.lfo.start();
      return g;
    }

    // ----- Khối xây dựng -----
    function voice(g, type, freq, t, o) {
      const c = g.ctx, osc = c.createOscillator(), v = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      if (o.detune) osc.detune.value = o.detune;
      const a = o.a !== undefined ? o.a : 0.01, hold = o.hold || 0, rel = o.rel !== undefined ? o.rel : 0.3, peak = o.peak !== undefined ? o.peak : 0.1;
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(peak, t + a);
      v.gain.setValueAtTime(peak, t + a + hold);
      v.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
      osc.connect(v);
      v.connect(o.dest || g.tone);
      if (o.send) { const s = c.createGain(); s.gain.value = o.send; v.connect(s); s.connect(g.delaySend); }
      if (o.wobble) {
        g.wob.connect(osc.detune);
        osc.onended = () => { try { g.wob.disconnect(osc.detune); } catch (e) { /* bỏ qua */ } };
      }
      osc.start(t);
      osc.stop(t + a + hold + rel + 0.05);
    }

    function noise(g, t, dur, o) {
      const c = g.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), v = c.createGain();
      s.buffer = g.noise;
      f.type = o.type || 'highpass';
      f.frequency.setValueAtTime(o.f0 || 5000, t);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
      f.Q.value = o.q || 0.7;
      const a = o.a || 0.003;
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(o.peak || 0.1, t + a);
      v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(v); v.connect(o.dest || g.tone);
      s.start(t, Math.random() * 1.4, dur + 0.05);
    }

    function sweep(g, t, f0, f1, dur, type, peak, dest) {
      const c = g.ctx, o = c.createOscillator(), v = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(v); v.connect(dest || g.sfxBus);
      o.start(t); o.stop(t + dur + 0.03);
    }

    // ----- Nhạc nền -----
    function pad(g, t, ch) {
      ch.pad.forEach((n, i) => {
        const tt = t + i * 0.015;
        voice(g, 'sine', mtof(n), tt, { a: 0.6, hold: BAR * 0.7, rel: 1.4, peak: 0.06, send: 0.35, wobble: true, detune: -4 });
        voice(g, 'triangle', mtof(n), tt, { a: 0.7, hold: BAR * 0.7, rel: 1.4, peak: 0.028, wobble: true, detune: 6 });
      });
    }
    function bass(g, t, ch) {
      const f = mtof(ch.root + 12); // nâng 1 quãng tám để loa điện thoại vẫn nghe được
      voice(g, 'sine', f, t, { a: 0.012, hold: BEAT * 1.4, rel: 0.35, peak: 0.17 });
      voice(g, 'sine', f / 2, t, { a: 0.02, hold: BEAT * 1.2, rel: 0.35, peak: 0.06 });
      voice(g, 'triangle', f * 2, t, { a: 0.012, hold: BEAT * 0.6, rel: 0.25, peak: 0.05 });
      voice(g, 'sine', f, eighthTime(t, 5), { a: 0.012, hold: BEAT * 0.5, rel: 0.3, peak: 0.13 });
      if (Math.random() < 0.5) voice(g, 'sine', f * 1.5, eighthTime(t, 7), { a: 0.012, hold: BEAT * 0.25, rel: 0.25, peak: 0.1 });
    }
    function ep(g, t, midi, vel) { // đàn Rhodes
      const f = mtof(midi);
      voice(g, 'sine', f, t, { a: 0.004, rel: 1.1, peak: 0.3 * vel, send: 0.55, wobble: true });
      voice(g, 'sine', f * 2, t, { a: 0.003, rel: 0.3, peak: 0.11 * vel, send: 0.3 });
      voice(g, 'triangle', f, t, { a: 0.004, rel: 0.5, peak: 0.09 * vel });
    }
    function kick(g, t, vel) {
      const c = g.ctx, o = c.createOscillator(), v = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(165, t);
      o.frequency.exponentialRampToValueAtTime(58, t + 0.12);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.005);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(v); v.connect(g.tone);
      o.start(t); o.stop(t + 0.35);
    }
    function drums(g, t, barNo) {
      if (barNo < 1) return; // ô nhịp đầu chỉ có hợp âm cho êm
      const hatVel = [1, 0.45, 0.7, 0.45, 0.95, 0.45, 0.7, 0.55];
      for (let i = 0; i < 8; i++) {
        const tt = eighthTime(t, i);
        if (Math.random() > 0.12) noise(g, tt, 0.05, { type: 'highpass', f0: 6500, peak: 0.07 * hatVel[i] * rnd(0.8, 1.1), dest: g.musicBus });
        if (i === 2 || i === 6) {
          noise(g, tt, 0.17, { type: 'bandpass', f0: 1700, q: 0.8, peak: 0.22 });
          voice(g, 'sine', 185, tt, { a: 0.002, rel: 0.1, peak: 0.06 });
        }
      }
      kick(g, t, 1);
      if (Math.random() < 0.8) kick(g, eighthTime(t, 3), 0.7);
      if (Math.random() < 0.3) kick(g, eighthTime(t, 7), 0.45);
    }
    function melody(g, t, barNo, mem) {
      if (barNo < 2 || Math.random() < 0.22) return;
      const slots = [0, 2, 3, 4, 6, 7].sort(() => Math.random() - 0.5);
      const chosen = slots.slice(0, pick([2, 3, 3, 4])).sort((a, b) => a - b);
      for (const s of chosen) {
        mem.i = Math.max(0, Math.min(MELODY_SCALE.length - 1, mem.i + pick([-2, -1, -1, 0, 1, 1, 2])));
        ep(g, eighthTime(t, s), MELODY_SCALE[mem.i], rnd(0.55, 0.95));
      }
    }
    function clicks(g, t) { // tiếng "lách tách" của đĩa than
      for (let k = 0; k < 5; k++) noise(g, t + Math.random() * BAR, 0.006, { type: 'highpass', f0: 2500, peak: rnd(0.02, 0.06), a: 0.0005, dest: g.musicBus });
    }
    function startHiss(g) {
      const c = g.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), v = c.createGain();
      s.buffer = g.noise; s.loop = true;
      f.type = 'highpass'; f.frequency.value = 3500;
      v.gain.value = 0.0045;
      s.connect(f); f.connect(v); v.connect(g.musicBus);
      s.start(0);
      g.hiss = s;
    }
    function scheduleBar(g, t, barNo, mem) {
      const prog = PROGS[Math.floor(barNo / 4) % PROGS.length];
      const ch = CHORDS[prog[barNo % 4]];
      pad(g, t, ch); bass(g, t, ch); drums(g, t, barNo); melody(g, t, barNo, mem); clicks(g, t);
    }

    // ----- Hiệu ứng âm thanh -----
    function sfxMerge(g, t, level) {
      level = Math.max(1, Math.min(11, level));
      if (level === 11) return sfxGold(g, t);
      const f0 = mtof(SFX_NOTES[level]);
      const mid = level >= 4, big = level >= 7, dur = 0.16 + level * 0.02;
      sweep(g, t, f0 * 0.6, f0 * 1.3, dur, mid ? 'triangle' : 'sine', 0.42);
      voice(g, 'sine', f0 * 2, t + 0.01, { a: 0.004, rel: dur * 0.6, peak: 0.1, dest: g.sfxBus });
      if (mid) sweep(g, t + 0.075, f0 * 0.9, f0 * 1.95, dur * 0.8, 'sine', 0.22);
      if (big) {
        voice(g, 'sine', f0 * 0.5, t, { a: 0.01, rel: 0.35, peak: 0.3, dest: g.sfxBus });
        sweep(g, t + 0.15, f0 * 1.2, f0 * 2.6, dur * 0.6, 'sine', 0.15);
      }
    }
    function sfxGold(g, t) {
      [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => {
        const tt = t + i * 0.07, f = mtof(n);
        voice(g, 'triangle', f, tt, { a: 0.004, rel: 0.5, peak: 0.2, dest: g.sfxBus });
        voice(g, 'sine', f * 2, tt, { a: 0.004, rel: 0.35, peak: 0.07, dest: g.sfxBus });
      });
      sweep(g, t, mtof(60) * 0.6, mtof(60) * 1.3, 0.4, 'sine', 0.35);
      noise(g, t + 0.3, 0.5, { type: 'highpass', f0: 6000, peak: 0.08, a: 0.05, dest: g.sfxBus });
    }
    function sfxDrop(g, t) {
      const c = g.ctx, o = c.createOscillator(), v = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.07);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(v); v.connect(g.sfxBus);
      o.start(t); o.stop(t + 0.15);
    }
    function sfxThud(g, t, vol) {
      const c = g.ctx, o = c.createOscillator(), v = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(170, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(v); v.connect(g.sfxBus);
      o.start(t); o.stop(t + 0.16);
    }
    function sfxWarn(g, t, n) {
      voice(g, 'triangle', n <= 1 ? 1175 : 880, t, { a: 0.004, rel: 0.13, peak: 0.22, dest: g.sfxBus });
    }
    function sfxOver(g, t) {
      [72, 69, 65, 60].forEach((n, i) => voice(g, 'triangle', mtof(n), t + i * 0.18, { a: 0.01, rel: 0.55, peak: 0.22, dest: g.sfxBus }));
      voice(g, 'sine', mtof(36), t + 0.7, { a: 0.02, rel: 0.9, peak: 0.28, dest: g.sfxBus });
    }
    function sfxFireworks(g, t) {
      noise(g, t, 0.5, { type: 'bandpass', f0: 500, f1: 3500, q: 1.2, peak: 0.16, a: 0.2, dest: g.sfxBus });
      for (let k = 0; k < 8; k++) {
        const tt = t + 0.5 + k * 0.1;
        noise(g, tt, 0.09, { type: 'highpass', f0: 1800, peak: 0.2, dest: g.sfxBus });
        voice(g, 'sine', mtof(pick([84, 88, 91, 96])), tt, { a: 0.004, rel: 0.3, peak: 0.07, dest: g.sfxBus });
      }
    }
    function sfxClick(g, t) { sweep(g, t, 420, 900, 0.07, 'sine', 0.16); }
    function sfxCombo(g, t, n) { // chuông lấp lánh, càng nhiều combo càng cao
      n = Math.max(1, Math.min(n, 8));
      const base = 72 + [0, 2, 4, 7, 9, 12, 14, 16][n - 1];
      [0, 7, 12].forEach((iv, i) => {
        const tt = t + i * 0.055, f = mtof(base + iv);
        voice(g, 'triangle', f, tt, { a: 0.004, rel: 0.35, peak: 0.18, dest: g.sfxBus });
        voice(g, 'sine', f * 2, tt, { a: 0.004, rel: 0.25, peak: 0.06, dest: g.sfxBus });
      });
    }
    function sfxBoom(g, t) { // tiếng nổ khi thua
      noise(g, t, 0.6, { type: 'lowpass', f0: 1800, f1: 120, q: 0.8, peak: 0.35, a: 0.01, dest: g.sfxBus });
      const c = g.ctx, o = c.createOscillator(), v = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(34, t + 0.45);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(v); v.connect(g.sfxBus);
      o.start(t); o.stop(t + 0.6);
    }
    function sfxReward(g, t) { // chuông nhỏ khi hoàn thành nhiệm vụ
      [76, 79, 84, 88].forEach((n, i) => {
        const tt = t + i * 0.09, f = mtof(n);
        voice(g, 'triangle', f, tt, { a: 0.004, rel: 0.45, peak: 0.2, dest: g.sfxBus });
        voice(g, 'sine', f * 2, tt, { a: 0.004, rel: 0.3, peak: 0.06, dest: g.sfxBus });
      });
    }

    // ----- Điều khiển (API công khai) -----
    let G = null, timer = 0, nextBar = 0, barNo = 0, duck = 1, mem = { i: 3 }, lastThud = 0;

    function applyGains(fast) {
      if (!G) return;
      const now = G.ctx.currentTime, tc = fast ? 0.01 : 0.06;
      G.musicBus.gain.setTargetAtTime(cfg.musicOn ? Math.pow(cfg.musicVol, 1.6) * MUSIC_GAIN * duck : 0, now, tc);
      G.sfxBus.gain.setTargetAtTime(cfg.sfxOn ? Math.pow(cfg.sfxVol, 1.3) * SFX_GAIN : 0, now, tc);
    }
    function init() {
      if (G) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { G = buildGraph(new AC()); } catch (e) { G = null; return false; }
      applyGains(true);
      return true;
    }
    function tick() {
      if (!G) return;
      while (nextBar < G.ctx.currentTime + 1.2) { scheduleBar(G, nextBar, barNo++, mem); nextBar += BAR; }
    }
    function startMusic() {
      if (!G || timer) return;
      if (MUSIC_FILE) { // dùng file nhạc có sẵn
        if (!fileEl) {
          fileEl = new Audio(MUSIC_FILE);
          fileEl.loop = true;
          G.ctx.createMediaElementSource(fileEl).connect(G.musicBus);
        }
        fileEl.play().catch(() => {});
        timer = -1;
        return;
      }
      barNo = 0; mem = { i: 3 };
      nextBar = G.ctx.currentTime + 0.15;
      startHiss(G);
      timer = setInterval(tick, 120);
      tick();
    }
    function stopMusic() {
      if (fileEl) fileEl.pause();
      if (timer) { clearInterval(timer); timer = 0; }
      if (G && G.hiss) { try { G.hiss.stop(); } catch (e) { /* bỏ qua */ } G.hiss = null; }
    }
    function play(fn, a, b) {
      if (!G || !cfg.sfxOn || G.ctx.state !== 'running') return;
      try { fn(G, G.ctx.currentTime + 0.005, a, b); } catch (e) { /* bỏ qua */ }
    }

    document.addEventListener('visibilitychange', () => {
      if (!G) return;
      if (document.hidden) G.ctx.suspend().catch(() => {});
      else G.ctx.resume().catch(() => {});
    });

    return {
      cfg,
      get running() { return !!G && G.ctx.state === 'running'; },
      get ctxState() { return G ? G.ctx.state : 'none'; },
      unlock() { // gọi trong lần chạm/bấm đầu tiên (trình duyệt chặn autoplay)
        if (!init()) return;
        if (G.ctx.state !== 'running') G.ctx.resume().catch(() => {});
        if (cfg.musicOn) startMusic();
      },
      setMusicOn(b) {
        cfg.musicOn = !!b; save(); applyGains();
        if (!G) return;
        if (cfg.musicOn) startMusic();
        else setTimeout(() => { if (!cfg.musicOn) stopMusic(); }, 400);
      },
      setSfxOn(b) { cfg.sfxOn = !!b; save(); applyGains(); },
      setMusicVol(v) { cfg.musicVol = Math.max(0, Math.min(1, v)); save(); applyGains(); },
      setSfxVol(v) { cfg.sfxVol = Math.max(0, Math.min(1, v)); save(); applyGains(); },
      setDuck(x) { duck = x; applyGains(); },
      drop() { play(sfxDrop); },
      merge(level) { play(sfxMerge, level); },
      fireworks() { play(sfxFireworks); },
      thud(speed) {
        const now = performance.now();
        if (now - lastThud < 70) return;
        lastThud = now;
        play(sfxThud, Math.min(0.3, 0.04 + speed * 0.03));
      },
      warn(n) { play(sfxWarn, n); },
      over() { play(sfxOver); },
      click() { play(sfxClick); },
      reward() { play(sfxReward); },
      combo(n) { play(sfxCombo, n); },
      boom() { play(sfxBoom); },
      preview() { play(sfxMerge, 3); },
      // Kiểm thử: dựng nhạc/SFX bằng OfflineAudioContext rồi trả về PCM 16-bit (base64)
      async renderTest(kind, seconds) {
        const sr = 44100, oc = new OfflineAudioContext(1, Math.floor(sr * seconds), sr), g = buildGraph(oc);
        g.musicBus.gain.value = Math.pow(0.6, 1.6) * MUSIC_GAIN;
        g.sfxBus.gain.value = Math.pow(0.8, 1.3) * SFX_GAIN;
        if (kind === 'music') {
          const m = { i: 3 };
          startHiss(g);
          for (let b = 0; b * BAR < seconds; b++) scheduleBar(g, 0.05 + b * BAR, b, m);
        } else {
          for (let l = 1; l <= 11; l++) sfxMerge(g, 0.2 + (l - 1) * 0.8, l);
          sfxDrop(g, 9.2); sfxThud(g, 9.8, 0.25); sfxWarn(g, 10.3, 3); sfxWarn(g, 10.8, 1); sfxOver(g, 11.3); sfxFireworks(g, 13.0); sfxClick(g, 15.2);
        }
        const buf = await oc.startRendering();
        const ch = buf.getChannelData(0), pcm = new Int16Array(ch.length);
        let peak = 0, nan = 0;
        for (let i = 0; i < ch.length; i++) {
          const x = ch[i];
          if (x !== x) { nan++; pcm[i] = 0; continue; }
          peak = Math.max(peak, Math.abs(x));
          pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
        }
        let bin = '';
        const u8 = new Uint8Array(pcm.buffer);
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return { sr, peak, nan, pcm: btoa(bin) };
      },
    };
  })();

  /* ===================================================================
     4c. HỒ SƠ NGƯỜI CHƠI: top 5 điểm cao, nhiệm vụ mỗi ngày, điểm tích lũy, skin
         Tất cả lưu trong localStorage (khoá 'fruitopia.profile').
     =================================================================== */
  const Profile = (() => {
    const KEY = 'fruitopia.profile';
    const BONUS = 30; // thưởng thêm khi hoàn thành đủ 3 nhiệm vụ trong ngày
    // Danh sách nhiệm vụ. type: make = tạo quả cấp `level`; score = đạt điểm trong 1 ván;
    // games = chơi xong N ván; merges = ghép N lần. Nhiệm vụ khó thì thưởng cao hơn.
    const POOL = [
      { id: 'games3', type: 'games', target: 3, reward: 20, text: 'Chơi xong 3 ván' },
      { id: 'merge40', type: 'merges', target: 40, reward: 25, text: 'Ghép quả 40 lần' },
      { id: 'lemon8', type: 'make', level: 3, target: 8, reward: 25, text: 'Tạo 8 quả chanh vàng' },
      { id: 'apple5', type: 'make', level: 5, target: 5, reward: 30, text: 'Tạo 5 quả táo' },
      { id: 'score500', type: 'score', target: 500, reward: 30, text: 'Đạt 500 điểm trong một ván' },
      { id: 'peach4', type: 'make', level: 6, target: 4, reward: 35, text: 'Tạo 4 quả đào' },
      { id: 'melon3', type: 'make', level: 8, target: 3, reward: 40, text: 'Tạo 3 quả dưa lưới' },
      { id: 'coconut3', type: 'make', level: 7, target: 3, reward: 40, text: 'Tạo 3 quả dừa' },
      { id: 'pine3', type: 'make', level: 9, target: 3, reward: 45, text: 'Tạo 3 quả khóm' },
      { id: 'score1000', type: 'score', target: 1000, reward: 50, text: 'Đạt 1000 điểm trong một ván' },
      { id: 'wmelon2', type: 'make', level: 10, target: 2, reward: 50, text: 'Tạo 2 quả dưa hấu' },
      { id: 'combo3', type: 'combo', target: 3, reward: 40, text: 'Tạo combo x3 (ghép liền 3 lần)' },
      { id: 'gold1', type: 'make', level: 11, target: 1, reward: 90, text: 'Tạo 1 quả dâu tây vàng' },
    ];
    const EASY = ['games3', 'merge40', 'lemon8', 'apple5', 'score500']; // mỗi ngày luôn có 1 nhiệm vụ dễ
    const byId = {};
    POOL.forEach((m) => { byId[m.id] = m; });

    const data = { points: 0, owned: ['default'], skin: 'default', scores: [], daily: null };
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && typeof o === 'object') {
        if (typeof o.points === 'number' && o.points >= 0) data.points = Math.floor(o.points);
        if (Array.isArray(o.owned)) data.owned = ['default'].concat(o.owned.filter((id) => id !== 'default' && SKINS.some((s) => s.id === id)));
        if (typeof o.skin === 'string' && data.owned.includes(o.skin)) data.skin = o.skin;
        if (Array.isArray(o.scores)) {
          data.scores = o.scores.filter((e) => e && typeof e.s === 'number' && DIFFICULTY[e.d]).slice(0, 5)
            .map((e) => ({ s: e.s, d: e.d, t: typeof e.t === 'number' ? e.t : 0 }));
        }
        const d = o.daily;
        if (d && typeof d.date === 'string' && Array.isArray(d.ids) && d.ids.length === 3 && d.ids.every((id) => byId[id])) {
          data.daily = { date: d.date, ids: d.ids, prog: d.prog || {}, done: d.done || {}, bonus: !!d.bonus };
        }
      }
    } catch (e) { /* bỏ qua */ }
    skinId = data.skin;

    let dirty = false, runPoints = 0;
    function flush() {
      if (!dirty) return;
      dirty = false;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* bỏ qua */ }
    }
    setInterval(flush, 4000);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

    // ----- Nhiệm vụ theo ngày thực (giờ máy người chơi) -----
    const pad = (n) => (n < 10 ? '0' : '') + n;
    function todayKey() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function seedOf(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
    function shuffle(arr, R) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
    function pickMissions(dateKey) {
      const R = rng(seedOf(dateKey));
      const easy = shuffle(EASY.slice(), R);
      const rest = shuffle(POOL.map((m) => m.id).filter((id) => !EASY.includes(id)), R);
      return [easy[0], rest[0], rest[1]];
    }
    function ensureDay() {
      const date = todayKey();
      if (data.daily && data.daily.date === date) return false;
      data.daily = { date, ids: pickMissions(date), prog: {}, done: {}, bonus: false };
      dirty = true;
      return true;
    }
    ensureDay();

    // ----- Thông báo (toast) -----
    const toastQ = [];
    let toastBusy = false;
    function toast(title, sub) { toastQ.push({ title, sub }); if (!toastBusy) nextToast(); }
    function nextToast() {
      const el = $('toast'), t = toastQ.shift();
      if (!t) { toastBusy = false; el.classList.remove('show'); return; }
      toastBusy = true;
      $('toastTitle').textContent = t.title;
      $('toastSub').textContent = t.sub || '';
      el.classList.add('show');
      setTimeout(() => { el.classList.remove('show'); setTimeout(nextToast, 260); }, 2300);
    }

    // ----- Điểm & tiến độ -----
    function addPoints(n) { data.points += n; runPoints += n; dirty = true; }
    function complete(m) {
      data.daily.done[m.id] = true;
      addPoints(m.reward);
      Sound.reward();
      toast('✓ ' + m.text, '+' + m.reward + ' ★');
      if (!data.daily.bonus && data.daily.ids.every((id) => data.daily.done[id])) {
        data.daily.bonus = true;
        addPoints(BONUS);
        toast('Xong cả 3 nhiệm vụ hôm nay!', '+' + BONUS + ' ★');
      }
      flush();
      if (typeof refreshMenu === 'function') refreshMenu();
    }
    function bump(fn) {
      ensureDay();
      const d = data.daily;
      for (const id of d.ids) {
        if (d.done[id]) continue;
        const m = byId[id], before = d.prog[id] || 0, after = Math.min(m.target, fn(m, before));
        if (after === before) continue;
        d.prog[id] = after; dirty = true;
        if (after >= m.target) complete(m);
      }
    }

    // ----- Bảng xếp hạng -----
    function recordScore(score, dk) {
      if (!(score > 0)) return 0;
      const entry = { s: score, d: dk, t: Date.now() };
      data.scores.push(entry);
      data.scores.sort((a, b) => b.s - a.s || a.t - b.t);
      if (data.scores.length > 5) data.scores.length = 5;
      dirty = true; flush();
      return data.scores.indexOf(entry) + 1; // 0 = không vào top 5
    }

    // ----- Skin -----
    function buy(id) {
      const s = SKINS.find((k) => k.id === id);
      if (!s) return 'none';
      if (data.owned.includes(id)) return 'owned';
      if (data.points < s.price) return 'poor';
      data.points -= s.price;
      data.owned.push(id);
      data.skin = id;
      dirty = true; flush(); refreshSkin();
      return 'ok';
    }
    function equip(id) {
      if (!data.owned.includes(id)) return false;
      data.skin = id; dirty = true; flush(); refreshSkin();
      return true;
    }

    return {
      data, SKINS, pool: POOL, bonusPoints: BONUS,
      get runPoints() { return runPoints; },
      beginRun() { runPoints = 0; ensureDay(); },
      ensureDay,
      onMerge(level) { bump((m, p) => (m.type === 'make' && m.level === level) || m.type === 'merges' ? p + 1 : p); },
      onScore(s) { bump((m, p) => (m.type === 'score' ? Math.max(p, s) : p)); },
      onCombo(n) { bump((m, p) => (m.type === 'combo' ? Math.max(p, n) : p)); },
      onGameEnd() { bump((m, p) => (m.type === 'games' ? p + 1 : p)); flush(); },
      recordScore, buy, equip, toast, flush,
      missions() {
        ensureDay();
        const d = data.daily;
        return d.ids.map((id) => ({ id, text: byId[id].text, reward: byId[id].reward, target: byId[id].target, prog: d.prog[id] || 0, done: !!d.done[id] }));
      },
      bonusDone() { return !!data.daily.bonus; },
      msToReset() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1) - n; },
      // chỉ dùng để kiểm thử
      _setMissions(ids) { data.daily = { date: todayKey(), ids, prog: {}, done: {}, bonus: false }; dirty = true; },
      _addPoints(n) { data.points += n; dirty = true; },
    };
  })();

  /* ===================================================================
     5. VẬT LÝ
     =================================================================== */
  let engine, jar, fruits = [], mergeQueue = [];

  function buildWorld() {
    engine = Engine.create({ positionIterations: 10, velocityIterations: 8, enableSleeping: false });
    engine.gravity.y = diff.gravity;
    fruits = [];
    mergeQueue = [];

    const left = (CFG.W - diff.jarW) / 2;
    const right = left + diff.jarW;
    jar = { left, right };
    const T = 80; // độ dày tường vô hình
    const wallOpt = { isStatic: true, friction: 0.1, restitution: 0.05, plugin: { wall: true } };
    Composite.add(engine.world, [
      Bodies.rectangle((left + right) / 2, CFG.FLOOR_Y + T / 2, diff.jarW + T * 2, T, wallOpt),
      Bodies.rectangle(left - T / 2, CFG.FLOOR_Y - 900, T, 2400, wallOpt),
      Bodies.rectangle(right + T / 2, CFG.FLOOR_Y - 900, T, 2400, wallOpt),
    ]);

    Events.on(engine, 'collisionStart', onCollide);
    Events.on(engine, 'collisionActive', onCollide);
    Events.on(engine, 'collisionStart', (e) => { // tiếng "bộp" khi quả chạm nhau / chạm đáy
      for (const p of e.pairs) {
        const A = p.bodyA, B = p.bodyB;
        if (A.plugin.fruit && B.plugin.fruit && A.plugin.level === B.plugin.level) continue;
        const sp = Math.hypot(A.velocity.x - B.velocity.x, A.velocity.y - B.velocity.y);
        if (sp > 2.2) Sound.thud(sp);
      }
    });
  }

  function onCollide(e) {
    for (const p of e.pairs) {
      const A = p.bodyA.plugin, B = p.bodyB.plugin;
      if (!A.fruit || !B.fruit) continue;
      if (A.level !== B.level || A.merging || B.merging || A.level >= GOLD) continue;
      A.merging = B.merging = true;
      mergeQueue.push([p.bodyA, p.bodyB]);
    }
  }

  function spawnFruit(level, x, y, o = {}) {
    const r = CFG.RADII[level];
    const startR = o.grow ? r * 0.78 : r;
    const b = Bodies.circle(x, y, startR, {
      density: CFG.DENSITY,
      restitution: diff.restitution,
      friction: CFG.FRICTION,
      frictionStatic: CFG.FRICTION_STATIC,
      frictionAir: CFG.FRICTION_AIR,
      plugin: { fruit: true, level, alive: true, merging: false, born: gt, targetR: r, curR: startR, pop: o.grow ? 0 : 1, warn: false },
    }, 36);
    Body.setVelocity(b, { x: o.vx || 0, y: o.vy || 0 });
    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.04);
    Composite.add(engine.world, b);
    fruits.push(b);
    return b;
  }

  function removeFruit(b) {
    b.plugin.alive = false;
    Composite.remove(engine.world, b);
    const i = fruits.indexOf(b);
    if (i >= 0) fruits.splice(i, 1);
  }

  function growFruits() { // quả mới ghép lớn dần để không "bắn" các quả xung quanh
    for (const b of fruits) {
      const P = b.plugin;
      if (P.curR >= P.targetR) continue;
      let nr = P.curR + (P.targetR - P.curR) * 0.4;
      if (P.targetR - nr < 0.4) nr = P.targetR;
      const k = nr / P.curR;
      Body.scale(b, k, k);
      P.curR = nr;
    }
  }

  function processMerges() {
    while (mergeQueue.length) {
      const [a, b] = mergeQueue.shift();
      if (!a.plugin.alive || !b.plugin.alive) continue;
      const level = a.plugin.level + 1;
      if (level > state.maxLevel) state.maxLevel = level;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      const vx = (a.velocity.x + b.velocity.x) / 2;
      const vy = (a.velocity.y + b.velocity.y) / 2;
      removeFruit(a);
      removeFruit(b);
      const nb = spawnFruit(level, x, y, { grow: true, vx, vy });
      const r = CFG.RADII[level];
      const nowMs = performance.now();
      state.combo = (nowMs - state.lastMergeAt <= CFG.COMBO_WINDOW) ? state.combo + 1 : 1;
      state.lastMergeAt = nowMs;
      if (state.combo > state.bestCombo) state.bestCombo = state.combo;
      addScore(CFG.SCORES[level], x, y - r * 0.4);
      if (state.combo >= 2) {
        const bonus = Math.min(CFG.COMBO_BONUS_MAX, CFG.COMBO_BONUS * (state.combo - 1));
        addScore(bonus, x, y - r * 0.4 - 22);
        floatText(x, y - r - 34, 'Combo x' + state.combo + '!', '#ff8a00', 22 + Math.min(10, state.combo * 2));
        Sound.combo(state.combo);
        Profile.onCombo(state.combo);
        if (state.combo >= 3) shake(0.25 + Math.min(0.3, state.combo * 0.05));
      }
      if (level >= 8) shake(0.3);
      ring(x, y, r, FRUIT_COLORS[level]);
      burst(x, y, FRUIT_COLORS[level], 10 + level, 90 + level * 12, 3 + level * 0.25);
      sparkles(x, y, r);
      Sound.merge(level);
      Profile.onMerge(level);
      if (level === GOLD) {
        nb.plugin.merging = true; // dâu tây vàng không ghép nữa
        state.pendingClear = CFG.GOLD_CLEAR_DELAY;
        floatText(x, y - r * 0.9, 'Dâu tây vàng!', '#ffb300', 30);
        burst(x, y, '#ffd54a', 36, 260, 4);
      }
    }
  }

  function launchRocket(x) { // pháo bay từ đáy lên rồi nổ
    const ty = CFG.DANGER_Y + 50 + Math.random() * 300, t = 0.42 + Math.random() * 0.16;
    const cols = [['#ff8fb1', '#fff'], ['#ffd54a', '#fff7b0'], ['#8fd8ff', '#fff'], ['#b9f0cf', '#fff'], ['#e4d9ff', '#ffd54a']][(Math.random() * 5) | 0];
    pushP({
      t: 'rocket', x, y: CFG.FLOOR_Y, vx: (Math.random() - 0.5) * 30, vy: -(CFG.FLOOR_Y - ty) / t, g: 0, life: t, max: t, size: 3.5, color: '#fff',
      end: (p) => { firework(p.x, p.y, cols.concat(['#ffd54a'])); ring(p.x, p.y, 22, cols[0]); },
    });
  }

  function clearAll() { // pháo hoa xoá toàn bộ quả
    Sound.fireworks();
    const list = fruits.slice();
    list.forEach((b, i) => {
      const { x, y } = b.position, col = FRUIT_COLORS[b.plugin.level];
      if (i % 3 === 0) firework(x, y, [col, '#ffd54a', '#fff']); else burst(x, y, col, 10, 170, 3.2);
      ring(x, y, b.plugin.curR, col);
      removeFruit(b);
    });
    mergeQueue = [];
    state.flash = 1;
    shake(0.8);
    for (let i = 0; i < 7; i++) {
      schedule(0.1 + i * 0.13, () => launchRocket(jar.left + 30 + Math.random() * (diff.jarW - 60)));
    }
  }

  function explodeFruit(b) { // quả nổ tung khi thua
    if (!b.plugin.alive) return;
    const { x, y } = b.position, L = b.plugin.level, col = FRUIT_COLORS[L];
    burst(x, y, col, 12 + L, 180 + L * 14, 3.5 + L * 0.25);
    burst(x, y, '#ff4664', 6, 130, 3);
    ring(x, y, b.plugin.curR, b.plugin.warn ? '#ff4664' : col);
    removeFruit(b);
  }

  function checkDanger(sec) {
    if (state.pendingClear > 0) { state.danger = 0; state.dangerStep = 0; for (const b of fruits) b.plugin.warn = false; return; }
    let any = false;
    for (const b of fruits) {
      const P = b.plugin;
      if (gt - P.born < CFG.SETTLE_AGE) { P.warn = false; continue; }
      const sp = Math.hypot(b.velocity.x, b.velocity.y);
      P.warn = b.position.y - P.curR < CFG.DANGER_Y && sp < CFG.SETTLE_SPEED;
      if (P.warn) {
        any = true;
        if (Math.random() < 0.12) burst(b.position.x + (Math.random() - 0.5) * P.curR, b.position.y - P.curR * 0.85, '#ff4664', 1, 70, 2.6);
      }
    }
    state.danger = any ? state.danger + sec : Math.max(0, state.danger - sec * 2);
    // tiếng "bíp" mỗi giây khi đang đếm ngược 3 - 2 - 1
    const step = state.danger > 0 ? Math.min(CFG.DANGER_SECONDS, Math.floor(state.danger) + 1) : 0;
    if (step !== state.dangerStep) {
      if (step > 0) Sound.warn(CFG.DANGER_SECONDS - step + 1);
      state.dangerStep = step;
    }
    if (state.danger >= CFG.DANGER_SECONDS) gameOver();
  }

  /* ===================================================================
     6. VÒNG LẶP MÔ PHỎNG
     =================================================================== */
  function pickLevel() {
    let total = 0;
    for (let i = 0; i < diff.levels; i++) total += diff.weights[i];
    let r = Math.random() * total;
    for (let i = 0; i < diff.levels; i++) { r -= diff.weights[i]; if (r <= 0) return i; }
    return 0;
  }

  const keys = { left: false, right: false };

  function clampHandX(x, level) {
    const r = CFG.RADII[level] + 2;
    return Math.max(jar.left + r, Math.min(jar.right - r, x));
  }

  function setHandX(x) {
    state.handX = state.hand ? clampHandX(x, state.hand.level) : x;
  }

  function giveHand() {
    state.hand = { level: state.nextLevel };
    state.nextLevel = pickLevel();
    state.handX = clampHandX(state.handX, state.hand.level);
    drawNext();
  }

  function dropFruit() {
    if (state.mode !== 'play' || !state.hand) return;
    const level = state.hand.level;
    const x = clampHandX(state.handX, level);
    spawnFruit(level, x, CFG.HAND_Y, { vy: 1 });
    state.hand = null;
    state.nextHandAt = gt + CFG.DROP_COOLDOWN;
    Sound.drop();
  }

  function simStep(ms) {
    gt += ms;
    const sec = ms / 1000;

    if (state.hand) {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (dir) setHandX(state.handX + dir * CFG.MOVE_SPEED * sec);
    } else if (gt >= state.nextHandAt) {
      giveHand();
    }

    Engine.update(engine, ms);

    for (const b of fruits) { // giới hạn vận tốc
      const sp = Math.hypot(b.velocity.x, b.velocity.y);
      if (sp > CFG.MAX_SPEED) {
        const k = CFG.MAX_SPEED / sp;
        Body.setVelocity(b, { x: b.velocity.x * k, y: b.velocity.y * k });
      }
    }

    growFruits();
    processMerges();

    if (state.pendingClear > 0) {
      state.pendingClear -= sec;
      if (state.pendingClear <= 0) { state.pendingClear = 0; clearAll(); }
    }

    checkDanger(sec);
  }

  /* ===================================================================
     7. ĐIỂM & HIỆU ỨNG HẠT
     =================================================================== */
  function addScore(n, x, y) {
    if (n <= 0) return;
    state.score += n;
    Profile.onScore(state.score);
    scoreEl.textContent = state.score;
    scoreEl.classList.add('bump');
    setTimeout(() => scoreEl.classList.remove('bump'), 120);
    if (state.score > state.best) {
      state.best = state.score;
      state.newRecord = true;
      bestEl.textContent = state.best;
    }
    floatText(x, y, '+' + n, '#ff6f9c', 18 + Math.min(14, n / 8));
  }

  const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function shake(a) { if (!REDUCE_MOTION) state.shake = Math.max(state.shake, a); }

  const particles = [];
  const delayed = [];
  const MAX_PARTICLES = 700;

  function pushP(p) { if (particles.length < MAX_PARTICLES) particles.push(p); }

  function burst(x, y, color, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * PI2, s = speed * (0.35 + Math.random() * 0.65);
      const life = 0.5 + Math.random() * 0.5;
      pushP({ t: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, g: 380, life, max: life, size: size * (0.6 + Math.random() * 0.7), color });
    }
  }
  function ring(x, y, r, color) {
    pushP({ t: 'ring', x, y, r, vx: 0, vy: 0, g: 0, life: 0.4, max: 0.4, size: r, color });
  }
  function sparkles(x, y, r) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * PI2, d = r * (0.5 + Math.random() * 0.7);
      pushP({ t: 'star', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: -20, g: 0, life: 0.5, max: 0.5, size: 4 + Math.random() * 5, color: '#fff' });
    }
  }
  function firework(x, y, colors) {
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * PI2 + Math.random() * 0.2, s = 140 + Math.random() * 200;
      const life = 0.7 + Math.random() * 0.6;
      pushP({ t: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 300, life, max: life, size: 3 + Math.random() * 3, color: colors[(Math.random() * colors.length) | 0] });
    }
    for (let i = 0; i < 6; i++) {
      pushP({ t: 'star', x: x + (Math.random() - 0.5) * 50, y: y + (Math.random() - 0.5) * 50, vx: 0, vy: 0, g: 0, life: 0.6, max: 0.6, size: 6 + Math.random() * 6, color: '#fff7b0' });
    }
  }
  function floatText(x, y, text, color, size) {
    pushP({ t: 'text', x, y, vx: 0, vy: -48, g: 0, life: 1.0, max: 1.0, size, color, text });
  }
  function schedule(delay, fn) { delayed.push({ at: fxTime + delay, fn }); }

  function updateFx(dt) {
    fxTime += dt;
    for (let i = delayed.length - 1; i >= 0; i--) {
      if (fxTime >= delayed[i].at) { const f = delayed[i].fn; delayed.splice(i, 1); f(); }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); if (p.end) p.end(p); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t === 'rocket' && Math.random() < 0.85) { // vệt đuôi pháo
        pushP({ t: 'dot', x: p.x, y: p.y, vx: (Math.random() - 0.5) * 24, vy: 40, g: 0, life: 0.32, max: 0.32, size: 2.6, color: '#ffe9a0' });
      }
    }
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 1.8);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.6);
  }

  /* ===================================================================
     8. VẼ MÀN CHƠI
     =================================================================== */
  function drawFruitSprite(level, x, y, angle, scale) {
    const s = sprites[level];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.drawImage(s.cv, -s.half, -s.half, s.half * 2, s.half * 2);
    ctx.restore();
  }

  function jarPath(pad) {
    const L = jar.left - pad, R = jar.right + pad, T = CFG.JAR_TOP, B = CFG.FLOOR_Y + pad, rad = 12;
    ctx.beginPath();
    ctx.moveTo(L, T);
    ctx.lineTo(L, B - rad);
    ctx.quadraticCurveTo(L, B, L + rad, B);
    ctx.lineTo(R - rad, B);
    ctx.quadraticCurveTo(R, B, R, B - rad);
    ctx.lineTo(R, T);
  }

  function drawJarBack() {
    ctx.save();
    jarPath(0);
    ctx.lineTo(jar.left, CFG.JAR_TOP);
    const g = ctx.createLinearGradient(0, CFG.JAR_TOP, 0, CFG.FLOOR_Y);
    g.addColorStop(0, 'rgba(255,255,255,.28)');
    g.addColorStop(1, 'rgba(255,225,238,.62)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function drawJarFront() {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    jarPath(5);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ffc2d8';
    ctx.stroke();
    jarPath(8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    // khay gỗ dưới đáy
    const bx = jar.left - 14, bw = diff.jarW + 28;
    ctx.fillStyle = '#ffd9b8';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, CFG.FLOOR_Y + 9, bw, 16, 8) : ctx.rect(bx, CFG.FLOOR_Y + 9, bw, 16);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawDangerLine(now) {
    const active = state.danger > 0;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = active
      ? `rgba(255,70,100,${0.6 + 0.4 * Math.sin(now * 0.018)})`
      : 'rgba(255,120,150,.5)';
    ctx.beginPath();
    ctx.moveTo(jar.left + 4, CFG.DANGER_Y);
    ctx.lineTo(jar.right - 4, CFG.DANGER_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '800 11px "Baloo 2", "Nunito", system-ui, sans-serif';
    ctx.fillStyle = active ? '#ff4664' : 'rgba(214,100,130,.75)';
    ctx.textAlign = 'right';
    ctx.fillText('VẠCH NGUY HIỂM', jar.right - 8, CFG.DANGER_Y - 7);
    ctx.restore();
  }

  function drawGold(b, now) { // hào quang + lấp lánh quanh dâu tây vàng
    const { x, y } = b.position, r = b.plugin.curR;
    ctx.save();
    const g = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 1.45);
    g.addColorStop(0, `rgba(255,230,120,${0.55 + 0.15 * Math.sin(now * 0.006)})`);
    g.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 1.45, 0, PI2); ctx.fill();
    ctx.restore();
  }
  function drawGoldSparkles(b, now) {
    const { x, y } = b.position, r = b.plugin.curR;
    ctx.save();
    ctx.fillStyle = '#fff6b0';
    for (let i = 0; i < 6; i++) {
      const a = now * 0.0009 + (i / 6) * PI2;
      const tw = 0.5 + 0.5 * Math.sin(now * 0.008 + i * 1.7);
      polyStar(ctx, x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05, 3 + tw * 6, 1.2, 4);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFruits(now) {
    for (const b of fruits) {
      const P = b.plugin;
      if (P.level === GOLD) drawGold(b, now);
    }
    for (const b of fruits) {
      const P = b.plugin;
      if (P.pop < 1) P.pop = Math.min(1, P.pop + 0.05);
      const pop = 1 + 0.14 * Math.sin(P.pop * Math.PI);
      const sc = (P.curR / P.targetR) * pop;
      let x = b.position.x, y = b.position.y;
      if (P.warn) {
        const k = Math.min(1, state.danger / CFG.DANGER_SECONDS);
        x += (Math.random() - 0.5) * (1 + 4 * k);
        y += (Math.random() - 0.5) * (1 + 4 * k);
      }
      drawFruitSprite(P.level, x, y, b.angle, sc * (P.warn ? 1 + 0.05 * Math.sin(now * 0.03) : 1));
      if (P.warn) {
        const k = Math.min(1, state.danger / CFG.DANGER_SECONDS);
        const a = (0.18 + 0.4 * k) * (0.6 + 0.4 * Math.sin(now * 0.03));
        ctx.save();
        ctx.fillStyle = `rgba(255,50,90,${a})`;
        ctx.beginPath(); ctx.arc(x, y, P.curR * sc, 0, PI2); ctx.fill();
        ctx.restore();
      }
    }
    for (const b of fruits) if (b.plugin.level === GOLD) drawGoldSparkles(b, now);
  }

  function drawHand(now) {
    if (state.mode === 'start') return;
    if (state.hand) {
      const level = state.hand.level, r = CFG.RADII[level];
      const x = clampHandX(state.handX, level);
      const bob = Math.sin(now * 0.004) * 2;
      if (diff.guide) {
        ctx.save();
        ctx.setLineDash([3, 9]);
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,111,156,.4)';
        ctx.beginPath();
        ctx.moveTo(x, CFG.HAND_Y + r + 6);
        ctx.lineTo(x, CFG.FLOOR_Y);
        ctx.stroke();
        ctx.restore();
      }
      drawFruitSprite(level, x, CFG.HAND_Y + bob, 0, 1);
    } else if (state.mode === 'play') {
      // quả tiếp theo "trượt" lên tay
      const t = Math.max(0, Math.min(1, 1 - (state.nextHandAt - gt) / CFG.DROP_COOLDOWN));
      if (t > 0.35) {
        const level = state.nextLevel, x = clampHandX(state.handX, level);
        drawFruitSprite(level, x, CFG.HAND_Y, 0, (t - 0.35) / 0.65 * 0.85);
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.save();
      ctx.globalAlpha = a;
      if (p.t === 'dot') {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, PI2); ctx.fill();
      } else if (p.t === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4 * a + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + (1 - a) * 0.55), 0, PI2); ctx.stroke();
      } else if (p.t === 'rocket') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,240,170,.45)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.2, 0, PI2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, PI2); ctx.fill();
      } else if (p.t === 'star') {
        ctx.fillStyle = p.color;
        polyStar(ctx, p.x, p.y, p.size * (0.5 + a), p.size * 0.25, 4);
        ctx.fill();
      } else if (p.t === 'text') {
        ctx.font = `800 ${p.size}px "Baloo 2", "Nunito", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#fff';
        ctx.lineJoin = 'round';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.restore();
    }
  }

  function drawCountdown(now) {
    if (state.danger <= 0 || state.mode !== 'play') return;
    const n = Math.max(1, Math.ceil(CFG.DANGER_SECONDS - state.danger));
    const pulse = 1 + 0.12 * Math.sin(now * 0.02);
    ctx.save();
    ctx.translate(CFG.W / 2, CFG.DANGER_Y + 78);
    ctx.scale(pulse, pulse);
    ctx.font = '800 76px "Baloo 2", "Nunito", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(String(n), 0, 0);
    ctx.fillStyle = '#ff4664';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }

  function render(now) {
    ctx.clearRect(0, 0, CFG.W, CFG.H);
    ctx.save();
    if (state.shake > 0) { const s = state.shake * 9; ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s); }
    drawJarBack();
    drawDangerLine(now);
    drawFruits(now);
    drawHand(now);
    drawParticles();
    drawCountdown(now);
    drawJarFront();
    ctx.restore();
    drawEvo();
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(${state.flashCol},${state.flash * 0.7})`;
      ctx.fillRect(0, 0, CFG.W, CFG.H);
    }
  }

  /* --- Ô "Quả tiếp theo" và hình quả trên màn hình chào --- */
  function drawEvo() {
    if (!evo.length) return;
    const n = CFG.RADII.length, x0 = (CFG.W - (n - 1) * EVO.PITCH) / 2;
    const known = Math.max(state.maxLevel, diff.levels - 1);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const x = x0 + i * EVO.PITCH, y = EVO.Y, e = evo[i];
      const secret = i === GOLD && state.maxLevel < GOLD;
      ctx.globalAlpha = (i <= known || secret) ? 1 : 0.4;
      ctx.drawImage(secret ? e.dark : e.cv, x - e.half, y - e.half, e.half * 2, e.half * 2);
      if (secret) {
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
        ctx.font = '800 14px "Baloo 2", "Nunito", sans-serif';
        ctx.fillText('?', x, y + 1);
      }
      if (i < n - 1) { // mũi tên chỉ tới quả kế tiếp
        const ax = x + EVO.PITCH / 2;
        ctx.globalAlpha = 1; ctx.strokeStyle = i < known ? '#ff8fb1' : '#f2c4d3';
        ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(ax - 2.2, y - 4); ctx.lineTo(ax + 2.2, y); ctx.lineTo(ax - 2.2, y + 4); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawNext() {
    const c = nextCtx, w = nextCv.width;
    c.clearRect(0, 0, w, w);
    const level = state.nextLevel, r = CFG.RADII[level];
    const dr = 24 + ((r - 13) / 24) * 18; // 24..42 px (trên canvas 120px)
    c.save();
    c.translate(w / 2, w / 2 + 2);
    paintFruit(c, level, dr);
    c.restore();
  }

  function drawHero() {
    const c = heroCv.getContext('2d');
    c.clearRect(0, 0, heroCv.width, heroCv.height);
    const lv = [1, 3, 5, 8, 10, 11];
    lv.forEach((level, i) => {
      c.save();
      c.translate(50 + i * 100, 88 + (i % 2 ? 6 : -6));
      c.rotate((i % 2 ? 1 : -1) * 0.08);
      paintFruit(c, level, 38);
      c.restore();
    });
  }

  /* ===================================================================
     9. LUỒNG GAME: bắt đầu / tạm dừng / thua / chơi lại
     =================================================================== */
  function showOverlay(name) {
    for (const k in overlays) overlays[k].classList.toggle('show', k === name);
  }

  function resetWorld() {
    particles.length = 0;
    delayed.length = 0;
    clearTimeout(overTimeout);
    buildWorld();
    gt = 0;
    state.score = 0;
    state.hand = null;
    state.danger = 0;
    state.dangerStep = 0;
    state.pendingClear = 0;
    state.flash = 0;
    state.flashCol = '255,255,255';
    state.shake = 0;
    state.combo = 0;
    state.lastMergeAt = -1e9;
    state.bestCombo = 0;
    state.newRecord = false;
    state.maxLevel = -1;
    state.howFrom = 'start';
    state.handX = CFG.W / 2;
    state.nextLevel = pickLevel();
    state.nextHandAt = 0;
    scoreEl.textContent = '0';
    bestEl.textContent = state.best;
    $('diffBadge').textContent = 'Độ khó: ' + diff.label;
    drawNext();
  }

  function startGame() {
    Profile.beginRun();
    resetWorld();
    state.mode = 'play';
    Sound.setDuck(1);
    showOverlay(null);
    giveHand();
    blurButtons();
  }

  function goMenu() {
    resetWorld();
    state.mode = 'start';
    Sound.setDuck(1);
    showOverlay('start');
    refreshMenu();
  }

  function pauseGame() {
    if (state.mode !== 'play') return;
    state.mode = 'pause';
    Sound.setDuck(0.35);
    showOverlay('pause');
  }
  function resumeGame() {
    if (state.mode !== 'pause') return;
    state.mode = 'play';
    Sound.setDuck(1);
    showOverlay(null);
    blurButtons();
  }

  function gameOver() {
    if (state.mode !== 'play') return;
    state.mode = 'over';
    state.hand = null;
    Sound.over();
    // nổ tung dây chuyền, bắt đầu từ các quả cao nhất (đang chạm vạch)
    Sound.boom();
    fruits.slice().sort((a, b) => a.position.y - b.position.y).forEach((b, i) => {
      schedule(Math.min(0.75, i * 0.035), () => explodeFruit(b));
    });
    state.flash = 0.7;
    state.flashCol = '255,70,100';
    shake(1);
    if (state.score >= state.best && state.score > 0) { state.best = state.score; }
    saveBest(state.best);
    Profile.onGameEnd();
    state.lastRank = Profile.recordScore(state.score, diffKey);
    $('overRank').textContent = state.lastRank ? 'Hạng ' + state.lastRank + ' trong Top 5 của bạn!' : '';
    $('overRank').classList.toggle('show', !!state.lastRank);
    $('overReward').textContent = Profile.runPoints > 0 ? '+' + Profile.runPoints + ' ★ từ nhiệm vụ' : '';
    $('overReward').classList.toggle('show', Profile.runPoints > 0);
    $('finalScore').textContent = state.score;
    $('finalBest').textContent = state.best;
    $('newRecord').classList.toggle('show', state.newRecord && state.score > 0);
    let top = state.maxLevel;
    for (const b of fruits) top = Math.max(top, b.plugin.level);
    top = Math.max(0, top);
    $('overFruitName').textContent = FRUIT_NAMES[top];
    const oc = $('overFruit').getContext('2d');
    oc.clearRect(0, 0, 120, 120);
    oc.save(); oc.translate(60, 62);
    paintFruit(oc, top, 14 + (CFG.RADII[top] / CFG.RADII[11]) * 36);
    oc.restore();
    overTimeout = setTimeout(() => showOverlay('over'), 1200);
  }

  function blurButtons() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }

  $('btnStart').addEventListener('click', startGame);
  $('btnPause').addEventListener('click', () => { state.mode === 'pause' ? resumeGame() : pauseGame(); blurButtons(); });
  $('btnRestart').addEventListener('click', startGame);
  $('btnResume').addEventListener('click', resumeGame);
  $('btnPauseRestart').addEventListener('click', startGame);
  $('btnPauseMenu').addEventListener('click', goMenu);
  $('btnAgain').addEventListener('click', startGame);
  $('btnOverMenu').addEventListener('click', goMenu);


  /* ===================================================================
     9b. GIAI ĐOẠN 2: CHỌN ĐỘ KHÓ + HƯỚNG DẪN CÁCH CHƠI
     =================================================================== */
  function applyDifficulty(k) {
    diffKey = k;
    diff = DIFFICULTY[k];
    try { localStorage.setItem('fruitopia.diff', k); } catch (e) { /* bỏ qua */ }
    document.querySelectorAll('.diff-btn').forEach((b) => {
      const on = b.dataset.diff === k;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('diffBadge').textContent = 'Độ khó: ' + diff.label;
    if (state.mode === 'start') resetWorld();
  }
  document.querySelectorAll('.diff-btn').forEach((b) => b.addEventListener('click', () => applyDifficulty(b.dataset.diff)));
  applyDifficulty(diffKey);

  // --- Các bước hướng dẫn: mỗi bước có tiêu đề, chú thích và 1 hàm vẽ minh hoạ (t = thời gian, giây) ---
  const HOW = [
    { title: 'Thả quả', text: 'Kéo ngón tay (hoặc di chuột) để chọn vị trí, rồi nhả tay / click để thả quả xuống khung.', draw: drawHowDrop },
    { title: 'Ghép đôi', text: 'Hai quả cùng loại chạm nhau sẽ hợp thành quả lớn hơn kế tiếp, và bạn nhận điểm!', draw: drawHowMerge },
    { title: 'Quả tiếp theo', text: 'Ô ở góc phải cho biết quả sắp xuất hiện. Hãy tính trước để xếp quả cho khéo.', draw: drawHowNext },
    { title: 'Đừng để tràn!', text: 'Quả chạm vạch nguy hiểm quá 3 giây là thua. Ghép nhanh để hạ quả xuống nhé.', draw: drawHowDanger },
    { title: 'Combo!', text: 'Ghép liên tiếp trong 1 giây để tạo combo: mỗi lần nối thêm điểm thưởng, càng dài càng nhiều!', draw: drawHowCombo },
    { title: 'Dâu tây vàng', text: 'Ghép hai dưa hấu để tạo dâu tây vàng: +100 điểm và pháo hoa xoá sạch khung, rồi chơi tiếp!', draw: drawHowGold },
  ];
  let howStep = 0, howT = 0, howRAF = 0, howOpen = false, howSwipeX = null;
  const howCv = $('howCv'), howCtx = howCv.getContext('2d');

  function hFruit(level, x, y, r, rot = 0) {
    howCtx.save();
    howCtx.translate(x, y);
    howCtx.rotate(rot);
    paintFruit(howCtx, level, r);
    howCtx.restore();
  }
  function hGround() {
    const c = howCtx;
    c.fillStyle = '#ffd9b8';
    c.beginPath(); c.roundRect ? c.roundRect(60, 350, 480, 22, 11) : c.rect(60, 350, 480, 22); c.fill();
    c.strokeStyle = '#ffc2d8'; c.lineWidth = 8; c.lineCap = 'round';
    c.beginPath(); c.moveTo(70, 60); c.lineTo(70, 345); c.lineTo(530, 345); c.lineTo(530, 60); c.stroke();
  }
  function hHand(x) { // ngón tay minh hoạ
    const c = howCtx;
    c.save(); c.translate(x, 250);
    c.fillStyle = '#ffe0cf'; c.strokeStyle = '#f2b9a0'; c.lineWidth = 3;
    c.beginPath(); c.roundRect ? c.roundRect(-12, 0, 24, 70, 12) : c.rect(-12, 0, 24, 70); c.fill(); c.stroke();
    c.restore();
  }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function drawHowDrop(t) {
    const c = howCtx; hGround();
    const k = (t % 3.2) / 3.2;
    const x = k < 0.45 ? 200 + ease(k / 0.45) * 190 : 390;
    if (k < 0.5) {
      hFruit(2, x, 90 + Math.sin(t * 5) * 3, 36);
      c.save(); c.setLineDash([4, 12]); c.strokeStyle = 'rgba(255,111,156,.45)'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, 135); c.lineTo(x, 340); c.stroke(); c.restore();
      hHand(x);
    } else {
      const f = Math.min(1, (k - 0.5) / 0.28);
      hFruit(2, 390, 90 + f * f * 220, 36);
      if (f >= 1) { c.save(); c.globalAlpha = 1 - (k - 0.78) * 3; c.strokeStyle = '#ff8fb1'; c.lineWidth = 5; c.beginPath(); c.arc(390, 310, 36 + (k - 0.78) * 160, 0, PI2); c.stroke(); c.restore(); }
    }
  }
  function drawHowMerge(t) {
    const c = howCtx; hGround();
    const k = (t % 3.4) / 3.4;
    if (k < 0.5) {
      const m = ease(k / 0.5);
      hFruit(1, 230 + m * 52, 312, 32);
      hFruit(1, 370 - m * 52, 312, 32);
    } else {
      const f = (k - 0.5) / 0.5;
      const sc = f < 0.3 ? 0.7 + f / 0.3 * 0.5 : 1.2 - Math.min(1, (f - 0.3) / 0.3) * 0.2;
      hFruit(2, 300, 304, 44 * sc);
      c.save(); c.globalAlpha = Math.max(0, 1 - f * 1.4); c.strokeStyle = '#8fd05a'; c.lineWidth = 5;
      c.beginPath(); c.arc(300, 304, 44 + f * 70, 0, PI2); c.stroke(); c.restore();
      c.save(); c.globalAlpha = Math.max(0, 1 - Math.max(0, f - 0.4) * 1.6);
      c.font = '800 44px "Baloo 2", "Nunito", sans-serif'; c.textAlign = 'center'; c.lineWidth = 8; c.lineJoin = 'round';
      c.strokeStyle = '#fff'; c.strokeText('+3', 300, 230 - f * 30); c.fillStyle = '#ff6f9c'; c.fillText('+3', 300, 230 - f * 30);
      c.restore();
    }
  }
  function drawHowNext(t) {
    const c = howCtx; hGround();
    const seq = [0, 1, 2, 3, 4];
    const i = Math.floor(t / 1.6) % seq.length, nx = seq[(i + 1) % seq.length];
    hFruit(seq[i], 220, 110 + Math.sin(t * 5) * 3, 34);
    c.save();
    c.fillStyle = 'rgba(255,255,255,.95)'; c.strokeStyle = '#fff'; c.lineWidth = 4;
    c.beginPath(); c.roundRect ? c.roundRect(400, 40, 130, 130, 24) : c.rect(400, 40, 130, 130); c.fill();
    c.shadowColor = 'rgba(255,143,177,.4)'; c.shadowBlur = 12; c.stroke(); c.restore();
    c.font = '800 20px "Baloo 2", "Nunito", sans-serif'; c.textAlign = 'center'; c.fillStyle = '#9a7388';
    c.fillText('TIẾP THEO', 465, 70);
    hFruit(nx, 465, 120, 30);
    c.save(); c.strokeStyle = '#ff6f9c'; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(330, 110); c.lineTo(375, 110); c.moveTo(362, 97); c.lineTo(376, 110); c.lineTo(362, 123); c.stroke(); c.restore();
  }
  function drawHowDanger(t) {
    const c = howCtx; hGround();
    const blink = 0.5 + 0.5 * Math.sin(t * 9);
    c.save(); c.setLineDash([14, 10]); c.lineWidth = 5; c.lineCap = 'round';
    c.strokeStyle = `rgba(255,70,100,${0.5 + 0.5 * blink})`;
    c.beginPath(); c.moveTo(85, 120); c.lineTo(515, 120); c.stroke(); c.restore();
    c.font = '800 22px "Baloo 2", "Nunito", sans-serif'; c.textAlign = 'right'; c.fillStyle = '#ff4664';
    c.fillText('VẠCH NGUY HIỂM', 515, 108);
    hFruit(4, 190, 305, 44); hFruit(5, 300, 292, 52); hFruit(3, 410, 312, 32); hFruit(2, 250, 215, 30); hFruit(4, 350, 205, 42);
    const sh = (Math.random() - 0.5) * 4;
    hFruit(5, 300 + sh, 145 + sh, 52);
    c.save(); c.fillStyle = `rgba(255,50,90,${0.15 + 0.3 * blink})`; c.beginPath(); c.arc(300 + sh, 145 + sh, 52, 0, PI2); c.fill(); c.restore();
    const n = 3 - Math.floor((t % 3.3) / 1.1);
    c.save(); c.font = '800 70px "Baloo 2", "Nunito", sans-serif'; c.textAlign = 'center'; c.lineWidth = 10; c.lineJoin = 'round';
    c.strokeStyle = '#fff'; c.strokeText(String(Math.max(1, n)), 470, 210); c.fillStyle = '#ff4664'; c.fillText(String(Math.max(1, n)), 470, 210); c.restore();
  }
  function drawHowCombo(t) {
    const c = howCtx; hGround();
    const k = (t % 4.2) / 4.2, n = Math.min(3, 1 + Math.floor(k * 3.4));
    for (let i = 0; i < 3; i++) hFruit(i < n ? i + 2 : i + 1, 170 + i * 130, 292, 38 + i * 8);
    for (let i = 1; i < n; i++) {
      c.save(); c.font = '800 ' + (30 + i * 8) + 'px "Baloo 2", "Nunito", sans-serif'; c.textAlign = 'center'; c.lineWidth = 8; c.lineJoin = 'round';
      c.strokeStyle = '#fff'; c.strokeText('Combo x' + (i + 1), 170 + i * 150, 190 - i * 30); c.fillStyle = '#ff8a00'; c.fillText('Combo x' + (i + 1), 170 + i * 150, 190 - i * 30); c.restore();
    }
  }
  function drawHowGold(t) {
    const c = howCtx; hGround();
    const k = (t % 4) / 4;
    if (k < 0.4) {
      const m = ease(k / 0.4);
      hFruit(10, 220 + m * 36, 292, 54); hFruit(10, 380 - m * 36, 292, 54);
    } else {
      const f = (k - 0.4) / 0.6;
      hFruit(11, 300, 280, 62 * (0.8 + 0.2 * Math.min(1, f * 4)));
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * PI2, d = f * (60 + (i % 4) * 36);
        c.save(); c.globalAlpha = Math.max(0, 1 - f * 1.1);
        c.fillStyle = ['#ff8fb1', '#ffd54a', '#8fd8ff', '#b9f0cf'][i % 4];
        c.beginPath(); c.arc(300 + Math.cos(a) * d, 200 + Math.sin(a) * d * 0.8, 6, 0, PI2); c.fill(); c.restore();
      }
      c.save(); c.globalAlpha = Math.min(1, f * 4);
      c.font = '800 40px "Baloo 2", "Nunito", sans-serif'; c.textAlign = 'center'; c.lineWidth = 8; c.lineJoin = 'round';
      c.strokeStyle = '#fff'; c.strokeText('+100', 300, 150); c.fillStyle = '#ffb300'; c.fillText('+100', 300, 150); c.restore();
    }
  }

  function renderHow(now) {
    if (!howOpen) return;
    howT = Math.max(0, (now - howStart) / 1000);
    howCtx.clearRect(0, 0, howCv.width, howCv.height);
    HOW[howStep].draw(howT);
    howRAF = requestAnimationFrame(renderHow);
  }
  let howStart = 0;

  function setHowStep(i) {
    howStep = Math.max(0, Math.min(HOW.length - 1, i));
    howStart = performance.now();
    $('howTitle').textContent = HOW[howStep].title;
    $('howText').textContent = HOW[howStep].text;
    const dots = $('howDots');
    if (dots.children.length !== HOW.length) {
      dots.innerHTML = '';
      HOW.forEach((_, j) => { const d = document.createElement('i'); d.addEventListener('click', () => setHowStep(j)); dots.appendChild(d); });
    }
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === howStep));
    $('howPrev').classList.toggle('hidden', howStep === 0);
    $('howNext').textContent = howStep === HOW.length - 1 ? 'Đã hiểu!' : 'Tiếp';
  }

  function openHow(from) {
    state.howFrom = from;
    howOpen = true;
    setHowStep(0);
    showOverlay('how');
    cancelAnimationFrame(howRAF);
    howRAF = requestAnimationFrame(renderHow);
  }
  function closeHow() {
    howOpen = false;
    cancelAnimationFrame(howRAF);
    showOverlay(state.howFrom === 'pause' ? 'pause' : 'start');
  }
  $('btnHow').addEventListener('click', () => openHow('start'));
  $('btnPauseHow').addEventListener('click', () => openHow('pause'));
  $('howPrev').addEventListener('click', () => setHowStep(howStep - 1));
  $('howNext').addEventListener('click', () => { if (howStep >= HOW.length - 1) closeHow(); else setHowStep(howStep + 1); });
  // Vuốt trái/phải để chuyển bước
  const howPanel = $('howPanel');
  howPanel.addEventListener('pointerdown', (e) => { howSwipeX = e.clientX; });
  howPanel.addEventListener('pointerup', (e) => {
    if (howSwipeX === null) return;
    const dx = e.clientX - howSwipeX; howSwipeX = null;
    if (Math.abs(dx) > 40) { if (dx < 0) { if (howStep < HOW.length - 1) setHowStep(howStep + 1); } else setHowStep(howStep - 1); }
  });
  howPanel.addEventListener('pointercancel', () => { howSwipeX = null; });
  window.addEventListener('keydown', (e) => {
    if (!howOpen) return;
    e.stopImmediatePropagation(); // không để phím lọt sang điều khiển ván chơi
    if (e.key === 'ArrowRight') { howStep < HOW.length - 1 ? setHowStep(howStep + 1) : closeHow(); }
    else if (e.key === 'ArrowLeft') setHowStep(howStep - 1);
    else if (e.key === 'Escape') closeHow();
  });

  /* ===================================================================
     9c. GIAI ĐOẠN 3: CÀI ĐẶT ÂM THANH + NÚT NHẠC NHANH
     =================================================================== */
  let setOpen = false, setFrom = 'start';
  const swMusic = $('swMusic'), swSfx = $('swSfx'), volMusic = $('volMusic'), volSfx = $('volSfx'), btnMusic = $('btnMusic');

  function paintRange(el) { el.style.setProperty('--p', (el.value / el.max * 100) + '%'); }
  function syncAudioUI() {
    const c = Sound.cfg;
    for (const [sw, on] of [[swMusic, c.musicOn], [swSfx, c.sfxOn]]) {
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    volMusic.value = Math.round(c.musicVol * 100);
    volSfx.value = Math.round(c.sfxVol * 100);
    paintRange(volMusic); paintRange(volSfx);
    $('rowMusic').classList.toggle('off', !c.musicOn);
    $('rowSfx').classList.toggle('off', !c.sfxOn);
    btnMusic.classList.toggle('off', !c.musicOn);
    btnMusic.setAttribute('aria-pressed', c.musicOn ? 'true' : 'false');
  }
  swMusic.addEventListener('click', () => { Sound.setMusicOn(!Sound.cfg.musicOn); syncAudioUI(); });
  swSfx.addEventListener('click', () => { Sound.setSfxOn(!Sound.cfg.sfxOn); syncAudioUI(); if (Sound.cfg.sfxOn) Sound.preview(); });
  btnMusic.addEventListener('click', () => { Sound.setMusicOn(!Sound.cfg.musicOn); syncAudioUI(); blurButtons(); });
  volMusic.addEventListener('input', () => { Sound.setMusicVol(volMusic.value / 100); paintRange(volMusic); });
  let lastPrev = 0;
  volSfx.addEventListener('input', () => {
    Sound.setSfxVol(volSfx.value / 100); paintRange(volSfx);
    const n = performance.now();
    if (n - lastPrev > 180) { lastPrev = n; Sound.preview(); }
  });

  function openSettings(from) {
    setFrom = from; setOpen = true;
    syncAudioUI();
    showOverlay('set');
  }
  function closeSettings() {
    setOpen = false;
    showOverlay(setFrom === 'pause' ? 'pause' : 'start');
  }
  $('btnSettings').addEventListener('click', () => openSettings('start'));
  $('btnPauseSettings').addEventListener('click', () => openSettings('pause'));
  $('btnSetDone').addEventListener('click', closeSettings);
  window.addEventListener('keydown', (e) => { // đăng ký trước điều khiển chính để chặn phím lọt sang ván chơi
    if (!setOpen) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') closeSettings();
  });

  // Trình duyệt chặn tự phát âm thanh: mở khoá ở lần chạm/bấm đầu tiên
  const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'click'];
  function unlockAudio() {
    Sound.unlock();
    if (Sound.running) UNLOCK_EVENTS.forEach((ev) => window.removeEventListener(ev, unlockAudio, true));
  }
  UNLOCK_EVENTS.forEach((ev) => window.addEventListener(ev, unlockAudio, true));
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) Sound.click(); });
  syncAudioUI();

  /* ===================================================================
     9d. GIAI ĐOẠN 4: XẾP HẠNG, NHIỆM VỤ NGÀY, CỬA HÀNG GIAO DIỆN
     =================================================================== */
  let subOpen = null, subFrom = 'start';
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const fmtDate = (t) => { const d = new Date(t); return d.getDate() + '/' + (d.getMonth() + 1); };

  function refreshMenu() {
    const ms = Profile.missions();
    $('misBadge').textContent = ms.filter((m) => m.done).length + '/' + ms.length;
    $('shopBadge').textContent = '★ ' + Profile.data.points;
    const best = Profile.data.scores[0];
    $('rankBadge').textContent = best ? 'Cao nhất ' + best.s : 'Top 5';
  }
  function refreshSkin() {
    skinId = Profile.data.skin;
    buildSprites();
    drawNext();
    drawHero();
    refreshMenu();
  }

  function renderRank(me) {
    const list = $('rankList');
    list.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const e = Profile.data.scores[i];
      const row = mk('div', 'rank-row' + (e ? '' : ' empty') + (me === i + 1 ? ' me' : ''));
      row.appendChild(mk('span', 'rank-medal m' + (i + 1), String(i + 1)));
      row.appendChild(mk('span', 'rank-score', e ? String(e.s) : '—'));
      row.appendChild(mk('span', 'rank-meta', e ? DIFFICULTY[e.d].label + ' · ' + fmtDate(e.t) : 'Chưa có'));
      list.appendChild(row);
    }
  }
  function renderMissions() {
    const list = $('misList');
    list.innerHTML = '';
    for (const m of Profile.missions()) {
      const card = mk('div', 'mis-card' + (m.done ? ' done' : ''));
      card.appendChild(mk('span', 'mis-text', (m.done ? '✓ ' : '') + m.text));
      card.appendChild(mk('span', 'mis-reward', '+' + m.reward + ' ★'));
      const bar = mk('div', 'mis-bar');
      const fill = mk('i');
      fill.style.setProperty('--w', Math.round(m.prog / m.target * 100) + '%');
      bar.appendChild(fill);
      card.appendChild(bar);
      card.appendChild(mk('span', 'mis-prog', m.prog + ' / ' + m.target));
      list.appendChild(card);
    }
    $('misPoints').textContent = Profile.data.points;
    $('misBonus').textContent = Profile.bonusDone() ? 'Đã nhận thưởng hoàn thành cả 3: +' + Profile.bonusPoints + ' ★' : 'Hoàn thành cả 3 nhiệm vụ: thưởng thêm +' + Profile.bonusPoints + ' ★';
    const ms = Profile.msToReset(), h = Math.floor(ms / 3600000), mi = Math.floor(ms % 3600000 / 60000);
    $('misReset').textContent = 'Nhiệm vụ mới sau ' + h + ' giờ ' + mi + ' phút';
  }
  function renderShop() {
    const list = $('shopList');
    list.innerHTML = '';
    $('shopPoints').textContent = Profile.data.points;
    for (const s of SKINS) {
      const owned = Profile.data.owned.includes(s.id), active = Profile.data.skin === s.id;
      const card = mk('div', 'shop-card' + (active ? ' active' : ''));
      const cv = mk('canvas'); cv.width = 224; cv.height = 96;
      const c = cv.getContext('2d');
      [[1, 22, 38], [5, 28, 112], [9, 33, 186]].forEach(([lv, r, x]) => { c.save(); c.translate(x, 50); paintFruit(c, lv, r, s.id); c.restore(); });
      card.appendChild(cv);
      const info = mk('div', 'shop-info');
      info.appendChild(mk('div', 'shop-name', s.name));
      info.appendChild(mk('div', 'shop-desc', s.desc));
      card.appendChild(info);
      const btn = mk('button', 'shop-btn');
      if (active) { btn.textContent = 'Đang dùng'; btn.classList.add('on'); btn.disabled = true; }
      else if (owned) { btn.textContent = 'Dùng'; btn.classList.add('use'); btn.addEventListener('click', () => { Profile.equip(s.id); renderShop(); }); }
      else {
        btn.textContent = s.price + ' ★';
        if (Profile.data.points < s.price) btn.classList.add('lock');
        btn.addEventListener('click', () => {
          const r = Profile.buy(s.id);
          if (r === 'poor') Profile.toast('Chưa đủ điểm', 'Cần thêm ' + (s.price - Profile.data.points) + ' ★');
          else if (r === 'ok') Profile.toast('Đã mở khoá: ' + s.name, 'Đã áp dụng cho tất cả quả');
          renderShop();
        });
      }
      card.appendChild(btn);
      list.appendChild(card);
    }
  }

  function openSub(name, from, me) {
    Profile.ensureDay();
    subOpen = name; subFrom = from || 'start';
    if (name === 'rank') renderRank(me);
    else if (name === 'mis') renderMissions();
    else renderShop();
    showOverlay(name);
  }
  function closeSub() {
    subOpen = null;
    showOverlay(subFrom === 'over' ? 'over' : 'start');
    refreshMenu();
  }
  $('btnRank').addEventListener('click', () => openSub('rank', 'start'));
  $('btnMis').addEventListener('click', () => openSub('mis', 'start'));
  $('btnShop').addEventListener('click', () => openSub('shop', 'start'));
  $('btnOverRank').addEventListener('click', () => openSub('rank', 'over', state.lastRank));
  for (const id of ['btnRankDone', 'btnMisDone', 'btnShopDone']) $(id).addEventListener('click', closeSub);
  window.addEventListener('keydown', (e) => { // đăng ký trước điều khiển chính
    if (!subOpen) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') closeSub();
  });
  refreshMenu();

  /* ===================================================================
     10. ĐIỀU KHIỂN (chuột, cảm ứng, bàn phím)
     =================================================================== */
  function toLogicalX(e) {
    const rect = canvas.getBoundingClientRect();
    return ((e.clientX - rect.left) * CFG.W) / rect.width;
  }
  let pointerDown = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'play') return;
    pointerDown = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
    setHandX(toLogicalX(e));
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'play') return;
    if (e.pointerType === 'mouse' || pointerDown) setHandX(toLogicalX(e));
  });
  canvas.addEventListener('pointerup', (e) => {
    if (state.mode !== 'play' || !pointerDown) return;
    pointerDown = false;
    setHandX(toLogicalX(e));
    dropFruit();
  });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (howOpen || setOpen || subOpen) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = true; if (state.mode === 'play') e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = true; if (state.mode === 'play') e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') {
      if (state.mode === 'play' && !e.repeat) { dropFruit(); e.preventDefault(); }
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (state.mode === 'play') pauseGame(); else if (state.mode === 'pause') resumeGame();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });
  // Tự tạm dừng khi chuyển tab / khoá màn hình
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

  /* ===================================================================
     11. KÍCH THƯỚC & VÒNG LẶP CHÍNH
     =================================================================== */
  function resize() {
    const w = app.clientWidth;
    app.style.setProperty('--u', w / CFG.W + 'px');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(w * dpr);
    const ch = Math.round(cw * CFG.H / CFG.W);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      buildSprites();
    }
    ctx.setTransform(canvas.width / CFG.W, 0, 0, canvas.height / CFG.H, 0, 0);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(app);

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    if (state.mode === 'play') {
      acc += dt;
      let n = 0;
      while (acc >= CFG.STEP && n < 5) { simStep(CFG.STEP); acc -= CFG.STEP; n++; if (state.mode !== 'play') break; }
      if (n >= 5) acc = 0;
    } else {
      acc = 0;
    }
    if (state.mode !== 'pause') updateFx(dt / 1000);
    // hạt/hiệu ứng vẫn chạy cả khi game over; vật lý chỉ chạy khi đang chơi
    render(now);
    requestAnimationFrame(frame);
  }

  /* ===================================================================
     12. KHỞI ĐỘNG
     =================================================================== */
  bestEl.textContent = state.best;
  resize();
  resetWorld();
  drawHero();
  requestAnimationFrame(frame);

  // Công cụ phục vụ kiểm thử (có thể xoá khi phát hành)
  window.FRUITOPIA_DEBUG = {
    state, CFG, DIFFICULTY, FRUIT_NAMES,
    get fruits() { return fruits; },
    get jar() { return jar; },
    paintFruit, spawnFruit, startGame, simStep, dropFruit, setHandX, openHow, setHowStep, Sound, Profile, SKINS, paintFruit, gameOver,
    setDifficulty(k) { applyDifficulty(k); resetWorld(); },
  };
}

/* Khởi động: dùng Matter.js từ CDN; nếu không tải được thì thử file matter.min.js cạnh game.js */
(function bootstrap() {
  function fail() {
    const d = document.createElement('div');
    d.className = 'load-error';
    d.innerHTML = '<b>Không tải được thư viện vật lý</b><span>Hãy kiểm tra mạng, hoặc đặt file <code>matter.min.js</code> cạnh <code>index.html</code> rồi tải lại trang.</span>';
    (document.getElementById('app') || document.body).appendChild(d);
  }
  if (window.Matter) return fruitopiaMain();
  const s = document.createElement('script');
  s.src = 'matter.min.js';
  s.onload = () => (window.Matter ? fruitopiaMain() : fail());
  s.onerror = fail;
  document.head.appendChild(s);
})();
