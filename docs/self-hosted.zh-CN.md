# 常规自托管部署

[English](self-hosted.md)

本文说明如何部署 `docker-compose.yml` 定义的私有单用户运行形态。该栈包含 PostgreSQL、一次性数据库迁移任务、Next.js Web 应用和独立刷新 Worker。Web 端口只绑定到回环地址；DNS、HTTPS、主机补丁、监控和备份保留策略由部署方负责。

不要使用在线演示栈保存个人数据。演示栈按设计可随时销毁，带共享账号、配额和确定性初始化数据。

## 1. 前置条件

- 维护中的 Linux 主机、Docker Engine 与 Docker Compose v2。
- Git、独立且稳定的检出目录，以及足够容纳镜像、PostgreSQL、文章和备份的磁盘空间。
- 已将 DNS 指向 HTTPS 反向代理或托管隧道的域名。
- 主机上的 Node.js 22 与 pnpm 11 只用于生成 Argon2 密码哈希；实际应用在 Docker 内构建运行。
- OpenSSL 或其他密码学安全的随机值生成工具。

Compose 不向主机发布 PostgreSQL。应用默认监听 `127.0.0.1:18120`，而不是所有网络接口。

## 2. 准备生产配置

在独立检出目录中执行：

```bash
cp .env.production.example .env
pnpm install --frozen-lockfile
```

分别生成 URL 安全的 PostgreSQL 密码和会话密钥：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

将两次不同的输出分别用于 `POSTGRES_PASSWORD` 与 `SESSION_SECRET`。数据库密码使用十六进制值，可以避免破坏内部 PostgreSQL 连接 URL。

以下方式不会把登录密码放进进程参数或 shell 历史：

```bash
read -r -s -p "Reader password: " RSS_PASSWORD; printf '\n'
printf '%s' "$RSS_PASSWORD" | pnpm hash-password
unset RSS_PASSWORD
```

编辑 `.env`，替换所有 `replace-...` 值：

| 变量 | 生产环境要求 |
| --- | --- |
| `APP_URL` | 准确的公开 HTTPS Origin，例如 `https://rss.example.com`，不能带路径。外观写操作会用它进行同源校验。 |
| `APP_PORT` | 反向代理访问的主机回环端口，默认 `18120`。 |
| `POSTGRES_DB` / `POSTGRES_USER` | 数据库和角色名称，首次部署后应保持不变。 |
| `POSTGRES_PASSWORD` | 长随机且 URL 安全的密钥；缺失时 Compose 会拒绝启动。 |
| `SINGLE_USER_USERNAME` | 当前安装的固定登录名；产生数据后不要随意修改。 |
| `SINGLE_USER_PASSWORD_HASH` | `pnpm hash-password` 输出的 Argon2 哈希，必须用单引号包裹，避免 `$` 被 Compose 展开。 |
| `SESSION_SECRET` | 至少 32 个字符的独立随机值；轮换会使现有会话失效。 |
| `FEED_REFRESH_MINUTES` | 成功刷新后安排下一次刷新的分钟数。 |
| `REFRESH_BATCH_SIZE` | Worker 每批领取的到期订阅数，范围 1 到 20。 |
| `FULL_TEXT_PREFETCH_COUNT` | 每次计划刷新后预取全文的最新待处理文章数，范围 0 到 20。 |
| `DEMO_MODE` | 常规自托管必须保持 `false`。 |

`docker-compose.yml` 会强制使用 `NODE_ENV=production`，并用内部 `postgres` 服务名构造 `DATABASE_URL`。`.env.example` 中指向 localhost 的连接仅用于本地开发。

保护并预检配置：

```bash
chmod 600 .env
docker compose config --quiet
```

`docker compose config --quiet` 只检查插值，不打印解析后的密钥。不要把完整的 Compose 渲染结果粘贴到 Issue 中。

## 3. 构建并启动

```bash
docker compose up -d --build --wait
docker compose ps -a
```

预期状态：

- `postgres` 正在运行且健康。
- `migrate` 已成功完成，显示为退出码 0。
- `web` 正在运行且健康。
- `worker` 正在运行。它没有 HTTP 健康接口，需要通过日志确认启动事件。

Web 与 Worker 只有在迁移任务成功后才会启动，因此迁移失败会阻止启动，而不是留下半初始化实例。

## 4. 通过 HTTPS 发布

保持 `18120` 只绑定回环地址，并将公开 HTTPS 域名转发到该端口。最小 Caddy 配置示例：

```caddyfile
rss.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18120
}
```

也可以使用 Nginx 或托管隧道。应保留原始 Host 与转发协议头，不要发布 PostgreSQL 端口，并通过防火墙阻止公网直接访问应用端口。

`APP_URL` 必须与浏览器看到的 Origin 一致。如果仍是 `http://localhost:3000` 或指向其他域名，外观与主题写请求会因同源检查返回 HTTP 403。生产会话使用 Secure Cookie，因此公开入口必须为 HTTPS。

## 5. 验证部署

检查容器、数据库和应用存活状态：

```bash
docker compose ps -a
docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
curl --fail --silent --show-error http://127.0.0.1:18120/api/health
curl --fail --silent --show-error https://rss.example.com/api/health
```

`/api/health` 只是应用进程存活响应，不会查询 PostgreSQL，因此数据库检查必须独立执行。

最后进行浏览器冒烟验证：

