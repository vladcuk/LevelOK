const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { formatCompact } = require('./format');
const { rgba, mix } = require('./color');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-Medium.ttf'), 'Inter Medium');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-SemiBold.ttf'), 'Inter SemiBold');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-Bold.ttf'), 'Inter Bold');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-ExtraBold.ttf'), 'Inter ExtraBold');

// Fallback-шрифты нужны для эмодзи/иероглифов в никах, если они есть в системе
const FALLBACK = 'sans-serif';
const font = (weight, size) => `${size}px "Inter ${weight}", ${FALLBACK}`;

// Карточка узкая, Discord показывает её примерно вдвое меньше натуральной ширины,
// поэтому шрифты крупные: самый мелкий текст — 18 px.
const W = 900;
const H = 340;
const SCALE = 2; // рисуем в 2x для чёткости на любых экранах

const DEFAULT_STYLE = {
  accent: '#3f7cff',
  accent2: '#35d0ff',
  background: '#151822',
  image: null,
  dim: 55,
};

// Палитра карточки из настроек оформления (см. /settings → «Другое»)
function makeTheme(style = {}) {
  const s = { ...DEFAULT_STYLE, ...style };
  const image = s.image ?? null;
  return {
    accentA: s.accent,
    accentB: s.accent2 ?? mix(s.accent, '#ffffff', 0.35),
    bgTop: s.background,
    bgBottom: mix(s.background, '#000000', 0.45),
    gap: mix(s.background, '#000000', 0.35),
    image,
    dim: Math.min(Math.max(Number(s.dim) || 0, 0), 90) / 100,
    border: 'rgba(255,255,255,0.08)',
    text: '#f4f6fb',
    // На картинке подписи светлее и плитки темнее — иначе текст теряется
    muted: image ? '#c3c8d4' : '#9aa1b2',
    track: image ? 'rgba(8,10,16,0.6)' : mix(s.background, '#ffffff', 0.06),
    tile: image ? 'rgba(8,10,16,0.45)' : 'rgba(255,255,255,0.045)',
    tileBorder: image ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.07)',
  };
}

// Текущая палитра на время отрисовки одной карточки (рендер синхронный после загрузки аватара)
let COLORS = makeTheme();

// Места на пьедестале подсвечиваются
const PODIUM = { 1: '#ffd25e', 2: '#d3dae8', 3: '#e8a06a' };

const fmt = formatCompact;

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

// Подбирает размер шрифта, чтобы текст влез в maxWidth (но не мельче minSize)
function fitFont(ctx, weight, size, minSize, text, maxWidth) {
  let s = size;
  ctx.font = font(weight, s);
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = font(weight, s);
  }
  return s;
}

function accentGradient(ctx, x0, x1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, COLORS.accentA);
  g.addColorStop(1, COLORS.accentB);
  return g;
}

// Подпись заглавными с небольшим разрежением — выглядит аккуратнее и читается лучше
function label(ctx, str, x, y, align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.font = font('SemiBold', 18);
  ctx.letterSpacing = '1px';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(str, x, y);
  ctx.restore();
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

function drawBackground(ctx) {
  roundRect(ctx, 0, 0, W, H, 30);
  ctx.save();
  ctx.clip();

  if (COLORS.image) {
    // Картинка уже обрезана под карточку; затемняем цветом фона, чтобы читался текст
    ctx.drawImage(COLORS.image, 0, 0, W, H);
    const shade = ctx.createLinearGradient(0, 0, W, 0);
    shade.addColorStop(0, rgba(COLORS.bgBottom, Math.min(1, COLORS.dim + 0.1)));
    shade.addColorStop(1, rgba(COLORS.bgBottom, COLORS.dim));
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
  } else {
    const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, COLORS.bgTop);
    bg.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  // Мягкие цветные свечения: за аватаром и в правом нижнем углу
  const glowA = ctx.createRadialGradient(130, 170, 0, 130, 170, 300);
  glowA.addColorStop(0, rgba(COLORS.accentA, 0.22));
  glowA.addColorStop(1, rgba(COLORS.accentA, 0));
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);

  const glowB = ctx.createRadialGradient(W, H, 0, W, H, 380);
  glowB.addColorStop(0, rgba(COLORS.accentB, 0.1));
  glowB.addColorStop(1, rgba(COLORS.accentB, 0));
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, W, H);

  // «Стекло»: лёгкий блик сверху
  const sheen = ctx.createLinearGradient(0, 0, 0, H * 0.45);
  sheen.addColorStop(0, 'rgba(255,255,255,0.045)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  ctx.restore();

  // Рамка и светлая верхняя кромка
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 30);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, 0, 0, W, H, 30);
  ctx.clip();
  const edge = ctx.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, rgba(COLORS.accentA, 0));
  edge.addColorStop(0.5, rgba(mix(COLORS.accentA, '#ffffff', 0.35), 0.45));
  edge.addColorStop(1, rgba(COLORS.accentB, 0));
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, 2);
  ctx.restore();
}

function drawAvatar(ctx, avatar, cx, cy, r) {
  // Кольцо с мягким свечением
  ctx.save();
  ctx.shadowColor = rgba(COLORS.accentA, 0.55);
  ctx.shadowBlur = 26;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
  ctx.strokeStyle = accentGradient(ctx, cx - r, cx + r);
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();

  // Тёмный зазор между кольцом и аватаркой
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.gap;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = '#2a2e38';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}

