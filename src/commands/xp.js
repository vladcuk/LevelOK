const { buildCommand, run } = require('../adjust');

// /xp add|remove|set — опыт участника
module.exports = {
  data: buildCommand('xp'),
  execute: (interaction) => run(interaction, 'xp'),
};
