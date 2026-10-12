const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { renderUserCard } = require('../rankcard');

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
    const png = await renderUserCard(user, member);

    await interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'rank.png' })] });
  },
};
