import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MoodleClient, READ_FUNCTIONS } from '../src/platforms/moodle/client.js';
import { createMoodleServer, runtime } from '../src/platforms/moodle/runtime.js';
import { mobileLaunch, mobileCallback } from '../src/auth/moodle-mobile.js';
import { sameHostHttpsUpgrade } from '../src/auth/cookies.js';
import { platformIds } from '../src/platforms/registry.js';
import { isAllowed } from '../src/policy.js';
import { LmsError } from '../src/errors.js';

const origin = 'https://moodle.example.edu';
const token = 'a'.repeat(32); // Synthetic only.
const info = { userid: 17, siteurl: origin, fullname: 'Synthetic Student', functions: [...READ_FUNCTIONS].map(name => ({ name })) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (e: LmsError) => e.code === code && !e.message.includes(token));

test('only Moodle registered and remote write functions cannot be requested', async () => {
  assert.deepEqual(platformIds, ['moodle']);
  for (const name of ['canvas_list_courses', 'bb_list_courses', 'moodle_submit_assignment', 'mod_assign_submit_for_grading', 'mod_forum_add_discussion_post', 'core_completion_update_activity_completion_status_manually']) assert.equal(isAllowed(name), false);
  let count = 0;
  const c = new MoodleClient(origin, token, (async () => { count++; return json(info); }) as typeof fetch);
  await rejects(c.request('mod_assign_submit_for_grading'), 'TOOL_NOT_ALLOWED');
  await rejects(c.request('core_webservice_get_site_info', { wstoken: 'injection' }), 'BAD_INPUT');
  assert.equal(count, 0);
});
test('REST encodes nested parameters and keeps tokens out of URL; redirects disabled', async () => {
  const c = new MoodleClient(origin, token, (async (url, init) => {
    assert.equal(String(url), `${origin}/webservice/rest/server.php`);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.method, 'POST');
    const form = init?.body as URLSearchParams;
    assert.equal(form.get('wstoken'), token); assert.equal(form.get('courseids[0]'), '12');
    assert.equal(form.get('options[limit]'), '20');
    return json({ courses: [] });
  }) as typeof fetch);
  assert.deepEqual(await c.request('mod_assign_get_assignments', { courseids: [12], options: { limit: 20 } }), { courses: [] });
});
test('identity must match origin and an authenticated user', async () => {
  for (const body of [{ ...info, userid: 0 }, { ...info, siteurl: 'https://other.edu' }, { ...info, functions: null }]) {
    await rejects(new MoodleClient(origin, token, (async () => json(body)) as typeof fetch).siteInfo(), 'AUTH_REQUIRED');
  }
});
test('missing service function is explicit, not empty success', async () => {
  let calls = 0;
  const c = new MoodleClient(origin, token, (async () => { calls++; return json({ ...info, functions: [] }); }) as typeof fetch);
  await rejects(c.read('core_course_get_contents', { courseid: 12 }), 'FUNCTION_UNAVAILABLE');
  assert.equal(calls, 1);
});
test('HTML, malformed JSON, oversized body, non-JSON primitive and HTTP errors fail closed', async () => {
  for (const [response, code] of [
    [new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), 'MOODLE_RESPONSE'],
    [new Response('{bad', { headers: { 'content-type': 'application/json' } }), 'MOODLE_RESPONSE'],
    [json(null), 'MOODLE_RESPONSE'], [json({}, 401), 'AUTH_REQUIRED'], [json({}, 403), 'FORBIDDEN'],
    [new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(9 * 1024 * 1024) } }), 'RESPONSE_TOO_LARGE'],
    [json({ body: 'x'.repeat(8 * 1024 * 1024) }), 'RESPONSE_TOO_LARGE'],
  ] as const) await rejects(new MoodleClient(origin, token, (async () => response) as typeof fetch).request('core_webservice_get_site_info'), code);
});
test('network and Moodle exceptions never reveal arbitrary server bodies or secrets', async () => {
  for (const code of ['invalidtoken', 'nopermissions', 'unknown']) {
    const c = new MoodleClient(origin, token, (async () => json({ exception: 'moodle_exception', errorcode: code, message: token, debuginfo: 'private details' })) as typeof fetch);
    await rejects(c.request('core_webservice_get_site_info'), code === 'invalidtoken' ? 'AUTH_REQUIRED' : code === 'nopermissions' ? 'FORBIDDEN' : 'MOODLE_API');
  }
  await rejects(new MoodleClient(origin, token, (async () => { throw new Error(`redirect ${token}`); }) as typeof fetch).siteInfo(), 'MOODLE_NETWORK');
});
test('token reflected in a successful JSON response is redacted', async () => {
  const c = new MoodleClient(origin, token, (async () => json({ url: `${origin}/file?token=${token}`, nested: [token] })) as typeof fetch);
  const result = await c.request('core_course_get_contents', { courseid: 1 });
  assert(!JSON.stringify(result).includes(token));
});
test('mobile authorization binds callback to site and fresh passport and discards private token', () => {
  const launch = mobileLaunch(origin); const other = mobileLaunch(origin);
  assert.notEqual(launch.passport, other.passport);
  assert.equal(new URL(launch.url).searchParams.get('service'), 'moodle_mobile_app');
  const payload = createHash('md5').update(origin + launch.passport).digest('hex') + ':::' + token + ':::PRIVATE-TOKEN';
  const url = `moodlemobile://token=${Buffer.from(payload).toString('base64')}`;
  assert.equal(mobileCallback(url, origin, launch.passport), token);
  assert.throws(() => mobileCallback(url, origin, other.passport));
  assert.throws(() => mobileCallback(url, 'https://evil.edu', launch.passport));
  for (const bad of ['https://evil.edu', 'moodlemobile://token=%zz', 'moodlemobile://token=bad', `${url}&extra=1`]) assert.throws(() => mobileCallback(bad, origin, launch.passport));
});
test('same-host HTTP login redirects are upgraded locally without allowing plaintext or cross-host navigation', () => {
  const configured = 'https://moodle.hsu.edu.hk';
  assert.equal(sameHostHttpsUpgrade('http://moodle.hsu.edu.hk/mdl-login/', configured), 'https://moodle.hsu.edu.hk/mdl-login/');
  assert.equal(sameHostHttpsUpgrade('https://moodle.hsu.edu.hk/mdl-login/', configured), null);
  assert.equal(sameHostHttpsUpgrade('http://sso.hsu.edu.hk/login', configured), null);
  assert.equal(sameHostHttpsUpgrade('http://user:pass@moodle.hsu.edu.hk/login', configured), null);
});
test('Moodle rejects cookie credentials rather than pretending they are REST tokens', async () => {
  await rejects(runtime.validate({ origin, profileId: 'synthetic', stateHome: '/tmp/unused' }, { kind: 'cookie', value: 'MoodleSession=synthetic' }), 'AUTH_REQUIRED');
});

