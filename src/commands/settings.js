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
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  LabelBuilder,
  FileUploadBuilder,
  AttachmentBuilder,
  GatewayIntentBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { store, DEFAULT_SETTINGS, DEFAULT_LEVEL_UP, DEFAULT_CARD } = require('../store');
const { parseHex, luminance } = require('../color');
const { setBackground, removeBackground, MAX_BYTES: MAX_BACKGROUND_BYTES } = require('../background');
const { renderUserCard } = require('../rankcard');
const { syncTopRoles } = require('../toproles');
const { PLACEHOLDERS, MAX_LENGTH: LEVEL_UP_MAX_LENGTH, renderLevelUp } = require('../levelup');
const { parseDuration, formatDuration: formatShortDuration } = require('../duration');

const ACCENT = 0x3f7cff;

const LIMITS = {
  xp: { min: 0, max: 1000 },
  cooldown: { min: 0, max: 86400 },
  multiplier: { min: 0.1, max: 10 },
  level: { min: 1, max: 1000 },
  top: { min: 1, max: 100 },
  dim: { min: 0, max: 90 },
};

const MAX_REWARDS = 20;
// Лимит Components V2 — 40 компонентов на сообщение; пункт награды занимает 3 (секция, текст, кнопка)
const REWARDS_PER_PAGE = 5;

// Множители отображаются так же, как награды: 3 компонента на пункт
const MAX_MULTIPLIERS = 20;
const MULTIPLIERS_PER_PAGE = 5;
const MULTIPLIER_TYPES = { c: 'channel', r: 'role' };

// Роли за место в топе — тоже по 3 компонента на пункт
const MAX_TOP_ROLES = 10;
const TOP_ROLES_PER_PAGE = 5;
// Каналы, на которые можно навесить множитель (категория действует на все свои каналы)
const MULTIPLIER_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildCategory,
];

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

function multipliersSummary() {
  const count = store.multiplierRules().length;
  if (count === 0) return 'На каналы, категории и роли';
  return `${count} ${plural(count, 'правило', 'правила', 'правил')} · действует наибольший`;
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
      new StringSelectMenuOptionBuilder()
        .setValue('multipliers')
        .setLabel('Множители')
        .setDescription(multipliersSummary())
        .setEmoji('⚡')
        .setDefault(active === 'multipliers'),
      new StringSelectMenuOptionBuilder()
        .setValue('levelup')
        .setLabel('Повышение уровня')
        .setDescription(store.levelUp.enabled ? 'Сообщение включено' : 'Сообщение выключено')
        .setEmoji('🎉')
        .setDefault(active === 'levelup'),
      new StringSelectMenuOptionBuilder()
        .setValue('other')
        .setLabel('Другое')
        .setDescription('Ранг-карта, обнуление опыта, роли за топ')
        .setEmoji('🧩')
        .setDefault(active === 'other'),
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

// Components V2 не сочетаются с content/embeds, поэтому «футер» — это мелкий текст внизу.
// attachments: [] убирает картинку предпросмотра, когда уходим с экрана ранг-карты.
function view(container, notice, files = []) {
  if (notice) container.addTextDisplayComponents(text(`-# ${notice}`));
  return { components: [container], flags: MessageFlags.IsComponentsV2, files, attachments: [] };
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
    hint: `умножает весь опыт, от ×${LIMITS.multiplier.min} до ×${LIMITS.multiplier.max}; больший множитель из «Множителей» приоритетнее`,
    value: (s) => formatMultiplier(s.multiplier),
  },
};

