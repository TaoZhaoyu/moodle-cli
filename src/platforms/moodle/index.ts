import type { PlatformDefinition } from '../types.js';
export const moodle = {
  id: 'moodle' as const,
  label: 'Moodle',
  environmentPrefixes: ['MOODLE_'],
  readTools: ['moodle_profile', 'moodle_courses', 'moodle_contents', 'moodle_assignments', 'moodle_submission', 'moodle_grades', 'moodle_calendar', 'moodle_forums', 'moodle_discussions', 'moodle_posts'],
  aliases: { profile: 'moodle_profile', courses: 'moodle_courses', content: 'moodle_contents', files: 'moodle_contents', assignments: 'moodle_assignments', submission: 'moodle_submission', grades: 'moodle_grades', calendar: 'moodle_calendar', forums: 'moodle_forums', discussions: 'moodle_discussions', posts: 'moodle_posts' },
  courseArgument: { name: 'courseid', type: 'number' },
  // Metadata only: authorization uses the mobile-service callback, never stored cookies.
  login: { cookieNames: /^MoodleSession$/, sessionCookieNames: ['MoodleSession'], probePath: '/webservice/rest/server.php' },
  probes: { identity: { tool: 'moodle_profile' }, courses: { tool: 'moodle_courses' } },
  overview: ({ days, now }) => ({
    calls: [{ tool: 'moodle_courses' }, { tool: 'moodle_calendar', args: { from: Math.floor(now.getTime() / 1000), days } }],
    scope: { calendarDays: days, announcementsRead: false, assignmentsRead: false, attachmentsRead: false, followUp: 'Read assignments and news forums for relevant courses. Calendar alone is not a complete schedule.' },
  }),
  limitations: 'Requires Moodle REST/mobile services and allowed functions. Each site and account requires live authorization and feature verification. Overview excludes announcements and attachments. Root and subdirectory installations supported. No submission, message sending, quiz attempts or completion writes.',
  loadRuntime: async () => (await import('./runtime.js')).runtime,
} satisfies PlatformDefinition;
