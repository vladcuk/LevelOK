const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_SETTINGS = {
  xpMin: 15,
  xpMax: 25,
  cooldown: 60, // секунд между начислениями опыта одному пользователю
  multiplier: 1,
  xpInThreads: true, // опыт за сообщения в ветках обычных каналов
  xpInForums: true, // опыт за сообщения в постах форумов
};

// Сообщение о повышении уровня. Переменные: {user} {name} {level} {rewards}
const DEFAULT_LEVEL_UP = {
  enabled: true,
  message: '🎉 {user}, поздравляем! Вы достигли **{level}** уровня.',
};

// Роли-награды за уровни. `roles`: { "<уровень>": "<id роли>" }.
// stacking = true — участник хранит роли за все достигнутые уровни,
// false — только роль за самый высокий достигнутый уровень.
const DEFAULT_REWARDS = {
  stacking: true,
  roles: {},
};

// Оформление ранг-карты. accent2 = null — второй цвет градиента подбирается сам.
// hasImage — в data/ лежит фоновая картинка (см. background.js), dim — её затемнение в %.
const DEFAULT_CARD = {
  accent: '#3f7cff',
  accent2: '#35d0ff',
  background: '#151822',
  hasImage: false,
  dim: 55,
};

// Обнуление опыта участника, когда он покидает сервер или получает бан
const DEFAULT_OTHER = {
  resetOnLeave: false,
  resetOnBan: false,
};

// Роли за место в топе: rules — [{ from, to, roleId }] (from === to — одно место),
// holders — { roleId: [userId] }: кому бот выдал роль, чтобы снять её без кэша участников.
const isValidTopRule = (r) =>
  r && Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 1 && r.to >= r.from && typeof r.roleId === 'string';

// Множители на каналы/категории и роли. Правило: { type: 'channel' | 'role', id, value,
// expiresAt (мс с эпохи или null — бессрочно), createdAt }. На одну цель — одно правило.
// При начислении опыта действует наибольший из подходящих множителей (см. multipliers.js).
const isValidRule = (r) =>
  r &&
  (r.type === 'channel' || r.type === 'role') &&
  typeof r.id === 'string' &&
  Number.isFinite(r.value) &&
  (r.expiresAt == null || Number.isFinite(r.expiresAt));

