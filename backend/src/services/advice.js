// აგებს გრძელ, კონკრეტული საიტისთვის მორგებულ რეკომენდაციებს სკანირების შედეგიდან
const docs = h => ({
  HSTS: { sev: 'Medium', title: 'HSTS is missing (Strict-Transport-Security)',
    what: 'HSTS is a response header that tells browsers to open your site only over HTTPS for a set period of time, even if a visitor types http:// or follows an old link.',
    why: `Without it, the very first request a visitor makes to ${h} can travel unencrypted. On public Wi-Fi, an attacker can intercept that first request and quietly redirect the visitor to a fake copy of your site or strip the encryption (a downgrade attack). Security audits also read a missing HSTS header as a sign that HTTPS was set up only halfway.`,
    steps: ['Confirm that every page already works over HTTPS and that plain HTTP redirects to HTTPS.', 'Start with a short test value such as max-age=300 (five minutes) and browse the whole site to confirm nothing breaks.', 'Raise it to max-age=31536000 (one year) once you are confident.', 'Add includeSubDomains only if every subdomain (shop., blog., mail. and so on) also supports HTTPS. Do not add "preload" unless you understand that removal from browser preload lists takes months.'],
    nginx: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    apache: 'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    express: "app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));" },
  CSP: { sev: 'Medium', title: 'Content-Security-Policy is missing',
    what: 'A Content Security Policy (CSP) is a list of rules that tells the browser which scripts, styles, images and frames your pages are allowed to load.',
    why: `If an attacker ever manages to inject a script into a page of ${h} (through a vulnerable plugin, a comment field or a compromised third-party widget), a CSP stops the browser from running it or from sending stolen data to another server. It is the strongest single defence against cross-site scripting (XSS), which is one of the most common ways customer accounts and payment pages are attacked.`,
    steps: ['List every external service your pages really use (analytics, fonts, chat widget, payment provider).', 'Deploy the policy first as Content-Security-Policy-Report-Only, so the browser only reports violations in the developer console and nothing breaks.', 'Fix or whitelist what the console reports, then switch to the enforcing header.', 'Avoid "unsafe-inline" and "unsafe-eval" for scripts wherever you can, because they weaken the protection a lot.'],
    nginx: `add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'" always;`,
    apache: `Header always set Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'"`,
    express: `app.use(helmet.contentSecurityPolicy({ directives: {\n  defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'],\n  scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], frameAncestors: ["'self'"]\n} }));` },
  'X-Frame-Options': { sev: 'Medium', title: 'Clickjacking protection is missing (X-Frame-Options)',
    what: 'This header controls whether other websites may display your pages inside a frame.',
    why: `Without it, anyone can embed ${h} invisibly inside their own page and trick visitors into clicking buttons they cannot see, for example "confirm order", "change password" or "delete account". This attack is called clickjacking and it works even when your own code has no bugs.`,
    steps: ['Decide whether any partner genuinely needs to embed your pages. For most business sites the answer is no.', 'Set the header to SAMEORIGIN (only your own site may frame your pages) or DENY (nobody may).', 'For modern browsers also use the frame-ancestors directive inside your Content-Security-Policy, which supersedes this header.'],
    nginx: 'add_header X-Frame-Options "SAMEORIGIN" always;', apache: 'Header always set X-Frame-Options "SAMEORIGIN"', express: "app.use(helmet.frameguard({ action: 'sameorigin' }));" },
  'X-Content-Type-Options': { sev: 'Low', title: 'MIME sniffing protection is missing (X-Content-Type-Options)',
    what: 'This header tells the browser to trust the content type your server declares and not to guess it.',
    why: `Browsers sometimes "sniff" a file and decide it is a script even though the server labelled it as an image or text. If your visitors or staff can upload files to ${h}, an attacker may disguise a script as a harmless file and get it executed. The header closes this gap at almost no cost.`,
    steps: ['Add the header with the single value nosniff to every response.', 'Make sure your server sends correct Content-Type values for scripts (application/javascript) and stylesheets (text/css), otherwise browsers will refuse to load them once nosniff is on.'],
    nginx: 'add_header X-Content-Type-Options "nosniff" always;', apache: 'Header always set X-Content-Type-Options "nosniff"', express: 'app.use(helmet.noSniff());' },
  'Referrer-Policy': { sev: 'Low', title: 'Referrer-Policy is missing',
    what: 'When a visitor clicks a link on your site, the browser tells the next site which page they came from. Referrer-Policy controls how much of that address is shared.',
    why: `By default the full address, including query strings, may be sent to every external site that ${h} links to or loads resources from. If those addresses contain order numbers, search words, reset tokens or customer identifiers, they leak to third parties and into their logs.`,
    steps: ['Choose strict-origin-when-cross-origin, which sends only your domain name to other sites and the full address only inside your own site.', 'Never put secrets or personal data into URLs, even with this header in place.'],
    nginx: 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;', apache: 'Header always set Referrer-Policy "strict-origin-when-cross-origin"', express: "app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));" },
  'Permissions-Policy': { sev: 'Low', title: 'Permissions-Policy is missing',
    what: 'This header lists the browser features (camera, microphone, location and others) that pages of your site, and any third-party code on them, are allowed to use.',
    why: `Your pages probably load third-party code such as analytics, chat or advertising widgets. Without a Permissions-Policy, a compromised or careless widget could request access to your visitors' camera, microphone or location while they are on ${h}. Switching off what you do not use limits the damage.`,
    steps: ['List the browser features your site really needs. Most business sites need none of them.', 'Disable the rest explicitly, as in the example. Add a feature back only if a page breaks and you know why.'],
    nginx: 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;', apache: 'Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"',
    express: "app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next(); });" }
});

function advise(r, withCode) {
  const h = r.host, D = docs(h), F = [], P = [];
  const add = (sev, title, paras, steps, code) => F.push({ sev, title, paras, steps, code: withCode ? code : null });
  const certbot = [{ lang: 'Terminal (Ubuntu/Debian, Nginx)', text: `sudo apt install certbot python3-certbot-nginx\nsudo certbot --nginx -d ${h} -d www.${h}\nsudo certbot renew --dry-run` },
    { lang: 'Terminal (Apache)', text: `sudo apt install certbot python3-certbot-apache\nsudo certbot --apache -d ${h} -d www.${h}\nsudo certbot renew --dry-run` }];
  if (!r.up) add('High', `${h} did not respond correctly`,
    [`When we checked ${h}, the server either did not answer within 10 seconds or answered with an error (HTTP ${r.status || 'no response'}). If this is not a short glitch, visitors cannot reach your business at all. Search engines may lower your ranking and you can lose orders or inquiries every hour the site stays down.`,
     'Typical causes are an expired hosting plan, a crashed application process, a full disk, an expired domain, wrong DNS records, or a firewall rule that blocks visitors.'],
    ['Open the site from your phone using mobile data to rule out a problem in your own network.', 'Log in to your hosting panel and check the service status and whether the plan or domain has expired.', 'Check your DNS records and confirm the domain still points to your server.', 'Read the web server error log and restart the web server or application if it has crashed.', 'Set up 24/7 monitoring with SMS alerts so you learn about the next outage in minutes, not days.'],
    [{ lang: 'Terminal', text: `dig +short ${h}\ncurl -I https://${h}\nsudo systemctl status nginx\nsudo tail -n 50 /var/log/nginx/error.log` }]);
  if (!r.url.startsWith('https:')) add('High', 'Your site is served without HTTPS',
    [`${h} is reachable over plain HTTP. Everything visitors send, including contact forms, logins and any personal details, travels as readable text and can be read or changed by anyone on the same network. Browsers label such sites "Not secure", which scares customers away, and search engines rank them lower.`,
     'A free certificate is enough. You do not need to pay for HTTPS.'],
    ['Ask your hosting provider to enable a free Let\'s Encrypt certificate, or install one yourself with the commands below.', 'Redirect all HTTP traffic to HTTPS permanently (301).', 'Update internal links, images and scripts that still point to http:// addresses.', 'Once everything works, add the HSTS header described in this report.'],
    [...certbot, { lang: 'Nginx (redirect HTTP to HTTPS)', text: `server {\n  listen 80;\n  server_name ${h} www.${h};\n  return 301 https://$host$request_uri;\n}` }]);
  else if (!r.ssl.ok) add('High', 'Your SSL certificate is not trusted',
    [`Browsers do not trust the certificate of ${h}${r.ssl.error ? ` (reason reported: ${r.ssl.error})` : ''}. Visitors will see a full-page security warning before they can enter the site, and most of them will leave. Cart and form submissions are also at risk of interception.`,
     'Common causes are an expired certificate, a certificate issued for a different domain name, a missing intermediate certificate in the chain, or a self-signed certificate.'],
    ['Check the reported reason above and compare it with the domain name on the certificate.', 'Reissue the certificate for exactly the names your visitors use (with and without www).', 'Install the full chain file, not only the single certificate file.', 'Test the result in a public SSL checker such as SSL Labs and aim for grade A.'], certbot);
  else if (r.ssl.days != null && r.ssl.days <= 30) add(r.ssl.days <= 14 ? 'High' : 'Medium', `Your SSL certificate expires in ${r.ssl.days} days`,
    [`The certificate of ${h} is valid but runs out in ${r.ssl.days} days. On that day every visitor will see a security warning instead of your site. Expiry is one of the most common and most avoidable reasons for outages.`,
     'Certificates from Let\'s Encrypt are valid for a short time on purpose and are meant to renew automatically. A certificate this close to expiry usually means automatic renewal is not working.'],
    ['Renew the certificate now, either in your hosting panel or with the command below.', 'Enable automatic renewal and confirm with a dry run that it works.', 'Make sure someone receives the expiry warning emails from your certificate provider, and keep monitoring on.'],
    [{ lang: 'Terminal', text: 'sudo certbot renew\nsudo certbot renew --dry-run\nsystemctl list-timers | grep certbot' }]);
  else P.push(`SSL certificate is valid (${r.ssl.days} days left).`);
  if (r.up) {
    for (const x of r.headers) {
      const d = D[x.label]; if (!d) continue;
      if (x.present) P.push(`${x.label} header is present.`);
      else add(d.sev, d.title, [d.what, d.why], d.steps, [{ lang: 'Nginx', text: d.nginx }, { lang: 'Apache (.htaccess)', text: d.apache }, { lang: 'Node.js / Express (helmet)', text: d.express }]);
    }
    if (r.responseMs >= 1500) add(r.responseMs >= 3000 ? 'High' : 'Medium', `Slow response time (${r.responseMs} ms)`,
      [`${h} needed ${r.responseMs} ms to start answering. Visitors expect a page to begin loading in well under one second. Every extra second noticeably increases the number of people who give up, and search engines use speed as a ranking factor.`,
       'Slow first responses usually come from an overloaded or cheap hosting plan, pages that are generated from scratch on every visit, heavy database queries, or very large images and scripts.'],
      ['Turn on compression (gzip or brotli) and browser caching for images, styles and scripts.', 'Compress and resize images, and serve them in modern formats such as WebP.', 'Use a CDN (for example Cloudflare\'s free plan) so files are served from a location close to the visitor.', 'If you use WordPress or a similar system, add a page cache plugin and remove plugins you do not need.', 'If the response is still slow, upgrade the hosting plan or review slow database queries.'],
      [{ lang: 'Nginx (compression and caching)', text: 'gzip on;\ngzip_types text/css application/javascript application/json image/svg+xml;\nlocation ~* \\.(?:css|js|woff2|png|jpg|jpeg|webp|svg)$ {\n  expires 30d;\n  add_header Cache-Control "public, immutable";\n}' },
       { lang: 'Node.js / Express', text: "const compression = require('compression');\napp.use(compression());\napp.use(express.static('public', { maxAge: '30d' }));" }]);
    else P.push(`Response time is good (${r.responseMs} ms).`);
  }
  const ex = require('./advice-extra').extras(r, 'en'); ex.items.forEach(i => add(i.sev, i.title, i.paras, i.steps, i.code)); P.push(...ex.passed);
  const rank = { High: 0, Medium: 1, Low: 2 };
  F.sort((a, b) => rank[a.sev] - rank[b.sev]);
  return { findings: F, passed: P };
}
module.exports = { advise, docs };
