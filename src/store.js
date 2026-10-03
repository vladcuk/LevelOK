const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_SETTINGS = {
  xpMin: 15,
  xpMax: 25,
  cooldown: 60, // секунд между начислениями опыта одному пользователю
  multiplier: 1,
};

// Простое JSON-хранилище: бот работает на одном сервере, этого хватает с запасом.
// Запись на диск отложенная (debounce) и атомарная (через временный файл).
class Store {
  constructor() {
    this.data = { settings: { ...DEFAULT_SETTINGS }, users: {} };
    this.saveTimer = null;
    this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
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

  getUser(id) {
    return this.data.users[id] ?? { xp: 0, messages: 0, lastXpAt: 0 };
  }

  setUser(id, user) {
    this.data.users[id] = user;
    this.scheduleSave();
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

module.exports = { store: new Store(), DEFAULT_SETTINGS };
