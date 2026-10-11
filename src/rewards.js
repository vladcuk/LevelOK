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
// Дёргает API только если есть что менять. Возвращает { added, removed } — id ролей.
// revokeAbove: снять роли за уровни выше текущего (когда админ понизил уровень).
async function applyRewards(member, level, { revokeAbove = false } = {}) {
  const result = { added: [], removed: [] };
  if (!member) return result;
  const { guild } = member;

  // Роли, удалённые на сервере, просто пропускаем
  const entries = store.rewardList().filter((r) => guild.roles.cache.has(r.roleId));
  const earned = entries.filter((r) => r.level <= level);
  const top = earned[earned.length - 1];
  const stacking = store.rewards.stacking;

  const wanted = new Set(stacking ? earned.map((r) => r.roleId) : top ? [top.roleId] : []);

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

  const remove = new Set();
  // Без суммирования снимаем роли более низких уровней, но только если
  // верхняя роль уже есть у участника или будет выдана — иначе он останется ни с чем.
  if (!stacking && top && (member.roles.cache.has(top.roleId) || toAdd.includes(top.roleId))) {
    for (const r of earned) if (r.roleId !== top.roleId) remove.add(r.roleId);
  }
  if (revokeAbove) {
    for (const r of entries) if (r.level > level && !wanted.has(r.roleId)) remove.add(r.roleId);
  }
  const toRemove = [...remove].filter((id) => member.roles.cache.has(id) && canManage(id));

  try {
    if (toAdd.length) {
      await member.roles.add(toAdd, REASON);
      result.added.push(...toAdd);
    }
    if (toRemove.length) {
      await member.roles.remove(toRemove, REASON);
      result.removed.push(...toRemove);
    }
  } catch (err) {
    console.error(`[rewards] Не удалось обновить роли участника ${member.id}:`, err.message);
  }
  return result;
}

module.exports = { applyRewards };