// Где начисляется опыт: ветки обычных каналов и посты форумов
const XP_TOGGLES = {
  threads: {
    field: 'xpInThreads',
    emoji: '🧵',
    title: 'Опыт в ветках',
    hint: 'сообщения в ветках текстовых каналов',
  },
  forums: {
    field: 'xpInForums',
    emoji: '🗂️',
    title: 'Опыт в форумах',
    hint: 'сообщения в постах форумов и медиаканалов',
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

  container.addSeparatorComponents(divider());
  for (const [key, toggle] of Object.entries(XP_TOGGLES)) {
    const on = s[toggle.field] !== false;
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`**${toggle.emoji} ${toggle.title}** · ${on ? 'начисляется' : 'не начисляется'}\n-# ${toggle.hint}`))
        .setButtonAccessory(
          on
            ? button(`settings:xp-toggle:${key}`, 'Выключить', ButtonStyle.Secondary)
            : button(`settings:xp-toggle:${key}`, 'Включить', ButtonStyle.Success),
        ),
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

// ───────────── категория «Множители» ─────────────

// Страница списка, на которой лежит правило (список отсортирован по убыванию множителя)
function multiplierPageOf(type, id) {
  const idx = store.multiplierRules().findIndex((r) => r.type === type && r.id === id);
  return idx === -1 ? 0 : Math.floor(idx / MULTIPLIERS_PER_PAGE);
}

const typeCode = (type) => (type === 'role' ? 'r' : 'c');

// Цель правила: роль, канал или категория; она могла быть удалена с сервера
function targetOf(guild, rule) {
  if (rule.type === 'role') {
    const exists = guild.roles.cache.has(rule.id);
    return { icon: '👥', label: exists ? `<@&${rule.id}>` : '`роль удалена`', missing: !exists };
  }
  const channel = guild.channels.cache.get(rule.id);
  return {
    icon: channel?.type === ChannelType.GuildCategory ? '📁' : '💬',
    label: channel ? `<#${rule.id}>` : '`канал удалён`',
    missing: !channel,
  };
}

const unix = (ms) => Math.floor(ms / 1000);

// Срок: «закончится через …» с живым отсчётом Discord или «бессрочно»
function expiryText(rule) {
  return rule.expiresAt ? `⏳ закончится <t:${unix(rule.expiresAt)}:R>` : '♾️ бессрочно';
}

function describeRule(guild, rule) {
  const target = targetOf(guild, rule);
  const global = store.settings.multiplier;
  const notes = [expiryText(rule)];
  if (target.missing) notes.push('⚠️ цель удалена');
  else if (rule.value <= global) notes.push(`не действует: общий ${formatMultiplier(global)} не меньше`);
  return `${target.icon} ${target.label} · **${formatMultiplier(rule.value)}**\n-# ${notes.join(' · ')}`;
}

function multipliersView(guild, page = 0, notice) {
  store.purgeExpiredMultipliers();
  const rules = store.multiplierRules();
  const global = store.settings.multiplier;
  const pages = Math.max(1, Math.ceil(rules.length / MULTIPLIERS_PER_PAGE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const slice = rules.slice(current * MULTIPLIERS_PER_PAGE, (current + 1) * MULTIPLIERS_PER_PAGE);

  const container = frame(
    'multipliers',
    '⚡ Множители',
    `Дополнительные множители на каналы, категории и роли, можно временные. ` +
      `Из всех подходящих действует **наибольший**; общий множитель (**${formatMultiplier(global)}**) тоже учитывается.`,
  );

  if (slice.length === 0) {
    container.addTextDisplayComponents(text('*Множителей пока нет — нажмите «Добавить множитель».*'));
  }
  // У каждого правила своя кнопка
  for (const rule of slice) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(describeRule(guild, rule)))
        .setButtonAccessory(
          button(`settings:mx-edit:${typeCode(rule.type)}:${rule.id}`, 'Изменить', ButtonStyle.Secondary, '✏️'),
        ),
    );
  }

  const controls = [button('settings:mx-add', 'Добавить множитель', ButtonStyle.Success, '➕')];
  if (pages > 1) {
    controls.push(
      button(`settings:mx-page:${current - 1}`, '◀', ButtonStyle.Secondary).setDisabled(current === 0),
      button('settings:mx-noop', `${current + 1}/${pages}`, ButtonStyle.Secondary).setDisabled(true),
      button(`settings:mx-page:${current + 1}`, '▶', ButtonStyle.Secondary).setDisabled(current === pages - 1),
    );
  }
  container.addSeparatorComponents(divider()).addActionRowComponents(row(...controls));

  return view(container, notice);
}

