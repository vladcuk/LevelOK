const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { store } = require('../store');
const { levelInfo } = require('../levels');

const PAGE_SIZE = 10;
const ACCENT = 0x3f7cff;
const MEDALS = ['🥇', '🥈', '🥉'];
const nf = new Intl.NumberFormat('ru-RU');

async function resolveName(guild, id) {
  const member = await guild.members.fetch(id).catch(() => null);
  if (member) return member.displayName;
  const user = await guild.client.users.fetch(id).catch(() => null);
  return user ? user.username : 'Неизвестный';
}

function escape(text) {
  return text.replace(/([*_`~|\\>])/g, '\\$1');
}

async function buildPage(guild, viewerId, page) {
  const ranking = store.ranking();
  const pages = Math.max(1, Math.ceil(ranking.length / PAGE_SIZE));
  page = Math.min(Math.max(0, page), pages - 1);

  const slice = ranking.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const names = await Promise.all(slice.map((u) => resolveName(guild, u.id)));

  const lines = slice.map((u, i) => {
    const pos = page * PAGE_SIZE + i + 1;
    const badge = MEDALS[pos - 1] ?? `\`#${String(pos).padStart(2, ' ')}\``;
    const { level } = levelInfo(u.xp);
    const name = escape(names[i]);
    const nameStr = u.id === viewerId ? `__**${name}**__` : `**${name}**`;
    return `${badge} ${nameStr}\n┗ Уровень **${level}** · ${nf.format(u.xp)} XP`;
  });

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({ name: `Таблица лидеров · ${guild.name}`, iconURL: guild.iconURL() ?? undefined })
    .setDescription(lines.length ? lines.join('\n\n') : 'Пока никто не набрал опыта. Начните общаться!');

  const viewerRank = store.rankOf(viewerId);
  const footer = [`Страница ${page + 1} из ${pages}`];
  if (viewerRank) {
    const viewer = store.getUser(viewerId);
    footer.push(`Ваше место: #${viewerRank} · ${nf.format(viewer.xp)} XP`);
  }
  embed.setFooter({ text: footer.join('  •  ') });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb:${page - 1}`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`lb:${page + 1}`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages - 1),
  );

  return { embeds: [embed], components: pages > 1 ? [row] : [] };
}

module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Таблица лидеров по опыту'),

  async execute(interaction) {
    await interaction.deferReply();
    await interaction.editReply(await buildPage(interaction.guild, interaction.user.id, 0));
  },

  async handleButton(interaction) {
    const page = Number(interaction.customId.split(':')[1]) || 0;
    await interaction.deferUpdate();
    await interaction.editReply(await buildPage(interaction.guild, interaction.user.id, page));
  },
};
