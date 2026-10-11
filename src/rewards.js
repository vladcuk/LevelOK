const { store } = require('./store');

const REASON = 'LevelOK: роль-награда за уровень';

// Чтобы не спамить консоль одним и тем же предупреждением на каждое сообщение
const warned = new Set();
function warnOnce(key, text) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(text);
}

// Синхронизирует роли-награды участника с его уровнем.
// Дёргает API только если есть что менять. Возвращает id реально выданных ролей.
async function applyRewards(member, level) {
  if (!member) return [];
  const { guild } = member;

  // Роли, удалённые на сервере, просто пропускаем
  const entries = store.rewardList().filter((r) => guild.roles.cache.has(r.roleId));
  const earned = entries.filter((r) => r.level <= level);
  if (earned.length === 0) return [];

  const top = earned[earned.length - 1];
  const stacking = store.rewards.stacking;

  const wanted = stacking ? new Set(earned.map((r) => r.roleId)) : new Set([top.roleId]);

  const canManage = (roleId) => {
    const role = guild.roles.cache.get(roleId);
    if (role?.editable) return true;
    warnOnce(
      `${guild.id}:${roleId}`,
      `[rewards] Не могу выдавать роль «${role?.name}» (${roleId}): нужна «Управление ролями» и роль бота выше этой роли.`,
    );
    return false;
  };

  const toAdd = [...wanted].filter((id) => !member.roles.cache.has(id) && canManage(id));

  // Без суммирования снимаем роли более низких уровней, но только если
  // верхняя роль уже есть у участника или будет выдана — иначе он останется ни с чем.
  let toRemove = [];
  if (!stacking) {
    const topSecured = member.roles.cache.has(top.roleId) || toAdd.includes(top.roleId);
    if (topSecured) {
      const lower = new Set(earned.filter((r) => r.roleId !== top.roleId).map((r) => r.roleId));
      toRemove = [...lower].filter((id) => member.roles.cache.has(id) && canManage(id));
    }
  }

  const added = [];
  try {
    if (toAdd.length) {
      await member.roles.add(toAdd, REASON);
      added.push(...toAdd);
    }
    if (toRemove.length) await member.roles.remove(toRemove, REASON);
  } catch (err) {
    console.error(`[rewards] Не удалось обновить роли участника ${member.id}:`, err.message);
  }
  return added;
}

module.exports = { applyRewards };
