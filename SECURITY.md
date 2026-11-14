# Security notes

## Scope and limitations

This is a local development system, not a production-ready property-management platform. It stores guest contact details in PostgreSQL and must not be exposed publicly or used with real guest/payment data. No production deployment is configured.

## Implemented safeguards

- Helmet security headers, restrictive Content Security Policy, same-origin CORS, JSON request size limit, and rate limits on login and public write endpoints.
- Admin accounts use bcrypt password hashes. Login creates random opaque sessions stored as HMAC hashes in PostgreSQL; cookies are HttpOnly and SameSite=Lax, and Secure is enabled when `NODE_ENV=production`.
- Google guest sign-in uses an OAuth authorization-code flow with state validation, PKCE, Google ID-token signature/audience verification, and verified-email checks. Guest sessions are separate, opaque, HttpOnly cookies; reservations are linked using the server-side customer identity.
- Room/offer management is role-protected. Offer prices are recomputed server-side and saved with the reservation as a pricing snapshot.
- Admin APIs require a valid session and role. Staff can manage day-to-day operations; user management, payment settings, reviews, audit logs, and contact reveal are admin-only.
- Room-category locks and serializable transactions protect overlapping inventory reservations. Rates are stored as booking snapshots.
- Guest lookup requires both an unpredictable booking reference and matching normalized Kenyan phone number. Phone numbers are masked in staff lists; full contact reveal is restricted and audited.
- M-Pesa can only call `https://sandbox.safaricom.co.ke`. The code rejects non-sandbox mode, requires an HTTPS callback and constant-time callback-token comparison, validates callback amount/phone/receipt, and records callback fingerprints to prevent duplicate processing.
- Payment/provider secrets, raw callback bodies, passwords, and full phone numbers are not logged.

## Important safeguards before any real use

- Never expose the local server or `/admin` through a public tunnel. M-Pesa callbacks are not reachable from Safaricom during local-only testing; use only mocked/manual callback tests unless a separately isolated callback relay is designed.
- Do not replace the sandbox host with a production endpoint. Production payment handling, reconciliation, refunds, Safaricom IP controls, and independent security testing are not implemented.
- Rotate all `.env` secrets if exposed. Keep `.env` untracked and do not use the initial credentials for real accounts.
- Register exact OAuth callback URLs, use a dedicated production Google client, keep its client secret in managed secret storage, and confirm privacy notices and account-data deletion/retention processes before enabling guest sign-in publicly.
- Review Kenya Data Protection Act obligations, consent, data minimization, access, deletion, retention, encryption-at-rest, backup/restore and incident procedures before collecting real personal data.
- Add HTTPS, secure CSRF protections, secure secret management, database least privilege, monitoring, backups, restore drills, and authorization/security tests before considering production use.
- Contact forms are stored locally; no automated email or SMS notifications, retention policy, or privacy-request workflow is implemented.
