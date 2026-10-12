require('dotenv').config();

const { Client, GatewayIntentBits, Events, MessageFlags, REST, Routes, ApplicationFlags } = require('discord.js');
const { store } = require('./store');
const { levelInfo, randomXp } = require('./levels');
const { applyRewards } = require('./rewards');
const { effectiveMultiplier } = require('./multipliers');
const { renderLevelUp, xpAllowedIn } = require('./levelup');
const { syncTopRoles } = require('./toproles');

const commands = [
  require('./commands/rank'),
  require('./commands/leaderboard'),
  require('./commands/settings'),
  require('./commands/xp'),
  require('./commands/level'),
];
const byName = new Map(commands.map((c) => [c.data.name, c]));

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN) {
  console.error('Не задан DISCORD_TOKEN. Скопируйте .env.example в .env и впишите токен.');
  process.exit(1);
}

// «Server Members Intent» — привилегированный: если его не включили на портале разработчика,
// бот с ним не подключится. Поэтому спрашиваем у Discord и без него просто не узнаём о выходах.
async function hasMembersIntent() {
  try {
    const app = await new REST().setToken(DISCORD_TOKEN).get(Routes.currentApplication());
    const flags = BigInt(app.flags ?? 0);
    const mask = BigInt(ApplicationFlags.GatewayGuildMembers | ApplicationFlags.GatewayGuildMembersLimited);
    return (flags & mask) !== 0n;
  } catch (err) {
    console.warn('[intents] Не удалось проверить Server Members Intent:', err.message);
    return false;
  }
}

const client = new Client({
  // MessageContent не нужен: опыт начисляется за сам факт сообщения.
  // GuildModeration (не привилегированный) — чтобы узнавать о банах.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildModeration],
});

// Бот рассчитан на один сервер: если GUILD_ID задан, остальные игнорируются
const isTargetGuild = (guildId) => !GUILD_ID || guildId === GUILD_ID;

async function registerCommands(guild) {
  await guild.commands.set(commands.map((c) => c.data.toJSON()));
  console.log(`[commands] Зарегистрированы на сервере «${guild.name}» (${guild.id})`);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] Вошёл как ${c.user.tag}`);
  const guilds = [...c.guilds.cache.values()].filter((g) => isTargetGuild(g.id));
  if (guilds.length === 0) {
    console.warn('[ready] Бот не находится на нужном сервере. Пригласите его по ссылке из README.');
  }
  for (const guild of guilds) {
    await registerCommands(guild).catch((err) => console.error('[commands] Ошибка регистрации:', err));
    syncTopRoles(guild);
  }
  if (!client.options.intents.has(GatewayIntentBits.GuildMembers)) {
    console.warn(
      '[intents] Server Members Intent выключен — обнуление опыта при выходе с сервера работать не будет. ' +
        'Включите его: Developer Portal → Bot → Privileged Gateway Intents.',
    );
  }
});

// Истёкшие временные множители не действуют и без этого, но убираем их и из базы
setInterval(() => store.purgeExpiredMultipliers(), 10 * 60 * 1000).unref();

client.on(Events.GuildCreate, (guild) => {
  if (isTargetGuild(guild.id)) registerCommands(guild).catch(console.error);
});

// Обнуление опыта при выходе/бане (/settings → «Другое»). Бан тоже вызывает «выход»,
// поэтому при бане опыт обнуляется по своей настройке, а не по настройке выхода.
function resetUser(guild, userId, reason) {
  if (!store.deleteUser(userId)) return;
  console.log(`[reset] Опыт ${userId} обнулён: ${reason}`);
  syncTopRoles(guild);
}

client.on(Events.GuildMemberRemove, (member) => {
  if (!isTargetGuild(member.guild.id) || member.user?.bot) return;
  if (store.other.resetOnLeave) resetUser(member.guild, member.id, 'вышел с сервера');
});

client.on(Events.GuildBanAdd, (ban) => {
  if (!isTargetGuild(ban.guild.id) || ban.user.bot) return;
  if (store.other.resetOnBan) resetUser(ban.guild, ban.user.id, 'бан');
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild() || !isTargetGuild(message.guildId)) return;

  const settings = store.settings;
  // В ветках и постах форумов опыт можно отключить в /settings → «Опыт»
  if (!xpAllowedIn(message.channel, settings)) return;

  const user = store.getUser(message.author.id);
  const now = Date.now();

  user.messages += 1;
  if (now - user.lastXpAt < settings.cooldown * 1000) {
    store.setUser(message.author.id, user);
    return;
  }

  const before = levelInfo(user.xp).level;
  // Из общего множителя и подходящих правил (канал/категория/роли) берётся наибольший
  user.xp += randomXp({ ...settings, multiplier: effectiveMultiplier(message).value });
  user.lastXpAt = now;
  store.setUser(message.author.id, user);

  const after = levelInfo(user.xp).level;

  // Синхронизируем и без повышения уровня: так роли подтянутся, если награду
  // настроили уже после того, как участник набрал нужный уровень.
  const { added } = await applyRewards(message.member, after);
  // Место в рейтинге могло измениться
  syncTopRoles(message.guild);

  if (after > before && store.levelUp.enabled) {
    const content = renderLevelUp(store.levelUp.message, {
      userId: message.author.id,
      name: message.member?.displayName ?? message.author.displayName,
      level: after,
      rewards: added,
    });
    message.channel
      .send({
        content,
        allowedMentions: { users: [message.author.id] }, // роли и @everyone в сообщении не пингуются
      })
      .catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild() || !isTargetGuild(interaction.guildId)) return;

  try {
    if (interaction.isChatInputCommand()) {
      await byName.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isMessageComponent()) {
      const [prefix] = interaction.customId.split(':');
      if (prefix === 'lb' && interaction.isButton()) await byName.get('leaderboard').handleButton(interaction);
      if (prefix === 'settings') await byName.get('settings').handleComponent(interaction);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('settings-modal:')) await byName.get('settings').handleModal(interaction);
    }
  } catch (err) {
    console.error('[interaction] Ошибка:', err);
    const payload = { content: 'Произошла ошибка при выполнении команды.', flags: MessageFlags.Ephemeral };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  }
});

// Сохраняем базу при остановке
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    store.saveNow();
    client.destroy();
    process.exit(0);
  });
}

hasMembersIntent().then((enabled) => {
  // Интенты читаются только при подключении, так что их можно дополнить до login()
  if (enabled) client.options.intents = client.options.intents.add(GatewayIntentBits.GuildMembers).freeze();
  return client.login(DISCORD_TOKEN);
});
