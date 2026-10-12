// Фоновая картинка ранг-карты. Загруженное изображение сразу обрезается под размер
// карточки и сохраняется в data/ — ссылки на вложения Discord со временем протухают,
// а готовый файл рисуется быстро.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { CARD_WIDTH, CARD_HEIGHT, CARD_SCALE } = require('./card');

const FILE = path.join(__dirname, '..', 'data', 'card-bg.png');
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

let cached; // undefined — не загружали, null — картинки нет

async function download(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Некорректная ссылка.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Ссылка должна начинаться с https://');

  let res;
  try {
    res = await fetch(parsed, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch {
    throw new Error('Не удалось скачать картинку по ссылке.');
  }
  if (!res.ok) throw new Error(`Не удалось скачать картинку (HTTP ${res.status}).`);
  const type = res.headers.get('content-type') ?? '';
  if (type && !type.startsWith('image/')) throw new Error('По ссылке не картинка.');
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('Картинка больше 10 МБ.');

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Картинка больше 10 МБ.');
  return buf;
}

// Обрезка «cover»: заполняем карточку целиком, лишнее по краям отрезаем
function coverCrop(image) {
  const w = CARD_WIDTH * CARD_SCALE;
  const h = CARD_HEIGHT * CARD_SCALE;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvas;
}

// Скачивает картинку, проверяет и сохраняет. Бросает Error с понятным текстом.
async function setBackground(url) {
  const buf = await download(url);
  let image;
  try {
    image = await loadImage(buf);
  } catch {
    throw new Error('Не удалось открыть картинку. Подойдут PNG, JPG, WEBP или GIF.');
  }
  if (!image.width || !image.height) throw new Error('Пустая картинка.');

  const png = await coverCrop(image).encode('png');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, png);
  fs.renameSync(tmp, FILE);
  cached = await loadImage(png);
}

function removeBackground() {
  fs.rmSync(FILE, { force: true });
  cached = null;
}

// Готовая к отрисовке картинка или null
async function getBackground() {
  if (cached !== undefined) return cached;
  try {
    cached = fs.existsSync(FILE) ? await loadImage(fs.readFileSync(FILE)) : null;
  } catch (err) {
    console.warn('[card] Не удалось прочитать фон:', err.message);
    cached = null;
  }
  return cached;
}

module.exports = { setBackground, removeBackground, getBackground, MAX_BYTES };
