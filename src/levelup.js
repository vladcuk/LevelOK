const { ChannelType } = require('discord.js');

// Переменные шаблона сообщения о повышении уровня
const PLACEHOLDERS = {
  '{user}': 'упоминание участника',
  '{name}': 'имя участника',
  '{level}': 'новый уровень',
  '{rewards}': 'полученные роли-награды',
};

const MAX_LENGTH = 1000;

// Подставляет переменные. Если в шаблоне нет {rewards}, а роли выданы,
// строка с наградой добавляется в конце — чтобы награда не потерялась.
function renderLevelUp(template, { userId, name, level, rewards = [] }) {
  const rewardsText = rewards.map((id) => `<@&${id}>`).join(' ');
  const values = {
    '{user}': `<@${userId}>`,
    '{name}': name,
    '{level}': String(level),
    '{rewards}': rewardsText,
  };
  let out = template.replace(/\{(user|name|level|rewards)\}/g, (m) => values[m]);
  if (rewards.length && !template.includes('{rewards}')) out += `\n🎁 Награда: ${rewardsText}`;
  return out.slice(0, 2000);
}

const FORUM_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia]);

// Начисляется ли опыт за сообщения в этом канале (ветки и посты форумов можно отключить)
function xpAllowedIn(channel, settings) {
  if (!channel?.isThread?.()) return true;
  const inForum = FORUM_TYPES.has(channel.parent?.type);
  return inForum ? settings.xpInForums !== false : settings.xpInThreads !== false;
}

module.exports = { PLACEHOLDERS, MAX_LENGTH, renderLevelUp, xpAllowedIn };
