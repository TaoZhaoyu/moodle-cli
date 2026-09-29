import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { addProfile, getProfile, initProfile, loadConfig, hsuhk, ProfileSchema, Origin, useProfile } from '../src/config.js';
import { isFreshAuthorization } from '../src/auth/launch.js';
import { Vault, type KeyProvider } from '../src/vault.js';
import { cookieHeader, allowedNavigation } from '../src/auth/cookies.js';
import { isAllowed, platformFor } from '../src/policy.js';
import { publicError, LmsError } from '../src/errors.js';
import { exportCalendar, listItems, upsertItems } from '../src/items.js';
import { codexArguments } from '../src/ask.js';

const home = await mkdtemp(join(tmpdir(), 'lms-unit-')); process.env.LMS_HOME = home;
after(() => rm(home, { recursive: true, force: true }));
class MemoryKey implements KeyProvider { key: Buffer | null = null; async get() { return this.key; } async set(k: Buffer) { this.key = k; } }
const key = new MemoryKey(); const vault = new Vault(key);
const p = ProfileSchema.parse(hsuhk);
test('Moodle URLs reject userinfo, insecure URLs, login pages and token query strings', () => {
  for (const bad of ['http://school.edu', 'https://me:secret@school.edu', 'https://school.edu/login', 'https://school.edu?token=abc', 'file:///etc/passwd']) assert.equal(Origin.safeParse(bad).success, false);
  assert.equal(Origin.parse('https://school.edu/'), 'https://school.edu');
});
test('profile config isolates schools and refuses accidental replacement', async () => {
  await addProfile(p); await addProfile({ id: 'second', label: 'Another', timezone: 'Europe/London', moodle: 'https://other.instructure.com' });
  await assert.rejects(addProfile(p), (e: LmsError) => e.code === 'PROFILE_EXISTS');
  await useProfile('second'); assert.equal((await getProfile()).id, 'second'); assert.equal((await getProfile('hsuhk')).moodle, hsuhk.moodle);
  assert.equal((await loadConfig()).profiles.length, 2);
  assert.equal(ProfileSchema.safeParse({ ...p, timezone: 'Mars/Test' }).success, false);
  assert.equal(ProfileSchema.safeParse({ ...p, id: '../escape' }).success, false);
});
test('vault encrypts secrets and authenticates school, slot and generation', async () => {
  const generation = await vault.write(p, 'moodle', { secret: 'SYNTHETIC-COOKIE-ONLY' });
  const loaded = await vault.read<{ secret: string }>(p, 'moodle'); assert.equal(loaded?.value.secret, 'SYNTHETIC-COOKIE-ONLY'); assert.equal(loaded?.generation, generation);
  const files = (await readdir(home)).filter(f => f.endsWith('.vault'));
  for (const file of files) assert.equal((await readFile(join(home, file), 'utf8')).includes('SYNTHETIC'), false);
  assert.equal(await vault.read({ ...p, id: 'other-account' }, 'moodle'), null);
  assert.equal(await vault.read({ ...p, moodle: 'https://different.example.edu' }, 'moodle'), null);
  const file = join(home, files[0]!); const envelope = JSON.parse(await readFile(file, 'utf8')); envelope.generation = 'tampered'; await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(vault.read(p, 'moodle'), (e: LmsError) => e.code === 'VAULT_INVALID');
});


test('old workers cannot replace new login or restore logged-out credentials', async () => {
  const first = await vault.write(p, 'moodle', { n: 1 }); const second = await vault.write(p, 'moodle', { n: 2 });
  assert.notEqual(first, second); assert.equal(await vault.write(p, 'moodle', { n: 99 }, first!), null);
  assert.equal((await vault.read<{ n: number }>(p, 'moodle'))?.value.n, 2);
  await vault.remove(p, 'moodle'); assert.equal(await vault.write(p, 'moodle', { n: 99 }, second!), null);
});
test('keychain failure has no plaintext or key-file fallback', async () => {
  const unavailable = new Vault({ get: async () => { throw new Error('sensitive native detail'); }, set: async () => {} });
  await assert.rejects(unavailable.write(p, 'moodle', { private: true }), (e: LmsError) => e.code === 'KEYCHAIN_UNAVAILABLE');
  assert.equal(await vault.generation(p, 'moodle'), null);
});


