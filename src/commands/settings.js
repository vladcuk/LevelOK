const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  RoleSelectMenuBuilder,
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
  level: { min: 1, max: 1000 },
};

const MAX_REWARDS = 20;
// Лимит Components V2 — 40 компонентов на сообщение; пункт награды занимает 3 (секция, текст, кнопка)
const REWARDS_PER_PAGE = 5;

// ───────────── форматирование ─────────────

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

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function totalLine() {
  const s = store.settings;
  const effMin = Math.round(s.xpMin * s.multiplier);
  const effMax = Math.round(s.xpMax * s.multiplier);
  const frequency =
    s.cooldown === 0 ? 'за каждое сообщение' : `не чаще чем раз в **${formatDuration(s.cooldown)}**`;
  return `📊 **Итого:** участник получает **${effMin}–${effMax} XP** ${frequency}.`;
}

function rewardsSummary() {
  const count = store.rewardList().length;
  if (count === 0) return 'Награды не настроены';
  const mode = store.rewards.stacking ? 'суммируются' : 'только высшая';
  return `${count} ${plural(count, 'награда', 'награды', 'наград')} · ${mode}`;
}

// ───────────── Components V2: заготовки ─────────────

const text = (markdown) => new TextDisplayBuilder().setContent(markdown);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const row = (...components) => new ActionRowBuilder().addComponents(...components);

function button(customId, label, style, emoji) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

// Меню служит только для выбора категории; текущая отмечена, поэтому «Назад» не нужен
function categoryMenu(active) {
  return new StringSelectMenuBuilder()
    .setCustomId('settings:cat')
    .setPlaceholder('Категория настроек')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setValue('xp')
        .setLabel('Опыт')
        .setDescription('Опыт за сообщение, интервал и множитель')
        .setEmoji('✨')
        .setDefault(active === 'xp'),
      new StringSelectMenuOptionBuilder()
        .setValue('rewards')
        .setLabel('Роли награды')
        .setDescription(rewardsSummary())
        .setEmoji('🏆')
        .setDefault(active === 'rewards'),
    );
}

// Каркас любого экрана: заголовок, меню категорий, разделитель
function frame(category, title, description) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(text(`## ${title}\n${description}`))
    .addActionRowComponents(row(categoryMenu(category)))
    .addSeparatorComponents(divider());
}

// Components V2 не сочетаются с content/embeds, поэтому «футер» — это мелкий текст внизу
function view(container, notice) {
  if (notice) container.addTextDisplayComponents(text(`-# ${notice}`));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ───────────── категория «Опыт» ─────────────

const ITEMS = {
  xp: {
    emoji: '✨',
    title: 'Опыт за сообщение',
    hint: 'случайно от минимума до максимума',
    value: (s) => `${s.xpMin} – ${s.xpMax} XP`,
  },
  cooldown: {
    emoji: '⏱️',
    title: 'Интервал',
    hint: 'как часто один участник получает опыт',
    value: (s) => formatDuration(s.cooldown),
  },
  multiplier: {
    emoji: '📈',
    title: 'Общий множитель',
    hint: `умножает весь опыт, от ×${LIMITS.multiplier.min} до ×${LIMITS.multiplier.max}`,
    value: (s) => formatMultiplier(s.multiplier),
  },
};

function xpView(notice) {
  const s = store.settings;
  const container = frame('xp', '✨ Опыт', 'Сколько опыта и как часто участники получают его за сообщения.');

  // У каждого пункта своя кнопка
  for (const [kind, item] of Object.entries(ITEMS)) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            `**${item.emoji} ${item.title}** · \`${item.value(s)}\`\n` +
              `-# ${item.hint} · по умолчанию ${item.value(DEFAULT_SETTINGS)}`,
          ),
        )
        .setButtonAccessory(button(`settings:edit:${kind}`, 'Изменить', ButtonStyle.Primary, '✏️')),
    );
  }

  container
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(totalLine()))
    .addActionRowComponents(row(button('settings:reset', 'Сбросить к умолчаниям', ButtonStyle.Secondary, '🔄')));

  return view(container, notice);
}

// ───────────── категория «Роли награды» ─────────────

// На какой странице списка находится награда за уровень
function pageOf(level) {
  const idx = store.rewardList().findIndex((r) => r.level === level);
  return idx === -1 ? 0 : Math.floor(idx / REWARDS_PER_PAGE);
}

// Роль может быть удалена или недоступна боту (ниже по иерархии / нет «Управления ролями»)
function describeReward(guild, { level, roleId }) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return `**Уровень ${level}** → \`роль удалена\` ⚠️`;
  return `**Уровень ${level}** → <@&${roleId}>${role.editable ? '' : ' ⚠️'}`;
}

