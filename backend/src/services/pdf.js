const fs = require('fs'), path = require('path');
const PDFDocument = require('pdfkit');
const { advise } = require('./advice');
const { adviseKa } = require('./advice-ka');
const COLOR = { High: '#b91c1c', Medium: '#b45309', Low: '#1d4ed8' };
const FONT = { r: path.join(__dirname, '../../fonts/DejaVuSans.ttf'), b: path.join(__dirname, '../../fonts/DejaVuSans-Bold.ttf') };

const LBL = {
  en: { title: 'Security report', score: ' / 100  overall score', sev: { High: 'HIGH', Medium: 'MEDIUM', Low: 'LOW' },
    good: h => `${h} is in good shape. The points below are refinements rather than urgent problems.`,
    mid: h => `${h} has a reasonable foundation, but several protections that are standard on well-run websites are missing. None of them needs deep technical knowledge to fix, and together they noticeably reduce your risk.`,
    low: h => `${h} needs attention soon. The findings below describe real weaknesses that attackers and automated tools look for, and some of them can affect your visitors directly.`,
    status: r => `Status: ${r.up ? 'online' : 'NOT responding correctly'} (HTTP ${r.status || '-'}), response time ${r.responseMs} ms. SSL: ${(r.finalUrl || r.url).startsWith('https:') ? (r.ssl.ok ? `valid, ${r.ssl.days} days left` : 'problem detected') : 'not used'}.`,
    overview: 'Priority overview', finding: (s, i) => `${s} PRIORITY  ·  FINDING ${i}`, todo: 'What to do', code: 'Ready-to-use code', fine: 'What is already fine', none: 'No checks passed in this scan.',
    withCode: 'This report contains full explanations and ready-to-paste code for every finding. Always test changes on a copy of your site or at a quiet time, and keep a backup.',
    noCode: 'This report contains full explanations of every finding and how to fix it. A version that also includes ready-to-paste code for each fix is available as an add-on.',
    end1: 'After you make changes, scan the site again to confirm the score improves. Problems often come back after updates or hosting changes, which is why continuous monitoring with alerts is worth having.',
    end2: 'This report is based on automated, passive checks of publicly available information (SSL certificate, response headers and response time). It is not a penetration test and does not find every possible weakness.' },
  ka: { title: 'უსაფრთხოების ანგარიში', score: ' / 100  საერთო ქულა', sev: { High: 'მაღალი', Medium: 'საშუალო', Low: 'დაბალი' },
    good: h => `${h} კარგ მდგომარეობაშია. ქვემოთ მოცემული პუნქტები სრულყოფის ნაბიჯებია და არა გადაუდებელი პრობლემები.`,
    mid: h => `${h}-ს გონივრული საფუძველი აქვს, მაგრამ რამდენიმე დაცვა, რომელიც კარგად მართულ ვებსაიტებზე სტანდარტია, აკლია. არცერთის გასწორებას ღრმა ტექნიკური ცოდნა არ სჭირდება და ერთად ისინი რისკს შესამჩნევად ამცირებენ.`,
    low: h => `${h}-ს მალე ყურადღება სჭირდება. ქვემოთ აღწერილია რეალური სისუსტეები, რომლებსაც თავდამსხმელები და ავტომატური ხელსაწყოები ეძებენ, და ზოგიერთმა მათგანმა შეიძლება პირდაპირ ზიანი მიაყენოს შენს ვიზიტორებს.`,
    status: r => `სტატუსი: ${r.up ? 'ხელმისაწვდომია' : 'სწორად არ პასუხობს'} (HTTP ${r.status || '-'}), პასუხის დრო ${r.responseMs} ms. SSL: ${(r.finalUrl || r.url).startsWith('https:') ? (r.ssl.ok ? `მოქმედია, დარჩა ${r.ssl.days} დღე` : 'პრობლემაა') : 'არ გამოიყენება'}.`,
    overview: 'პრიორიტეტების მიმოხილვა', finding: (s, i) => `${s} პრიორიტეტი  ·  პუნქტი ${i}`, todo: 'რა უნდა გააკეთო', code: 'მზა კოდი', fine: 'რა არის უკვე კარგად', none: 'ამ სკანირებაში არცერთი შემოწმება არ გაიარა.',
    withCode: 'ეს ანგარიში შეიცავს სრულ ახსნებს და მზა კოდს ყოველი პუნქტისთვის. ცვლილებები ყოველთვის გამოსცადე საიტის ასლზე ან მშვიდ დროს და შეინახე სარეზერვო ასლი.',
    noCode: 'ეს ანგარიში შეიცავს ყოველი პუნქტის სრულ ახსნას და მისი გასწორების გზას. ვერსია, რომელიც ასევე შეიცავს მზა კოდს ყოველი გასწორებისთვის, ცალკე დამატებითი სერვისია.',
    end1: 'ცვლილებების შემდეგ საიტი ხელახლა დაასკანერე, რომ დარწმუნდე ქულა გაუმჯობესდა. პრობლემები ხშირად ბრუნდება განახლებებისა და ჰოსტინგის ცვლილებების შემდეგ, ამიტომ შეტყობინებებით უწყვეტი მონიტორინგი ღირს.',
    end2: 'ეს ანგარიში დაფუძნებულია საჯაროდ ხელმისაწვდომი ინფორმაციის ავტომატურ, პასიურ შემოწმებაზე (SSL სერტიფიკატი, პასუხის სათაურები და პასუხის დრო). ეს არ არის შეღწევადობის ტესტი და ყველა შესაძლო სისუსტეს ვერ პოულობს.' }
};

