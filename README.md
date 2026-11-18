# Secura GE

Secura GE checks website availability, monitors external security configuration, and sends alerts. The app serves a Georgian and English frontend. It requires Node.js 22.13 or newer.

## Run locally

1. Run npm ci in both frontend and backend.
2. Copy backend/.env.example to backend/.env. Set JWT_SECRET to a fresh random value and set FRONTEND_URL to http://localhost:5173 and PUBLIC_API_URL to http://localhost:3000. For a fresh value, run openssl rand -hex 32.
3. Run npm run dev from backend and frontend in separate terminals. Open http://localhost:5173.

Use PAYMENT_MODE=disabled to test the beta without checkout. Configure mail to deliver verification and reset links.

## Deploy the beta

Build the frontend with npm run build from frontend. Express serves frontend/dist. Set NODE_ENV=production and PAYMENT_MODE=disabled. Set FRONTEND_URL and PUBLIC_API_URL to the same public HTTPS origin. Configure TRUST_PROXY to match the proxy topology and ensure the proxy strips untrusted forwarding headers. Use a persistent disk for backend/data.sqlite, uploads and local backups. Run one primary application process against that disk. Keep the primary process and the development server on separate environments.

Use stable, separately generated values for JWT_SECRET and DATA_SECRET. DATA_SECRET encrypts authenticator setup data, dashboard drafts and queued account emails. Preserve it securely when restoring a backup. Configure an email provider as shown below. Set SUPPORT_EMAIL to the supported address you want displayed on the site.

### Account and alert email

On a server that permits SMTP, use the sending Gmail account with Google 2-Step Verification and a Google App Password. Use these settings in backend/.env locally or the service's Environment settings in production.

```dotenv
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-sending-account@gmail.com
SMTP_PASS=
MAIL_FROM=Secura GE <your-sending-account@gmail.com>
```

