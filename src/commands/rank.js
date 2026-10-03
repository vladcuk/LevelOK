const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { store } = require('../store');
const { levelInfo } = require('../levels');
const { renderRankCard } = require('../card');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Показать карточку ранга')
    .addUserOption((o) => o.setName('пользователь').setDescription('Чью карточку показать (по умолчанию — вашу)')),

  async execute(interaction) {
    const user = interaction.options.getUser('пользователь') ?? interaction.user;
    if (user.bot) {
      return interaction.reply({ content: 'У ботов нет опыта.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const data = store.getUser(user.id);
    const info = levelInfo(data.xp);

    const png = await renderRankCard({
      displayName: member?.displayName ?? user.globalName ?? user.username,
      username: user.username,
      avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      rank: store.rankOf(user.id),
      messages: data.messages,
      ...info,
    });

    await interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'rank.png' })] });
  },
};