1. 使用 `SINGLE_USER_USERNAME` 和原始密码登录，不要输入 Argon2 哈希。
2. 新增一个公开 RSS 或 Atom 地址。
3. 手动刷新一次。
4. 新建或修改主题，确认公开 Origin 配置正确。

不要输入私有、需要认证、包含凭据或指向内网的订阅 URL。抓取层会主动阻止私有地址范围和不安全重定向。

## 6. 日志与 Worker 行为

```bash
docker compose logs --follow --tail=200 web worker
docker compose logs --tail=200 migrate postgres
```

应用输出结构化日志，并对常见密码、Authorization 和 Cookie 字段进行脱敏；Docker 与代理日志仍应作为运维数据妥善保护。

常规 Worker 的实际行为：

- 空闲时每 30 秒轮询一次，找到任务后每 5 秒继续轮询。
- 每批最多领取 `REFRESH_BATCH_SIZE` 个到期订阅，使用两分钟数据库租约与 `SKIP LOCKED`，中断后可以恢复。
- 计划刷新先保存规范化文章，再为最多 `FULL_TEXT_PREFETCH_COUNT` 篇最新待处理文章尝试全文提取。
- 订阅刷新失败时保留最后一次成功文章，记录安全错误，并从 30 分钟开始指数退避，最长 12 小时。
- 全文提取失败时回退到订阅源正文，并在 24 小时内不重复尝试。
- 手动刷新只更新订阅，不执行 Worker 的预取步骤；打开文章时可以按需触发全文提取。

## 7. 备份

备份应存放在 Git 检出目录之外。仓库会忽略 `backups/` 与 `*.dump` 作为最后一道防线，但这不能替代备份保留和加密策略。

```bash
install -d -m 700 "$HOME/backups/fulltext-rss-reader"
BACKUP="$HOME/backups/fulltext-rss-reader/rss-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$BACKUP"
docker compose exec -T postgres pg_restore --list < "$BACKUP" > /dev/null
printf 'Backup verified: %s\n' "$BACKUP"
```

将验证成功的备份复制到独立存储，按需要加密，并定期进行恢复演练。PostgreSQL 数据卷只是持久化，不是备份。

## 8. 恢复

恢复操作具有破坏性。继续前必须确认目标检出目录、`.env`、数据库名和备份文件；如果现有数据库仍可读取，应先制作紧急备份。

```bash
docker compose stop web worker
docker compose exec -T postgres sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /secure/path/rss-backup.dump
docker compose run --rm migrate
docker compose up -d --wait web worker
```

恢复后重新检查数据库、本地 HTTP、公开 HTTPS、登录、订阅和主题操作。

## 9. 升级与回滚

每次升级前：

1. 创建并验证数据库备份。
2. 使用 `git rev-parse HEAD` 记录当前提交。
3. 检查迁移和配置变化。

升级命令：

```bash
git pull --ff-only
docker compose up -d --build --wait
docker compose ps -a
docker compose logs --tail=200 migrate web worker
```

随后重复完整冒烟验证。

数据库迁移是单向的，仓库不提供自动向下迁移。如果确认只有应用变化且数据库结构兼容，可以切换回记录的提交并重新构建。如果升级执行了不兼容迁移，需要停止应用、切换回记录的提交、恢复与该提交匹配的升级前数据库备份，然后重新构建并验证完整栈。常规安装禁止执行 `docker compose down --volumes`。

## 10. 凭据变更

- 更新 `SINGLE_USER_PASSWORD_HASH` 后重建 Web 容器即可生效，但不会使已签名会话自动失效；需要强制退出时同时轮换 `SESSION_SECRET`。
- 首次使用后应将 `SINGLE_USER_USERNAME` 视为不可变。修改后会创建或选择另一个数据库用户，不会迁移已有订阅或主题。
- 只修改 `.env` 中的 `POSTGRES_PASSWORD` 不会改变已初始化 PostgreSQL 角色的密码。应在维护窗口中先协调修改数据库角色密码，再更新 `.env` 并重建应用容器。

## 11. 常见故障

| 现象 | 检查项 |
| --- | --- |
| Compose 提示必须设置 `POSTGRES_PASSWORD` | 将 `.env.production.example` 复制为 `.env` 并替换占位值。 |
| 无法登录或 Web 容器反复启动 | 确认哈希为有效 Argon2 输出、仍由单引号包裹，且会话密钥不少于 32 个字符。 |
| 主题或外观写操作返回 403 | 让 `APP_URL` 与浏览器公开 Origin 完全一致，并重建 `web`。 |
| `migrate` 以退出码 1 结束 | 查看 `docker compose logs migrate postgres`；Web 与 Worker 会按设计等待迁移成功。 |
| 修改 `.env` 后数据库认证失败 | 已存在的 PostgreSQL 角色仍使用旧密码，只改容器环境不会完成轮换。 |
| Worker 不断重启 | 查看 `docker compose logs worker` 中的环境变量或数据库连接错误。 |
| 订阅地址被拒绝 | 私有 IP、不安全 DNS 结果、URL 凭据、重定向过多、内容类型不支持、响应过大和超时都会被主动阻止。 |
| 刷新失败后仍显示旧文章 | 这是预期行为：Worker 会记录错误并安排有上限的退避重试。 |
| 本地健康检查成功但公网打不开 | 检查 DNS、TLS、反向代理路由、防火墙和配置的回环端口。 |
| 18120 端口已被占用 | 修改 `APP_PORT` 并同步修改代理上游；`APP_URL` 仍保持公开 Origin。 |
