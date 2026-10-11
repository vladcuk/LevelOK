// Рендерит пример карточки в preview.png — удобно для настройки дизайна без запуска бота.
// Аватар рисуется локально, так что сеть не нужна.
const fs = require('node:fs');
const { createCanvas } = require('@napi-rs/canvas');
const { renderRankCard } = require('../src/card');
const { levelInfo } = require('../src/levels');

function placeholderAvatar() {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, '#ff7a59');
  g.addColorStop(1, '#7b3fe4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 130px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('В', 128, 138);
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}

(async () => {
  const info = levelInfo(12345);
  const png = await renderRankCard({
    displayName: 'Вячеслав',
    username: 'slavik',
    avatarUrl: placeholderAvatar(),
    rank: 3,
    messages: 532,
    ...info,
  });
  fs.writeFileSync('preview.png', png);
  console.log('preview.png готов:', info);
})();
