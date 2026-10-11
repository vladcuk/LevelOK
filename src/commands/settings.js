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

// Предел наград: select-меню удаления вмещает 25 пунктов, плюс запас по длине текста панели
const MAX_REWARDS = 20;

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

function xpRange(s) {
  return `${s.xpMin} – ${s.xpMax} XP`;
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
  if (count === 0) return 'не настроены';
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

const backButton = () => button('settings:home', 'Назад', ButtonStyle.Secondary, '↩️');

// Контейнер с заголовком; остальное дописывает конкретная страница
function shell(title, description) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(text(`## ${title}\n${description}`))
    .addSeparatorComponents(divider());
}

// Components V2 не сочетаются с content/embeds, поэтому «футер» — это мелкий текст внизу
function view(container, notice) {
  if (notice) container.addTextDisplayComponents(text(`-# ${notice}`));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ───────────── страницы ─────────────

const PAGES = {
  xp: {
    emoji: '✨',
    title: 'Опыт за сообщение',
    hint: 'Каждое засчитанное сообщение приносит случайное количество опыта — от минимума до максимума.',
    current: (s) => `\`${xpRange(s)}\``,
    option: (s) => xpRange(s),
  },
  cooldown: {
    emoji: '⏱️',
    title: 'Интервал начисления',
    hint: 'Как часто один участник может получать опыт. Сообщения внутри интервала не засчитываются.',
    current: (s) => `\`${formatDuration(s.cooldown)}\``,
    option: (s) => formatDuration(s.cooldown),
  },
  multiplier: {
    emoji: '📈',
    title: 'Общий множитель',
    hint: `Умножает опыт за каждое сообщение. Допустимо от ×${LIMITS.multiplier.min} до ×${LIMITS.multiplier.max}.`,
    current: (s) => `\`${formatMultiplier(s.multiplier)}\``,
    option: (s) => formatMultiplier(s.multiplier),
  },
};

function homeView(notice) {
  const s = store.settings;

  const menu = new StringSelectMenuBuilder()
    .setCustomId('settings:menu')
    .setPlaceholder('Выберите, что настроить…')
    .addOptions(
      ...Object.entries(PAGES).map(([kind, p]) =>
        new StringSelectMenuOptionBuilder()
          .setValue(kind)
          .setLabel(p.title)
          .setDescription(p.option(s))
          .setEmoji(p.emoji),
      ),
      new StringSelectMenuOptionBuilder()
        .setValue('rewards')
        .setLabel('Роли награды')
        .setDescription(rewardsSummary())
        .setEmoji('🏆'),
    );

  const container = shell('⚙️ Общие настройки', 'Параметры системы опыта и наград за уровни.')
    .addTextDisplayComponents(
      text(
        [
          ...Object.values(PAGES).map((p) => `${p.emoji} **${p.title}** · ${p.current(s)}`),
          `🏆 **Роли награды** · ${rewardsSummary()}`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(totalLine()))
    .addSeparatorComponents(divider())
    .addActionRowComponents(row(menu))
    .addActionRowComponents(row(button('settings:reset', 'Сбросить параметры опыта', ButtonStyle.Secondary, '🔄')));

  return view(container, notice);
}

function pageView(kind, notice) {
  const p = PAGES[kind];
  const container = shell(`${p.emoji} ${p.title}`, p.hint)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`**Сейчас**\n${p.current(store.settings)}`))
        .setButtonAccessory(button(`settings:edit:${kind}`, 'Изменить', ButtonStyle.Primary, '✏️')),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(totalLine()))
    .addSeparatorComponents(divider())
    .addActionRowComponents(row(backButton()));

  return view(container, notice);
}

// Роль может быть удалена или недоступна боту (ниже по иерархии / нет «Управления ролями»)
function describeReward(guild, { level, roleId }) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return `**Уровень ${level}** → \`роль удалена\` ⚠️`;
  return `**Уровень ${level}** → <@&${roleId}>${role.editable ? '' : ' ⚠️'}`;
}