Set SMTP_PASS to the sender's Google App Password in the server's private environment. Leave checkout and OAuth credentials separate. [Google App Passwords](https://support.google.com/accounts/answer/185833)

Render Free blocks outbound SMTP ports. On that plan, verify a sending domain in Resend and set these variables on the service. Use an address on that verified domain for MAIL_FROM. The recipient can use Gmail. [Render Free limits](https://render.com/docs/free) · [Resend sending domains](https://resend.com/docs/dashboard/domains/introduction)

```dotenv
MAIL_TRANSPORT=resend
RESEND_API_KEY=
MAIL_FROM=Secura GE <alerts@your-verified-domain.ge>
```

Run npm run check-mail -- recipient@example.com from backend to send a test. Run npm run check-mail without a recipient to check SMTP authentication without sending. Set FRONTEND_URL to your public website in production so confirmation and reset links point to the right domain. When the provider is unavailable, account links stay out of application logs. Failed jobs are retried when possible.

Registration and each new sign-in require a one-time email link valid for 5 minutes. Confirm the link, then return to the initiating browser if you opened the email on another device. Configure a working mail provider before enabling public access.

Under Profile → Account data, account deactivation signs out every device and stops the account’s monitoring. Sign in and confirm the reactivation email to restore the account. Under Dashboard → Workspaces, an owner can deactivate or reactivate a company workspace independently. This pauses its monitors and members’ access while preserving history, memberships and personal monitors.

### Two-factor authentication with a passkey

After confirming their email, users can set up a passkey under Profile → Security → Two-factor authentication. Sign-in uses the normal password or social login followed by device confirmation. The browser and device choose which PIN, fingerprint or face unlock to offer. Existing authenticator users can switch using a current authenticator code or a recovery code. Save the new one-time recovery codes when setting up or switching.

Passkeys require a compatible browser on HTTPS or localhost. Set FRONTEND_URL to the exact browser origin, including the port for local development. Use a single canonical production hostname. Passkeys registered on a different hostname cannot be reused on the new one.

### Monitoring and integrations

- New monitors check every 30 minutes by default. A monitor checks the status of the final HTTP response and validates TLS for any HTTPS connection in the redirect chain. An expected status or matching literal can be set per monitor. The literal search uses a bounded text response, including JSON.
- To use a shorter interval, create the DNS TXT record shown in the monitor's domain verification section. The 5- and 15-minute intervals become available after verification.
- Set SMSOFFICE_KEY to the active SMSoffice API key and SMS_SENDER to the sender registered on that account for Georgian numbers. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID for international numbers. If SMSoffice is unconfigured, Georgian numbers can use Twilio when the Twilio sender is enabled for Georgia. Configure these values in backend/.env locally or the hosting service's Environment settings, then restart the backend.
- In Profile, save a mobile number and confirm it with the SMS code. Then send a test in Dashboard → Notifications. Tests are rate-limited and available on all plans. Automated monitoring SMS still requires an SMS-enabled plan. Delivery history reports provider acceptance and failure. Provider acceptance means the request was submitted, and final handset delivery depends on the provider and carrier.
- Workspace invitations are visible to the invited account under Workspaces and can also be shared by link. After confirming their email address, the recipient can accept or decline. The owner can see the response and change an accepted member’s role. Viewers can read shared results, and operators can also trigger a monitor check. Workspace membership, monitor settings and deletion stay under the owner’s control.
- For Telegram, set TELEGRAM_BOT_TOKEN on the backend. Open the bot and start a private chat or add the bot to a group with permission to post. Enter that chat ID in the verified monitor’s alert settings. In Notifications, select Telegram and the same monitor to test it.
- Reputation checks use Cloudflare’s malware and phishing DNS filter by default. This lookup only submits the domain and works without an API key. Set GOOGLE_WEB_RISK_KEY to prefer Google Cloud Web Risk for URL-level lookup without the query string. If Google is unavailable, the result shows the Cloudflare domain-only check. An unblocked domain does not establish that an individual link is safe.
- For an independent second region, deploy a separate instance with MONITOR_WORKER_ONLY=1 and MONITOR_PEER_ACCEPT=1. Both instances need the same independent random MONITOR_PEER_KEY at least 32 characters long. In the primary environment set MONITOR_PEER_URL to the HTTPS origin of the second instance. Restrict incoming traffic to the primary instance's network egress IP wherever possible. The primary sends only confirmations for verified monitors.
- Configure an external uptime monitor against /api/health. The application status page uses the same health endpoint. An independently hosted health page is needed for display during a total hosting outage.
- Permit worker network access only to the public Internet and the private infrastructure directly required for DNS and deployment. Exclude private destinations and cloud instance metadata from the scanner's outbound network reach. Application checks also validate addresses, redirects, and connection lookups. Private targets are permitted only in development and only when explicitly enabled for tests.

### Backups and administration

The scheduler keeps 14 daily SQLite copies in backend/backups. Set BACKUP_DIR to a separate mounted backup location if available, and protect backup directories with access controls and encryption. The database backup includes the monitor data and notification queue. Preserve uploaded files and environment secrets separately.

Check a copy with node scripts/check-backup.js <backup.sqlite> from backend. To rehearse recovery, copy the file to an isolated location and point DB_PATH at the copy. Inspect the copy with the read-only integrity script. Keep the primary scheduler stopped in an isolated restore rehearsal unless its real notification destinations have been removed. Compare record counts with the original snapshot. Keep the running primary and its database separate during the rehearsal.

Add the administrator's verified email to ADMIN_EMAILS. That user needs to enable two-factor authentication through Profile before entering the admin panel. Keep recovery codes in a secure location. Admin changes appear in the audit history.

Review the support, privacy and terms pages against the actual business and hosting arrangements before publishing them.

## Verification

Run npm test from backend and npm run build from frontend. The backend tests use local HTTP and SMTP fixtures for incident and recovery transitions, retries, backup restoration, workspace access, account deletion and admin MFA. CI checks both applications and surfaces advisory results for development dependencies separately from the production dependency gate.
