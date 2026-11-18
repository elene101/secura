const { UserError } = require('../helpers/errors');
const fs = require('fs'), path = require('path');
const { save } = require('../config/db');
const { validateProfile, validateOnboarding } = require('../validators/auth.validator');
function saveProfile(user, changes) {
  if ('phone' in changes && changes.phone !== user.phone) {
    delete user.verifiedPhone;
    delete user.phoneChallenge;
  }
  Object.assign(user, changes);
  save();
}
exports.update = async (req, res) => {
  saveProfile(req.user, validateProfile(req.body));
  res.json({ ok: true });
};
exports.completeOnboarding = async (req, res) => {
  if (req.user.onboardingPending) {
    const changes = validateOnboarding(req.body);
    saveProfile(req.user, { ...changes, onboardingPending: false });
  }
  res.json({ ok: true });
};
exports.avatar = async (req, res) => { // ბრაუზერი ფოტოს წინასწარ ამცირებს JPEG-ად (256x256)
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(req.body.image || '');
  const buf = m && Buffer.from(m[1], 'base64');
  if (!buf || buf.length > 300 * 1024 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new UserError('Please send a JPEG image under 300 KB');
  const dir = path.join(__dirname, '../../uploads/avatars'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, req.user.id + '.jpg'), buf);
  req.user.avatar = `/uploads/avatars/${req.user.id}.jpg?v=${Date.now()}`; req.user.avatarSource = 'upload'; save();
  res.json({ avatar: req.user.avatar });
};