function drawTile(ctx, x, y, w, h, caption, value, { suffix, color } = {}) {
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = COLORS.tile;
  ctx.fill();
  ctx.strokeStyle = COLORS.tileBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  const PAD = 20;
  label(ctx, caption, x + PAD, y + 29);

  ctx.textAlign = 'left';
  let suffixW = 0;
  if (suffix) {
    ctx.font = font('Bold', 20);
    suffixW = ctx.measureText(suffix).width + 8;
  }
  const maxW = w - PAD * 2 - suffixW;
  fitFont(ctx, 'ExtraBold', 36, 24, value, maxW);
  const valueW = ctx.measureText(value).width;
  ctx.fillStyle = typeof color === 'function' ? color(x + PAD, x + PAD + valueW) : color ?? COLORS.text;
  ctx.fillText(value, x + PAD, y + 66);

  if (suffix) {
    ctx.font = font('Bold', 20);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(suffix, x + PAD + valueW + 8, y + 66);
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
 * @param {object} [style] оформление: { accent, accent2, background, image, dim }
 */
async function renderRankCard(p, style) {
  // Аватар грузим заранее: дальше отрисовка синхронная, и общая палитра не перепутается
  // между карточками, которые рендерятся одновременно.
  const avatar = await loadAvatar(p.avatarUrl);
  COLORS = makeTheme(style);

  const canvas = createCanvas(W * SCALE, H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  drawBackground(ctx);
  drawAvatar(ctx, avatar, 132, H / 2, 82);

  const LX = 270;
  const RX = W - 40;
  const CW = RX - LX;

  // --- Имя ---
  ctx.save();
  if (COLORS.image) {
    // На картинке имя без подложки — лёгкая тень отделяет его от фона
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 10;
  }
  ctx.textAlign = 'left';
  fitFont(ctx, 'Bold', 46, 30, p.displayName, CW);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fitText(ctx, p.displayName, CW), LX, 82);

  ctx.font = font('Medium', 22);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(fitText(ctx, `@${p.username}`, CW), LX, 114);
  ctx.restore();

  // --- Плитки: ранг, уровень, общий опыт ---
  const TY = 136;
  const TH = 80;
  const GAP = 12;
  const TW = (CW - GAP * 2) / 3;

  drawTile(ctx, LX, TY, TW, TH, 'РАНГ', p.rank ? `#${p.rank}` : '—', {
    color: PODIUM[p.rank] ?? COLORS.text,
  });
  drawTile(ctx, LX + TW + GAP, TY, TW, TH, 'УРОВЕНЬ', String(p.level), {
    color: (x0, x1) => accentGradient(ctx, x0, x1),
  });
  drawTile(ctx, LX + (TW + GAP) * 2, TY, TW, TH, 'ВСЕГО ОПЫТА', fmt(p.total), { suffix: 'XP' });

  // --- Прогресс до следующего уровня ---
  const ratio = p.needed > 0 ? Math.min(1, p.current / p.needed) : 0;
  const LABEL_Y = 252;
  const BAR_Y = 266;
  const BAR_H = 26;

  label(ctx, `ДО УРОВНЯ ${p.level + 1}`, LX, LABEL_Y);

  ctx.textAlign = 'right';
  const neededStr = ` / ${fmt(p.needed)} XP`;
  ctx.font = font('Medium', 21);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(neededStr, RX, LABEL_Y);
  const neededW = ctx.measureText(neededStr).width;
  ctx.font = font('Bold', 21);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fmt(p.current), RX - neededW, LABEL_Y);

  roundRect(ctx, LX, BAR_Y, CW, BAR_H, BAR_H / 2);
  ctx.fillStyle = COLORS.track;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (ratio > 0) {
    const fillW = Math.max(BAR_H, CW * ratio);

    ctx.save();
    ctx.shadowColor = rgba(COLORS.accentA, 0.55);
    ctx.shadowBlur = 14;
    roundRect(ctx, LX, BAR_Y, fillW, BAR_H, BAR_H / 2);
    ctx.fillStyle = accentGradient(ctx, LX, LX + fillW);
    ctx.fill();
    ctx.restore();

    // Блик сверху полосы
    roundRect(ctx, LX + 5, BAR_Y + 3, Math.max(0, fillW - 10), BAR_H / 2 - 3, (BAR_H / 2 - 3) / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fill();
  }

  // --- Нижняя строка ---
  const FOOT_Y = 322;
  ctx.textAlign = 'left';
  ctx.font = font('Medium', 20);
  ctx.fillStyle = COLORS.muted;
  const msgLabel = 'Сообщений ';
  ctx.fillText(msgLabel, LX, FOOT_Y);
  const msgLabelW = ctx.measureText(msgLabel).width;
  ctx.font = font('Bold', 20);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fmt(p.messages), LX + msgLabelW, FOOT_Y);

  ctx.textAlign = 'right';
  const percent = `${Math.floor(ratio * 100)}%`;
  ctx.font = font('Bold', 20);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(percent, RX, FOOT_Y);
  const percentW = ctx.measureText(percent).width;
  ctx.font = font('Medium', 20);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(`Осталось ${fmt(Math.max(0, p.needed - p.current))} XP  ·  `, RX - percentW, FOOT_Y);

  // encode асинхронный, но всё нарисовано — палитру можно отдавать следующей карточке
  return canvas.encode('png');
}

module.exports = { renderRankCard, CARD_WIDTH: W, CARD_HEIGHT: H, CARD_SCALE: SCALE };
