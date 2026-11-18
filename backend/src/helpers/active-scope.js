const { db } = require('../config/db');

const accountActive = id => !db.users.find(user => user.id === id)?.deactivatedAt;
const workspaceActive = team => !!team && !team.deactivatedAt && accountActive(team.userId);
function siteActive(site) {
  return accountActive(site.userId) &&
    (!site.workspaceId || workspaceActive(db.workspaces.find(team => team.id === site.workspaceId)));
}

module.exports = { workspaceActive, siteActive };
