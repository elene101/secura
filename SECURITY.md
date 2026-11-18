# Secura GE deployment security

Production enables Secure session cookies, CSRF checks, HSTS and browser security headers. Passwords use scrypt. Administrator access requires a verified email and MFA. Passkey challenges are single-use, expire, and are bound to the configured origin and account. Legacy TOTP secrets and queued account emails are encrypted. Sign-in confirmations are short-lived, single-use and complete authentication only in the initiating browser. Recovery codes and invite tokens are stored as hashes.

The external scanner validates URLs, DNS results, redirects and outbound connection lookups. HTTP requests also have bounded time and response size. The app shares a scanner concurrency budget and per-host budget across public scans, reports, and monitors. Apply independent network egress controls at the host or container layer. Use the development private-target setting only for isolated test fixtures.

Use Node.js 22.13 or newer. Production fails when SQLite is unavailable. Use a single primary application process with its own persistent database and storage. Store database backups independently of the primary disk and rehearse restoring them. Keep DATA_SECRET with protected deployment secrets so backup restoration can decrypt existing data.

The notification queue can retry after interruptions. Email and SMS show acceptance by their providers. A provider can receive a duplicate after an interruption between accepting a message and persisting the local result.

Report a security issue using the configured support address shown on the website.