async function withServer(c: MoodleClient | undefined, fn: (client: Client) => Promise<void>) {
  const server = createMoodleServer(c); const client = new Client({ name: 'test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try { await server.connect(left); await client.connect(right); await fn(client); }
  finally { await client.close(); await server.close(); }
}
const resultJSON = (r: any) => JSON.parse(r.content[0].text);
test('actual MCP handshake is available offline and private reads require authorization', async () => {
  await withServer(undefined, async c => {
    const catalog = await c.listTools(); assert.equal(catalog.tools.length, 10);
    assert(catalog.tools.every(t => isAllowed(t.name)));
    const result = await c.callTool({ name: 'moodle_courses', arguments: {} });
    assert.equal(result.isError, true); assert.equal(resultJSON(result).error.code, 'AUTH_REQUIRED');
  });
});
test('MCP binds reads to current user, preserves pagination and warnings, and uses exact Moodle parameters', async () => {
  const requests: URLSearchParams[] = [];
  const c = new MoodleClient(origin, token, (async (_url, init) => {
    const p = init?.body as URLSearchParams; requests.push(p);
    switch (p.get('wsfunction')) {
      case 'core_webservice_get_site_info': return json(info);
      case 'core_enrol_get_users_courses': return json([{ id: 1 }, { id: 2 }, { id: 3 }]);
      case 'mod_forum_get_forum_discussions': return json({ discussions: [{ id: 5 }], warnings: [] });
      case 'mod_assign_get_assignments': return json({ courses: [], warnings: [{ warningcode: '1', message: 'Synthetic warning' }] });
      default: return json({ items: [] });
    }
  }) as typeof fetch);
  await withServer(c, async mc => {
    const courses = resultJSON(await mc.callTool({ name: 'moodle_courses', arguments: { limit: 1, offset: 1 } }));
    assert.deepEqual(courses.data, [{ id: 2 }]); assert.equal(courses.scope.nextOffset, 2); assert.equal(courses.scope.partial, true);
    assert.equal(requests.at(-1)?.get('userid'), '17');
    await mc.callTool({ name: 'moodle_grades', arguments: { courseid: 12 } });
    assert.equal(requests.at(-1)?.get('userid'), '17'); assert.equal(requests.at(-1)?.get('courseid'), '12');
    const discussions = resultJSON(await mc.callTool({ name: 'moodle_discussions', arguments: { forumid: 22, page: 2, limit: 1 } }));
    assert.equal(discussions.scope.nextPage, 3); assert.equal(requests.at(-1)?.get('perpage'), '1');
    const assignments = resultJSON(await mc.callTool({ name: 'moodle_assignments', arguments: { courseid: 12 } }));
    assert.equal(assignments.scope.partial, true); assert.equal(requests.at(-1)?.get('courseids[0]'), '12');
    await mc.callTool({ name: 'moodle_calendar', arguments: { from: 1000, days: 7 } });
    assert.equal(requests.at(-1)?.get('events[courseids][0]'), '1'); assert.equal(requests.at(-1)?.get('options[timestart]'), '1000'); assert.equal(requests.at(-1)?.get('options[timeend]'), String(1000 + 7 * 86400));
    const invalid = await mc.callTool({ name: 'moodle_discussions', arguments: { forumid: 22, limit: 500 } });
    assert.equal(invalid.isError, true);
  });
});

test('REST and source links preserve arbitrary deployment subdirectories', async () => {
  const base = 'https://learning.example.org/moodle';
  const c = new MoodleClient(base, token, (async (url, init) => {
    assert.equal(String(url), `${base}/webservice/rest/server.php`);
    const fn = (init?.body as URLSearchParams).get('wsfunction');
    return json(fn === 'core_webservice_get_site_info' ? { ...info, siteurl: base } : [{ id: 41 }]);
  }) as typeof fetch);
  await withServer(c, async mc => {
    const result = resultJSON(await mc.callTool({ name: 'moodle_contents', arguments: { courseid: 41 } }));
    assert.equal(result.source, `${base}/course/view.php?id=41`);
    assert.deepEqual(result.data, [{ id: 41 }]);
  });
});
test('mobile launch and callback bind to the complete deployment base, not just its host', () => {
  const base = 'https://learning.example.org/campus/moodle';
  const launch = mobileLaunch(base);
  assert.equal(new URL(launch.url).pathname, '/campus/moodle/admin/tool/mobile/launch.php');
  const payload = createHash('md5').update(base + launch.passport).digest('hex') + ':::' + token;
  const callback = `moodlemobile://token=${Buffer.from(payload).toString('base64')}`;
  assert.equal(mobileCallback(callback, base, launch.passport), token);
  assert.throws(() => mobileCallback(callback, 'https://learning.example.org', launch.passport));
  assert.throws(() => mobileCallback(callback, 'https://learning.example.org/other', launch.passport));
});