// Выбор цели нового правила: канал/категория или роль (сразу после выбора откроется форма)
function addMultiplierView(notice) {
  const container = frame(
    'multipliers',
    '➕ Новый множитель',
    'Выберите канал, категорию или роль — затем зададите значение и срок. ' +
      'Множитель категории действует на все её каналы; для той же цели правило заменяется.',
  )
    .addActionRowComponents(
      row(
        new ChannelSelectMenuBuilder()
          .setCustomId('settings:mx-pickch')
          .setPlaceholder('💬 Канал или категория…')
          .setChannelTypes(...MULTIPLIER_CHANNEL_TYPES)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    )
    .addActionRowComponents(
      row(
        new RoleSelectMenuBuilder()
          .setCustomId('settings:mx-pickrole')
          .setPlaceholder('👥 Роль…')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    )
    .addActionRowComponents(row(button('settings:mx-page:0', 'Отмена', ButtonStyle.Secondary, '✖️')));

  return view(container, notice);
}

// Экран одного правила: подробности, изменить значение и срок, удалить
function ruleView(guild, type, id, notice) {
  const rule = store.multiplierRules().find((r) => r.type === type && r.id === id);
  if (!rule) return multipliersView(guild, 0, 'Этого множителя уже нет — возможно, истёк срок.');

  const target = targetOf(guild, rule);
  const global = store.settings.multiplier;
  const lines = [
    `${target.icon} **Цель:** ${target.label}`,
    `⚡ **Множитель:** ${formatMultiplier(rule.value)}`,
    `⏳ **Срок:** ${rule.expiresAt ? `до <t:${unix(rule.expiresAt)}:f> (<t:${unix(rule.expiresAt)}:R>)` : 'бессрочно'}`,
  ];
  if (!target.missing && rule.value <= global) {
    lines.push(`-# Сейчас не действует: общий множитель ${formatMultiplier(global)} не меньше.`);
  }

  const container = frame('multipliers', `⚡ Множитель ${formatMultiplier(rule.value)}`, lines.join('\n'))
    .addActionRowComponents(
      row(
        button(`settings:mx-modal:${typeCode(type)}:${id}`, 'Изменить значение и срок', ButtonStyle.Primary, '✏️'),
        button(`settings:mx-del:${typeCode(type)}:${id}`, 'Удалить', ButtonStyle.Danger, '🗑️'),
        button(`settings:mx-page:${multiplierPageOf(type, id)}`, 'К списку', ButtonStyle.Secondary, '↩️'),
      ),
    );

  return view(container, notice);
}

// ───────────── категория «Повышение уровня» ─────────────

// Шаблон показываем как есть; тройные кавычки ломали бы блок кода
const showTemplate = (t) => '```\n' + t.replace(/```/g, '`​``') + '\n```';

function levelUpView(user, notice) {
  const { enabled, message } = store.levelUp;
  const sampleReward = store.rewardList()[0]?.roleId;
  const preview = renderLevelUp(message, {
    userId: user.id,
    name: user.displayName ?? user.username,
    level: 5,
    rewards: sampleReward ? [sampleReward] : [],
  });

  const container = frame('levelup', '🎉 Повышение уровня', 'Сообщение, которое бот отправляет в канал, когда участник получает новый уровень.')
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            enabled
              ? '🔔 **Сообщение** · включено\n-# Бот поздравляет участника в канале, где тот написал.'
              : '🔕 **Сообщение** · выключено\n-# Уровни и роли-награды выдаются молча.',
          ),
        )
        .setButtonAccessory(
          enabled
            ? button('settings:lu-toggle', 'Выключить', ButtonStyle.Secondary)
            : button('settings:lu-toggle', 'Включить', ButtonStyle.Success),
        ),
    )
    .addSeparatorComponents(divider())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`**✏️ Текст сообщения**\n${showTemplate(message)}`))
        .setButtonAccessory(button('settings:lu-edit', 'Изменить', ButtonStyle.Primary, '✏️')),
    )
    .addTextDisplayComponents(
      text(
        '-# Переменные: ' +
          Object.entries(PLACEHOLDERS)
            .map(([k, v]) => `\`${k}\` — ${v}`)
            .join(' · ') +
          '. Если `{rewards}` нет в тексте, награда допишется отдельной строкой.',
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(`**👁️ Предпросмотр** (уровень 5${sampleReward ? ', с наградой' : ''})\n${preview.split('\n').map((l) => `> ${l}`).join('\n')}`),
    )
    .addActionRowComponents(row(button('settings:lu-reset', 'Сбросить текст', ButtonStyle.Secondary, '🔄')));

  return view(container, notice);
}

function buildLevelUpModal() {
  return new ModalBuilder()
    .setCustomId('settings-modal:lu')
    .setTitle('Сообщение о повышении уровня')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Текст ({user} {name} {level} {rewards})')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(LEVEL_UP_MAX_LENGTH)
          .setValue(store.levelUp.message),
      ),
    );
}

// ───────────── категория «Другое» ─────────────

const hasMembersIntent = (client) => client.options.intents.has(GatewayIntentBits.GuildMembers);

function cardSummary() {
  const c = store.card;
  const custom = ['accent', 'accent2', 'background'].some((k) => c[k] !== DEFAULT_CARD[k]);
  if (c.hasImage) return 'своя картинка на фоне';
  return custom ? 'свои цвета' : 'стандартное оформление';
}

function topRolesSummary() {
  const count = store.topRoleList().length;
  if (count === 0) return 'не настроены';
  return `${count} ${plural(count, 'правило', 'правила', 'правил')}`;
}

function toggleButton(customId, on) {
  return on ? button(customId, 'Выключить', ButtonStyle.Secondary) : button(customId, 'Включить', ButtonStyle.Success);
}

function otherView(client, notice) {
  const { resetOnLeave, resetOnBan } = store.other;
  const leaveHint = hasMembersIntent(client)
    ? 'Ушедший участник теряет весь опыт и место в топе; вернётся — начнёт с нуля.'
    : '⚠️ Сейчас не сработает: включите **Server Members Intent** (Developer Portal → Bot → Privileged Gateway Intents) и перезапустите бота.';

  const container = frame('other', '🧩 Другое', 'Оформление ранг-карты, обнуление опыта и роли за места в топе.')
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`**🎨 Ранг-карта** · ${cardSummary()}\n-# Цвета, фон и картинка карточки /rank для всех участников.`))
        .setButtonAccessory(button('settings:cd-open', 'Настроить', ButtonStyle.Primary, '🎨')),
    )
    .addSeparatorComponents(divider())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(`**🚪 Обнулять опыт при выходе** · ${resetOnLeave ? 'включено' : 'выключено'}\n-# ${leaveHint}`),
        )
        .setButtonAccessory(toggleButton('settings:ot-leave', resetOnLeave)),
    )
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            `**🔨 Обнулять опыт при бане** · ${resetOnBan ? 'включено' : 'выключено'}\n` +
              '-# Работает и при выключенном обнулении при выходе.',
          ),
        )
        .setButtonAccessory(toggleButton('settings:ot-ban', resetOnBan)),
    )
    .addSeparatorComponents(divider())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(`**🥇 Роли за место в топе** · ${topRolesSummary()}\n-# Роль держит тот, кто занимает место в /leaderboard.`),
        )
        .setButtonAccessory(button('settings:tr-page:0', 'Настроить', ButtonStyle.Primary, '🥇')),
    );

  return view(container, notice);
}

