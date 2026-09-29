# Third-party notices

This Moodle-only fork derives from **zs-andy/lms-cli**, source commit `8933a80` (2026-09-21), under the MIT license. The original license is retained in LICENSE. Shared configuration, worker/MCP/backend, vault, local task, authentication window, CLI and plugin plumbing were adapted; the Canvas and Blackboard vendored connectors were removed.

The new Moodle connector calls the official Moodle REST/mobile-service protocol. Moodle server source is not bundled. Protocol/parameter references:

- https://moodledev.io/docs/5.0/apis/subsystems/external
- https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/admin/tool/mobile/launch.php
- https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/forum/externallib.php
- https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/calendar/externallib.php

Runtime/build dependencies include the Model Context Protocol SDK (MIT), Electron (MIT and bundled component notices), TypeScript (Apache-2.0), Zod (MIT), Commander (MIT), Ajv (MIT), ical-generator (MIT), proper-lockfile (MIT), and @napi-rs/keyring (see its package license). Exact versions and transitive dependencies are in package-lock.json; package distributions retain their own license files.

Moodle and school names are identifiers only. This project is not affiliated with or endorsed by HSUHK, Moodle, or OpenAI. The inherited neutral application icon is covered by the upstream MIT license.
