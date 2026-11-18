// OAuth / OpenID Connect providers: github, google
const E = require('../config/env');
const getJson = async (url, opts) => (await fetch(url, opts)).json();
const oidc = url => async at => { // OIDC userinfo ფორმატი (Google)
  const u = await getJson(url, { headers: { Authorization: 'Bearer ' + at } });
  return { sub: String(u.sub), email: u.email_verified ? u.email : null, first: u.given_name || String(u.name || '').split(' ')[0] || 'User', last: u.family_name || '', avatar: u.picture && u.picture.replace(/=s\d+-c$/, '=s256-c') };
};
exports.PROVIDERS = {
  github: {
    id: E.GITHUB_CLIENT_ID, secret: E.GITHUB_CLIENT_SECRET, scope: 'read:user user:email',
    auth: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token',
    async profile(at) {
      const h = { Authorization: 'Bearer ' + at, 'User-Agent': 'SecuraGE', Accept: 'application/vnd.github+json' };
      const u = await getJson('https://api.github.com/user', { headers: h });
      const emails = await getJson('https://api.github.com/user/emails', { headers: h });
      const e = Array.isArray(emails) ? emails.find(x => x.primary && x.verified) : null;
      const [first, ...rest] = String(u.name || u.login || 'GitHub user').split(' ');
      return { sub: String(u.id), email: e?.email, first, last: rest.join(' '), avatar: u.avatar_url };
    }
  },
  google: {
    id: E.GOOGLE_CLIENT_ID, secret: E.GOOGLE_CLIENT_SECRET, scope: 'openid email profile',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    profile: oidc('https://openidconnect.googleapis.com/v1/userinfo')
  },
};
