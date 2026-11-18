const { db, id, save } = require('../config/db');
const { UserError } = require('../helpers/errors');
const { readDraft, writeDraft } = require('../helpers/dashboard-draft');
const { sha256 } = require('../helpers/crypto');
const { memberRoles, workspaceRole } = require('../helpers/workspace-role');
const { computeStats } = require('../services/stats');
const { workspaceActive, siteActive } = require('../helpers/active-scope');
const { cancelAlerts } = require('../services/notify');
const { publicUrl } = require('../services/scan-work');

function ensureActive(team) {
  if (!workspaceActive(team)) throw new UserError('This company workspace is deactivated.', 409);
}
function find(req) {
  const item = db.workspaces.find(w => w.id === req.params.id && w.userId === req.user.id);
  if (!item) throw new UserError('Workspace not found', 404);
  return item;
}
const inviteState = invite => invite.acceptedBy ? 'accepted' : invite.declinedBy ? 'declined' : 'pending';
const activeInvites = team => team.invites.filter(invite => invite.expires > Date.now());
function recentInvites(team) {
  return [...new Map(activeInvites(team).map(invite => [invite.email, invite])).values()];
}
const description = (team, userId) => ({
  id: team.id, name: team.name, owner: team.userId === userId, role: workspaceRole(team, userId), deactivated: !!team.deactivatedAt,
  members: team.userId === userId ? db.users.filter(u => team.members.includes(u.id))
    .map(({ id, email }) => ({ id, email, role: workspaceRole(team, id, true) })) : [],
  invitations: team.userId === userId ? recentInvites(team).map(invite => ({ email: invite.email, status: inviteState(invite) })) : []
});
exports.list = async (req, res) => {
  res.json(db.workspaces.filter(team => workspaceRole(team, req.user.id)).map(team => description(team, req.user.id)));
};
exports.incoming = async (req, res) => {
  const email = req.user.email.trim().toLowerCase();
  res.json(db.workspaces.filter(workspaceActive).flatMap(team => recentInvites(team)
    .filter(invite => invite.email === email && inviteState(invite) === 'pending' && !workspaceRole(team, req.user.id))
    .map(invite => ({ reference: invite.hash, workspace: team.name }))));
};
exports.create = async (req, res) => {
  if (!req.user.emailVerified) throw new UserError('Please confirm your email first. Check your inbox for the confirmation link.', 403);
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) throw new UserError('Enter a workspace name');
  if (db.workspaces.filter(w => w.userId === req.user.id).length >= 10) throw new UserError('Workspace limit reached');
  const item = { id: id(), userId: req.user.id, name, members: [], invites: [] };
  db.workspaces.push(item);
  save();
  res.status(201).json(description(item, req.user.id));
};
exports.invite = async (req, res) => {
  const item = find(req);
  ensureActive(item);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === req.user.email) throw new UserError('Enter an invitee email address');
  if (db.users.some(user => item.members.includes(user.id) && user.email.toLowerCase() === email))
    throw new UserError('This account is already a workspace member.', 409);
  const token = id(24), now = Date.now();
  item.invites = item.invites.filter(invite => invite.expires > now);
  if (item.invites.filter(invite => inviteState(invite) === 'pending').length >= 50) throw new UserError('The workspace has reached its invitation limit.', 409);
  item.invites.push({ email, hash: sha256(token), expires: now + 7 * 86400000 });
  save();
  res.json({ path: '/dashboard.html#invite=' + token });
};
function invitation(body) {
  const { token, reference } = body;
  const hash = typeof token === 'string' && /^[a-f0-9]{48}$/.test(token) ? sha256(token) : reference;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
    throw new UserError('This invitation link is invalid.', 404);
  const team = db.workspaces.find(item => item.invites.some(invite => invite.hash === hash));
  const invite = team?.invites.find(item => item.hash === hash);
  if (!invite) throw new UserError('This invitation link is invalid.', 404);
  return { team, invite };
}

exports.preview = async (req, res) => {
  const { team, invite } = invitation(req.body);
  const user = req.user;
  const sender = team.userId === user.id;
  if (!sender && invite.email !== user.email.trim().toLowerCase())
    throw new UserError('Sign in with the email address that was invited.', 403);
  ensureActive(team);
  if (invite.expires <= Date.now()) throw new UserError('This invitation has expired. Ask the workspace owner for a new link.', 410);

  const status = inviteState(invite);
  if (!sender && !user.emailVerified && status === 'pending') {
    const { token } = req.body;
    if (typeof token === 'string' && /^[a-f0-9]{48}$/.test(token)) {
      writeDraft(user, { ...readDraft(user), invite: token });
      save();
    }
    return res.status(202).json({ status: 'verification_required' });
  }
  res.json({ status, workspace: team.name, sender });
};

