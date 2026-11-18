const { protect, reveal } = require('./secrets');

function readDraft(user) {
  if (user.dashboardDraft?.expires > Date.now()) {
    try { return JSON.parse(reveal(user.dashboardDraft.value)); } catch {}
  }
  return {};
}
function writeDraft(user, draft) {
  if (Object.keys(draft).length) {
    user.dashboardDraft = { expires: Date.now() + 86400000, value: protect(JSON.stringify(draft)) };
  } else {
    delete user.dashboardDraft;
  }
}

module.exports = { readDraft, writeDraft };
