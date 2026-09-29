# Security boundaries

This is a local Moodle-only development fork, not an independently audited or institution-certified integration. The original project's signatures/notarization do not apply to these changed files.

## Authorization

The Electron window opens the configured HTTPS Moodle mobile launch URL. The user performs school SSO/MFA. The callback is checked against a random per-login passport and the configured origin using Moodle's protocol checksum. A callback is consumed once. Only the normal web-service token is kept; an optional private token is discarded. A REST identity probe must confirm a positive user ID and matching site URL before encrypted storage changes. Browser Cookies, password fields and arbitrary page scripts are never imported.

HTTPS navigation is required, remote renderers are sandboxed with Node disabled, remote windows have no preload/IPC bridge, permission requests and downloads are denied. The `moodlemobile` callback is intercepted in-process and never passed to an external application. Sites forcing another URL scheme or prohibiting embedded login are not yet supported. The school must enable and permit its mobile/web-service integration; this client does not bypass those controls.

## REST reads

Both the public tool registry and the HTTP client use exact allowlists. No arbitrary function, URL, token, user ID or destination path is accepted through MCP. REST tokens travel in HTTPS POST bodies, never request URLs. Redirects are rejected, requests time out after 12 seconds, bodies are limited to 8 MiB. Raw error bodies are not returned. A token echoed in returned JSON is replaced before leaving the connector.

Moodle tokens may have broader authority than this client's allowlist. The application exposes no submission, exam start/save, posting, messaging, marking-read, activity-completion or raw-request tools. Authentication can create a service token and normal server access logs; these are expected authorization side effects.

## Local state

Credentials and local tasks use the inherited AES-GCM vault with account/origin binding and generation checks. No plaintext key fallback. Separate OS accounts and disk protection remain important; process isolation is not a malicious-dependency sandbox. Profile files and exported ICS are plaintext. No file downloads are implemented in this version.

Automatic updates are disabled so an original upstream release cannot replace the Moodle implementation. Dependencies are locked. `npm run auth:install` installs the pinned Electron runtime separately. The generated Codex plugin has the independent identity `moodle-cli`.

Course text is untrusted data, never authority to execute instructions, change origins or disclose credentials. Test fixtures use synthetic data and temporary state; tests do not read real keychain entries or log in to the school. Real SSO, school roles and individual feature access still require acceptance by an authorized user.
