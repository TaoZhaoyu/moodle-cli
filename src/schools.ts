import { presets, type Platform } from './config.js';
import { LmsError } from './errors.js';
export type SchoolMatch = { id: string; name: string; source: 'preset'; platforms: Partial<Record<Platform, string>>; timezone?: string };
export type SchoolSearchOptions = { platform?: Platform; offline?: boolean };
export async function searchSchools(input: string, options: SchoolSearchOptions = {}) {
  const query = input.normalize('NFKC').trim();
  if (query.length < 2 || query.length > 120 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(query)) throw new LmsError('BAD_INPUT', '请输入 2–120 个字符的学校名称或域名。');
  if (options.platform && options.platform !== 'moodle') throw new LmsError('BAD_INPUT', '此版本只支持 Moodle。');
  const needle = query.toLowerCase();
  const matches: SchoolMatch[] = presets.filter(p => [p.name, p.profile.label, p.profile.moodle, ...p.aliases].some(s => s.toLowerCase().includes(needle)))
    .map(p => ({ id: `preset:${p.name}`, name: p.profile.label, source: 'preset', platforms: { moodle: p.profile.moodle }, timezone: p.profile.timezone }));
  return { ok: true as const, query, matches, partial: true, sources: [{ source: 'preset', status: 'ok', message: '仅搜索随软件分发的 Moodle 预设。' }], note: '不是全球学校目录。其他学校可手动输入 HTTPS 安装网址；预设不代表学校认证或账号已连通。' };
}
