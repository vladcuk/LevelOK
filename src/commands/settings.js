const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { store, DEFAULT_SETTINGS } = require('../store');

const ACCENT = 0x3f7cff;

const LIMITS = {
  xp: { min: 0, max: 1000 },
  cooldown: { min: 0, max: 86400 },
  multiplier: { min: 0.1, max: 10 },
};

function formatMultiplier(m) {
  return `×${Number(m.toFixed(2))}`;
}

function formatDuration(sec) {
  if (sec === 0) return 'без задержки';
  const parts = [];
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) parts.push(`${h} ч`);
  if (m) parts.push(`${m} мин`);
  if (s) parts.push(`${s} сек`);
  return parts.join(' ');
}

function buildPanel(notice) {
  const s = store.settings;
  const effMin = Math.round(s.xpMin * s.multiplier);
  const effMax = Math.round(s.xpMax * s.multiplier);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('⚙️ Общие настройки')
    .setDescription('Параметры начисления опыта за сообщения на сервере.')
    .addFields(
      { name: 'Опыт за сообщение', value: `\`${s.xpMin} – ${s.xpMax} XP\``, inline: true },
      { name: 'Интервал', value: `\`${formatDuration(s.cooldown)}\``, inline: true },
      { name: 'Общий множитель', value: `\`${formatMultiplier(s.multiplier)}\``, inline: true },
      {
        name: 'Итого',
        value: `Участник получает **${effMin}–${effMax} XP** не чаще чем раз в **${formatDuration(s.cooldown)}**.`,
      },
    );
  if (notice) embed.setFooter({ text: notice });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('settings:xp').setLabel('Опыт мин/макс').setEmoji('✨').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('settings:cooldown').setLabel('Интервал').setEmoji('⏱️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('settings:multiplier').setLabel('Множитель').setEmoji('📈').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('settings:reset').setLabel('Сбросить').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function input(id, label, value, placeholder) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10)
      .setValue(String(value))
      .setPlaceholder(placeholder),
  );
}

function buildModal(kind) {
  const s = store.settings;
  const modal = new ModalBuilder().setCustomId(`settings-modal:${kind}`);
  switch (kind) {
    case 'xp':
      return modal
        .setTitle('Опыт за сообщение')
        .addComponents(
          input('xpMin', 'Минимум XP', s.xpMin, `${LIMITS.xp.min}–${LIMITS.xp.max}`),
          input('xpMax', 'Максимум XP', s.xpMax, `${LIMITS.xp.min}–${LIMITS.xp.max}`),
        );
    case 'cooldown':
      return modal
        .setTitle('Интервал начисления')
        .addComponents(input('cooldown', 'Интервал в секундах', s.cooldown, 'например, 60'));
    case 'multiplier':
      return modal
        .setTitle('Общий множитель')
        .addComponents(input('multiplier', 'Множитель (от 0.1 до 10)', s.multiplier, 'например, 1.5'));
    default:
      return null;
  }
}

function parseNumber(raw, { integer }) {
  const n = Number(String(raw).trim().replace(',', '.').replace(/^[x×х]|[x×х]$/gi, ''));
  if (!Number.isFinite(n)) return null;
  if (integer && !Number.isInteger(n)) return null;
  return n;
}

// Возвращает либо { patch }, либо { error }
function validate(kind, fields) {
  if (kind === 'xp') {
    const min = parseNumber(fields.getTextInputValue('xpMin'), { integer: true });
    const max = parseNumber(fields.getTextInputValue('xpMax'), { integer: true });
    const { min: lo, max: hi } = LIMITS.xp;
    if (min === null || max === null) return { error: 'Опыт должен быть целым числом.' };
    if (min < lo || max > hi) return { error: `Опыт должен быть в диапазоне ${lo}–${hi}.` };
    if (min > max) return { error: 'Минимум не может быть больше максимума.' };
    return { patch: { xpMin: min, xpMax: max } };
  }
  if (kind === 'cooldown') {
    const sec = parseNumber(fields.getTextInputValue('cooldown'), { integer: true });
    const { min: lo, max: hi } = LIMITS.cooldown;
    if (sec === null || sec < lo || sec > hi) return { error: `Интервал — целое число секунд от ${lo} до ${hi}.` };
    return { patch: { cooldown: sec } };
  }
  if (kind === 'multiplier') {
    const m = parseNumber(fields.getTextInputValue('multiplier'), { integer: false });
    const { min: lo, max: hi } = LIMITS.multiplier;
    if (m === null || m < lo || m > hi) return { error: `Множитель должен быть от ${lo} до ${hi}.` };
    return { patch: { multiplier: Math.round(m * 100) / 100 } };
  }
  return { error: 'Неизвестная настройка.' };
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Общие настройки системы опыта')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: 'Нужно право «Управлять сервером».', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ ...buildPanel(), flags: MessageFlags.Ephemeral });
  },

  async handleButton(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: 'Нужно право «Управлять сервером».', flags: MessageFlags.Ephemeral });
    }
    const kind = interaction.customId.split(':')[1];
    if (kind === 'reset') {
      store.updateSettings({ ...DEFAULT_SETTINGS });
      return interaction.update(buildPanel('Настройки сброшены по умолчанию.'));
    }
    const modal = buildModal(kind);
    if (modal) await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: 'Нужно право «Управлять сервером».', flags: MessageFlags.Ephemeral });
    }
    const kind = interaction.customId.split(':')[1];
    const { patch, error } = validate(kind, interaction.fields);
    if (error) {
      return interaction.reply({ content: `❌ ${error}`, flags: MessageFlags.Ephemeral });
    }
    store.updateSettings(patch);
    await interaction.update(buildPanel('✅ Сохранено.'));
  },
};