// ── Ранг-карта ──

const PREVIEW_NAME = 'card-preview.png';

// С предпросмотром на карточке самого администратора; рендер долгий — вызывать после deferUpdate
async function cardView(interaction, notice) {
  const c = store.card;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const png = await renderUserCard(interaction.user, member);

  const accent = c.accent2 ? `\`${c.accent}\` → \`${c.accent2}\`` : `\`${c.accent}\` → авто`;
  const container = frame('other', '🎨 Ранг-карта', 'Оформление карточки /rank для всех участников. Ниже — предпросмотр на вашей карточке.')
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${PREVIEW_NAME}`)),
    )
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(`**🎨 Цвета** · акцент ${accent} · фон \`${c.background}\`\n-# Акцент — полоса прогресса, уровень и обводка аватара.`),
        )
        .setButtonAccessory(button('settings:cd-colors', 'Изменить', ButtonStyle.Primary, '✏️')),
    )
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            (c.hasImage
              ? `**🖼️ Фоновая картинка** · установлена, затемнение ${c.dim}%`
              : '**🖼️ Фоновая картинка** · не задана') +
              `\n-# PNG, JPG, WEBP или GIF до ${MAX_BACKGROUND_BYTES / 1024 / 1024} МБ; обрезается под карточку.`,
          ),
        )
        .setButtonAccessory(
          button('settings:cd-image', c.hasImage ? 'Изменить' : 'Загрузить', ButtonStyle.Primary, '🖼️'),
        ),
    )
    .addActionRowComponents(
      row(
        button('settings:cd-image-del', 'Убрать картинку', ButtonStyle.Secondary, '🗑️').setDisabled(!c.hasImage),
        button('settings:cd-reset', 'Сбросить оформление', ButtonStyle.Secondary, '🔄'),
        button('settings:ot-open', 'Назад', ButtonStyle.Secondary, '↩️'),
      ),
    );

  return view(container, notice, [new AttachmentBuilder(png, { name: PREVIEW_NAME })]);
}

// Белый текст карточки плохо читается на светлом фоне
const lightWarning = (hex) =>
  luminance(hex) > 0.4 ? ' ⚠️ Фон светлый — белый текст на карточке может плохо читаться.' : '';

function label(title, description, component) {
  const l = new LabelBuilder().setLabel(title);
  if (description) l.setDescription(description);
  return component instanceof FileUploadBuilder ? l.setFileUploadComponent(component) : l.setTextInputComponent(component);
}

function shortInput(id, value, placeholder, { required = true, maxLength = 7 } = {}) {
  const field = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(maxLength)
    .setPlaceholder(placeholder);
  if (value != null && value !== '') field.setValue(String(value));
  return field;
}

function buildColorsModal() {
  const c = store.card;
  return new ModalBuilder()
    .setCustomId('settings-modal:cd-colors')
    .setTitle('Цвета ранг-карты')
    .addLabelComponents(
      label('Цвет акцента', 'HEX, например #3f7cff', shortInput('accent', c.accent, '#3f7cff')),
      label('Второй цвет градиента', 'Пусто — подберётся автоматически', shortInput('accent2', c.accent2, '#35d0ff', { required: false })),
      label('Цвет фона', 'Лучше тёмный: текст на карточке белый', shortInput('background', c.background, '#151822')),
    );
}

function buildImageModal() {
  const c = store.card;
  return new ModalBuilder()
    .setCustomId('settings-modal:cd-image')
    .setTitle('Фоновая картинка')
    .addLabelComponents(
      label(
        'Картинка',
        c.hasImage ? 'Оставьте пустым, чтобы сохранить текущую' : 'Загрузите файл или укажите ссылку ниже',
        new FileUploadBuilder().setCustomId('file').setRequired(false).setMinValues(0).setMaxValues(1),
      ),
      label('Или ссылка на картинку', 'https://…', shortInput('url', null, 'https://example.com/bg.png', { required: false, maxLength: 1000 })),
      label(
        'Затемнение, %',
        `От ${LIMITS.dim.min} до ${LIMITS.dim.max}: чем больше, тем лучше читается текст`,
        shortInput('dim', c.dim, String(DEFAULT_CARD.dim), { maxLength: 3 }),
      ),
    );
}

