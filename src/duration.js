// Разбор срока действия из текста: «1д», «12ч», «2д 6ч», «30м», «1d 12h», «1 нед».
// Пустая строка / «навсегда» / «бессрочно» — без срока.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const LIMITS = { min: MIN, max: 365 * DAY };

const UNITS = [
  [7 * DAY, ['w', 'wk', 'week', 'weeks', 'н', 'нед', 'неделя', 'недели', 'недель']],
  [DAY, ['d', 'day', 'days', 'д', 'дн', 'день', 'дня', 'дней']],
  [HOUR, ['h', 'hr', 'hour', 'hours', 'ч', 'час', 'часа', 'часов']],
  [MIN, ['m', 'min', 'mins', 'minute', 'minutes', 'м', 'мин', 'минута', 'минуты', 'минут']],
];
const UNIT_BY_ALIAS = new Map(UNITS.flatMap(([ms, aliases]) => aliases.map((a) => [a, ms])));

const PERMANENT = new Set(['', 'навсегда', 'бессрочно', 'forever', 'never', 'permanent']);

const FORMAT_HINT = 'Срок — например 1д, 12ч, 2д 6ч, 30м (или пусто, чтобы без срока).';

// Возвращает { ms } (null — бессрочно) или { error }
function parseDuration(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (PERMANENT.has(text)) return { ms: null };

  if (!/^(?:\d+\s*[a-zа-яё]+\s*)+$/u.test(text)) return { error: FORMAT_HINT };

  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+)\s*([a-zа-яё]+)/gu)) {
    const ms = UNIT_BY_ALIAS.get(unit);
    if (!ms) return { error: FORMAT_HINT };
    total += Number(amount) * ms;
  }

  if (total < LIMITS.min) return { error: 'Срок не может быть короче 1 минуты.' };
  if (total > LIMITS.max) return { error: 'Срок не может быть больше 365 дней.' };
  return { ms: total };
}

// «1д 3ч 20м» — формат, который парсер понимает обратно (для подстановки в поле ввода)
function formatDuration(ms) {
  const totalMin = Math.max(1, Math.ceil(ms / MIN));
  const d = Math.floor(totalMin / (24 * 60));
  const h = Math.floor((totalMin % (24 * 60)) / 60);
  const m = totalMin % 60;
  return [d && `${d}д`, h && `${h}ч`, m && `${m}м`].filter(Boolean).join(' ');
}

module.exports = { parseDuration, formatDuration, FORMAT_HINT };
