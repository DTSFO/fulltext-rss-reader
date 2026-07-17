# 在线演示部署形态

[English](hosted-demo.md)

本文说明仓库内可移植、带认证的在线演示形态。它使用真实 Next.js 阅读器和虚构示例数据，但与常规自托管栈严格隔离：使用独立数据库、共享账号配额、确定性重置，并且不启动后台刷新 Worker。

Compose 只定义应用容器和回环监听端口，不会安装 DNS、HTTPS 反向代理或隧道、监控和重置调度器。

## 1. 前置条件与边界

- 维护中的 Linux 主机、Docker Engine 与 Docker Compose v2。
- Git 和仅用于当前演示的稳定检出目录。
- 用于生成共享密码哈希的 Node.js 22 与 pnpm 11。
- OpenSSL 或其他安全随机值生成工具。
- 独立域名、DNS，以及 HTTPS 反向代理或托管隧道。

PostgreSQL 不向主机发布端口。演示使用独立 Compose 项目、桥接网络、镜像标签和命名数据卷。用户手动触发的订阅操作仍通过受保护抓取路径，但不会自动计划后台刷新。

禁止向该栈或初始化 SQL 添加生产订阅、账号、凭据、导出文件或私有 URL。

## 2. 配置

```bash
cp .env.demo.example .env.demo
pnpm install --frozen-lockfile
openssl rand -hex 32
openssl rand -hex 32
```

将两次不同的随机输出分别用于 `DEMO_POSTGRES_PASSWORD` 与 `DEMO_SESSION_SECRET`，并保持数据库密码 URL 安全。

当 `DEMO_MODE=true` 时，登录页会显示固定共享密码 `demo-reader`。为该准确密码生成哈希，且不要把密码放入命令参数：

```bash
printf '%s' 'demo-reader' | pnpm hash-password
```

编辑 `.env.demo`：

- 将 `DEMO_APP_URL` 设置为准确的公开 HTTPS Origin，不能带路径。
- 将 URL 安全的数据库密钥写入 `DEMO_POSTGRES_PASSWORD`。
- 将独立会话密钥写入 `DEMO_SESSION_SECRET`。
- 将 Argon2 输出写入 `DEMO_PASSWORD_HASH`，并保持单引号包裹，避免 `$` 被 Compose 展开。
- 除非同时更新公开登录说明和初始化数据预期，否则保持 `DEMO_USERNAME=demo-user`。
- 只有 HTTPS 入口使用其他回环端口时才修改 `DEMO_APP_PORT`。

禁止提交 `.env.demo`。保护并验证配置：

```bash
chmod 600 .env.demo
docker compose --project-name fulltext-rss-reader-demo --env-file .env.demo --file docker-compose.demo.yml config --quiet
```

示例限制为 5 个订阅、3 个自定义主题、每个订阅保留 50 篇文章、账号级新增订阅冷却 1 分钟、每个订阅手动刷新冷却 10 分钟。新增订阅冷却会在外部抓取前原子保留，删除订阅后仍然存在，抓取失败也会消耗本次尝试。只有评估主机容量和边缘请求限制后才应提高配额。

## 3. 启动与验证

```bash
./scripts/demo-stack.sh up
./scripts/demo-stack.sh status
curl --fail --silent --show-error http://127.0.0.1:18121/api/health
```

首次创建时，栈会构建应用、等待 PostgreSQL、运行迁移、载入确定性示例数据并等待 Web 健康检查。`/api/health` 只是应用存活响应；排查数据库问题时应单独检查 PostgreSQL。

发布 HTTPS 后还应执行：

```bash
curl --fail --silent --show-error https://rss-demo.example.com/api/health
```

随后使用 `demo-user` / `demo-reader` 登录，新增一个公开订阅，确认订阅和主题配额，并验证主题写操作。不要输入私有或包含凭据的 URL。

## 4. 数据生命周期与操作

演示数据库按设计可以随时销毁。初始化任务会执行 `TRUNCATE TABLE users CASCADE`，删除共享账号拥有的订阅、文章、阅读状态、分类和外观数据。

```bash
./scripts/demo-stack.sh logs
./scripts/demo-stack.sh reseed
./scripts/demo-stack.sh reset
./scripts/demo-stack.sh down
./scripts/demo-stack.sh destroy
```