// { patch } или { error }
function validateColors(fields) {
  const accent = parseHex(fields.getTextInputValue('accent'));
  const background = parseHex(fields.getTextInputValue('background'));
  const rawAccent2 = fields.getTextInputValue('accent2').trim();
  const accent2 = rawAccent2 ? parseHex(rawAccent2) : null;
  if (!accent || !background || (rawAccent2 && !accent2)) {
    return { error: 'Цвет указывается в HEX: #3f7cff или #38f.' };
  }
  return { patch: { accent, accent2, background } };
}

// ── Роли за место в топе ──

const topKey = ({ from, to }) => `${from}-${to}`;
const topLabel = ({ from, to }) => (from === to ? `${from} место` : `${from}–${to} места`);
const topShort = ({ from, to }) => (from === to ? `#${from}` : `#${from}–${to}`);

function parseTopKey(key) {
  const [from, to] = String(key).split('-').map(Number);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < LIMITS.top.min || to > LIMITS.top.max || from > to) return null;
  return { from, to };
}

// «5», «#5», «1-3», «1 – 3» → { from, to } или { error }
function parsePositions(raw) {
  const m = String(raw).trim().replace(/#/g, '').match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
  const { min, max } = LIMITS.top;
  const err = { error: `Укажите место (5) или диапазон (1-3), от ${min} до ${max}.` };
  if (!m) return err;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (from < min || to > max || from > to) return err;
  return { from, to };
}

function topPageOf(from, to) {
  const idx = store.topRoleList().findIndex((r) => r.from === from && r.to === to);
  return idx === -1 ? 0 : Math.floor(idx / TOP_ROLES_PER_PAGE);
}

function describeTopRole(guild, rule) {
  const role = guild.roles.cache.get(rule.roleId);
  if (!role) return `**${topShort(rule)}** → \`роль удалена\` ⚠️`;
  return `**${topShort(rule)}** → <@&${rule.roleId}>${role.editable ? '' : ' ⚠️'}`;
}

async function topRolesView(guild, page = 0, notice) {
  await guild.members.fetchMe().catch(() => null); // для проверки role.editable
  const list = store.topRoleList();
  const pages = Math.max(1, Math.ceil(list.length / TOP_ROLES_PER_PAGE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const slice = list.slice(current * TOP_ROLES_PER_PAGE, (current + 1) * TOP_ROLES_PER_PAGE);
  const broken = list.some(({ roleId }) => !guild.roles.cache.get(roleId)?.editable);

  const container = frame(
    'other',
    '🥇 Роли за место в топе',
    'Роль получает тот, кто занимает место в /leaderboard, и теряет, когда опускается ниже. ' +
      'Можно указать одно место (`5`) или диапазон (`1-3`).',
  );

  if (slice.length === 0) {
    container.addTextDisplayComponents(text('*Ролей пока нет — нажмите «Добавить роль».*'));
  }
  for (const rule of slice) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(describeTopRole(guild, rule)))
        .setButtonAccessory(button(`settings:tr-edit:${topKey(rule)}`, 'Изменить', ButtonStyle.Secondary, '✏️')),
    );
  }
  if (broken) {
    container.addTextDisplayComponents(
      text('-# ⚠️ Бот не может выдать роль: нужно право «Управление ролями» и роль бота выше этой роли в списке ролей сервера.'),
    );
  }

  const controls = [button('settings:tr-add', 'Добавить роль', ButtonStyle.Success, '➕')];
  if (pages > 1) {
    controls.push(
      button(`settings:tr-page:${current - 1}`, '◀', ButtonStyle.Secondary).setDisabled(current === 0),
      button('settings:tr-noop', `${current + 1}/${pages}`, ButtonStyle.Secondary).setDisabled(true),
      button(`settings:tr-page:${current + 1}`, '▶', ButtonStyle.Secondary).setDisabled(current === pages - 1),
    );
  }
  controls.push(button('settings:ot-open', 'Назад', ButtonStyle.Secondary, '↩️'));

  container.addSeparatorComponents(divider()).addActionRowComponents(row(...controls));
  return view(container, notice);
}

function pickTopRoleView(guild, pos, notice) {
  const existing = store.findTopRole(pos.from, pos.to);
  const container = frame(
    'other',
    `🥇 Роль за ${topLabel(pos)}`,
    `Выберите роль для ${pos.from === pos.to ? `**${pos.from}** места` : `мест **${pos.from}–${pos.to}**`} в топе.` +
      (existing ? `\nСейчас: <@&${existing.roleId}>` : ''),
  );

  const select = new RoleSelectMenuBuilder()
    .setCustomId(`settings:tr-pick:${topKey(pos)}`)
    .setPlaceholder('Выберите роль…')
    .setMinValues(1)
    .setMaxValues(1);
  if (existing && guild.roles.cache.has(existing.roleId)) select.setDefaultRoles(existing.roleId);

  const actions = [];
  if (existing) actions.push(button(`settings:tr-del:${topKey(pos)}`, 'Удалить', ButtonStyle.Danger, '🗑️'));
  actions.push(button(`settings:tr-page:${topPageOf(pos.from, pos.to)}`, 'Отмена', ButtonStyle.Secondary, '✖️'));

  container.addActionRowComponents(row(select)).addActionRowComponents(row(...actions));
  return view(container, notice);
}