async function rewardsView(guild, page = 0, notice) {
  await guild.members.fetchMe().catch(() => null); // для проверки role.editable
  const list = store.rewardList();
  const stacking = store.rewards.stacking;
  const pages = Math.max(1, Math.ceil(list.length / REWARDS_PER_PAGE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const slice = list.slice(current * REWARDS_PER_PAGE, (current + 1) * REWARDS_PER_PAGE);
  const broken = list.some(({ roleId }) => !guild.roles.cache.get(roleId)?.editable);

  const container = frame('rewards', '🏆 Роли награды', 'Бот сам выдаёт роль, когда участник достигает уровня.');

  if (slice.length === 0) {
    container.addTextDisplayComponents(text('*Наград пока нет — нажмите «Добавить роль».*'));
  }
  // У каждой награды своя кнопка
  for (const reward of slice) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(describeReward(guild, reward)))
        .setButtonAccessory(button(`settings:rw-edit:${reward.level}`, 'Изменить', ButtonStyle.Secondary, '✏️')),
    );
  }
  if (broken) {
    container.addTextDisplayComponents(
      text('-# ⚠️ Бот не может выдать роль: нужно право «Управление ролями» и роль бота выше награды в списке ролей сервера.'),
    );
  }

  const controls = [button(`settings:rw-add`, 'Добавить роль', ButtonStyle.Success, '➕')];
  if (pages > 1) {
    controls.push(
      button(`settings:rw-page:${current - 1}`, '◀', ButtonStyle.Secondary).setDisabled(current === 0),
      button('settings:rw-noop', `${current + 1}/${pages}`, ButtonStyle.Secondary).setDisabled(true),
      button(`settings:rw-page:${current + 1}`, '▶', ButtonStyle.Secondary).setDisabled(current === pages - 1),
    );
  }

  container
    .addSeparatorComponents(divider())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            stacking
              ? '🔁 **Суммирование ролей** · включено\n-# Участник сохраняет роли за все достигнутые уровни.'
              : '🔁 **Суммирование ролей** · выключено\n-# У участника остаётся только роль за самый высокий достигнутый уровень.',
          ),
        )
        .setButtonAccessory(
          stacking
            ? button(`settings:rw-stack:${current}`, 'Выключить', ButtonStyle.Secondary)
            : button(`settings:rw-stack:${current}`, 'Включить', ButtonStyle.Success),
        ),
    )
    .addActionRowComponents(row(...controls));

  return view(container, notice);
}

// Выбор роли для уровня: и для новой награды, и для существующей (там же её можно удалить)
function pickRoleView(guild, level, notice) {
  const existing = store.rewards.roles[level];
  const container = frame(
    'rewards',
    `🏆 Роль за ${level} уровень`,
    `Выберите роль, которая будет выдаваться при достижении **${level}** уровня.` +
      (existing ? `\nСейчас: <@&${existing}>` : ''),
  );

  const select = new RoleSelectMenuBuilder()
    .setCustomId(`settings:rw-pick:${level}`)
    .setPlaceholder('Выберите роль…')
    .setMinValues(1)
    .setMaxValues(1);
  if (existing && guild.roles.cache.has(existing)) select.setDefaultRoles(existing);

  const actions = [];
  if (existing) actions.push(button(`settings:rw-del:${level}`, 'Удалить награду', ButtonStyle.Danger, '🗑️'));
  actions.push(button(`settings:rw-page:${pageOf(level)}`, 'Отмена', ButtonStyle.Secondary, '✖️'));

  container.addActionRowComponents(row(select)).addActionRowComponents(row(...actions));
  return view(container, notice);
}

// ───────────── модальные окна ─────────────

function input(id, label, value, placeholder) {
  const field = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10)
    .setPlaceholder(placeholder);
  if (value !== undefined) field.setValue(String(value));
  return new ActionRowBuilder().addComponents(field);
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
    case 'level':
      return modal
        .setTitle('Уровень награды')
        .addComponents(
          input('level', `Уровень (${LIMITS.level.min}–${LIMITS.level.max})`, undefined, 'например, 10'),
        );
    default:
      return null;
  }
}

const INTEGER_RE = /^-?\d+$/;
const DECIMAL_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

// Строгий разбор: Number() принимает пустую строку (как 0), «0x10», «1e3» и т.п.
function parseNumber(raw, { integer }) {
  let value = String(raw).trim().replace(',', '.');
  if (!integer) value = value.replace(/^[x×х]|[x×х]$/gi, '').trim();
  if (!(integer ? INTEGER_RE : DECIMAL_RE).test(value)) return null;
  return Number(value);
}

