const { buildCommand, run } = require('../adjust');

// /level add|remove|set — уровень участника
module.exports = {
  data: buildCommand('level'),
  execute: (interaction) => run(interaction, 'level'),
};