function buildTopModal() {
  return new ModalBuilder()
    .setCustomId('settings-modal:tr')
    .setTitle('Роль за место в топе')
    .addComponents(input('positions', `Место или диапазон (${LIMITS.top.min}–${LIMITS.top.max})`, undefined, 'например, 5 или 1-3'));
}

const topRolesFull = (from, to) => store.topRoleList().length >= MAX_TOP_ROLES && !store.findTopRole(from, to);

// Одна роль не может быть и наградой за уровень, и ролью за топ: бот бы снимал её сам у себя
const isRewardRole = (roleId) => Object.values(store.rewards.roles).includes(roleId);
const isTopRole = (roleId) => store.topRoleList().some((r) => r.roleId === roleId);

// Общие проверки выбранной роли: null или текст ошибки
function roleProblem(guild, role) {
  if (!role || role.id === guild.id) return 'Эту роль выбрать нельзя. Выберите другую.';
  if (role.managed) return 'Эта роль управляется интеграцией или ботом — выдать её нельзя. Выберите другую.';
  return null;
}

// Тяжёлые экраны (с картинкой или загрузкой) отвечают через deferUpdate, чтобы уложиться в 3 секунды
async function slowUpdate(interaction, build) {
  await interaction.deferUpdate();
  return interaction.editReply(await build());
}

// ───────────── модальные окна ─────────────