- `reseed` 会主动删除共享账号状态并恢复示例数据，但不删除 PostgreSQL 数据卷。
- `reset` 会主动删除整个演示数据卷，然后迁移、初始化并启动干净栈。
- `destroy` 会停止栈并永久删除可丢弃数据库卷。
- `up` 会在需要时创建迁移与初始化任务；凡是会重建这些任务的更新，都应视为可能清除共享账号改动。

只在独立演示检出目录中运行这些命令。脚本默认固定 Compose 项目名为 `fulltext-rss-reader-demo`，避免误操作常规栈。

## 5. 日志与排障

`./scripts/demo-stack.sh logs` 只跟踪 `web-demo`。检查全部启动阶段：

```bash
docker compose --project-name fulltext-rss-reader-demo --env-file .env.demo --file docker-compose.demo.yml ps -a
docker compose --project-name fulltext-rss-reader-demo --env-file .env.demo --file docker-compose.demo.yml logs --tail=200 postgres-demo migrate-demo seed-demo web-demo
```

常见排查方向：

| 现象 | 检查项 |
| --- | --- |
| Compose 拒绝配置 | 替换 `.env.demo` 中所有占位值，并保持 Argon2 哈希由单引号包裹。 |
| `migrate-demo` 失败 | 同时查看迁移和 PostgreSQL 日志；Web 会按设计等待迁移与初始化成功。 |
| `seed-demo` 失败 | 确认迁移成功，且当前检出的初始化 SQL 与应用结构一致。 |
| 本地健康检查成功但公网打不开 | 检查 DNS、TLS、代理或隧道路由、防火墙和 `DEMO_APP_PORT`。 |
| 外观写操作返回 403 | 让 `DEMO_APP_URL` 与浏览器公开 Origin 完全一致。 |
| 请求返回 409 或 429 | 共享账号触发配额或冷却，检查 `DEMO_MAX_*` 与 `DEMO_*_COOLDOWN_*`。 |
| 订阅不会自动刷新 | 这是预期行为：演示栈没有 Worker，只能在冷却限制内手动刷新。 |
| 修改密码后数据库认证失败 | 只改 `.env.demo` 不会更新已有数据卷中的角色密码；演示数据可丢弃，应将新密钥与 `reset` 配套执行。 |

## 6. 通过 HTTPS 发布

保持应用只绑定回环地址。最小 Caddy 示例：

```caddyfile
rss-demo.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18121
}
```

也可以使用 Nginx 或托管隧道。应保留原始 Host 与转发协议头，不得暴露 PostgreSQL，并在边缘为公开共享账号设置请求频率、请求体和连接数限制。及时更新 Docker 主机和 HTTPS 边缘组件。

## 7. 定时重置

仓库不会安装调度器。以下 root crontab 示例通过 `flock` 避免重叠任务，并每 6 小时重置一次：

```cron
17 */6 * * * flock -n /run/lock/fulltext-rss-reader-demo-reset.lock sh -c 'cd /srv/fulltext-rss-reader && ./scripts/demo-stack.sh reset' >> /var/log/fulltext-rss-reader-demo-reset.log 2>&1
```

替换真实检出路径，选择低峰分钟，并配置日志轮转。重置会造成短暂中断并永久删除共享账号改动。只有需要保留数据库卷时才使用 `reseed`；它仍会删除用户状态。

## 8. 更新与密钥轮换

```bash
git pull --ff-only
./scripts/demo-stack.sh up
```

应把更新视为可能重新初始化可丢弃状态，随后重新执行本地健康、公开 HTTPS、登录、配额和主题验证。如果迁移或初始化数据变化需要干净数据库，执行 `reset`。

- 轮换 `DEMO_SESSION_SECRET` 并重建 Web 后，现有会话会失效。
- 轮换 `DEMO_PASSWORD_HASH` 会改变登录密码，但当前登录页仍会公开 `demo-reader`，二者必须一致。
- 演示数据库可丢弃，因此轮换 `DEMO_POSTGRES_PASSWORD` 时应同时执行 `reset`；只修改环境变量不会更新已有 PostgreSQL 角色。

初始化数据库按设计无需备份。应监控磁盘使用、容器状态、代理日志和定时重置结果。
