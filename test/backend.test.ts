import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Backend, type Connect } from '../src/backend.js';
import { hsuhk, ProfileSchema } from '../src/config.js';
const p = ProfileSchema.parse(hsuhk);
const tools: Tool[] = [
  { name: 'moodle_courses', inputSchema: { type: 'object', properties: {} } },
  { name: 'moodle_discussions', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
];
const data = { content: [{ type: 'text' as const, text: '[{"id":1}]' }] };
test('schema validation catches limits and unknown parameters before sending a request', async () => {
  let calls = 0;
  const b = new Backend(async () => ({ tools, call: async () => { calls++; return data; }, close: async () => {} }), async () => 'g1');
  assert.equal((await b.call(p, 'moodle_discussions', { limit: 101 })).error?.code, 'BAD_INPUT');
  assert.equal((await b.call(p, 'moodle_discussions', { bad: true })).error?.code, 'BAD_INPUT');
  assert.equal(calls, 0); assert.equal((await b.call(p, 'moodle_discussions', { limit: 100 })).ok, true); await b.close();
});
test('memory cache and fresh bypass; credential changes invalidate cache and reconnect', async () => {
  let connects = 0; let calls = 0; let closes = 0; let generation: string | null = 'g1';
  const b = new Backend(async () => { connects++; return { tools, call: async () => { calls++; return data; }, close: async () => { closes++; } }; }, async () => generation);
  await b.call(p, 'moodle_courses'); assert.equal((await b.call(p, 'moodle_courses')).cached, true); assert.equal(calls, 1);
  await b.call(p, 'moodle_courses', {}, { fresh: true }); assert.equal(calls, 2);
  generation = 'g2'; assert.equal((await b.call(p, 'moodle_courses')).cached, false); assert.equal(connects, 2); assert.equal(closes, 1);
  generation = null; assert.equal((await b.call(p, 'moodle_courses')).error?.code, 'AUTH_REQUIRED'); assert.equal(calls, 3); await b.close();
});
test('parallel requests deduplicate startup and identical work', async () => {
  let connects = 0; let calls = 0;
  const b = new Backend(async () => { connects++; await new Promise(r => setTimeout(r, 15)); return { tools, call: async () => { calls++; await new Promise(r => setTimeout(r, 15)); return data; }, close: async () => {} }; }, async () => 'g');
  const results = await Promise.all(Array.from({ length: 8 }, () => b.call(p, 'moodle_courses')));
  assert(results.every(r => r.ok)); assert.equal(connects, 1); assert.equal(calls, 1); await b.close();
});
test('batch keeps partial failures explicit and never falls back to empty/stale success', async () => {
  const b = new Backend(async (_p, platform) => ({ tools, call: async (name) => name === 'moodle_discussions' ? { isError: true, content: [{ type: 'text', text: 'SESSION_EXPIRED cookie=NEVER-PRINT' }] } : data, close: async () => {} }), async () => 'g');
  const result = await b.batch(p, [{ tool: 'moodle_courses' }, { tool: 'moodle_discussions' }, { tool: 'moodle_submit_assignment' }]);
  assert.equal(result.partial, true); assert.equal(result.ok, false); assert.equal(result.results[0]!.ok, true); assert.equal(result.results[1]!.error?.code, 'AUTH_REQUIRED'); assert.equal(result.results[2]!.error?.code, 'TOOL_NOT_ALLOWED');
  assert(!JSON.stringify(result).includes('NEVER-PRINT')); await b.close();
});
test('failed startup is retryable and batch respects its size bound', async () => {
  let n = 0; const connect: Connect = async () => { if (!n++) throw new Error('startup'); return { tools, call: async () => data, close: async () => {} }; };
  const b = new Backend(connect, async () => 'g'); assert.equal((await b.call(p, 'moodle_courses')).ok, false); assert.equal((await b.call(p, 'moodle_courses')).ok, true);
  await assert.rejects(b.batch(p, Array.from({ length: 9 }, () => ({ tool: 'moodle_courses' })))); await b.close();
});
test('connections and cached results are isolated by school/account and origin', async () => {
  let connects = 0;
  const b = new Backend(async school => { connects++; return { tools, call: async () => ({ content: [{ type: 'text', text: school.moodle! }] }), close: async () => {} }; }, async () => 'same-generation');
  const second = ProfileSchema.parse({ id: 'second', label: 'Second', timezone: 'Europe/London', moodle: 'https://other.instructure.com' });
  const first = await b.call(p, 'moodle_courses');
  const other = await b.call(second, 'moodle_courses');
  assert.equal(first.origin, p.moodle); assert.equal(other.origin, second.moodle); assert.equal(other.cached, false);
  assert.equal(other.timezone, 'Europe/London'); assert.equal(connects, 2);
  assert.equal((await b.call(p, 'moodle_courses')).cached, true);
  const moved = await b.call({ ...second, moodle: 'https://moved.school.edu' }, 'moodle_courses');
  assert.equal(connects, 3); assert.equal((moved.data!.content[0] as { text: string }).text, 'https://moved.school.edu');
  await b.close();
});
