/** A deployment base URL, not a login/course page. Preserve subdirectory installs. */
export function normalizeMoodleUrl(input: string): string {
  if (/[\\\s]/.test(input)) throw new Error('Invalid Moodle URL');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS Moodle base URL without credentials, query or fragment');
  const path = url.pathname.replace(/\/+$/, '');
  if (/\.(?:php|html?)$/i.test(path) || /\/(?:login|course|my|admin|webservice)(?:\/|$)/i.test(path) || /%(?:2f|5c|2e)/i.test(path)) throw new Error('Use the Moodle installation URL, not a login, course or API URL');
  return url.origin + path;
}
