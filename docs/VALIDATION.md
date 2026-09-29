# Validation — Moodle CLI CLI 0.1.0

Date: 2026-09-28. Environment: macOS arm64, Node.js 22.16.0.

## Verified locally

- TypeScript type check and build passed.
- 34 automated tests passed, 0 failed, 0 skipped. All private API data is synthetic, and all profile/vault state uses temporary directories or an in-memory key provider.
- CLI → Backend → actual worker MCP tool discovery passed without credentials. Fresh-install custom schools, multiple accounts, subdirectory REST/source URLs, deployment-bound mobile callbacks and same-host vault isolation also passed. Only Moodle commands/10 reviewed platform tools are exposed.
- Actual public stdio MCP handshake exposes 17 front-door tools; profile listing, tool schema discovery and missing-authorization diagnostics passed without opening a school window.
- Tests cover read allowlists, fixed-origin requests, token transport/redaction, malformed/oversized responses, function availability, current-user binding, pagination/warnings, calendar course IDs, site/passport-bound mobile callback, account/cache isolation, encrypted state, stale generations, preserved task history and ICS timestamps.
- Plugin manifest validator and query-skill validator passed.
- `npm audit --omit=dev`: 0 known vulnerabilities at the time of this run. This is a point-in-time dependency check, not a security certification.

## Public HSUHK observation

An unauthenticated request to the official Moodle public configuration function `tool_mobile_get_public_config` returned:

- origin: `https://moodle.hsu.edu.hk`
- site name: `HSUHK Moodle`
- `enablewebservices: 1`
- `enablemobilewebservice: 1`
- `typeoflogin: 3` (embedded-browser mobile login)
- launch URL: `https://moodle.hsu.edu.hk/admin/tool/mobile/launch.php`

Only public configuration was requested. No user account, password, MFA, token, courses or grades were accessed. Public settings do not prove a particular account's service permissions or successful SSO.

## Pending real-account acceptance

1. User completes the school's mobile-service login and MFA in the local authorization window.
2. Verify identity/site binding, enrolled courses and one relevant course's assignments, news forum, grades and calendar.
3. Compare output against the school UI, including group-specific notices, pagination and changed deadlines.
4. Confirm expiry/logout/re-login and OS keychain behavior with the actual account.

Not verified: live SSO/MFA, model-assisted private queries, Windows/Linux physical systems, institution-custom plugins, group-specific calendar events, attachment text, other schools, signed/notarized distribution or publication. Original lms-cli release validation does not apply to this fork. School URLs and public capabilities may change.

## Delivery note

Node dependencies and compiled JavaScript are present in the local delivery directory. Electron binary preparation was attempted but did not complete during this run and was stopped; run `npm run auth:install` before the first browser authorization. No login window was opened. The source ZIP excludes node_modules, local state and credentials; reinstall dependencies when unpacking on another machine.
