# Moodle architecture

CLI / public MCP → shared Backend → account-specific worker → Moodle REST MCP → configured HTTPS site.

- `src/platforms/registry.ts` registers Moodle only. CLI options, MCP platform enums and profile validation derive from it.
- `src/platforms/moodle/index.ts` owns tool aliases, read allowlist and bounded overview scope.
- `client.ts` binds a token to one HTTPS origin, validates identity/service function availability, POST-encodes nested Moodle parameters, rejects redirects and bounded-response failures, and redacts errors.
- `runtime.ts` provides 10 narrow MCP reads. Grades/submission/courses bind to the token user's ID, not arbitrary caller IDs. Forum reads do not call view/mark-read functions. Calendar passes enrolled course IDs explicitly; group events and uncalendared announcements remain coverage gaps.
- `src/auth/moodle-mobile.ts` constructs the official mobile launch URL and validates its callback. `auth/app.ts` captures the callback inside a hardened ephemeral window, passes the token through the private worker pipe, and clears browser state. No remote page JavaScript execution or Cookie import.
- `vault.ts` encrypts tokens and local tasks, binds files to profile/slot/origin and rejects stale worker writes. Default state root is independent from upstream.
- `updates.ts` intentionally performs no network request or install. Plugin identity is independent; generated MCP configuration pins the current local Node/CLI paths.

## API mapping

| Tool | Official read function |
| --- | --- |
| moodle_profile | core_webservice_get_site_info |
| moodle_courses | core_enrol_get_users_courses |
| moodle_contents | core_course_get_contents |
| moodle_assignments | mod_assign_get_assignments |
| moodle_submission | mod_assign_get_submission_status |
| moodle_grades | gradereport_user_get_grade_items |
| moodle_calendar | core_calendar_get_calendar_events |
| moodle_forums | mod_forum_get_forums_by_courses |
| moodle_discussions | mod_forum_get_forum_discussions |
| moodle_posts | mod_forum_get_discussion_posts |

Root and subdirectory installations are supported. The normalized deployment base is preserved in REST URLs, mobile launch URLs, identity checks, callback binding, vault keys and source links. Different subdirectory sites on one host remain isolated. School-specific custom plugins and external submission portals are outside this version.