module.exports = (r, res, { withCode = false, lang = 'en' } = {}) => {
  const ka = lang === 'ka', L = LBL[ka ? 'ka' : 'en'];
  const { findings, passed } = (ka ? adviseKa : advise)(r, withCode);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="secura-${r.host}.pdf"`);
  const scannedAt = new Date(r.scannedAt);
  const d = new PDFDocument({ margin: 54, size: 'A4', info: { CreationDate: scannedAt, ModDate: scannedAt } }); d.pipe(res);
  // ქართულისთვის ვიყენებთ DejaVu Sans-ს (მას ქართული ასოები აქვს); თუ ფაილი არ არის, Helvetica-ზე ვბრუნდებით
  const custom = ka && fs.existsSync(FONT.r) && fs.existsSync(FONT.b);
  if (custom) { d.registerFont('R', FONT.r); d.registerFont('B', FONT.b); }
  const R = custom ? 'R' : 'Helvetica', B = custom ? 'B' : 'Helvetica-Bold';
  const Lx = 54, W = d.page.width - 108;
  const need = h => { if (d.y + h > d.page.height - 60) d.addPage(); };
  const p = (t, o = {}) => d.font(R).fontSize(10.5).fillColor('#222').text(t, Lx, d.y, { width: W, lineGap: 2.5, ...o }).moveDown(0.6);
  const code = (lang, text) => {
    d.font('Courier').fontSize(8.5); const h = d.heightOfString(text, { width: W - 16 }) + 14;
    need(h + 24); d.font('Helvetica-Bold').fontSize(9).fillColor('#555').text(lang, Lx, d.y).moveDown(0.2);
    const y = d.y; d.rect(Lx, y, W, h).fill('#f3f4f6');
    d.fillColor('#111').font('Courier').fontSize(8.5).text(text, Lx + 8, y + 7, { width: W - 16 });
    d.x = Lx; d.y = y + h + 10;
  };

  d.font(B).fontSize(24).fillColor('#111').text(L.title, Lx, 54);
  d.font(R).fontSize(11).fillColor('#555').text(`${r.url}  ·  ${r.scannedAt.slice(0, 10)}  ·  Secura GE`).moveDown(1.2);
  d.font(B).fontSize(40).fillColor(r.score >= 75 ? '#15803d' : r.score >= 45 ? '#b45309' : '#b91c1c').text(`${r.score}`, Lx, d.y, { continued: true })
    .font(R).fontSize(14).fillColor('#555').text(L.score).moveDown(0.8);
  if (r.score != null) p(r.score >= 85 ? L.good(r.host) : r.score >= 60 ? L.mid(r.host) : L.low(r.host));
  p(L.status(r));
  if (findings.length) {
    d.font(B).fontSize(13).fillColor('#111').text(L.overview, Lx, d.y).moveDown(0.4);
    findings.forEach((f, i) => d.font(R).fontSize(10.5).fillColor('#222').text(`${i + 1}.  [${L.sev[f.sev]}]  ${f.title}`, Lx, d.y, { width: W }).moveDown(0.25));
  }
  d.moveDown(0.8);
  p(withCode ? L.withCode : L.noCode);

  findings.forEach((f, i) => {
    need(160); d.moveDown(0.6);
    d.font(B).fontSize(9).fillColor(COLOR[f.sev]).text(L.finding(L.sev[f.sev], i + 1), Lx, d.y).moveDown(0.15);
    d.font(B).fontSize(15).fillColor('#111').text(f.title, Lx, d.y, { width: W }).moveDown(0.5);
    f.paras.forEach(t => p(t));
    d.font(B).fontSize(11).fillColor('#111').text(L.todo, Lx, d.y).moveDown(0.3);
    f.steps.forEach((s, n) => p(`${n + 1}.  ${s}`, { indent: 12 }));
    if (f.code) { d.font(B).fontSize(11).fillColor('#111').text(L.code, Lx, d.y).moveDown(0.3); f.code.forEach(c => code(c.lang, c.text)); }
  });

  need(120); d.moveDown(0.8);
  d.font(B).fontSize(13).fillColor('#111').text(L.fine, Lx, d.y).moveDown(0.4);
  (passed.length ? passed : [L.none]).forEach(t => p('•  ' + t, { indent: 8 }));
  d.moveDown(0.5); p(L.end1); p(L.end2);
  d.end();
};
