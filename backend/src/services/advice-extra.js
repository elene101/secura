// დამატებითი შემოწმებების რეკომენდაციები (ინგლისურად და ქართულად)
const T = (ka, en, k) => (ka ? k : en);
exports.extras = (r, lang) => {
  const ka = lang === 'ka', d = r.details || {}, h = r.host, apex = d.apex || h, items = [], passed = [];
  const add = (sev, title, paras, steps, code) => items.push({ sev, title, paras, steps, code });
  const nginx301 = `server {\n  listen 80;\n  server_name ${h} www.${h};\n  return 301 https://$host$request_uri;\n}`;

  if (d.redirect?.ok === false) add('Medium',
    T(ka, 'HTTP does not redirect to HTTPS', 'HTTP არ გადამისამართდება HTTPS-ზე'),
    [T(ka, `Visitors who type http://${h} or follow an old link are served the site over an unencrypted connection instead of being sent to the secure version. Everything they send can be read or altered on the way, and the missing redirect also splits your site into two addresses in search engines.`,
      `ვიზიტორებს, რომლებიც http://${h}-ს ჩაწერენ ან ძველ ბმულზე გადავლენ, საიტი დაუშიფრავი კავშირით უჩვენება და დაცულ ვერსიაზე არ გადაჰყავს. ყველაფერი, რასაც გზაში გაგზავნიან, შეიძლება წაიკითხონ ან შეცვალონ, გადამისამართების არარსებობა კი საძიებო სისტემებში შენს საიტს ორ მისამართად ყოფს.`),
     T(ka, 'A permanent redirect (HTTP status 301) from every http:// address to the same https:// address fixes both problems with a few lines of configuration.',
      'მუდმივი გადამისამართება (HTTP სტატუსი 301) ყველა http:// მისამართიდან იმავე https:// მისამართზე ორივე პრობლემას რამდენიმე სტრიქონით აგვარებს.')],
    ka ? ['დარწმუნდი, რომ HTTPS ვერსია გაფრთხილებების გარეშე მუშაობს.', 'დაამატე მუდმივი გადამისამართება მთელ HTTP ტრაფიკზე (მაგალითები ქვემოთაა).', `შეამოწმე ბრაუზერით და ბრძანებით curl -I http://${h}: პასუხში უნდა იყოს 301 და Location, რომელიც https://-ით იწყება.`, 'ამის შემდეგ დაამატე ამ ანგარიშში აღწერილი HSTS სათაური.']
       : ['Make sure the HTTPS version works without warnings.', 'Add a permanent redirect for all HTTP traffic (examples below).', `Test in a browser and with curl -I http://${h}: you should see a 301 and a Location header that starts with https://.`, 'Afterwards add the HSTS header described in this report.'],
    [{ lang: 'Nginx', text: nginx301 }, { lang: 'Apache (.htaccess)', text: 'RewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]' }]);
  else if (d.redirect?.ok) passed.push(T(ka, 'HTTP redirects to HTTPS.', 'HTTP გადამისამართდება HTTPS-ზე.'));

  const ck = d.cookies;
  if (ck?.issues?.length) {
    const list = ck.issues.slice(0, 5).map(i => `${i.name} (${T(ka, 'missing', 'აკლია')} ${i.missing.join(', ')})`).join('; ');
    add(ck.issues.some(i => i.session) ? 'Medium' : 'Low', T(ka, 'Cookies are missing security flags', 'Cookie-ებს უსაფრთხოების ნიშნები აკლია'),
      [T(ka, `${h} sets cookies without some protective flags. Affected: ${list}.`, `${h} ზოგ cookie-ს დამცავი ნიშნების გარეშე აყენებს. ეხება: ${list}.`),
       T(ka, 'Secure keeps a cookie from being sent over plain HTTP. HttpOnly hides it from JavaScript, so a script injected into your page cannot steal a login session. SameSite limits sending it along with requests started from other websites, which blocks most cross-site request forgery.',
        'Secure არ აძლევს cookie-ს უბრალო HTTP-ით გაგზავნის უფლებას. HttpOnly მას JavaScript-ისგან მალავს, ამიტომ შენს გვერდზე ჩასმულ სკრიპტს შესვლის სესიის მოპარვა არ შეუძლია. SameSite ზღუდავს მის გაგზავნას სხვა საიტებიდან დაწყებულ მოთხოვნებთან ერთად, რაც cross-site request forgery შეტევების უმეტესობას ბლოკავს.')],
      ka ? ['იპოვე, სად იქმნება ჩამოთვლილი cookie-ები (შენი ფრეიმვორკი, CMS ან დამატება).', 'სესიისა და შესვლის cookie-ებზე დააყენე Secure და HttpOnly, ყველაზე კი SameSite=Lax (ან Strict).', 'თუ cookie-ს შენი სკრიპტები უნდა კითხულობდნენ (მაგალითად ენის არჩევანი), მხოლოდ მას HttpOnly ნუ დაუყენებ.', 'გამოშვების შემდეგ ხელახლა დაასკანერე.']
         : ['Find where each listed cookie is created (your framework, CMS or a plugin).', 'Set Secure and HttpOnly on session and login cookies, and SameSite=Lax (or Strict) on all of them.', 'If your own scripts must read a cookie (for example a language preference), leave HttpOnly off for that one only.', 'Re-scan after deploying.'],
      [{ lang: 'Node.js / Express', text: "res.cookie('sid', value, { httpOnly: true, secure: true, sameSite: 'lax' });" }, { lang: 'PHP (php.ini)', text: 'session.cookie_secure = 1\nsession.cookie_httponly = 1\nsession.cookie_samesite = "Lax"' }, { lang: 'Nginx (proxy, 1.19.3+)', text: 'proxy_cookie_flags ~ secure httponly samesite=lax;' }]);
  } else if (ck) passed.push(T(ka, 'Cookies are set with safe flags.', 'Cookie-ები უსაფრთხო ნიშნებითაა დაყენებული.'));

  if (d.disclosure?.length) add('Low', T(ka, 'Your server reveals software versions', 'შენი სერვერი პროგრამების ვერსიებს ამჟღავნებს'),
    [T(ka, `${h} announces which software it runs: ${d.disclosure.join('; ')}.`, `${h} აცხადებს, რომელ პროგრამებზე მუშაობს: ${d.disclosure.join('; ')}.`),
     T(ka, 'Exact version numbers let attackers look up known weaknesses of that exact version and attack many sites automatically. Hiding them does not fix old software, but it removes an easy shortcut.',
      'ზუსტი ვერსიის ნომრები თავდამსხმელს საშუალებას აძლევს მოძებნოს სწორედ ამ ვერსიის ცნობილი სისუსტეები და ბევრ საიტს ავტომატურად შეუტიოს. მათი დამალვა ძველ პროგრამას არ ასწორებს, მაგრამ მარტივ მოკლე გზას ართმევს.')],
    ka ? ['გამორთე ვერსიების ჩვენება ვებ სერვერსა და პროგრამირების გარემოში (მაგალითები ქვემოთაა).', 'უფრო მნიშვნელოვანია, განაახლო ჩამოთვლილი პროგრამები უახლეს მხარდაჭერილ ვერსიამდე.', 'თუ CMS-ის დამატება ან თემა generator ნიშანს ბეჭდავს, ამოიღე.']
       : ['Turn off version banners in your web server and language runtime (examples below).', 'More importantly, update the listed software to the latest supported version.', 'If a CMS plugin or theme prints a generator tag, remove it.'],
    [{ lang: 'Nginx', text: 'server_tokens off;' }, { lang: 'Apache', text: 'ServerTokens Prod\nServerSignature Off' }, { lang: 'PHP (php.ini)', text: 'expose_php = Off' }, { lang: 'Node.js / Express', text: "app.disable('x-powered-by');" }, { lang: 'WordPress (functions.php)', text: "remove_action('wp_head', 'wp_generator');" }]);
  else if (d.disclosure) passed.push(T(ka, 'No software versions are exposed.', 'პროგრამების ვერსიები არ ჩანს.'));

  if (d.mixed?.count > 0) add('Medium', T(ka, `Mixed content: ${d.mixed.count} resources load over plain HTTP`, `შერეული შინაარსი: ${d.mixed.count} რესურსი იტვირთება უბრალო HTTP-ით`),
    [T(ka, `The HTTPS page of ${h} loads resources such as ${d.mixed.samples.join(', ')} over unencrypted HTTP. Browsers may block them (parts of the page break) or load them while warning visitors, and an attacker on the network can replace them with malicious versions.`,
      `${h}-ის HTTPS გვერდი ისეთ რესურსებს, როგორიცაა ${d.mixed.samples.join(', ')}, დაუშიფრავი HTTP-ით ტვირთავს. ბრაუზერებმა შეიძლება ისინი დაბლოკონ (გვერდის ნაწილი გაფუჭდება) ან ვიზიტორებს გააფრთხილონ, ქსელში მყოფ თავდამსხმელს კი შეუძლია ისინი მავნე ვერსიებით ჩაანაცვლოს.`)],
    ka ? ['ყველა სურათის, სკრიპტისა და სტილის http:// მისამართი შეცვალე https://-ით (ან ფარდობითი მისამართით).', 'შეამოწმე, რომ გარე სერვისი HTTPS-ს უჭერს მხარს, თუ არა და ჩაანაცვლე.', 'დამატებითი დაცვისთვის ჩართე upgrade-insecure-requests წესი (ქვემოთ).']
       : ['Change each http:// address of images, scripts and styles to https:// (or to a relative path).', 'Check that the external service supports HTTPS and replace it if it does not.', 'As a safety net, add the upgrade-insecure-requests policy (below).'],
    [{ lang: 'Nginx', text: 'add_header Content-Security-Policy "upgrade-insecure-requests" always;' }, { lang: 'Apache (.htaccess)', text: 'Header always set Content-Security-Policy "upgrade-insecure-requests"' }]);
  else if (d.mixed && r.url.startsWith('https:') && r.up) passed.push(T(ka, 'No mixed content found.', 'შერეული შინაარსი არ მოიძებნა.'));

  const em = d.email;
  if (em?.applicable) {
    if (!em.spf.present || em.spf.policy === 'weak') add('Medium', T(ka, em.spf.present ? 'SPF policy is too weak' : 'SPF record is missing', em.spf.present ? 'SPF წესი ძალიან სუსტია' : 'SPF ჩანაწერი არ არსებობს'),
      [T(ka, `Your domain ${apex} receives email, but ${em.spf.present ? 'its SPF record allows almost any server to send as you' : 'it has no SPF record'}. SPF is the list of servers allowed to send email using your domain name.`,
        `შენი დომენი ${apex} ელფოსტას იღებს, მაგრამ ${em.spf.present ? 'მისი SPF ჩანაწერი თითქმის ნებისმიერ სერვერს აძლევს შენი სახელით გაგზავნის უფლებას' : 'მას SPF ჩანაწერი არ აქვს'}. SPF არის იმ სერვერების სია, რომლებსაც შენი დომენის სახელით ელფოსტის გაგზავნა შეუძლიათ.`),
       T(ka, 'Without a strict SPF record, criminals can send fake emails that look like they come from your company address, for example invoices or password requests to your customers, and your genuine emails are more likely to land in spam.',
        'მკაცრი SPF ჩანაწერის გარეშე თაღლითებს შეუძლიათ ყალბი წერილები გააგზავნონ შენი კომპანიის მისამართიდან, მაგალითად ინვოისები ან პაროლის მოთხოვნები შენს კლიენტებზე, შენი ნამდვილი წერილები კი უფრო ხშირად ხვდება სპამში.')],
      ka ? ['ჩამოწერე ყველა სერვისი, რომელიც შენი დომენის სახელით წერილებს აგზავნის (ფოსტის პროვაიდერი, newsletter-ის სერვისი, საიტის ფორმები).', 'გამოაქვეყნე ერთი TXT ჩანაწერი, რომელიც ყველას შეიცავს და ~all-ით მთავრდება. როცა დარწმუნდები, რომ არაფერი კანონიერი არ გამოგრჩა, შეცვალე -all-ზე.', 'ერთ დომენზე SPF ჩანაწერი ზუსტად ერთი უნდა იყოს.']
         : ['List every service that sends email for your domain (mail provider, newsletter tool, website forms).', 'Publish one TXT record that includes them all and ends with ~all. Once you are sure nothing legitimate is missing, change it to -all.', 'Keep exactly one SPF record per domain.'],
      [{ lang: 'DNS TXT (Google Workspace example)', text: `${apex}.   TXT   "v=spf1 include:_spf.google.com ~all"` }]);
    else passed.push(T(ka, 'SPF record is in place.', 'SPF ჩანაწერი არსებობს.'));
    if (!em.dmarc.present || em.dmarc.policy === 'none') add('Medium', T(ka, em.dmarc.present ? 'DMARC policy only monitors (p=none)' : 'DMARC record is missing', em.dmarc.present ? 'DMARC წესი მხოლოდ აკვირდება (p=none)' : 'DMARC ჩანაწერი არ არსებობს'),
      [T(ka, `DMARC tells receiving mail servers what to do with emails that pretend to come from ${apex} and fail the checks, and it sends you reports about them.`,
        `DMARC აცნობებს მიმღებ ფოსტის სერვერებს, რა უყონ წერილებს, რომლებიც ${apex}-დან მოსულად ასაღებენ თავს, მაგრამ შემოწმებას ვერ ამთავრებენ, და მათზე ანგარიშებს გიგზავნის.`),
       T(ka, 'Without an enforcing policy, fake emails in your company name are still delivered. Start by monitoring, read the reports for a few weeks, then move to quarantine and finally reject. Also turn on DKIM signing in your mail provider\'s admin panel.',
        'მოქმედი წესის გარეშე შენი კომპანიის სახელით გაგზავნილი ყალბი წერილები მაინც მიდის. დაიწყე დაკვირვებით, რამდენიმე კვირა იკითხე ანგარიშები, შემდეგ გადადი quarantine-ზე და ბოლოს reject-ზე. ასევე ჩართე DKIM ხელმოწერა ფოსტის პროვაიდერის ადმინ პანელში.')],
      ka ? ['დაამატე DMARC TXT ჩანაწერი p=none-ით და საკუთარი მისამართით ანგარიშებისთვის.', 'რამდენიმე კვირა წაიკითხე ანგარიშები და გაასწორე კანონიერი წერილების პრობლემები.', 'გადადი p=quarantine-ზე, შემდეგ p=reject-ზე.']
         : ['Add a DMARC TXT record with p=none and your own address for reports.', 'For a few weeks read the reports and fix problems with legitimate email.', 'Move to p=quarantine, then to p=reject.'],
      [{ lang: 'DNS TXT (start)', text: `_dmarc.${apex}.   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@${apex}"` }, { lang: 'DNS TXT (later)', text: `_dmarc.${apex}.   TXT   "v=DMARC1; p=reject; rua=mailto:dmarc@${apex}"` }]);
    else passed.push(T(ka, 'DMARC policy is enforced.', 'DMARC წესი მოქმედებს.'));
  }

  if (em?.applicable && em.dkim?.length) passed.push(T(ka, `DKIM signing detected (selector: ${em.dkim[0]}).`, `DKIM ხელმოწერა აღმოჩენილია (selector: ${em.dkim[0]}).`));
  if (d.securityTxt === false) add('Low', T(ka, 'No security.txt file', 'security.txt ფაილი არ არის'),
    [T(ka, 'security.txt is a small public text file that tells security researchers how to report a vulnerability they found. Without it, responsible finders may not know whom to contact, or may disclose the problem publicly.',
      'security.txt არის პატარა საჯარო ტექსტური ფაილი, რომელიც უსაფრთხოების მკვლევრებს ეუბნება, როგორ შეგატყობინონ ნაპოვნი სისუსტე. მის გარეშე პასუხისმგებელმა მპოვნელმა შეიძლება არ იცოდეს, ვის მიმართოს, ან პრობლემა საჯაროდ გამოაქვეყნოს.')],
    ka ? ['შექმენი ფაილი მისამართზე /.well-known/security.txt.', 'მიუთითე კონტაქტი, რომელსაც რეალურად კითხულობ.', 'დაწერე ვადა, რომელიც არაუმეტეს ერთი წლისაა და წელიწადში ერთხელ განაახლე.']
       : ['Create the file at /.well-known/security.txt.', 'Give a contact address that you really read.', 'Set an expiry date no more than a year ahead and renew it yearly.'],
    [{ lang: 'security.txt', text: `Contact: mailto:security@${apex}\nExpires: ${new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10)}T00:00:00.000Z\nPreferred-Languages: en, ka\nCanonical: https://${h}/.well-known/security.txt` }]);
  else if (d.securityTxt) passed.push(T(ka, 'security.txt is published.', 'security.txt გამოქვეყნებულია.'));

  if (d.domain && d.domain.days <= 30) add(d.domain.days <= 7 ? 'High' : 'Medium',
    T(ka, d.domain.days <= 0 ? `Your domain ${apex} has expired` : `Your domain ${apex} expires in ${d.domain.days} days`, d.domain.days <= 0 ? `დომენს ${apex} ვადა გაუვიდა` : `დომენი ${apex} ${d.domain.days} დღეში იწურება`),
    [T(ka, `The registration of ${apex} ends on ${String(d.domain.expires).slice(0, 10)}. If it lapses, your website and your email stop working, and someone else may register the name.`,
      `${apex}-ის რეგისტრაცია ${String(d.domain.expires).slice(0, 10)}-ს სრულდება. თუ ვადა გავა, შენი საიტიც და ელფოსტაც გაჩერდება, სახელი კი სხვამ შეიძლება დაირეგისტრიროს.`),
     T(ka, 'Domains are often lost because the renewal reminder went to an old email address or the payment card expired.', 'დომენები ხშირად იკარგება იმიტომ, რომ განახლების შეხსენება ძველ ელფოსტაზე მიდის ან ბარათს ვადა გაუვიდა.')],
    ka ? ['განაახლე დომენი რეგისტრატორთან დღესვე.', 'ჩართე ავტომატური განახლება და შეამოწმე გადახდის ბარათი.', 'დარწმუნდი, რომ რეგისტრატორთან მითითებული ელფოსტა მოქმედია.', 'ჩართე დომენის დაბლოკვა (registrar lock).']
       : ['Renew the domain at your registrar today.', 'Turn on auto-renew and check the payment card.', 'Make sure the contact email at the registrar is valid.', 'Enable the registrar lock.'],
    [{ lang: 'Terminal', text: `whois ${apex} | grep -i -E "expir|renewal"` }]);
  else if (d.domain) passed.push(T(ka, 'Domain registration is not expiring soon.', 'დომენის რეგისტრაცია ახლოს არ იწურება.'));
  return { items, passed };
};
