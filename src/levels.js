// Опыт, необходимый для перехода с уровня `level` на `level + 1`.
// Классическая кривая: 100, 155, 220, 295, 380, ...
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

// По общему опыту возвращает уровень и прогресс внутри текущего уровня
function levelInfo(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return {
    level,
    current: remaining, // опыт, набранный на текущем уровне
    needed: xpForLevel(level), // сколько нужно на текущем уровне до следующего
    total: totalXp,
  };
}

// Суммарный опыт, при котором участник оказывается в самом начале уровня `level`
function totalXpForLevel(level) {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpForLevel(l);
  return total;
}

function randomXp({ xpMin, xpMax, multiplier }) {
  const base = Math.floor(Math.random() * (xpMax - xpMin + 1)) + xpMin;
  return Math.max(0, Math.round(base * multiplier));
}

module.exports = { xpForLevel, levelInfo, totalXpForLevel, randomXp };
