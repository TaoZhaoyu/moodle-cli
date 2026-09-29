import { fileURLToPath } from 'node:url';
import { stateHome } from './config.js';
export function managedRoot(): string | undefined { return undefined; }
export function mcpConfig() {
  return { mcpServers: { moodle: { command: process.execPath, args: [fileURLToPath(new URL('./cli.js', import.meta.url)), 'mcp'], env: {
    LMS_HOME: stateHome(),
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...(process.env.LMS_AUTH_APP ? { LMS_AUTH_APP: process.env.LMS_AUTH_APP } : {}),
  } } } };
}
