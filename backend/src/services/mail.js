const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, IS_PROD } = require('../config/env');
const { MAIL_TRANSPORT = 'smtp', RESEND_API_KEY } = process.env;
const host = SMTP_HOST || (SMTP_USER && SMTP_PASS ? 'smtp.gmail.com' : '');
const gmail = host.toLowerCase() === 'smtp.gmail.com';
const port = Number(SMTP_PORT || (gmail ? 465 : 587));
const from = MAIL_FROM || SMTP_USER;
const local = !IS_PROD && ['127.0.0.1', '::1', 'localhost'].includes(host);
let transport;

function mailConfigured() {
  if (MAIL_TRANSPORT === 'resend') return !!(RESEND_API_KEY && MAIL_FROM);
  if (MAIL_TRANSPORT !== 'smtp') return false;
  return !!(host && from && port > 0 && port <= 65535 && Number.isInteger(port) &&
    (gmail ? SMTP_USER && SMTP_PASS : !!SMTP_USER === !!SMTP_PASS));
}

function getTransport() {
  return transport ||= require('nodemailer').createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465 && !local,
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
    auth: SMTP_USER ? { user: SMTP_USER, pass: gmail ? SMTP_PASS.replace(/\s/g, '') : SMTP_PASS } : undefined
  });
}

async function deliverMail(to, subject, text, reference) {
  if (!mailConfigured()) throw new Error('MAIL_NOT_CONFIGURED');
  const safeSubject = String(subject).replace(/[\r\n]+/g, ' ').slice(0, 200);
  if (MAIL_TRANSPORT === 'resend') {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json',
        ...(reference ? { 'Idempotency-Key': 'secura-ge/' + reference } : {})
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: safeSubject, text })
    });
    if (!response.ok || !(await response.json()).id) throw new Error('EMAIL_API_REJECTED');
    return;
  }
  const response = await getTransport().sendMail({ from, to, subject: safeSubject, text });
  if (!response.accepted?.length) throw new Error('SMTP_REJECTED');
}

async function verifyMail() {
  if (!mailConfigured()) throw new Error('MAIL_NOT_CONFIGURED');
  if (MAIL_TRANSPORT === 'resend') throw new Error('For Resend, pass a test recipient.');
  await getTransport().verify();
}

module.exports = { mailConfigured, deliverMail, verifyMail };
