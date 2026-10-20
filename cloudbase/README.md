# 云端存档（CloudBase）

这套手账的页面仍然是纯静态的，登录只多了一个云函数。**已经部署完成并在用**，下面是现状与重装步骤。

## 现状

| 资源 | 值 |
|---|---|
| 环境 | `<ENV_ID>`（体验版，ap-shanghai，PostgreSQL 模式） |
| 云函数 | `nte-api`，Nodejs18.15，入口 `index.main` |
| 调用地址 | `https://<ENV_ID>-<APPID>.ap-shanghai.app.tcloudbase.com/nte-api` |
| 路由 | HTTP 网关 `SCF` 上游，path `/nte-api`，不鉴权、不路径透传 |
| 数据表 | `public.users`，`name_key` 唯一 |
| 迁移 | `cloudbase/migrations/*.sql`，已跑 4 条 |
| 静态托管 | `nte-companion/` 已上传到根目录，站点地址见下方 |
| 仓库 | COS `<BUCKET_NAME>`，ap-shanghai |

地址已经写进 `nte-companion/cloud/cloud-config.js`，「个人档案」里的登录按钮是可用状态。

## 静态托管（线上地址）

```
https://<ENV_ID>-<APPID>.tcloudbaseapp.com/
```

托管根目录下是一个 `index.html` 加三个子目录：

```
index.html
assets/   app.js  data.js  style.css
cloud/    cloud.js  cloud-config.js
images/   1.1.jpg  1.2.jpg  1.3.jpg  1.4.jpg
```

首页文档 `index.html`，`AutoAddressing` 开启（`/` 自动跳到 `/index.html`）。
更新站点只改本地 `nte-companion/`，再整目录覆盖上传（MCP `manageHosting(action=upload)`，
或 CLI `tcb hosting deploy nte-companion -e <环境ID>`）；改动前端资源时记得同步改
`index.html` 里的 `?v=` 版本串，否则浏览器会拿旧缓存。

三种上传方式：

1. **双击项目根目录的 `上传网站到云端.bat`** —— 内部就是
   `tcb hosting deploy nte-companion -e <ENV_ID> --verify`，结尾会打站点地址。
   CLI 用 CloudBase 官方的 `tcb`（`npm i -g @cloudbase/cli`），需先 `tcb login`。
   若提示未登录，在同一个窗口执行 `tcb login` 后再跑。
2. **控制台手动**：CloudBase 控制台 → 当前环境 → 静态网站托管 → 文件管理 → 上传文件，
   把 `nte-companion/` 里的文件拖进去覆盖同名文件即可（不需要先删旧的）。
3. **让 AI 传**：在这份手账的对话里说「上传」，我会用 CloudBase 连接器整目录覆盖。

**默认域名的中间页**：`*.tcloudbaseapp.com` 是平台测试域名，访客首次访问会先看到一页
「页面访问提示」（1 秒倒计时后可点「确定访问」），点过之后在 Cookie 有效期内不再出现。
这是平台合规要求，只有绑定**已备案的自定义域名**才能去掉
（见 [官方说明](https://docs.cloudbase.net/service/alias)）。个人自用可以不折腾。

## 为什么不用文档数据库

这个环境开的是 **PostgreSQL 模式**（`EnvInfo.RuntimeBackends.nosql = false`），没有
`app.database()` 那套集合。所以云函数改用 `app.rdb()` 走 PG。

另外实测：云函数里的 rdb 客户端出网时是 **`anon` 角色**，对自建表没有任何写权限。
所以表开了 RLS 且不对外授予任何策略，浏览器和匿名角色都读不到表；读写全部收敛到三个
`SECURITY DEFINER` 函数里，只暴露登录、读取、保存三件事：

| 函数 | 作用 |
|---|---|
| `nte_login(p_name text)` → `(id, name, data)` | 按 `lower(name)` 查重，没有就建，有就顺手更新展示名 |
| `nte_pull(p_id bigint)` → `(id, name, data)` | 读一个账号，不存在直接抛「账号不存在」 |
| `nte_save(p_id bigint, p_data jsonb)` → `boolean` | 整包覆盖进度 |

三个函数 `GRANT EXECUTE TO anon, authenticated, service_role`，别的什么也没开——
拿不到用户列表，也没法做任意查询。

## 表结构

```sql
CREATE TABLE public.users (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_key   TEXT        NOT NULL UNIQUE,   -- 小写，查重用
  name       TEXT        NOT NULL,          -- 展示名
  data       JSONB,                          -- 整包进度
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;   -- 不建策略 = 谁都不许直连
```

`data` 里放的就是页面 `localStorage` 那一份：

```json
{ "done": [1, 2], "name": "玩家名", "cat": "daily",
  "started": { "19": 1790000000000 }, "counts": { "19": 3 }, "perHour": { "19": 4000 } }
```

## 接口

统一 `POST`，请求体是 JSON（页面用 `Content-Type: text/plain` 发包，避开浏览器预检），
返回也是 JSON。响应头带 `Access-Control-Allow-Origin: *`，`OPTIONS` 返回 204。

```jsonc
{ "action": "login", "name": "玩家名" }
// → { "ok": true, "id": "3", "name": "玩家名", "data": null }

{ "action": "pull", "userId": "3" }
// → { "ok": true, "id": "3", "name": "玩家名", "data": { ... } }

{ "action": "save", "userId": "3", "data": { ... } }
// → { "ok": true, "updatedAt": 1792391773872 }

// 出错统一 { "ok": false, "error": "账号不存在" }
```

## 从零重装

```bash
# 1. 建表 + 建三个函数（按版本号顺序）
#    用 CloudBase MCP 的 managePgDatabase(action=applyMigration) 逐条跑
#    cloudbase/migrations/ 下的 SQL，或者 CLI：
tcb db pg migration up --envId <环境ID>

# 2. 部署云函数
tcb fn deploy nte-api --dir cloudbase/functions/nte-api --envId <环境ID>

# 3. 挂 HTTP 网关路由：path /nte-api → SCF 上游 nte-api，鉴权关闭
#    MCP：manageGateway(action=createRoute, upstreamResourceType=SCF, path="/nte-api")

# 4. 把 https://<环境ID>-<appid>.ap-shanghai.app.tcloudbase.com/nte-api
#    填进 nte-companion/cloud/cloud-config.js 的 endpoint

# 5. 上传静态站点（MCP：manageHosting(action=upload, localPath=<nte-companion>）)
tcb hosting deploy nte-companion -e <环境ID>
```

## 验证

```js
// 浏览器控制台
await NTE_CLOUD.login("测试")
// { ok: true, id: "1", name: "测试", data: null }
```

或者直接 curl：

```bash
curl -X POST -H "Content-Type: text/plain" \
  -d '{"action":"pull","userId":"1"}' \
  https://<ENV_ID>-<APPID>.ap-shanghai.app.tcloudbase.com/nte-api
```

排查要点：

- 返回 `未知操作：` → 请求体没解析出来。网关转发时 body 可能是 base64，云函数里已按
  `isBase64Encoded` 解码，也兜底试了一次 base64。
- 返回 `permission denied for table users` → 表权限或 RLS 问题，说明代码绕过 RPC 直接查表了。
- 浏览器报跨域 → 检查网关路由是否还开着鉴权，或安全域名白名单。

## 关于「只用用户名」

没有密码，知道用户名就能进这个账号。这份手账是个人进度记录，按这个前提做的。
真要加一道门，给 `users` 加 `secret` 字段、在 `nte_login` 里校验即可——但那就不是
「只填用户名」了。
