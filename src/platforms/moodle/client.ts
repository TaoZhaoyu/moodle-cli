import { LmsError } from '../../errors.js';
import { normalizeMoodleUrl } from '../../moodle-url.js';

export const READ_FUNCTIONS = new Set([
  'core_webservice_get_site_info', 'core_enrol_get_users_courses', 'core_course_get_contents',
  'mod_assign_get_assignments', 'mod_assign_get_submission_status', 'gradereport_user_get_grade_items',
  'core_calendar_get_calendar_events', 'mod_forum_get_forums_by_courses',
  'mod_forum_get_forum_discussions', 'mod_forum_get_discussion_posts',
]);
const MAX_BYTES = 8 * 1024 * 1024;
export type SiteInfo = { userid: number; siteurl: string; functions: { name: string }[]; fullname?: string; sitename?: string; release?: string };

function formValue(form: URLSearchParams, key: string, value: unknown) {
  if (Array.isArray(value)) value.forEach((v, i) => formValue(form, `${key}[${i}]`, v));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => formValue(form, `${key}[${k}]`, v));
  else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') form.set(key, String(typeof value === 'boolean' ? Number(value) : value));
  else throw new LmsError('BAD_INPUT', 'Invalid Moodle request parameters.');
}

/** Fixed-origin REST reads. POST is Moodle's transport; the function allowlist enforces read-only behavior. */
export class MoodleClient {
  private info?: Promise<SiteInfo>;
  constructor(readonly origin: string, private token: string, private fetcher: typeof fetch = fetch) {
    try { if (normalizeMoodleUrl(origin) !== origin) throw new Error(); }
    catch { throw new LmsError('BAD_INPUT', 'Moodle requires a normalized HTTPS installation URL.'); }
    if (!/^[a-f0-9]{32}$/i.test(token)) throw new LmsError('AUTH_REQUIRED', 'A Moodle web-service token is required.');
  }
  async request(fn: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!READ_FUNCTIONS.has(fn)) throw new LmsError('TOOL_NOT_ALLOWED', 'Moodle function is not on the reviewed read allowlist.');
    if (Object.keys(params).some(k => ['wstoken', 'wsfunction', 'moodlewsrestformat'].includes(k))) throw new LmsError('BAD_INPUT', 'Reserved Moodle request parameter.');
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) formValue(form, key, value);
    form.set('wstoken', this.token); form.set('wsfunction', fn); form.set('moodlewsrestformat', 'json');
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}/webservice/rest/server.php`, {
        method: 'POST', body: form, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(12_000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'moodle-cli/0.1' },
      });
    } catch { throw new LmsError('MOODLE_NETWORK', 'Moodle could not be reached without a redirect; check connectivity and the configured origin.'); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401) throw new LmsError('AUTH_REQUIRED', 'Moodle authorization was rejected.');
      if (response.status === 403) throw new LmsError('FORBIDDEN', 'Moodle denied this request.');
      throw new LmsError('MOODLE_HTTP', 'Moodle returned an unsuccessful HTTP response.');
    }
    if (!response.body || !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => {});
      throw new LmsError('MOODLE_RESPONSE', 'Expected Moodle JSON, received another response (possibly a login page).');
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body.cancel(); throw new LmsError('RESPONSE_TOO_LARGE', 'Moodle response exceeded the 8 MiB limit. Narrow the query.');
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0; let data: any;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new LmsError('RESPONSE_TOO_LARGE', 'Moodle response exceeded the 8 MiB limit. Narrow the query.'); chunks.push(value); }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) { if (e instanceof LmsError) throw e; throw new LmsError('MOODLE_RESPONSE', 'Moodle returned an incomplete or invalid JSON response.'); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (data === null || typeof data !== 'object') throw new LmsError('MOODLE_RESPONSE', 'Moodle returned an unexpected JSON value.');
    if (data.exception || data.errorcode) {
      const code = data.errorcode;
      if (['invalidtoken', 'accessexception', 'webserviceaccessexception'].includes(code)) throw new LmsError('AUTH_REQUIRED', 'Moodle token is invalid, expired or not permitted for this service.');
      if (['nopermissions', 'requireloginerror', 'required_capability_exception'].includes(code)) throw new LmsError('FORBIDDEN', 'Moodle denied access to this resource.');
      throw new LmsError('MOODLE_API', 'Moodle could not perform the read. Check function availability and resource IDs.');
    }
    // Never forward a server-reflected token, even inside an error/warning/string URL.
    return JSON.parse(JSON.stringify(data).split(this.token).join('[REDACTED]'));
  }
  async siteInfo(): Promise<SiteInfo> {
    this.info ??= this.request('core_webservice_get_site_info').then(data => {
      if (!Number.isSafeInteger(data.userid) || data.userid <= 0 || typeof data.siteurl !== 'string' || data.siteurl.replace(/\/$/, '') !== this.origin || !Array.isArray(data.functions) || data.functions.some((f: any) => typeof f?.name !== 'string')) throw new LmsError('AUTH_REQUIRED', 'Moodle identity did not match the configured site.');
      return data as SiteInfo;
    }).catch(error => { this.info = undefined; throw error; });
    return this.info;
  }
  async read(fn: string, params: Record<string, unknown> = {}) {
    if (!READ_FUNCTIONS.has(fn)) throw new LmsError('TOOL_NOT_ALLOWED', 'Moodle function is not on the reviewed read allowlist.');
    const info = await this.siteInfo();
    if (!info.functions.some(f => f.name === fn)) throw new LmsError('FUNCTION_UNAVAILABLE', `The Moodle service does not expose ${fn}.`, 'Ask the school about mobile/web-service permissions. No empty result was substituted.');
    return this.request(fn, params);
  }
}
