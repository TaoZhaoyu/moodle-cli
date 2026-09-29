import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { LmsError } from '../errors.js';
/** Moodle mobile launch protocol; no password scraping or browser-cookie import. */
export function mobileLaunch(origin: string) {
  const passport = randomBytes(32).toString('hex');
  const url = new URL(`${origin}/admin/tool/mobile/launch.php`);
  url.searchParams.set('service', 'moodle_mobile_app');
  url.searchParams.set('passport', passport);
  url.searchParams.set('urlscheme', 'moodlemobile');
  return { url: url.href, passport };
}
export function mobileCallback(url: string, origin: string, passport: string): string {
  const fail = () => new LmsError('AUTH_CALLBACK_INVALID', 'Moodle authorization callback did not match this login attempt.');
  if (!url.startsWith('moodlemobile://token=') || url.length > 4096) throw fail();
  let encoded: string;
  try { encoded = decodeURIComponent(url.slice('moodlemobile://token='.length)); } catch { throw fail(); }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail();
  const parts = Buffer.from(encoded, 'base64').toString('utf8').split(':::');
  const [siteid, token] = parts;
  const expected = createHash('md5').update(origin + passport).digest('hex'); // Protocol checksum, not password hashing.
  if (parts.length < 2 || parts.length > 3 || !siteid || !/^[a-f0-9]{32}$/.test(siteid) || !timingSafeEqual(Buffer.from(siteid), Buffer.from(expected)) || !token || !/^[a-f0-9]{32}$/i.test(token)) throw fail();
  // Optional private token enables browser auto-login: deliberately discard it.
  return token;
}
