import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LmsError, publicError } from '../../errors.js';
import type { PlatformRuntime } from '../types.js';
import { MoodleClient } from './client.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const course = { courseid: id };
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const unix = z.number().int().min(0).max(4102444800);

export function createMoodleServer(client?: MoodleClient) {
  const server = new McpServer({ name: 'moodle-cli-connector', version: '0.1.0' });
  function register(name: string, description: string, schema: z.ZodRawShape, handler: (c: MoodleClient, args: any) => Promise<unknown>) {
    server.registerTool(name, { description, inputSchema: schema, annotations }, async args => {
      try {
        if (!client) throw new LmsError('AUTH_REQUIRED', 'Sign in to Moodle before reading data.');
        const parsed = z.object(schema).strict().parse(args);
        const result = await handler(client, parsed);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e instanceof z.ZodError ? { code: 'BAD_INPUT', message: 'Invalid tool arguments.' } : publicError(e) }) }] }; }
    });
  }
  const wrap = (c: MoodleClient, data: any, path: string, scope: Record<string, unknown> = {}) => ({ source: `${c.origin}${path}`, fetchedAt: new Date().toISOString(), scope: { ...scope, partial: scope.partial === true || (Array.isArray(data?.warnings) && data.warnings.length > 0) }, data });
  register('moodle_profile', 'Current user identity, site and available reviewed capabilities. No token or private token.', {}, async c => {
    const s = await c.siteInfo();
    return wrap(c, { userid: s.userid, fullname: s.fullname, sitename: s.sitename, release: s.release }, '/user/profile.php');
  });
  register('moodle_courses', 'Courses enrolled by the current user. Bounded output; use offset to continue. No other user selector.', { offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(200).default(100) }, async (c, a) => {
    const s = await c.siteInfo(); const rows = await c.read('core_enrol_get_users_courses', { userid: s.userid });
    if (!Array.isArray(rows)) throw new LmsError('MOODLE_RESPONSE', 'Expected a course list.');
    return wrap(c, rows.slice(a.offset, a.offset + a.limit), '/my/courses.php', { offset: a.offset, total: rows.length, partial: a.offset > 0 || rows.length > a.offset + a.limit, nextOffset: rows.length > a.offset + a.limit ? a.offset + a.limit : null });
  });
  register('moodle_contents', 'Sections, activities and file metadata for one course. Does not download files or mark activities viewed/completed.', course, async (c, a) => wrap(c, await c.read('core_course_get_contents', { courseid: a.courseid }), `/course/view.php?id=${a.courseid}`, { attachmentsRead: false }));
  register('moodle_assignments', 'Assignment descriptions and due dates for one course; unavailable/zero dates are not guessed.', course, async (c, a) => wrap(c, await c.read('mod_assign_get_assignments', { courseids: [a.courseid] }), `/course/view.php?id=${a.courseid}`));
  register('moodle_submission', 'Current user submission status and feedback for an assignment ID (not course-module ID). Never submits or changes work.', { assignid: id }, async (c, a) => wrap(c, await c.read('mod_assign_get_submission_status', { assignid: a.assignid, userid: (await c.siteInfo()).userid }), `/my/`, { assignmentId: a.assignid, sourceNote: 'Use the course contents module URL for a direct assignment link.' }));
  register('moodle_grades', 'Current user grade items in one course. No arbitrary user selector.', course, async (c, a) => wrap(c, await c.read('gradereport_user_get_grade_items', { courseid: a.courseid, userid: (await c.siteInfo()).userid }), `/grade/report/user/index.php?id=${a.courseid}`));
  register('moodle_calendar', 'Calendar events for a bounded Unix-second interval; includes site/current-user/course events. Excludes forum announcements and may omit uncalendared deadlines.', { courseid: id.optional(), from: unix.optional(), days: z.number().int().min(1).max(90).default(14) }, async (c, a) => {
    const from = a.from ?? Math.floor(Date.now() / 1000); const to = from + a.days * 86400;
    let courseids: number[];
    let truncated = false;
    if (a.courseid) courseids = [a.courseid];
    else {
      const courses = await c.read('core_enrol_get_users_courses', { userid: (await c.siteInfo()).userid });
      if (!Array.isArray(courses) || courses.some((row: any) => !Number.isSafeInteger(row?.id) || row.id <= 0)) throw new LmsError('MOODLE_RESPONSE', 'Expected enrolled course IDs for calendar scope.');
      courseids = courses.slice(0, 200).map((row: any) => row.id); truncated = courses.length > 200;
    }
    return wrap(c, await c.read('core_calendar_get_calendar_events', { events: { courseids }, options: { userevents: 1, siteevents: 1, timestart: from, timeend: to } }), '/calendar/view.php', { from, to, courseids, coursesTruncated: truncated, partial: true, groupEventsRead: false, announcementsRead: false, attachmentsRead: false });
  });
  register('moodle_forums', 'Forums for one course. News/announcement forums normally have type news; do not assume every forum is an announcement.', course, async (c, a) => wrap(c, await c.read('mod_forum_get_forums_by_courses', { courseids: [a.courseid] }), `/course/view.php?id=${a.courseid}`));
  register('moodle_discussions', 'One page of forum discussions (including announcement forums); follow posts for the full discussion. Does not mark read.', { forumid: id, page: z.number().int().min(0).max(1000).default(0), limit: z.number().int().min(1).max(50).default(20) }, async (c, a) => {
    const data = await c.read('mod_forum_get_forum_discussions', { forumid: a.forumid, page: a.page, perpage: a.limit });
    if (!Array.isArray(data.discussions)) throw new LmsError('MOODLE_RESPONSE', 'Expected a forum discussion page.');
    return wrap(c, data, `/mod/forum/view.php?f=${a.forumid}`, { page: a.page, limit: a.limit, partial: a.page > 0 || data.discussions.length >= a.limit, nextPage: data.discussions.length >= a.limit ? a.page + 1 : null, attachmentsRead: false });
  });
  register('moodle_posts', 'Posts of one discussion. Does not mark read or post replies. Response size is bounded; attached file bodies are not read.', { discussionid: id }, async (c, a) => wrap(c, await c.read('mod_forum_get_discussion_posts', { discussionid: a.discussionid, sortby: 'created', sortdirection: 'ASC' }), `/mod/forum/discuss.php?d=${a.discussionid}`, { attachmentsRead: false }));
  return server;
}

let current: MoodleClient | undefined;
export const runtime: PlatformRuntime = {
  configure() { current = undefined; },
  async validate(context, candidate) {
    if (candidate.kind !== 'token') throw new LmsError('AUTH_REQUIRED', 'Moodle requires a mobile-service or web-service token, not a browser cookie.');
    await new MoodleClient(context.origin, candidate.value).siteInfo();
    return { kind: 'token', value: candidate.value, validatedAt: new Date().toISOString() };
  },
  async install(context, credential) {
    if (credential && credential.kind !== 'token') throw new LmsError('AUTH_REQUIRED', 'Unsupported Moodle authorization.');
    current = credential ? new MoodleClient(context.origin, credential.value) : undefined;
  },
  async serve() { await createMoodleServer(current).connect(new StdioServerTransport()); },
};