// Возвращает { patch } (настройки опыта), { level } (уровень награды) или { error }
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
  if (kind === 'level') {
    const level = parseNumber(fields.getTextInputValue('level'), { integer: true });
    const { min: lo, max: hi } = LIMITS.level;
    if (level === null || level < lo || level > hi) return { error: `Уровень — целое число от ${lo} до ${hi}.` };
    return { level };
  }
  return { error: 'Неизвестная настройка.' };
}

// ───────────── обработчики ─────────────

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const NO_ACCESS = ephemeral('Нужно право «Управлять сервером».');

function rewardsFull(level) {
  return store.rewardList().length >= MAX_REWARDS && !(level in store.rewards.roles);
}

const validLevel = (level) =>
  Number.isInteger(level) && level >= LIMITS.level.min && level <= LIMITS.level.max;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Общие настройки системы опыта')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(NO_ACCESS);
    await interaction.reply({ ...xpView(), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  },

  // Кнопки и меню: customId = settings:<действие>[:<аргумент>]
  async handleComponent(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(NO_ACCESS);
    const [, action, arg] = interaction.customId.split(':');
    const { guild } = interaction;

    switch (action) {
      // Меню категорий
      case 'cat':
        return interaction.update(interaction.values[0] === 'rewards' ? await rewardsView(guild) : xpView());

      // Категория «Опыт»
      case 'edit': {
        const modal = buildModal(arg);
        if (modal) await interaction.showModal(modal);
        return;
      }
      case 'reset':
        store.updateSettings({ ...DEFAULT_SETTINGS });
        return interaction.update(xpView('🔄 Параметры опыта сброшены по умолчанию.'));

      // Категория «Роли награды»
      case 'rw-page':
        return interaction.update(await rewardsView(guild, Number(arg)));
      case 'rw-noop':
        return interaction.deferUpdate();
      case 'rw-add':
        return interaction.showModal(buildModal('level'));
      case 'rw-stack': {
        const enabled = !store.rewards.stacking;
        store.setStacking(enabled);
        return interaction.update(
          await rewardsView(
            guild,
            Number(arg),
            `✅ Суммирование ${enabled ? 'включено' : 'выключено'}. Роли обновятся, когда участник в следующий раз получит опыт.`,
          ),
        );
      }
      case 'rw-edit': {
        const level = Number(arg);
        if (!(level in store.rewards.roles)) return interaction.update(await rewardsView(guild));
        return interaction.update(pickRoleView(guild, level));
      }
      case 'rw-del': {
        const level = Number(arg);
        const page = pageOf(level);
        store.removeReward(level);
        return interaction.update(
          await rewardsView(guild, page, `🗑️ Награда за ${level} уровень удалена. Уже выданные роли остаются у участников.`),
        );
      }
      case 'rw-pick': {
        const level = Number(arg);
        if (!validLevel(level)) return interaction.update(await rewardsView(guild));
        if (rewardsFull(level)) {
          return interaction.update(await rewardsView(guild, 0, `❌ Можно настроить не более ${MAX_REWARDS} наград.`));
        }
        const role = guild.roles.cache.get(interaction.values[0]);
        if (!role || role.id === guild.id) {
          return interaction.update(pickRoleView(guild, level, '❌ Эту роль выбрать нельзя. Выберите другую.'));
        }
        if (role.managed) {
          return interaction.update(
            pickRoleView(guild, level, '❌ Эта роль управляется интеграцией или ботом — выдать её нельзя. Выберите другую.'),
          );
        }
        store.setReward(level, role.id);
        return interaction.update(
          await rewardsView(guild, pageOf(level), `✅ Награда за ${level} уровень сохранена: ${role.name}.`),
        );
      }
      default:
        // Кнопки старых панелей (до перехода на Components V2 и до смены раскладки)
        return interaction.reply(ephemeral('Эта панель устарела — откройте /settings заново.'));
    }
  },

  async handleModal(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(NO_ACCESS);
    const kind = interaction.customId.split(':')[1];
    const { patch, level, error } = validate(kind, interaction.fields);
    if (error) return interaction.reply(ephemeral(`❌ ${error}`));

    if (kind === 'level') {
      if (rewardsFull(level)) return interaction.reply(ephemeral(`❌ Можно настроить не более ${MAX_REWARDS} наград.`));
      return interaction.update(pickRoleView(interaction.guild, level));
    }

    store.updateSettings(patch);
    await interaction.update(xpView('✅ Сохранено.'));
  },
};
