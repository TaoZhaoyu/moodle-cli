# Development

Use Node.js 24 and install dependencies with `npm ci --ignore-scripts`. `npm run auth:install` is separate and needed only for the login window.

Run `npm run typecheck`, `npm test`, and `npm run pack:cli`. Keep tests offline with synthetic responses and temporary LMS_HOME. Do not access real school credentials, profiles or the system keychain in automated tests.

Only Moodle is registered. Add read functions explicitly to both the connector HTTP allowlist and the public registry; inspect Moodle implementation for writes and include tests for permissions, schema, origin, secret redaction and incomplete results. Never expose a generic function-name or URL escape hatch.

See docs/ARCHITECTURE.md and docs/VALIDATION.md. Do not restore the original project's updater, installation URLs, Canvas/Blackboard plugins, or signed-release claims in this fork.
