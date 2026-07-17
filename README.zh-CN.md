# Fulltext RSS Reader

[English](README.md)

一个可部署的单用户 RSS/Atom 全文阅读器，提供全文提取、受保护的远程内容抓取，以及可版本化的外观与主题设置。常规 Docker Compose 配置包含独立刷新 Worker；公开在线演示则有意使用不含 Worker、带配额限制的精简运行形态。

[在线演示](https://rss-demo.713007.xyz/) | [自托管部署指南](docs/self-hosted.zh-CN.md) | [架构说明](docs/architecture.md) | [安全策略](SECURITY.md)

![CI](https://github.com/DTSFO/fulltext-rss-reader/actions/workflows/ci.yml/badge.svg)

![在线演示中的阅读器](docs/assets/demo-reader.png)

以下截图来自可定期重置的公开在线演示，分别展示登录后的阅读器、新增 RSS/Atom 订阅，以及外观与主题设置。

| 新增订阅 | 外观与主题 |
| --- | --- |
| ![新增 RSS 或 Atom 订阅](docs/assets/demo-add-feed.png) | ![外观与主题设置](docs/assets/demo-appearance.png) |

## 核心能力

- 基于 Next.js 16 与 React 19 的桌面端、移动端响应式阅读体验
- 使用 Drizzle ORM 与 PostgreSQL 持久化订阅、文章和阅读状态
- RSS/Atom 规范化与基于 Readability 的原网页全文提取
- 常规部署配置中的独立刷新 Worker、受限批处理与可恢复的错误状态
- Argon2 单用户认证与签名会话
- 对 URL、重定向、地址范围、内容类型和响应体大小进行安全限制
- 支持主题编辑、预览、导入/导出、租约与安全恢复
- 使用 Vitest、Testing Library、Playwright 和集成测试覆盖关键流程

## 部署形态

| 形态 | 运行组件 | 适用场景 |
| --- | --- | --- |
| 常规自托管栈 | `web`、`worker`、`migrate`、PostgreSQL | 带定时后台刷新的私有单用户阅读器 |
| 在线演示栈 | `web-demo`、`migrate-demo`、`seed-demo`、隔离 PostgreSQL；不含 Worker | 带手动刷新、配额、冷却时间和确定性重置数据的共享功能演示 |

以上是仓库支持的部署形态，并不表示所有运行中的实例都采用相同拓扑。反向代理或隧道、DNS、监控和定时重置均由部署方在仓库之外配置。

## 在线演示

当前公开实例运行带认证的在线演示栈，使用独立、可丢弃的 PostgreSQL 数据库，并且不启动后台刷新 Worker。使用 `demo-user` / `demo-reader` 登录后，可以新增 RSS 订阅，并体验主题创建、编辑、预览、导入和导出。

为避免共享实例被滥用，演示环境限制为最多 5 个订阅、3 个自定义主题、每个订阅保留 50 篇文章；同一共享账号每分钟最多尝试新增 1 个订阅，每个订阅每 10 分钟最多手动刷新 1 次。当前部署实例通过应用栈之外的定时任务每 6 小时恢复一次虚构示例数据。

这是共享公开账号，请勿添加私有、需要认证或包含访问凭据的订阅地址。该环境仅用于功能体验，不连接生产数据库或生产控制面。

## 部署

- 如需部署带 PostgreSQL、数据库迁移、Web、刷新 Worker、HTTPS、备份恢复和升级说明的私有生产实例，请阅读[常规自托管部署指南](docs/self-hosted.zh-CN.md)。
- 如需运行带配额、确定性示例数据且不启动后台 Worker 的可丢弃共享实例，请阅读[在线演示部署指南](docs/hosted-demo.zh-CN.md)。

生产 Compose 栈使用 `.env.production.example`；`.env.example` 只用于本地开发。两种栈默认都只把应用绑定到主机回环端口，公开 HTTPS 入口仍由部署方配置。

## 本地开发

需要 Node.js 22、pnpm 11、Docker 与 Docker Compose。

```bash
cp .env.example .env
pnpm install
read -r -s -p "Reader password: " RSS_PASSWORD; printf '\n'
printf '%s' "$RSS_PASSWORD" | pnpm hash-password
unset RSS_PASSWORD
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

启动前，请用生成的 Argon2 哈希替换 `.env` 中故意设置的无效占位值。

如需在 Linux 主机上运行隔离的认证演示，可使用 `docker-compose.demo.yml`，并按照[在线演示部署说明](docs/hosted-demo.zh-CN.md)执行确定性的重置与初始化流程。该栈只绑定回环端口，使用独立 PostgreSQL 数据卷，并且不启动后台刷新 Worker。HTTPS 发布与定时重置需要由部署方另行配置。

## 质量检查

```bash
pnpm safety
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

仓库还包含依赖 Docker 的集成测试和服务端渲染 Playwright 测试，需要本机 Docker 守护进程：

```bash
pnpm test:integration
pnpm test:e2e
```

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `src/app` | 页面与类型化路由处理器 |
| `src/features` | 阅读器、订阅、文章、认证、分类和外观模块 |
| `src/jobs` | 后台订阅刷新 Worker |
| `src/lib/http` | 受保护的外部 HTTP 访问 |
| `src/db` 与 `drizzle` | 数据库结构、迁移和访问层 |
| `tests` | 浏览器测试与集成场景 |
| `.env.production.example` 与 `docker-compose.yml` | 常规自托管生产栈 |
| `docs/self-hosted.zh-CN.md` | 中文生产部署与运维指南 |
| `docker-compose.demo.yml` 与 `docs/hosted-demo.zh-CN.md` | 隔离认证演示栈及中文指南 |
| `scripts/demo-stack.sh` 与 `scripts/demo-seed.sql` | 演示环境生命周期与确定性数据重置 |

## 安全与数据边界

仓库及其示例不包含个人订阅、生产数据库、部署凭据、Agent 会话文件或私有基础设施配置。部署者自行提供环境变量、数据库、订阅地址和 HTTPS 入口；在线演示仅使用可丢弃的虚构数据和受限配额。

## 许可证

MIT
