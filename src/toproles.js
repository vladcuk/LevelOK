const { store } = require('./store');

const REASON = 'LevelOK: роль за место в топе';
// Участника нет на сервере — не дёргаем API за ним на каждом сообщении
const ABSENT_TTL = 10 * 60 * 1000;

const absent = new Map(); // userId → когда выяснили, что его нет
const warned = new Set();

function warnOnce(key, text) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(text);
}

async function fetchMember(guild, id) {
  const cached = guild.members.cache.get(id);
  if (cached) return cached;
  const since = absent.get(id);
  if (since && Date.now() - since < ABSENT_TTL) return null;
  const member = await guild.members.fetch(id).catch(() => null);
  if (member) absent.delete(id);
  else absent.set(id, Date.now());
  return member;
}

// Кто по правилам должен держать каждую роль: Map<roleId, Set<userId>>
function wantedHolders(guild) {
  const ranking = store.ranking();
  const wanted = new Map();
  for (const { from, to, roleId } of store.topRoleList()) {
    if (!guild.roles.cache.has(roleId)) continue;
    const set = wanted.get(roleId) ?? new Set();
    for (let pos = from; pos <= to && pos <= ranking.length; pos++) set.add(ranking[pos - 1].id);
    wanted.set(roleId, set);
  }
  return wanted;
}

async function sync(guild) {
  const wanted = wantedHolders(guild);
  const roleIds = new Set([...wanted.keys(), ...store.topRoleHeld()]);

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) {
      store.setTopRoleHolders(roleId, []); // роль удалили с сервера
      continue;
    }
    if (!role.editable) {
      warnOnce(
        `${guild.id}:${roleId}`,
        `[top] Не могу выдавать роль «${role.name}» (${roleId}): нужна «Управление ролями» и роль бота выше этой роли.`,
      );
      continue;
    }

    const want = wanted.get(roleId) ?? new Set();
    const have = new Set(store.topRoleHolders(roleId));

    // Выбыл из нужных мест — снимаем (или он ушёл с сервера — просто забываем)
    for (const id of have) {
      if (want.has(id)) continue;
      const member = await fetchMember(guild, id);
      if (member?.roles.cache.has(roleId)) {
        const ok = await member.roles.remove(roleId, REASON).then(
          () => true,
          (err) => (console.error(`[top] Не удалось снять роль у ${id}:`, err.message), false),
        );
        if (!ok) continue;
      }
      have.delete(id);
    }

    // Новые обладатели; если роль у держателя сняли вручную — вернём
    for (const id of want) {
      const known = have.has(id);
      const member = known ? guild.members.cache.get(id) : await fetchMember(guild, id);
      if (!member || member.roles.cache.has(roleId)) {
        if (member) have.add(id);
        continue;
      }
      await member.roles.add(roleId, REASON).then(
        () => have.add(id),
        (err) => console.error(`[top] Не удалось выдать роль ${id}:`, err.message),
      );
    }

    const next = [...have];
    const prev = store.topRoleHolders(roleId);
    if (next.length !== prev.length || next.some((id) => !prev.includes(id))) store.setTopRoleHolders(roleId, next);
  }
}

// Синхронизации идут строго по очереди: иначе два сообщения подряд выдали бы роль дважды
let queue = Promise.resolve();
let pending = false;

// Подтягивает роли за топ к текущему рейтингу. Повторные вызовы, пока идёт синхронизация,
// склеиваются в один следующий проход.
function syncTopRoles(guild) {
  if (!guild) return queue;
  if (pending) return queue;
  if (store.topRoleList().length === 0 && store.topRoleHeld().length === 0) return queue;
  pending = true;
  queue = queue
    .then(() => {
      pending = false;
      return sync(guild);
    })
    .catch((err) => console.error('[top] Ошибка синхронизации:', err));
  return queue;
}

module.exports = { syncTopRoles };