async function rewardsView(guild, notice) {
  await guild.members.fetchMe().catch(() => null); // для проверки role.editable
  const list = store.rewardList();
  const stacking = store.rewards.stacking;
  const broken = list.some(({ roleId }) => !guild.roles.cache.get(roleId)?.editable);

  const container = shell(
    '🏆 Роли награды',
    'Бот сам выдаёт роль, когда участник достигает указанного уровня.',
  )
    .addTextDisplayComponents(
      text(list.length ? list.map((r) => describeReward(guild, r)).join('\n') : '*Награды ещё не настроены.*'),
    );

  if (broken) {
    container.addTextDisplayComponents(
      text('-# ⚠️ Бот не может выдать роль: нужно право «Управление ролями» и роль бота выше награды в списке ролей сервера.'),
    );
  }

  container
    .addSeparatorComponents(divider())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            stacking
              ? '🔁 **Суммирование ролей** · включено\nУчастник сохраняет роли за все достигнутые уровни.'
              : '🔁 **Суммирование ролей** · выключено\nУ участника остаётся только роль за самый высокий достигнутый уровень.',
          ),
        )
        .setButtonAccessory(
          stacking
            ? button('settings:rw-stack', 'Выключить', ButtonStyle.Secondary)
            : button('settings:rw-stack', 'Включить', ButtonStyle.Success),
        ),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      row(button('settings:rw-add', 'Добавить роль', ButtonStyle.Primary, '➕'), backButton()),
    );

  if (list.length) {
    container.addActionRowComponents(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('settings:rw-del')
          .setPlaceholder('Удалить награду…')
          .addOptions(
            // В select-меню максимум 25 пунктов (на случай ручной правки db.json)
            list.slice(0, 25).map(({ level, roleId }) =>
              new StringSelectMenuOptionBuilder()
                .setValue(String(level))
                .setLabel(`Уровень ${level}`)
                .setDescription(`Роль: ${guild.roles.cache.get(roleId)?.name ?? 'удалена'}`.slice(0, 100))
                .setEmoji('🗑️'),
            ),
          ),
      ),
    );
  }

  return view(container, notice);
}

function pickRoleView(level, notice) {
  const current = store.rewards.roles[level];
  const container = shell(
    `🏆 Роль за ${level} уровень`,
    `Выберите роль, которая будет выдаваться при достижении **${level}** уровня.` +
      (current ? `\nСейчас: <@&${current}> — она будет заменена.` : ''),
  )
    .addActionRowComponents(
      row(
        new RoleSelectMenuBuilder()
          .setCustomId(`settings:rw-pick:${level}`)
          .setPlaceholder('Выберите роль…')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    )
    .addActionRowComponents(row(button('settings:rewards', 'Отмена', ButtonStyle.Secondary, '✖️')));

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Общие настройки системы опыта')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(NO_ACCESS);
    await interaction.reply({ ...homeView(), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  },

  // Кнопки и меню: customId = settings:<действие>[:<аргумент>]
  async handleComponent(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(NO_ACCESS);
    const [, action, arg] = interaction.customId.split(':');
    const { guild } = interaction;

    switch (action) {
      case 'menu': {
        const kind = interaction.values[0];
        if (kind === 'rewards') return interaction.update(await rewardsView(guild));
        return interaction.update(PAGES[kind] ? pageView(kind) : homeView());
      }
      case 'home':
        return interaction.update(homeView());
      case 'edit': {
        const modal = buildModal(arg);
        if (modal) await interaction.showModal(modal);
        return;
      }
      case 'reset':
        store.updateSettings({ ...DEFAULT_SETTINGS });
        return interaction.update(homeView('Параметры опыта сброшены по умолчанию. Награды не затронуты.'));

      case 'rewards':
        return interaction.update(await rewardsView(guild));
      case 'rw-add':
        return interaction.showModal(buildModal('level'));
      case 'rw-stack': {
        const enabled = !store.rewards.stacking;
        store.setStacking(enabled);
        return interaction.update(
          await rewardsView(
            guild,
            `✅ Суммирование ${enabled ? 'включено' : 'выключено'}. Роли обновятся, когда участник в следующий раз получит опыт.`,
          ),
        );
      }
      case 'rw-del': {
        const level = Number(interaction.values[0]);
        store.removeReward(level);
        return interaction.update(
          await rewardsView(guild, `🗑️ Награда за ${level} уровень удалена. Уже выданные роли остаются у участников.`),
        );
      }
      case 'rw-pick': {
        const level = Number(arg);
        if (!Number.isInteger(level) || level < LIMITS.level.min || level > LIMITS.level.max) {
          return interaction.update(await rewardsView(guild));
        }
        if (rewardsFull(level)) {
          return interaction.update(await rewardsView(guild, `❌ Можно настроить не более ${MAX_REWARDS} наград.`));
        }
        const role = guild.roles.cache.get(interaction.values[0]);
        if (!role || role.id === guild.id) {
          return interaction.update(pickRoleView(level, '❌ Эту роль выбрать нельзя. Выберите другую.'));
        }
        if (role.managed) {
          return interaction.update(
            pickRoleView(level, '❌ Эта роль управляется интеграцией или ботом — выдать её нельзя. Выберите другую.'),
          );
        }
        store.setReward(level, role.id);
        return interaction.update(await rewardsView(guild, `✅ Награда за ${level} уровень сохранена: ${role.name}.`));
      }
      default:
        // Кнопки старой панели (до перехода на Components V2)
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
      return interaction.update(pickRoleView(level));
    }

    store.updateSettings(patch);
    await interaction.update(pageView(kind, '✅ Сохранено.'));
  },
};
