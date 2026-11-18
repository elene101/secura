const { workspaceActive } = require('./active-scope');
const memberRoles = ['viewer', 'operator'];
function workspaceRole(team, userId, includeInactive = false) {
  if (!team) return null;
  if (team.userId === userId) return 'owner';
  if ((!includeInactive && !workspaceActive(team)) || !team.members.includes(userId)) return null;
  return team.memberRoles?.[userId] === 'operator' ? 'operator' : 'viewer';
}

module.exports = { memberRoles, workspaceRole };
