const { deliverMail, verifyMail } = require('../src/services/mail');

async function main() {
  const recipient = process.argv[2];
  if (recipient) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Enter one recipient email address.');
    await deliverMail(recipient, 'Secura GE email test', 'Secura GE can submit messages to the configured email provider.');
    console.log('The email provider accepted the test message. Check the recipient’s inbox and spam folder.');
  } else {
    await verifyMail();
    console.log('SMTP connection and authentication succeeded.');
  }
}
main().catch(error => {
  const code = [error.code, error.message].find(value => typeof value === 'string' && /^[A-Z_0-9]+$/.test(value));
  console.error('Email check failed.' + (code ? ' Code: ' + code : ' Check the transport settings and retry.'));
  process.exitCode = 1;
});
