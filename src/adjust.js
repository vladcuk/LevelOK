const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { store } = require('./store');
const { levelInfo, totalXpForLevel, xpForLevel } = require('./levels');
const { applyRewards } = require('./rewards');
const { syncTopRoles } = require('./toproles');
const { formatCompact } = require('./format');

const MAX_LEVEL = 1000;
const MAX_XP = totalXpForLevel(MAX_LEVEL); // ≈1.7B — дальше уровни не считаем

const KINDS = {
  xp: {
    description: 'Изменить опыт участника',
    amount: 'Количество опыта',
    max: MAX_XP,
  },
  level: {
    description: 'Изменить уровень участника',
    amount: 'Количество уровней',
    max: MAX_LEVEL,
  },
};

const ACTIONS = [
  ['add', 'добавить', 'Добавить', 1],
  ['remove', 'убавить', 'Убавить', 1],
  ['set', 'установить', 'Установить', 0],
];

function buildCommand(kind) {
  const k = KINDS[kind];
  const cmd = new SlashCommandBuilder()
    .setName(kind)
    .setDescription(k.description)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  for (const [name, ru, verb, min] of ACTIONS) {
    cmd.addSubcommand((sc) =>
      sc
        .setName(name)
        .setNameLocalizations({ ru })
        .setDescription(`${verb} ${kind === 'xp' ? 'опыт' : 'уровень'}`)
        .addUserOption((o) => o.setName('пользователь').setDescription('Участник').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('количество')
            .setDescription(name === 'set' ? (kind === 'xp' ? 'Новый общий опыт' : 'Новый уровень') : k.amount)
            .setRequired(true)
            .setMinValue(min)
            .setMaxValue(k.max),
        ),
    );
  }
  return cmd;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

// Новый общий опыт после операции.
// Для уровня при add/remove сохраняем прогресс внутри уровня, при set — начало уровня.
function computeXp(kind, action, amount, xp) {
  if (kind === 'xp') {
    if (action === 'add') return clamp(xp + amount, 0, MAX_XP);
    if (action === 'remove') return clamp(xp - amount, 0, MAX_XP);
    return clamp(amount, 0, MAX_XP);
  }
  const { level, current } = levelInfo(xp);
  if (action === 'set') return totalXpForLevel(clamp(amount, 0, MAX_LEVEL));
  const target = clamp(action === 'add' ? level + amount : level - amount, 0, MAX_LEVEL);
  const progress = Math.min(current, xpForLevel(target) - 1);
  return Math.min(totalXpForLevel(target) + progress, MAX_XP);
}

const roles = (ids) => ids.map((id) => `<@&${id}>`).join(' ');

async function run(interaction, kind) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Нужно право «Управлять сервером».', flags: MessageFlags.Ephemeral });
  }
  const action = interaction.options.getSubcommand();
  const user = interaction.options.getUser('пользователь', true);
  const amount = interaction.options.getInteger('количество', true);
  if (user.bot) {
    return interaction.reply({ content: 'У ботов нет опыта.', flags: MessageFlags.Ephemeral });
  }

  const data = store.getUser(user.id);
  const before = levelInfo(data.xp);
  data.xp = computeXp(kind, action, amount, data.xp);
  store.setUser(user.id, data);
  const after = levelInfo(data.xp);

  await interaction.deferReply();
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const { added, removed } = await applyRewards(member, after.level, { revokeAbove: after.level < before.level });
  await syncTopRoles(interaction.guild);

  const diff = data.xp - before.total;
  const lines = [
    `✅ ${user}: опыт **${formatCompact(before.total)} → ${formatCompact(after.total)} XP**` +
      (diff ? ` (${diff > 0 ? '+' : '−'}${formatCompact(Math.abs(diff))})` : ''),
    `Уровень **${before.level} → ${after.level}**`,
  ];
  if (added.length) lines.push(`🎁 Выданы роли: ${roles(added)}`);
  if (removed.length) lines.push(`🗑️ Сняты роли: ${roles(removed)}`);
  if (!member) lines.push('-# Участника нет на сервере — роли-награды не обновлены.');

  await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

module.exports = { buildCommand, run, computeXp, MAX_LEVEL, MAX_XP };
