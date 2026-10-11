const { store } = require('./store');

// Канал, его категория и (для веток/постов форума) родительский канал с его категорией:
// правило на категорию действует на все её каналы, правило на канал — на его ветки.
function channelChain(channel) {
  const ids = new Set();
  if (!channel) return ids;
  ids.add(channel.id);
  if (channel.parentId) ids.add(channel.parentId);
  if (channel.parent?.parentId) ids.add(channel.parent.parentId);
  return ids;
}

// Из подходящих правил (и общего множителя `base`) побеждает наибольший по значению
function pickMultiplier(rules, base, channelIds, roleIds) {
  let best = { value: base, rule: null };
  for (const rule of rules) {
    const applies = rule.type === 'channel' ? channelIds.has(rule.id) : roleIds.has(rule.id);
    if (applies && rule.value > best.value) best = { value: rule.value, rule };
  }
  return best;
}

// Множитель для сообщения: { value, rule } (rule = null, если действует общий)
function effectiveMultiplier(message, now = Date.now()) {
  const roleIds = new Set(message.member?.roles?.cache?.keys() ?? []);
  return pickMultiplier(store.multiplierRules(now), store.settings.multiplier, channelChain(message.channel), roleIds);
}

module.exports = { channelChain, pickMultiplier, effectiveMultiplier };
