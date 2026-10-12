const { store } = require('./store');
const { levelInfo } = require('./levels');
const { renderRankCard } = require('./card');
const { getBackground } = require('./background');

// Оформление карточки из настроек сервера
async function cardStyle() {
  const { accent, accent2, background, hasImage, dim } = store.card;
  return { accent, accent2, background, dim, image: hasImage ? await getBackground() : null };
}

// Карточка участника с его данными из базы (для /rank и предпросмотра в /settings)
async function renderUserCard(user, member) {
  const data = store.getUser(user.id);
  return renderRankCard(
    {
      displayName: member?.displayName ?? user.globalName ?? user.username,
      username: user.username,
      avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      rank: store.rankOf(user.id),
      messages: data.messages,
      ...levelInfo(data.xp),
    },
    await cardStyle(),
  );
}

module.exports = { renderUserCard, cardStyle };