// Простое JSON-хранилище: бот работает на одном сервере, этого хватает с запасом.
// Запись на диск отложенная (debounce) и атомарная (через временный файл).
class Store {
  constructor() {
    this.data = {
      settings: { ...DEFAULT_SETTINGS },
      rewards: { ...DEFAULT_REWARDS, roles: {} },
      multipliers: { rules: [] },
      levelUp: { ...DEFAULT_LEVEL_UP },
      card: { ...DEFAULT_CARD },
      other: { ...DEFAULT_OTHER },
      topRoles: { rules: [], holders: {} },
      users: {},
    };
    this.saveTimer = null;
    this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      this.data.rewards = {
        stacking: raw.rewards?.stacking ?? DEFAULT_REWARDS.stacking,
        roles: { ...raw.rewards?.roles },
      };
      this.data.multipliers = {
        rules: (Array.isArray(raw.multipliers?.rules) ? raw.multipliers.rules : [])
          .filter(isValidRule)
          .map((r) => ({ ...r, expiresAt: r.expiresAt ?? null, createdAt: r.createdAt ?? Date.now() })),
      };
      this.data.levelUp = { ...DEFAULT_LEVEL_UP, ...raw.levelUp };
      this.data.card = { ...DEFAULT_CARD, ...raw.card };
      this.data.other = { ...DEFAULT_OTHER, ...raw.other };
      this.data.topRoles = {
        rules: (Array.isArray(raw.topRoles?.rules) ? raw.topRoles.rules : []).filter(isValidTopRule),
        holders: { ...raw.topRoles?.holders },
      };
      this.data.users = raw.users ?? {};
    } catch (err) {
      console.error('[store] Не удалось прочитать db.json, начинаю с пустой базы:', err);
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 2000);
  }

  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.scheduleSave();
  }

  get levelUp() {
    return this.data.levelUp;
  }

  updateLevelUp(patch) {
    Object.assign(this.data.levelUp, patch);
    this.scheduleSave();
  }

  get card() {
    return this.data.card;
  }

  updateCard(patch) {
    Object.assign(this.data.card, patch);
    this.scheduleSave();
  }

  get other() {
    return this.data.other;
  }

  updateOther(patch) {
    Object.assign(this.data.other, patch);
    this.scheduleSave();
  }

  // Правила ролей за топ, по возрастанию места
  topRoleList() {
    return [...this.data.topRoles.rules].sort((a, b) => a.from - b.from || a.to - b.to);
  }

  findTopRole(from, to) {
    return this.data.topRoles.rules.find((r) => r.from === from && r.to === to) ?? null;
  }

  // Правило на те же места заменяется
  setTopRole(from, to, roleId) {
    const existing = this.findTopRole(from, to);
    if (existing) existing.roleId = roleId;
    else this.data.topRoles.rules.push({ from, to, roleId });
    this.scheduleSave();
  }

  removeTopRole(from, to) {
    this.data.topRoles.rules = this.data.topRoles.rules.filter((r) => !(r.from === from && r.to === to));
    this.scheduleSave();
  }

  topRoleHolders(roleId) {
    return this.data.topRoles.holders[roleId] ?? [];
  }

  // Все роли, которые бот когда-либо выдал за топ и ещё не снял
  topRoleHeld() {
    return Object.keys(this.data.topRoles.holders);
  }

  setTopRoleHolders(roleId, userIds) {
    if (userIds.length) this.data.topRoles.holders[roleId] = userIds;
    else delete this.data.topRoles.holders[roleId];
    this.scheduleSave();
  }

  get rewards() {
    return this.data.rewards;
  }

  // Награды, отсортированные по уровню: [{ level, roleId }]
  rewardList() {
    return Object.entries(this.data.rewards.roles)
      .map(([level, roleId]) => ({ level: Number(level), roleId }))
      .sort((a, b) => a.level - b.level);
  }

  setReward(level, roleId) {
    this.data.rewards.roles[level] = roleId;
    this.scheduleSave();
  }

  removeReward(level) {
    delete this.data.rewards.roles[level];
    this.scheduleSave();
  }

  setStacking(enabled) {
    this.data.rewards.stacking = Boolean(enabled);
    this.scheduleSave();
  }

  // Действующие правила (без истёкших): сначала самые большие множители
  multiplierRules(now = Date.now()) {
    return this.data.multipliers.rules
      .filter((r) => r.expiresAt === null || r.expiresAt > now)
      .sort((a, b) => b.value - a.value || a.createdAt - b.createdAt);
  }

  findMultiplier(type, id) {
    return this.data.multipliers.rules.find((r) => r.type === type && r.id === id) ?? null;
  }

  // Правило на ту же цель заменяется
  setMultiplier({ type, id, value, expiresAt }) {
    const rules = this.data.multipliers.rules;
    const existing = this.findMultiplier(type, id);
    if (existing) Object.assign(existing, { value, expiresAt });
    else rules.push({ type, id, value, expiresAt, createdAt: Date.now() });
    this.scheduleSave();
  }

  removeMultiplier(type, id) {
    const rules = this.data.multipliers.rules;
    const idx = rules.findIndex((r) => r.type === type && r.id === id);
    if (idx !== -1) rules.splice(idx, 1);
    this.scheduleSave();
  }

  // Убирает истёкшие правила из базы; возвращает, сколько удалено
  purgeExpiredMultipliers(now = Date.now()) {
    const rules = this.data.multipliers.rules;
    const kept = rules.filter((r) => r.expiresAt === null || r.expiresAt > now);
    const removed = rules.length - kept.length;
    if (removed) {
      this.data.multipliers.rules = kept;
      this.scheduleSave();
    }
    return removed;
  }

  getUser(id) {
    return this.data.users[id] ?? { xp: 0, messages: 0, lastXpAt: 0 };
  }

  setUser(id, user) {
    this.data.users[id] = user;
    this.scheduleSave();
  }

  // Полностью удаляет участника из базы (обнуление опыта); true — если было что удалять
  deleteUser(id) {
    if (!(id in this.data.users)) return false;
    delete this.data.users[id];
    this.scheduleSave();
    return true;
  }

  // Все пользователи, отсортированные по опыту (по убыванию)
  ranking() {
    return Object.entries(this.data.users)
      .filter(([, u]) => u.xp > 0)
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => b.xp - a.xp);
  }

  rankOf(id) {
    const idx = this.ranking().findIndex((u) => u.id === id);
    return idx === -1 ? null : idx + 1;
  }
}

module.exports = { store: new Store(), DEFAULT_SETTINGS, DEFAULT_LEVEL_UP, DEFAULT_CARD };
