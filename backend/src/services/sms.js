const { SMSOFFICE_KEY, SMS_SENDER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_MESSAGING_SERVICE_SID } = require('../config/env');
// ქართული ნომერი: 599123456 ან +995599123456. უცხოური: +კოდი ნომერი (მაგ. +44 7700 900123)
function normPhone(p) {
  const d = String(p || '').replace(/[\s().-]/g, '');
  if (/^5\d{8}$/.test(d)) return '995' + d;
  if (/^\+?9955\d{8}$/.test(d)) return d.replace('+', '');
  if (/^(\+|00)995(?!5\d{8}$)/.test(d)) return null;
  if (/^(\+|00)[1-9]\d{7,14}$/.test(d)) return d.replace(/^(\+|00)/, '');
  return null;
}
const settings = {
  officeKey: SMSOFFICE_KEY?.trim(),
  officeSender: SMS_SENDER?.trim(),
  twilioSID: TWILIO_ACCOUNT_SID?.trim(),
  twilioToken: TWILIO_AUTH_TOKEN?.trim(),
  twilioFrom: TWILIO_FROM?.trim(),
  twilioService: TWILIO_MESSAGING_SERVICE_SID?.trim()
};

function smsProvider(phone) {
  if (phone.startsWith('995') && settings.officeKey && settings.officeKey !== 'your-smsoffice-api-key' && settings.officeSender)
    return 'SMSoffice';
  if (settings.twilioSID && settings.twilioToken && (settings.twilioService || settings.twilioFrom)) return 'Twilio';
  return null;
}

const SMS_ERRORS = {
  NOT_CONFIGURED: 'SMS delivery is unavailable because no provider is configured for this number.',
  SMS_CREDENTIALS: 'The SMS provider rejected the server credentials.',
  SMS_REJECTED: 'The SMS provider rejected the message. Check the sender and provider account.',
  SMS_UNAVAILABLE: 'The SMS provider did not respond. Try again later.'
};

async function sendSMS(phone, text) {
  const provider = smsProvider(phone);
  if (!provider) throw new Error('NOT_CONFIGURED');
  const form = provider === 'SMSoffice'
    ? { key: settings.officeKey, destination: phone, sender: settings.officeSender, content: text }
    : { To: '+' + phone, Body: text, ...(settings.twilioService
      ? { MessagingServiceSid: settings.twilioService }
      : { From: settings.twilioFrom }) };
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (provider === 'Twilio')
    headers.Authorization = 'Basic ' + Buffer.from(settings.twilioSID + ':' + settings.twilioToken).toString('base64');
  const url = provider === 'SMSoffice' ? 'https://smsoffice.ge/api/v2/send/'
    : 'https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(settings.twilioSID) + '/Messages.json';
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', headers, body: new URLSearchParams(form), signal: AbortSignal.timeout(10000), redirect: 'error'
    });
  } catch {
    throw new Error('SMS_UNAVAILABLE');
  }
  const result = await response.json().catch(() => null);
  if (response.ok && (provider === 'SMSoffice'
    ? result?.Success === true
    : typeof result?.sid === 'string' && !['failed', 'undelivered', 'canceled'].includes(result.status))) return;
  const code = Number(provider === 'SMSoffice' ? result?.ErrorCode : result?.code);
  console.warn('SMS provider rejected request', { provider, status: response.status, code: Number.isInteger(code) ? code : null });
  if (response.status === 401 || response.status === 403 || (provider === 'SMSoffice' && code === 80))
    throw new Error('SMS_CREDENTIALS');
  throw new Error(response.status >= 500 || response.status === 429 ? 'SMS_UNAVAILABLE' : 'SMS_REJECTED');
}

module.exports = { normPhone, sendSMS, smsProvider, SMS_ERRORS };
