import { VERSION } from './version.js';
export type UpdateInfo = { status: 'disabled' | 'available'; current: string; checkedAt: string; releaseUrl?: string; message: string };
/** Never download or switch back to an upstream Canvas/Blackboard release. */
export async function checkForUpdates(_options: { automatic?: boolean } = {}): Promise<UpdateInfo> {
  return { status: 'disabled', current: VERSION, checkedAt: new Date().toISOString(), message: 'Moodle 本地开发版未配置发布源；请从此分支源码更新。不会安装原项目版本。' };
}
export const sessionUpdate = checkForUpdates;