exports.respond = async (req, res) => {
  const { decision } = req.body;
  if (decision !== 'accept' && decision !== 'decline') throw new UserError('Choose whether to accept or decline the invitation.');
  const user = req.user, email = user.email.trim().toLowerCase();
  const { team, invite } = invitation(req.body);
  if (invite.email !== email) throw new UserError('Sign in with the email address that was invited.', 403);
  ensureActive(team);
  if (invite.expires <= Date.now()) throw new UserError('This invitation has expired. Ask the workspace owner for a new link.', 410);
  if (!user.emailVerified) throw new UserError('Confirm your email before responding to an invitation.', 403);

  if (inviteState(invite) !== 'pending') return res.json({ status: inviteState(invite), workspace: team.name });
  const accepting = decision === 'accept';
  if (accepting && !team.members.includes(user.id)) {
    if (team.members.length >= 50) throw new UserError('Workspace member limit reached');
    team.members.push(user.id);
  }
  const answered = activeInvites(team).filter(item => item.email === email && inviteState(item) === 'pending');
  for (const item of answered) item[accepting ? 'acceptedBy' : 'declinedBy'] = user.id;
  const draft = readDraft(user);
  if (draft.invite && answered.some(item => item.hash === sha256(draft.invite))) {
    delete draft.invite;
    writeDraft(user, draft);
  }
  save();
  res.json({ status: inviteState(invite), workspace: team.name });
};

exports.setRole = async (req, res) => {
  const team = find(req);
  ensureActive(team);
  const member = req.params.member, { role } = req.body;
  if (!team.members.includes(member)) throw new UserError('Workspace member not found.', 404);
  if (!memberRoles.includes(role)) throw new UserError('Choose a valid workspace role.');
  (team.memberRoles ??= {})[member] = role;
  save();
  res.json(description(team, req.user.id));
};

exports.revoke = async (req, res) => {
  const team = find(req);
  const removed = db.users.find(user => user.id === req.params.member);
  team.members = team.members.filter(id => id !== req.params.member);
  if (team.memberRoles) delete team.memberRoles[req.params.member];
  team.invites = team.invites.filter(invite => invite.acceptedBy !== req.params.member && invite.email !== removed?.email.toLowerCase());
  for (const site of db.sites.filter(site => site.workspaceId === team.id)) {
    site.alertMembers = (site.alertMembers || []).filter(id => id !== req.params.member);
  }
  save();
  res.json({ ok: true });
};
exports.setState = async (req, res) => {
  const team = find(req), { active } = req.body;
  if (typeof active !== 'boolean') throw new UserError('Choose a workspace state.');
  if (active === !team.deactivatedAt) return res.json(description(team, req.user.id));
  const sites = db.sites.filter(site => site.workspaceId === team.id);
  if (active) {
    delete team.deactivatedAt;
    for (const site of sites) if (!site.paused) site.nextCheck = Date.now();
  } else {
    team.deactivatedAt = Date.now();
    cancelAlerts({ sites: new Set(sites.map(site => site.id)) });
  }
  save();
  res.json(description(team, req.user.id));
};

exports.share = async (req, res) => {
  const site = db.sites.find(s => s.id === req.params.id && s.userId === req.user.id);
  if (!site || !siteActive(site)) throw new UserError('Not found', 404);
  db.shares = db.shares.filter(share => share.expires > Date.now());
  db.shares = db.shares.filter(share => share.siteId !== site.id);
  if (!req.body.revoke) {
    const token = id(24);
    db.shares.push({ id: sha256(token), siteId: site.id, expires: Date.now() + 7 * 86400000 });
    save();
    return res.json({ path: '/status.html#report=' + token });
  }
  save();
  res.json({ ok: true });
};
exports.readShare = async (req, res) => {
  const share = db.shares.find(item => item.id === sha256(String(req.body.token || '')) && item.expires > Date.now());
  const site = share && db.sites.find(item => item.id === share.siteId);
  if (!site || !siteActive(site)) throw new UserError('Not found', 404);
  const { uptimePeriod, days, checks } = computeStats(site, 30);
  res.json({ url: publicUrl(site.url), label: site.label, uptimePeriod, days, checks, lastCheck: site.lastCheck, expires: share.expires });
};
