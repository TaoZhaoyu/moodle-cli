# Moodle CLI CLI

基于 [zs-andy/lms-cli](https://github.com/zs-andy/lms-cli) 的 **通用 Moodle 命令行与 MCP 学习助手**。连接你指定的 Moodle 站点，支持多学校、多账号、独立时区，以及根域名或子目录部署（例如 `https://learn.example.edu/moodle`）。

保留 CLI/MCP、隔离 worker、凭据加密、本地待办及 ICS 导出；仅支持 Moodle。HSUHK 是可选网址预设，不是默认学校或功能限制。

当前已验证构建与离线测试，**尚未用真实账号验证学校 SSO/MFA 或课程读取**。各站点必须启用相应 Web Services/移动端服务，并允许你的账号访问。通用接入能力不代表所有 Moodle 版本、登录方式或第三方插件均兼容。此分支为本地开发版，不是学校官方或已签名、公证的安装包。

## 本地运行

需要 Node.js >= 22.16、npm；建议 Node.js 24。macOS/Windows 需要可用的系统凭据库，Linux 需要 Secret Service；网页登录还需要图形桌面。

在本目录运行（本次交付目录已安装开发依赖并生成 dist）：

```sh
npm ci --ignore-scripts
npm run build
npm run auth:install
node bin/lms.js setup --manual --no-codex --no-login
node bin/lms.js auth login --platform moodle
node bin/lms.js check
node bin/lms.js moodle courses
```

`auth:install` 下载固定版本 Electron 授权运行时；不全局安装、不访问学校账号。首次 `auth login` 打开学校的 Moodle 移动端授权页，由你自行完成学校登录及 MFA。程序验证回调和站点身份后，加密保存 web-service token，丢弃可选 private token，不保存密码或学校 Cookie。不需要在聊天中提供任何凭据。

若学校未开放移动端授权，程序不会绕过学校限制。已获学校许可的 REST token 可以通过密码管理器的管道输入 `node bin/lms.js auth token --stdin`，不要把令牌放在命令参数、聊天、环境变量或源码中。普通网页登录成功不代表第三方 REST 权限可用。

也可以使用配置向导（会尝试接入本机 Codex）：

```sh
node bin/lms.js setup --manual
# 独立使用 CLI：
node bin/lms.js setup --manual --no-codex
# 仅保存配置：
node bin/lms.js setup --manual --no-login --no-codex
```

非交互方式指定站点（示例网址须替换）：

```sh
node bin/lms.js init --id my-school --label "My Moodle" --moodle https://learn.example.edu/moodle --timezone Europe/London
node bin/lms.js profiles add another-account --label "Another account" --moodle https://another.example.edu --timezone Asia/Singapore
node bin/lms.js --profile another-account moodle courses
```

每个账号使用独立 profile。新增账号不会自动切换已有默认账号；需要时用 `profiles use <id>` 切换。`schools search` 只搜索本地预设，不是全球 Moodle 学校目录。若要使用恒生大学预设，可选运行 `node bin/lms.js init --preset hsuhk`。

如果以后自行进行全局安装，命令名称是 `moodle-lms`，不会覆盖原来的 `lms`。

## 查询

```sh
node bin/lms.js moodle courses
node bin/lms.js moodle content --course 123
node bin/lms.js moodle assignments --course 123
node bin/lms.js moodle grades --course 123
node bin/lms.js moodle forums --course 123
node bin/lms.js moodle discussions --args '{"forumid":456,"page":0,"limit":20}'
node bin/lms.js moodle posts --args '{"discussionid":789}'
node bin/lms.js moodle submission --args '{"assignid":321}'
node bin/lms.js overview --days 7 --fresh
node bin/lms.js tools --name moodle_calendar
```

以上 ID 都是示例，必须替换为课程元数据中的真实 ID。课程 ID、课程模块 ID、作业实例 ID、论坛和讨论 ID 不能混用。

- `files` 与 `content` 都返回课程目录及文件元数据，**暂不下载或解析附件正文**。
- 公告通过课程的 news 类型论坛读取；概览只有课程和日历，必须进一步查相关课程的作业和公告。
- 日历明确传入课程 ID（最多 200 门，可用 `--course` 缩小）；包含个人/全站事件，暂不查询小组专属事件。结果明确标记范围缺口。
- 课程列表默认 100 条，最多 200 条/次，支持 `offset`；论坛讨论最多 50 条/页。服务端响应最多 8 MiB，单个 HTTP 请求超时 12 秒。不把超时、权限错误或服务未开放伪装成空列表。
- 仅允许 10 个审查过的 REST 读取函数。虽然 Moodle REST 使用 HTTP POST 传参数，不能调用提交作业、开始测验、发帖、发消息、标记已读或完成活动等写操作。
- 取得的 token 本身可能具备更广的学校权限；只读是此客户端强制的调用边界，不是学校签发的 token 权限缩减。

## MCP 与插件

```sh
node bin/lms.js mcp-config
node bin/lms.js connect codex
```

前者打印当前安装路径的 MCP 配置，后者注册独立的 `moodle-cli` 插件。需有兼容版本的 Codex CLI。源插件在 `plugins/moodle-cli/`；生成接入配置时使用当前 Node 和编译后 CLI 的绝对路径。此交付尚未向用户的 Codex 安装插件或验证登录后的模型查询。

本地数据默认为系统应用数据目录下的 `moodle-cli`，与原项目隔离。`LMS_HOME` 可覆盖位置，但不要指向旧 `lms-cli` 数据目录。`auth logout --platform moodle --yes` 只删除本地令牌，不撤销学校端 token，也不删除本地待办。

本地待办：`items list`、`items upsert --file ...`、`items export --out ...`；只有用户明确要求才保存。导出的 ICS 是未加密普通文件。

## 开发与验证

```sh
npm run typecheck
npm test
npm run pack:cli
```

见 [架构与接口](docs/ARCHITECTURE.md)、[验证范围](docs/VALIDATION.md)、[隐私](PRIVACY.md) 和 [安全边界](SECURITY.md)。此分支关闭上游自动更新，不执行原项目安装脚本；更新应来自 Moodle 分支源码。

MIT 许可，保留上游版权及出处。新增 Moodle 连接器是本地实现；Moodle 服务端没有被复制或捆绑。
