// Работа с HEX-цветами для оформления ранг-карты

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// «3f7cff», «#3F7CFF», «#38f» → «#3f7cff»; иначе null
function parseHex(raw) {
  const m = String(raw ?? '').trim().match(HEX_RE);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

function rgba(hex, alpha) {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Смешивает два цвета: t = 0 — первый, t = 1 — второй
function mix(a, b, t) {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return toHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

// Относительная яркость (0 — чёрный, 1 — белый) по WCAG
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

module.exports = { parseHex, rgba, mix, luminance };
