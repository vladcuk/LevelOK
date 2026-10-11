// Сокращение больших чисел: 5320 → «5.32K», 1 240 000 → «1.24M».
// Округляем вниз, чтобы подпись не завышала реальное значение (1999 → «1.99K», а не «2K»).
const COMPACT_UNITS = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

function formatCompact(n) {
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.trunc(n));
  const [unit, suffix] = COMPACT_UNITS.find(([u]) => abs >= u);
  const hundredths = Math.floor(abs / (unit / 100)); // целые сотые доли: без ошибок float
  return `${n < 0 ? '-' : ''}${hundredths / 100}${suffix}`;
}

module.exports = { formatCompact };
