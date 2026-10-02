# ai文字 · Cloudflare 公开网页版 v1.4.0

**已发布网址：[ai文字在线版](https://aiwenzi.pages.dev/)**。打开后展开“模型与服务商设置”，选择平台与模型，填写自己的 API Key，再输入写作要求。首次试用建议选择“直接生成”。

这个版本支持 **Cloudflare Workers + Static Assets**，以及 **Pages 入口 + Workers 写作后台**；浏览器始终从当前网站网址调用 API。访问者只需浏览器，不需要安装 Python 或 EXE；发布者使用 Node.js 22 或更新版本及 Wrangler 构建与发布。

支持九家预设服务商、多模型切换、保存写作配置、文学诊断和三阶段编辑，以及 API token 用量统计。访问者填写自己的模型平台 Key，费用由对应模型平台计收。

## 使用更短的 Pages 网址

项目也支持 Cloudflare Pages 入口，网址形式为 `项目名.pages.dev`。Pages 提供网页和同站 API 入口，通过服务绑定调用已有的 `aiwenzi` Worker；文学编辑、流式阶段响应、密钥检查和来源 IP 限流仍由该 Worker 执行。

首次发布时，在浏览器授权 Wrangler 的 Pages 和 Workers 发布权限，然后运行：

```powershell
npm ci
npx wrangler login
npx wrangler pages project create aiwenzi --production-branch main --force
npm run pages:deploy
```

如果 Pages 项目已创建，跳过创建命令。创建命令的 `--force` 使 Wrangler 直接创建 Pages 项目，避免自动改为 Workers；后续部署不需要它。名称被其他账号占用时，Cloudflare 可能分配带后缀的地址，请以实际返回的网址为准。以后更新运行 `npm run pages:deploy`，会先更新 Worker，再构建并发布 Pages。不要只运行 `npm run deploy`，它只更新 Workers 网址对应的部署。

Pages 配置见 `cloudflare/wrangler.jsonc`，根目录的 `wrangler.jsonc` 是 Worker 配置。更改后端 Worker 名称时，同步修改 Pages 配置 `services` 中的 `service`；仅有 Pages 前端而没有对应 Worker，写作接口无法运行。不要删除作为后端的 Worker。构建输出位于 `build/pages/`，由 Wrangler 上传，无需提交到 GitHub。

## 先准备这些文件

解压 `ai文字-Cloudflare网页版.zip`，文件直接放在 GitHub 仓库根目录，保留子目录结构：

```text
package.json
package-lock.json
wrangler.jsonc
.gitignore
README.md
Cloudflare部署说明.md
providers.json
profiles.json
cloudflare/            Workers 后端、测试
web/                   网页
prompts/               文学指令
tests/                 网页状态测试
```

不要上传 `node_modules/`、`.wrangler/`、`build/`、`.dev.vars` 或自己的密钥。完整项目仓库也可以直接部署；不需要删除原有 Python 和 EXE 构建源码。

## 方式一：在 Cloudflare 后台连接 GitHub

1. 登录 Cloudflare，进入 **Workers & Pages**，创建一个 **Worker**，选择连接 Git 仓库的方式。
2. 选择已上传这些文件的 GitHub 仓库和发布分支。
3. 根目录使用包含 `package.json` 与 `wrangler.jsonc` 的目录。如果这些文件就在仓库根目录，保持默认根目录；如果整个项目放在 `literary-deepseek/` 下，根目录填 `literary-deepseek`。
4. 构建命令填 `npm ci && npm run check`，部署命令填 `npm run deploy`。使用 Node.js 22 或更新版本。
5. Worker 名称设为 `aiwenzi`，与 `wrangler.jsonc` 的 `name` 一致；需要其他名称时同步修改配置文件。
6. 点击部署。成功后，Cloudflare 显示此账号下的 `workers.dev` 网址；打开该网址即可使用。需要绑定域名时，在这个 Worker 的域名设置里添加自己的域名。

以上步骤发布 Workers 网址。使用 Pages 网址请按前面的 Pages 步骤发布，仅把 `web/` 拖到静态 Pages 项目里不能运行写作接口。

## 方式二：在电脑上发布

在解压目录打开终端，依次运行：

```powershell
npm ci
npx wrangler login
npm run deploy
```

登录命令会打开 Cloudflare 官方页面，在浏览器完成账号登录和授权。不要把 Cloudflare Token 或模型 API Key 写进源码。部署完成后，终端会显示可公开访问的网址。CLI 没有授权前，完成本地代码和检查也不会产生正式的公开网址。

## 本机预览和检查

```powershell
npm ci
npm test
npm run check
npm run dev
```

打开 `http://127.0.0.1:8787/`。这只是本机预览网址，其他人不能通过它访问你的电脑。`check` 是部署演练，只检查打包，不上传网站。自动化测试使用模拟响应，不调用真实模型或消耗模型费用。

## 发布后检查

- 首页显示“公开网页版 · 使用自己的 API Key”，页面底部显示“Cloudflare 网页版”。
- `/api/health` 返回 `ok: true`，`/api/config` 能正常加载模型配置。
- 选择服务商并填写自己的 Key，先用“直接生成”写约 100 字；成功后再试文学编辑。
- 核对阶段文本、token 数与模型平台实际响应。模型权限、平台余额和 Cloudflare 到相应平台的网络可达性需在发布后实测。

## 数据与调用方式

浏览器将 Key、任务、原文和相关资料发到本站 Worker，再由 Worker 调用所选模型平台。程序不把 Key 和作品写入数据库或应用日志，未配置 D1、KV、R2，也不读取发布者的模型密钥。每次模型请求都必须带访问者提供的 Key。

命名配置与 token 记录保存在当前浏览器的 `localStorage`；默认不保存 Key，主动勾选后才会明文保存到该浏览器。作品不自动保存。不同浏览器、网址或域名的数据不会共享；更换域名前请记录需要迁移的配置并下载稿件。

公开版只允许九家服务商的预设 HTTPS 地址，可自定义这些平台的模型名。自定义 API 地址仍可在本地 Python／EXE 版使用。Worker 不跟随模型服务的重定向，防止把 Key 转发到其他地址。

公开写作接口仅接受同站页面的 JSON 请求，请求体最多 1 MB；每次模型响应最多 4 MB；每个阶段等待上限可设为 1—600 秒。默认配置每个来源 IP 每分钟最多约 12 次 API 请求（包括列表、测试、写作），采用 Cloudflare 的区域性限流绑定，不是严格的全局配额。多人共用同一出口 IP 时会共享这项限制。

token 统计采用服务商返回的实际用量，不等于账单或网站配额。Workers 的费用、CPU、请求次数和其他限制由 Cloudflare 当前计划决定；本项目没有配置自动购买或升级套餐。浏览器断开时后续阶段会停止，但已经发往模型平台的请求仍可能计费。

## 文件与版本

Cloudflare 版为 v1.4.0；原有 Windows EXE 为 v1.3.1，分别发布。修改 `web/`、`prompts/` 或模型预设后，Workers 部署运行 `npm run deploy`，Pages 入口运行 `npm run pages:deploy`；无需重新打包 EXE。若也要更新 EXE，使用原有 Windows 构建脚本另行打包。

## 官方资料

- [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)
- [Pages 高级模式](https://developers.cloudflare.com/pages/functions/advanced-mode/)
- [Pages 服务绑定](https://developers.cloudflare.com/pages/functions/bindings/)
- [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Wrangler 登录与通用命令](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Workers 运行限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Rate Limiting 绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
