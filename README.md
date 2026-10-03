# LevelOK

Discord-бот опыта и уровней для одного сервера. Написан на [discord.js v14](https://discord.js.org), карточка ранга рисуется через `@napi-rs/canvas`.

## Команды

| Команда | Кто может | Что делает |
| --- | --- | --- |
| `/rank [пользователь]` | все | Карточка ранга: место, уровень, опыт на уровне / до следующего уровня, общий опыт, сообщения |
| `/leaderboard` | все | Таблица лидеров с переключением страниц |
| `/settings` | право «Управлять сервером» | «Общие настройки»: опыт мин/макс, интервал, общий множитель (×0.1 – ×10) |

Опыт начисляется за сообщения: случайно от `мин` до `макс`, умножается на общий множитель, не чаще одного раза за интервал. При повышении уровня бот поздравляет участника в том же канале.

Кривая уровней: чтобы перейти с уровня `N` на `N+1`, нужно `5·N² + 50·N + 100` XP (100, 155, 220, 295, …).

## Запуск

### 1. Что нужно

- [Node.js](https://nodejs.org) **18.17 или новее** (рекомендуется 20 или 22 LTS).
- Бот в [Discord Developer Portal](https://discord.com/developers/applications).

### 2. Настройка бота в Developer Portal

1. **Bot → Reset Token** — скопируйте токен. Никому его не показывайте и не заливайте в git.
2. Privileged Gateway Intents включать **не нужно** — бот обходится без них.
3. **OAuth2 → URL Generator**: отметьте scopes `bot` и `applications.commands`, в Bot Permissions — `View Channels`, `Send Messages`, `Embed Links`, `Attach Files`. Откройте полученную ссылку и добавьте бота на свой сервер.

   Или используйте готовую ссылку, подставив ID приложения (General Information → Application ID):

   ```
   https://discord.com/oauth2/authorize?client_id=ВАШ_APPLICATION_ID&scope=bot+applications.commands&permissions=52224
   ```

### 3. Установка

```bash
git clone https://github.com/vladcuk/LevelOK.git
cd LevelOK
npm install
```

Скопируйте `.env.example` в `.env` (Windows: `copy .env.example .env`, Linux/macOS: `cp .env.example .env`) и заполните:

```env
DISCORD_TOKEN=ваш_токен
GUILD_ID=id_вашего_сервера
```

`GUILD_ID` — ПКМ по серверу → «Копировать ID сервера» (нужен включённый «Режим разработчика» в настройках Discord → Расширенные). Если оставить пустым, бот зарегистрирует команды на всех серверах, где он состоит.

### 4. Старт

```bash
npm start
```

В консоли появится `Вошёл как ...` и `Зарегистрированы на сервере ...` — команды сразу доступны на сервере.

### Работа 24/7

Бот работает, пока запущен процесс. Чтобы он был онлайн постоянно, запустите его на VPS/хостинге, например через [pm2](https://pm2.keymetrics.io):

```bash
npm install -g pm2
pm2 start src/index.js --name levelok
pm2 save
pm2 startup   # автозапуск после перезагрузки сервера
```

## Данные

Опыт и настройки хранятся в `data/db.json` (создаётся автоматически, в git не попадает). Для переноса бота на другую машину просто скопируйте эту папку. Делайте её резервные копии.

## Структура

```
src/
  index.js              запуск, начисление опыта, обработка взаимодействий
  store.js              хранилище (JSON) и настройки по умолчанию
  levels.js             формула уровней и расчёт опыта
  card.js               отрисовка карточки ранга
  commands/
    rank.js
    leaderboard.js
    settings.js
scripts/preview-card.js   npm run preview → preview.png (пример карточки без запуска бота)
assets/fonts/             шрифт Inter (SIL Open Font License)
```
