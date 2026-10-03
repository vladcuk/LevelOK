// Рендерит пример карточки в preview.png — удобно для настройки дизайна без запуска бота
const fs = require('node:fs');
const { renderRankCard } = require('../src/card');
const { levelInfo } = require('../src/levels');

(async () => {
  const info = levelInfo(12345);
  const png = await renderRankCard({
    displayName: 'Вячеслав',
    username: 'slavik',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    rank: 3,
    messages: 532,
    ...info,
  });
  fs.writeFileSync('preview.png', png);
  console.log('preview.png готов:', info);
})();
