require('dotenv').config();

const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const { store } = require('./store');
const { levelInfo, randomXp } = require('./levels');

const commands = [require('./commands/rank'), require('./commands/leaderboard'), require('./commands/settings')];
const byName = new Map(commands.map((c) => [c.data.name, c]));

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN) {
  console.error('Не задан DISCORD_TOKEN. Скопируйте .env.example в .env и впишите токен.');
  process.exit(1);
}

const client = new Client({
  // MessageContent не нужен: опыт начисляется за сам факт сообщения
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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
  }
});

client.on(Events.GuildCreate, (guild) => {
  if (isTargetGuild(guild.id)) registerCommands(guild).catch(console.error);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild() || !isTargetGuild(message.guildId)) return;

  const settings = store.settings;
  const user = store.getUser(message.author.id);
  const now = Date.now();

  user.messages += 1;
  if (now - user.lastXpAt < settings.cooldown * 1000) {
    store.setUser(message.author.id, user);
    return;
  }

  const before = levelInfo(user.xp).level;
  user.xp += randomXp(settings);
  user.lastXpAt = now;
  store.setUser(message.author.id, user);

  const after = levelInfo(user.xp).level;
  if (after > before) {
    message.channel
      .send({
        content: `🎉 ${message.author}, поздравляем! Вы достигли **${after}** уровня.`,
        allowedMentions: { users: [message.author.id] },
      })
      .catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild() || !isTargetGuild(interaction.guildId)) return;

  try {
    if (interaction.isChatInputCommand()) {
      await byName.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isButton()) {
      const [prefix] = interaction.customId.split(':');
      if (prefix === 'lb') await byName.get('leaderboard').handleButton(interaction);
      if (prefix === 'settings') await byName.get('settings').handleButton(interaction);
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

client.login(DISCORD_TOKEN);