function input(id, label, value, placeholder, { required = true, maxLength = 10 } = {}) {
  const field = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(maxLength)
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

// Форма множителя: значение и срок. Для существующего правила поля заполнены
// (срок — оставшееся время; новый срок отсчитывается от момента сохранения).
function buildMultiplierModal(type, id, rule) {
  const remaining = rule?.expiresAt ? Math.max(0, rule.expiresAt - Date.now()) : 0;
  return new ModalBuilder()
    .setCustomId(`settings-modal:mx:${typeCode(type)}:${id}`)
    .setTitle(rule ? 'Изменить множитель' : 'Новый множитель')
    .addComponents(
      input('value', 'Множитель (от 0.1 до 10)', rule?.value, 'например, 2'),
      input('duration', 'Срок (пусто — без срока)', remaining ? formatShortDuration(remaining) : undefined, '1д, 12ч, 2д 6ч, 30м', {
        required: false,
        maxLength: 20,
      }),
    );
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

// { value, expiresAt } или { error }
function validateMultiplier(fields) {
  const value = parseNumber(fields.getTextInputValue('value'), { integer: false });
  const { min: lo, max: hi } = LIMITS.multiplier;
  if (value === null || value < lo || value > hi) return { error: `Множитель должен быть от ${lo} до ${hi}.` };

  const duration = parseDuration(fields.getTextInputValue('duration'));
  if (duration.error) return { error: duration.error };

  return {
    value: Math.round(value * 100) / 100,
    expiresAt: duration.ms === null ? null : Date.now() + duration.ms,
  };
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

function multipliersFull(type, id) {
  return store.multiplierRules().length >= MAX_MULTIPLIERS && !store.findMultiplier(type, id);
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
    const [, action, arg, arg2] = interaction.customId.split(':');
    const { guild } = interaction;

    switch (action) {
      // Меню категорий
      case 'cat': {
        const category = interaction.values[0];
        if (category === 'rewards') return interaction.update(await rewardsView(guild));
        if (category === 'multipliers') return interaction.update(multipliersView(guild));
        if (category === 'levelup') return interaction.update(levelUpView(interaction.user));
        if (category === 'other') return interaction.update(otherView(interaction.client));
        return interaction.update(xpView());
      }

      // Категория «Опыт»
      case 'edit': {
        const modal = buildModal(arg);
        if (modal) await interaction.showModal(modal);
        return;
      }
      case 'xp-toggle': {
        const toggle = XP_TOGGLES[arg];
        if (!toggle) return interaction.update(xpView());
        const enabled = store.settings[toggle.field] === false;
        store.updateSettings({ [toggle.field]: enabled });
        return interaction.update(xpView(`✅ ${toggle.title}: ${enabled ? 'включён' : 'выключен'}.`));
      }
      case 'reset':
        store.updateSettings({ ...DEFAULT_SETTINGS });
        return interaction.update(xpView('🔄 Параметры опыта сброшены по умолчанию.'));

      // Категория «Повышение уровня»
      case 'lu-toggle': {
        const enabled = !store.levelUp.enabled;
        store.updateLevelUp({ enabled });
        return interaction.update(levelUpView(interaction.user, `✅ Сообщение о повышении ${enabled ? 'включено' : 'выключено'}.`));
      }
      case 'lu-edit':
        return interaction.showModal(buildLevelUpModal());
      case 'lu-reset':
        store.updateLevelUp({ message: DEFAULT_LEVEL_UP.message });
        return interaction.update(levelUpView(interaction.user, '🔄 Текст сброшен по умолчанию.'));

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
        const problem =
          roleProblem(guild, role) ??
          (isTopRole(role.id) ? 'Эта роль уже выдаётся за место в топе (/settings → «Другое»). Выберите другую.' : null);
        if (problem) return interaction.update(pickRoleView(guild, level, `❌ ${problem}`));
        store.setReward(level, role.id);
        return interaction.update(
          await rewardsView(guild, pageOf(level), `✅ Награда за ${level} уровень сохранена: ${role.name}.`),
        );
      }

      // Категория «Множители»: arg = c|r (канал/роль), arg2 = id цели
      case 'mx-page':
        return interaction.update(multipliersView(guild, Number(arg)));
      case 'mx-noop':
        return interaction.deferUpdate();
      case 'mx-add':
        return interaction.update(addMultiplierView());
      case 'mx-pickch': {
        const id = interaction.values[0];
        if (!guild.channels.cache.has(id)) return interaction.update(addMultiplierView('❌ Канал не найден. Выберите другой.'));
        if (multipliersFull('channel', id)) {
          return interaction.update(multipliersView(guild, 0, `❌ Можно настроить не более ${MAX_MULTIPLIERS} множителей.`));
        }
        return interaction.showModal(buildMultiplierModal('channel', id, store.findMultiplier('channel', id)));
      }
      case 'mx-pickrole': {
        const id = interaction.values[0];
        if (id === guild.id) {
          return interaction.update(
            addMultiplierView('❌ На @everyone множитель не нужен — используйте общий во вкладке «Опыт».'),
          );
        }
        if (!guild.roles.cache.has(id)) return interaction.update(addMultiplierView('❌ Роль не найдена. Выберите другую.'));
        if (multipliersFull('role', id)) {
          return interaction.update(multipliersView(guild, 0, `❌ Можно настроить не более ${MAX_MULTIPLIERS} множителей.`));
        }
        return interaction.showModal(buildMultiplierModal('role', id, store.findMultiplier('role', id)));
      }
      case 'mx-edit':
        return interaction.update(ruleView(guild, MULTIPLIER_TYPES[arg], arg2));
      case 'mx-modal': {
        const type = MULTIPLIER_TYPES[arg];
        const rule = store.multiplierRules().find((r) => r.type === type && r.id === arg2);
        if (!rule) return interaction.update(multipliersView(guild, 0, 'Этого множителя уже нет — возможно, истёк срок.'));
        return interaction.showModal(buildMultiplierModal(type, arg2, rule));
      }
      case 'mx-del': {
        const type = MULTIPLIER_TYPES[arg];
        const page = multiplierPageOf(type, arg2);
        store.removeMultiplier(type, arg2);
        return interaction.update(multipliersView(guild, page, '🗑️ Множитель удалён.'));
      }
      // Категория «Другое»
      case 'ot-open':
        return interaction.update(otherView(interaction.client));
      case 'ot-leave':
      case 'ot-ban': {
        const field = action === 'ot-leave' ? 'resetOnLeave' : 'resetOnBan';
        const enabled = !store.other[field];
        store.updateOther({ [field]: enabled });
        const what = action === 'ot-leave' ? 'при выходе' : 'при бане';
        return interaction.update(otherView(interaction.client, `✅ Обнуление опыта ${what} ${enabled ? 'включено' : 'выключено'}.`));
      }

      // Ранг-карта
      case 'cd-open':
        return slowUpdate(interaction, () => cardView(interaction));
      case 'cd-colors':
        return interaction.showModal(buildColorsModal());
      case 'cd-image':
        return interaction.showModal(buildImageModal());
      case 'cd-image-del':
        removeBackground();
        store.updateCard({ hasImage: false });
        return slowUpdate(interaction, () => cardView(interaction, '🗑️ Фоновая картинка убрана.'));
      case 'cd-reset':
        removeBackground();
        store.updateCard({ ...DEFAULT_CARD });
        return slowUpdate(interaction, () => cardView(interaction, '🔄 Оформление сброшено по умолчанию.'));

      // Роли за место в топе: arg = «от-до»
      case 'tr-page':
        return interaction.update(await topRolesView(guild, Number(arg)));
      case 'tr-noop':
        return interaction.deferUpdate();
      case 'tr-add':
        return interaction.showModal(buildTopModal());
      case 'tr-edit': {
        const pos = parseTopKey(arg);
        if (!pos || !store.findTopRole(pos.from, pos.to)) return interaction.update(await topRolesView(guild));
        return interaction.update(pickTopRoleView(guild, pos));
      }
      case 'tr-del': {
        const pos = parseTopKey(arg);
        if (!pos) return interaction.update(await topRolesView(guild));
        const page = topPageOf(pos.from, pos.to);
        store.removeTopRole(pos.from, pos.to);
        syncTopRoles(guild); // роль снимется с тех, кто держал её за это место
        return interaction.update(await topRolesView(guild, page, `🗑️ Роль за ${topLabel(pos)} удалена и будет снята с участников.`));
      }
      case 'tr-pick': {
        const pos = parseTopKey(arg);
        if (!pos) return interaction.update(await topRolesView(guild));
        if (topRolesFull(pos.from, pos.to)) {
          return interaction.update(await topRolesView(guild, 0, `❌ Можно настроить не более ${MAX_TOP_ROLES} ролей за топ.`));
        }
        const role = guild.roles.cache.get(interaction.values[0]);
        const problem =
          roleProblem(guild, role) ??
          (isRewardRole(role.id) ? 'Эта роль уже выдаётся за уровень («Роли награды»). Выберите другую.' : null);
        if (problem) return interaction.update(pickTopRoleView(guild, pos, `❌ ${problem}`));
        store.setTopRole(pos.from, pos.to, role.id);
        syncTopRoles(guild);
        return interaction.update(
          await topRolesView(guild, topPageOf(pos.from, pos.to), `✅ Роль за ${topLabel(pos)} сохранена: ${role.name}.`),
        );
      }
      default:
        // Кнопки старых панелей (до перехода на Components V2 и до смены раскладки)
        return interaction.reply(ephemeral('Эта панель устарела — откройте /settings заново.'));
    }
  },

  async handleModal(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(NO_ACCESS);
    const [, kind, typeArg, targetId] = interaction.customId.split(':');

    if (kind === 'lu') {
      const message = interaction.fields.getTextInputValue('message').trim();
      if (!message) return interaction.reply(ephemeral('❌ Текст не может быть пустым. Чтобы не отправлять сообщение — выключите его.'));
      store.updateLevelUp({ message: message.slice(0, LEVEL_UP_MAX_LENGTH) });
      return interaction.update(levelUpView(interaction.user, '✅ Текст сохранён.'));
    }

    if (kind === 'mx') {
      const type = MULTIPLIER_TYPES[typeArg];
      if (!type || !targetId) return interaction.reply(ephemeral('Неизвестная настройка.'));
      const { value, expiresAt, error: mxError } = validateMultiplier(interaction.fields);
      if (mxError) return interaction.reply(ephemeral(`❌ ${mxError}`));
      if (multipliersFull(type, targetId)) {
        return interaction.reply(ephemeral(`❌ Можно настроить не более ${MAX_MULTIPLIERS} множителей.`));
      }
      store.setMultiplier({ type, id: targetId, value, expiresAt });
      return interaction.update(
        multipliersView(interaction.guild, multiplierPageOf(type, targetId), `✅ Множитель ${formatMultiplier(value)} сохранён.`),
      );
    }

    if (kind === 'cd-colors') {
      const { patch, error: colorError } = validateColors(interaction.fields);
      if (colorError) return interaction.reply(ephemeral(`❌ ${colorError}`));
      store.updateCard(patch);
      return slowUpdate(interaction, () => cardView(interaction, `✅ Цвета сохранены.${lightWarning(patch.background)}`));
    }

    if (kind === 'cd-image') {
      const dim = parseNumber(interaction.fields.getTextInputValue('dim'), { integer: true });
      if (dim === null || dim < LIMITS.dim.min || dim > LIMITS.dim.max) {
        return interaction.reply(ephemeral(`❌ Затемнение — целое число от ${LIMITS.dim.min} до ${LIMITS.dim.max}.`));
      }
      const file = interaction.fields.getUploadedFiles('file')?.first();
      const url = interaction.fields.getTextInputValue('url').trim();
      if (!file && !url && !store.card.hasImage) {
        return interaction.reply(ephemeral('❌ Загрузите картинку или укажите ссылку на неё.'));
      }
      if (file && file.contentType && !file.contentType.startsWith('image/')) {
        return interaction.reply(ephemeral('❌ Это не картинка. Подойдут PNG, JPG, WEBP или GIF.'));
      }
      if (file && file.size > MAX_BACKGROUND_BYTES) {
        return interaction.reply(ephemeral(`❌ Картинка больше ${MAX_BACKGROUND_BYTES / 1024 / 1024} МБ.`));
      }

      // Скачивание и обработка картинки могут занять несколько секунд
      await interaction.deferUpdate();
      let notice = '✅ Затемнение сохранено.';
      if (file || url) {
        try {
          await setBackground(file ? file.url : url);
          notice = '✅ Фоновая картинка установлена.';
        } catch (err) {
          store.updateCard({ dim });
          return interaction.editReply(await cardView(interaction, `❌ ${err.message}`));
        }
      }
      store.updateCard({ hasImage: true, dim });
      return interaction.editReply(await cardView(interaction, notice));
    }

    if (kind === 'tr') {
      const pos = parsePositions(interaction.fields.getTextInputValue('positions'));
      if (pos.error) return interaction.reply(ephemeral(`❌ ${pos.error}`));
      if (topRolesFull(pos.from, pos.to)) {
        return interaction.reply(ephemeral(`❌ Можно настроить не более ${MAX_TOP_ROLES} ролей за топ.`));
      }
      return interaction.update(pickTopRoleView(interaction.guild, pos));
    }

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
