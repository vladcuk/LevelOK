const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-Medium.ttf'), 'Inter Medium');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-SemiBold.ttf'), 'Inter SemiBold');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-Bold.ttf'), 'Inter Bold');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-ExtraBold.ttf'), 'Inter ExtraBold');

// Fallback-шрифты нужны для эмодзи/иероглифов в никах, если они есть в системе
const FALLBACK = 'sans-serif';
const font = (weight, size) => `${size}px "Inter ${weight}", ${FALLBACK}`;

const W = 1000;
const H = 300;
const SCALE = 2; // рисуем в 2x для чёткости на любых экранах

const COLORS = {
  bgTop: '#14161c',
  bgBottom: '#0c0d11',
  border: 'rgba(255,255,255,0.06)',
  text: '#f2f4f8',
  muted: '#8a90a0',
  faint: '#5b6070',
  track: '#22252e',
  accentA: '#3f7cff',
  accentB: '#35d0ff',
};

const nf = new Intl.NumberFormat('ru-RU');
const fmt = (n) => nf.format(n);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function accentGradient(ctx, x0, x1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, COLORS.accentA);
  g.addColorStop(1, COLORS.accentB);
  return g;
}

async function loadAvatar(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    console.warn('[card] Не удалось загрузить аватар:', err.message);
    return null;
  }
}

/**
 * @param {object} p
 * @param {string} p.displayName
 * @param {string} p.username
 * @param {string} p.avatarUrl
 * @param {number|null} p.rank
 * @param {number} p.level
 * @param {number} p.current  опыт на текущем уровне
 * @param {number} p.needed   опыт, нужный для следующего уровня
 * @param {number} p.total    общий опыт
 * @param {number} p.messages
 */
async function renderRankCard(p) {
  const canvas = createCanvas(W * SCALE, H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // --- Фон ---
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.save();
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, COLORS.bgTop);
  bg.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Мягкое свечение за аватаром
  const glow = ctx.createRadialGradient(150, 150, 0, 150, 150, 260);
  glow.addColorStop(0, 'rgba(63,124,255,0.20)');
  glow.addColorStop(1, 'rgba(63,124,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Точечная сетка справа — едва заметная фактура, плавно проявляется к краю
  for (let x = 560; x < W; x += 18) {
    const alpha = 0.05 * Math.min(1, (x - 560) / 260);
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    for (let y = 14; y < H; y += 18) {
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Акцентная полоса слева
  const stripe = ctx.createLinearGradient(0, 0, 0, H);
  stripe.addColorStop(0, COLORS.accentA);
  stripe.addColorStop(1, COLORS.accentB);
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, 6, H);

  ctx.restore();

  // Тонкая рамка
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 28);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- Аватар ---
  const AX = 150;
  const AY = 150;
  const AR = 92;

  ctx.beginPath();
  ctx.arc(AX, AY, AR + 7, 0, Math.PI * 2);
  ctx.strokeStyle = accentGradient(ctx, AX - AR, AX + AR);
  ctx.lineWidth = 4;
  ctx.stroke();

  const avatar = await loadAvatar(p.avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(AX, AY, AR, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, AX - AR, AY - AR, AR * 2, AR * 2);
  } else {
    ctx.fillStyle = '#2a2e38';
    ctx.fillRect(AX - AR, AY - AR, AR * 2, AR * 2);
  }
  ctx.restore();

  // --- Правая часть ---
  const LX = 290;
  const RX = 950;

  // Статы справа сверху: РАНГ и УРОВЕНЬ
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';

  const drawStat = (rightX, label, value, highlight) => {
    ctx.font = font('ExtraBold', 46);
    ctx.fillStyle = highlight ? accentGradient(ctx, rightX - ctx.measureText(value).width, rightX) : COLORS.text;
    ctx.fillText(value, rightX, 100);
    const valueWidth = ctx.measureText(value).width;
    ctx.font = font('SemiBold', 14);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(label, rightX, 50);
    return Math.max(valueWidth, ctx.measureText(label).width);
  };

  const levelWidth = drawStat(RX, 'УРОВЕНЬ', String(p.level), true);
  const rankRight = RX - levelWidth - 40;
  const rankWidth = drawStat(rankRight, 'РАНГ', p.rank ? `#${p.rank}` : '—', false);

  // Разделитель между статами
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(RX - levelWidth - 20, 42, 1, 62);

  // Имя
  const nameMax = rankRight - rankWidth - 30 - LX;
  ctx.textAlign = 'left';
  ctx.font = font('Bold', 38);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fitText(ctx, p.displayName, nameMax), LX, 86);

  ctx.font = font('Medium', 18);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(fitText(ctx, `@${p.username}`, nameMax), LX, 116);

  // Прогресс
  const BAR_Y = 196;
  const BAR_H = 22;
  const BAR_W = RX - LX;
  const ratio = p.needed > 0 ? Math.min(1, p.current / p.needed) : 0;

  ctx.font = font('SemiBold', 16);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('ПРОГРЕСС УРОВНЯ', LX, BAR_Y - 16);

  ctx.textAlign = 'right';
  const neededStr = ` / ${fmt(p.needed)} XP`;
  ctx.font = font('Medium', 18);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(neededStr, RX, BAR_Y - 15);
  const neededW = ctx.measureText(neededStr).width;
  ctx.font = font('Bold', 18);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fmt(p.current), RX - neededW, BAR_Y - 15);

  roundRect(ctx, LX, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
  ctx.fillStyle = COLORS.track;
  ctx.fill();

  if (ratio > 0) {
    const fillW = Math.max(BAR_H, BAR_W * ratio);
    roundRect(ctx, LX, BAR_Y, fillW, BAR_H, BAR_H / 2);
    ctx.fillStyle = accentGradient(ctx, LX, LX + fillW);
    ctx.fill();

    // Лёгкий блик сверху полосы
    roundRect(ctx, LX + 4, BAR_Y + 3, Math.max(0, fillW - 8), BAR_H / 2 - 3, (BAR_H / 2 - 3) / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
  }

  // Нижняя строка
  const FOOT_Y = 256;
  ctx.textAlign = 'left';
  const footItem = (x, label, value) => {
    ctx.font = font('SemiBold', 14);
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(label, x, FOOT_Y);
    const lw = ctx.measureText(label).width;
    ctx.font = font('Bold', 17);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(value, x + lw + 10, FOOT_Y);
    return lw + 10 + ctx.measureText(value).width;
  };
  const w1 = footItem(LX, 'ВСЕГО ОПЫТА', `${fmt(p.total)} XP`);
  footItem(LX + w1 + 36, 'СООБЩЕНИЙ', fmt(p.messages));

  ctx.textAlign = 'right';
  ctx.font = font('Bold', 17);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`${Math.floor(ratio * 100)}%`, RX, FOOT_Y);

  return canvas.encode('png');
}

module.exports = { renderRankCard };
