import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const home = await mkdtemp(join(tmpdir(), 'moodle-integration-'));
after(() => rm(home, { recursive: true, force: true }));
const env = { ...process.env, LMS_HOME: home };
function cli(...args: string[]) { return JSON.parse(execFileSync(process.execPath, ['bin/lms.js', ...args], { env, encoding: 'utf8' })); }
test('built CLI sets up isolated HSUHK profile and discovers actual worker tools without credentials', async () => {
  const profile = cli('init', '--preset', 'hsuhk');
  assert.equal(profile.moodle, 'https://moodle.hsu.edu.hk'); assert.equal(profile.timezone, 'Asia/Hong_Kong');
  assert.deepEqual(cli('init', '--preset', 'hsuhk'), profile);
  const catalog = cli('tools'); assert.equal(catalog.length, 10); assert(catalog.every((t: any) => t.platform === 'moodle'));
  assert.equal(cli('update', '--check').status, 'disabled');
  assert.equal(cli('schools', 'search', '恒生')["matches"].length, 1);
  const help = execFileSync(process.execPath, ['bin/lms.js', '--help'], { env, encoding: 'utf8' });
  assert(help.includes('moodle')); assert(!help.includes('canvas <')); assert(!help.includes('blackboard <'));
});
test('built public MCP spawns Moodle worker and reports missing authorization without revealing bodies', async () => {
  const client = new Client({ name: 'integration', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('bin/lms.js'), 'mcp'], env: env as Record<string, string>, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = await client.listTools(); assert.equal(tools.tools.length, 17);
    const read = async (name: string, args = {}) => {
      const result: any = await client.callTool({ name, arguments: args }); return JSON.parse(result.content[0].text);
    };
    const profiles = await read('lms_profiles'); assert.equal(profiles.profiles[0].id, 'hsuhk'); assert.equal(profiles.update.status, 'disabled');
    const catalog = await read('lms_tools'); assert.equal(catalog.length, 10);
    const check = await read('lms_check'); assert.equal(check.ok, false); assert(check.checks.every((c: any) => c.error.code === 'AUTH_REQUIRED'));
    const schema = await read('lms_tools', { name: 'moodle_grades' } as any); assert(schema[0].inputSchema.properties.courseid);
  } finally { await client.close(); }
});

test('a fresh installation accepts arbitrary schools and accounts without choosing HSUHK', async () => {
  const fresh = await mkdtemp(join(tmpdir(), 'moodle-custom-'));
  const customEnv = { ...env, LMS_HOME: fresh };
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ['bin/lms.js', ...args], { env: customEnv, encoding: 'utf8' }));
  try {
    run('init', '--id', 'first', '--label', 'First Moodle', '--moodle', 'https://learn.example.org/moodle/', '--timezone', 'Europe/Berlin');
    run('profiles', 'add', 'second', '--label', 'Second Moodle', '--moodle', 'https://learn.example.org/another', '--timezone', 'Asia/Singapore');
    const config = run('profiles', 'list');
    assert.equal(config.active, 'first'); assert.equal(config.profiles.length, 2);
    assert.equal(config.profiles[0].moodle, 'https://learn.example.org/moodle');
    assert(!JSON.stringify(config).includes('hsuhk'));
    assert.equal(run('--profile', 'second', 'tools').length, 10);
  } finally { await rm(fresh, { recursive: true, force: true }); }
});