test('unknown error details never reach the client', () => {
  assert.equal(JSON.stringify(publicError(new Error('cookie=super-secret'))).includes('super-secret'), false);
});
test('tasks preserve completion and history across due-date corrections', async () => {
  const item = { id: 'moodle:3805:10486:homework1', title: 'Homework 1', kind: 'assignment', due: '2026-10-02T18:00:00+08:00', status: 'done', notes: 'my note', sources: [{ url: 'https://moodle.hsuhk.edu.hk/courses/3805/discussion_topics/10486', quote: 'Due 2 October at 18:00' }] };
  await upsertItems(p, [item], vault);
  await upsertItems(p, [{ ...item, due: '2026-10-03T18:00:00+08:00', status: undefined, notes: undefined }], vault);
  const items = await listItems(p, vault); assert.equal(items.length, 1); assert.equal(items[0]!.status, 'done'); assert.equal(items[0]!.notes, 'my note'); assert.equal(items[0]!.history[0]!.due, item.due);
  await assert.rejects(upsertItems(p, [{ ...item, due: 'next Friday' }], vault));
  await assert.rejects(upsertItems(p, [{ ...item, sources: [] }], vault));
});
test('concurrent local upserts do not drop another task', async () => {
  const base = { title: 'Check', kind: 'other', sources: [{ url: 'https://school.edu/notice', quote: 'Check your work' }] };
  await Promise.all([upsertItems(p, [{ ...base, id: 'a' }], vault), upsertItems(p, [{ ...base, id: 'b' }], vault)]);
  const items = await listItems(p, vault); assert(items.some(i => i.id === 'a')); assert(items.some(i => i.id === 'b'));
});
test('ICS preserves instants, stable UIDs and excludes ambiguous tasks', async () => {
  const items = await listItems(p, vault); const exported = exportCalendar(p, items);
  assert(exported.ics.includes('DTSTART:20261003T100000Z')); assert.equal(exported.excluded.length, 2);
  const uid = exported.ics.match(/UID:([^\r\n]+)/)![1];
  const changed = structuredClone(items); changed[0]!.due = '2026-10-04T18:00:00+08:00';
  assert.equal(exportCalendar(p, changed).ics.match(/UID:([^\r\n]+)/)![1], uid);
  changed[0]!.needsConfirmation = true; assert.equal(exportCalendar(p, changed).excluded.length, 3);
});
test('ask uses isolated Codex invocation with no shell, credentials or approval bypass', () => {
  const args = codexArguments(p, '/tmp/example', '/tmp/example/answer.txt');
  assert(args.includes('--ignore-user-config')); assert(args.includes('read-only')); assert(args.includes('shell_tool'));
  assert(!args.join(' ').includes('dangerously')); assert(!args.join(' ').includes('CANVAS_COOKIE'));
});

test('custom Moodle base URLs normalize trailing slashes and do not require a school preset', () => {
  const base = 'https://learning.example.org/campus/moodle';
  assert.equal(Origin.parse(`${base}/`), base);
  const profile = ProfileSchema.parse({ id: 'custom', label: 'Custom Moodle', timezone: 'Europe/Berlin', moodle: base });
  assert.equal(profile.moodle, base);
  for (const bad of [`${base}/login/index.php`, `${base}/course/view.php?id=12`, `${base}#fragment`]) assert.equal(Origin.safeParse(bad).success, false);
});
test('two Moodle deployments on the same host have isolated encrypted state', async () => {
  const first = { ...p, id: 'same-account', moodle: 'https://learning.example.org/site-a' };
  const second = { ...first, moodle: 'https://learning.example.org/site-b' };
  await vault.write(first, 'moodle', { kind: 'token', value: 'synthetic-a' });
  assert.equal(await vault.read(second, 'moodle'), null);
  await vault.write(second, 'moodle', { kind: 'token', value: 'synthetic-b' });
  assert.equal((await vault.read<{ value: string }>(first, 'moodle'))?.value.value, 'synthetic-a');
});
