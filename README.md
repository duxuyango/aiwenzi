# ai文字

支持 DeepSeek、通义千问、硅基流动、Kimi、智谱 GLM、MiniMax、火山方舟、Gemini、OpenRouter 及自定义兼容 API 的文学写作增强插件，帮助作者打磨小说、散文、诗歌和人物对话。

**Windows／Python 版：1.3.1 · Cloudflare 公开网页版：1.4.0**

ai文字把文学写作指令、编辑流程和多服务商 API 接入整合在一起。它关注具体经验、叙述视角、人物声音、情感表达和语言节奏，让修改围绕作品本身展开。

这是通过提示词与生成流程实现的写作中间件，不涉及模型微调。默认接入 DeepSeek-V4.1-Flash，服务商、API 地址与模型名均通过下拉菜单选择，也保留自定义选项。

## 服务商与模型选择

| 服务商 | 预设模型 | API 地址选项 |
| --- | --- | --- |
| DeepSeek 官方 | V4.1 Flash、V4 Pro | 官方 API |
| 阿里云百炼 | Qwen3.8 Max、Qwen Plus | 北京／新加坡业务空间地址、北京 DashScope 兼容地址 |
| 硅基流动 | 平台上的 DeepSeek V4 Flash、V4 Pro | SiliconFlow 中国 API |
| 月之暗面 · Kimi | Kimi K3、K2.6 | 中国／国际 API |
| 智谱 · GLM | GLM-5.3 | 智谱标准 API |
| MiniMax | M3、M2.7 | 中国／国际标准 API |
| 火山方舟 · 豆包 | Seed 2.1 Pro、Seed 2.0 Lite | 北京标准 API；也可自定义推理接入点 ID |
| Google · Gemini | Gemini 3.8 Flash | OpenAI 兼容 API |
| OpenRouter | 获取平台模型目录后选择 | OpenRouter API |
| 自定义兼容服务 | 从账户获取，或自定义模型名 | 自定义 Chat Completions 地址 |

选择服务商后，地址和模型下拉列表会联动更新。支持模型列表的预设可点击“从账户获取可用模型”；列表可能包含非文字生成模型，请按用途选择。GLM、MiniMax 和火山方舟预设未配置模型列表检查，相关按钮会禁用；请选择预设或自定义模型，用短任务、直接生成验证。预设只是配置起点，实际可用性、权限和费用由服务商决定。

OpenRouter 使用公开的平台模型目录，目录中的模型不代表当前账户拥有生成权限。“测试连接与密钥”会另行调用密钥鉴权接口，再检查所选模型是否在目录中；实际生成可用性仍需写作请求验证。

百炼业务空间地址需要额外填写 `WorkspaceId`；地域、业务空间与 Key 必须对应。Kimi、MiniMax 的中国与国际服务也需使用对应的 Key。火山方舟预设使用标准 API，Coding Plan 的地址、Key 与模型配置请按对应套餐设置自定义地址。切换服务商或地址时会清空页面里的 Key。

参数适配默认为自动，支持 `thinking`、`enable_thinking`、Kimi、GLM 和 MiniMax 格式，也可切换为通用兼容。Kimi K3 与 GLM-5.3 强制思考，Kimi K2.6 可切换；Kimi 与 GLM 不发送温度参数，GLM 默认采用低思考强度。MiniMax M3 可切换思考，M2.7 使用平台默认思考；思考内容与正文分离。通用兼容模式沿用平台默认思考行为，界面的思考开关不会控制它。

## 保存与切换配置

在“模型与服务商设置”中配置好模型和参数，填写名称，再点击“保存为新配置”。可分别保存“Flash 日常写作”“Pro 精修”等最多 50 套配置，从“已保存的配置”下拉菜单一键载入。

保存内容包括服务商、API 地址、WorkspaceId、模型名、思考模式、token 上限、温度、代理与超时，以及任务类型、文体、文字气质、篇幅、生成方式和自己的风格要求。原文、写作任务、连续性资料、修改边界和稿件不随配置保存。修改后点击“更新所选配置”才能覆盖；删除配置同时删除其中保存的 Key。

刷新或重新打开页面会恢复上次选中的已保存配置。数据存储在本机浏览器的 `localStorage`，不写入服务器文件。换浏览器、换本地端口、隐私浏览模式或清除网站数据后，配置可能不共享或丢失。

**默认不保存 API Key。** 如需切换时自动恢复 Key，主动勾选“同时保存此配置的 API Key”后再保存。Key 会明文保存在该浏览器的网站数据中，仅适合自己的电脑；取消勾选并更新配置可移除已保存的 Key。载入时只恢复该配置对应 API 地址的 Key，手动更换服务商或地址仍清空当前 Key。也可用环境变量管理密钥。

## Token 用量

稿纸下方显示本次输入、输出、总 token，并列出初稿、编辑诊断、定向修订的用量。每个阶段的响应收到后更新，不显示逐 token 的实时计数。文学诊断任务只显示一次诊断用量。后续阶段失败或连接断开时，保留已收到阶段的记录；下载全部阶段 JSON 时包含 `usage` 与 `stage_usage`。

“本机累计记录”按服务商和模型汇总，并保存在本机浏览器中；可清空累计记录。本次页面上的用量仍保留。累计记录不包含 Key、作品或写作任务。

数字来自 API 的 `prompt_tokens`、`completion_tokens`、`total_tokens`。未返回总数但输入与输出数完整时，相加得到总数；“—”表示未知，不当作零。缺少部分数据时，合计仅包含已返回的数字并显示提示。统计包含文学提示词和编辑材料，token 与中文字数不同。仅记录本浏览器已收到的阶段响应，未收到用量的失败请求与其他客户端用量等不在其中，不代表账户账单、余额或费用。

## 文学增强思路

文学性可以朴素、口语、克制，也可以抒情或具有实验性。插件不把增加辞藻、删除常用词或增加比喻当作统一的优化目标。

- **细节与经验**：选择属于人物和场景的细节，让动作、物件与感知承担作用。
- **视角与连续性**：保持叙述者的知识边界、人物关系、时间线和已有事实。
- **人物声音**：通过词汇、句法、称谓、停顿和回应方式区分人物。
- **情感与节奏**：根据作品需要选择直叙、场景、概括与留白，调整叙述速度。
- **意象与结构**：让比喻和意象带来新的感知，避免无目的的装饰与自动升华。
- **保护作者声音**：润色优先局部修改，保留有力量的句子、刻意的口语、残句与重复。

作者明确的题材、形式、风格和修改边界始终优先于默认写作指令。以上约束通过提示词引导模型执行，不是程序层面的内容保证。

## 支持的任务

| 任务 | 用途 | 输入要求 |
| --- | --- | --- |
| 创作 | 根据题材、场景与风格写新文本 | 写作要求；原文可选 |
| 润色 | 在既有事实与声音基础上调整表达 | 修改要求与原文 |
| 续写 | 承接前文，只输出新增部分 | 续写要求与前文 |
| 文学诊断 | 引用具体文字，提出编辑意见 | 诊断要求与原文 |

提供五种可选文字气质：**自然有质感、冷静克制、抒情有节制、口语与人物声音、实验与陌生化**。可以进一步填写自己的风格要求、连续性资料和修改边界。

## 两种生成方式

### 直接生成

调用 API 一次，按文学指令完成当前任务。适合初次试用、短文本和快速写作。

### 文学编辑

```text
任务与材料 → 初稿 → 编辑诊断 → 定向修订
```

通常调用 API 三次。诊断需要引用候选正文，指出问题的读者效果和具体修改方向；修订保留有效表达，并服从作者的原始要求。界面保留初稿、编辑意见与最终文本，便于比较。

“文学诊断”任务始终只调用一次 API，不自动改写原文。编辑流程消耗更多请求和 token，实际费用按服务商计费。若后续阶段失败，保留已完成的文本；若输出被截断，停止后续阶段并提示调整篇幅或 token 上限。

## Cloudflare 公开网页版

**在线使用：[打开 ai文字](https://aiwenzi.pages.dev/)**。选择模型服务商，填写自己的 API Key，再填写写作要求即可开始。首次试用可选择“直接生成”。

提供 Cloudflare Workers + Static Assets 部署版本，别人通过网址即可使用，不需要安装 EXE 或 Python。保留九家预设服务商、多模型、文学编辑、配置保存和 token 用量统计。访问者使用自己的 API Key，网站不使用发布者的模型密钥；配置与用量仍保存在访问者浏览器中。

完整部署步骤见 **[Cloudflare 部署说明](Cloudflare部署说明.md)**。网页和 API 一起发布到 Workers；只上传静态网页无法运行写作接口。发布成功后，由 Cloudflare 提供账号对应的公开网址；本地预览地址不是公开网址。

也支持 Pages 入口，使用 `项目名.pages.dev` 的短网址。Pages 通过服务绑定接入原有 Worker，保留完整写作流程和限流。首次创建 Pages 项目后运行 `npm run pages:deploy`，以后使用同一命令更新；创建和授权步骤见部署说明。

```powershell
npm ci
npx wrangler login
npm run deploy
```

构建与发布需要 Node.js 22 或更新版本；访问者只需浏览器。先用 `npm test` 和 `npm run check` 验证，再发布。公开版允许自定义模型名，API 地址限定为预设服务商的地址；本地版仍支持自定义 API 地址。Key 和作品会经网站 Worker 转发至所选模型平台，程序不写入数据库或应用日志。

## Windows 用户：双击启动，无需安装 Python

在本仓库的 **[Releases（发行版）](https://github.com/duxuyango/aiwenzi/releases/tag/v1.3.1)** 页面，下载 **[aiwenzi-v1.3.1-Windows-x64.zip](https://github.com/duxuyango/aiwenzi/releases/download/v1.3.1/aiwenzi-v1.3.1-Windows-x64.zip)**。源码的 “Download ZIP” 下载的是源码，不包含编译好的 EXE。发行版的校验文件使用实际下载附件名；本地构建的便携包仍命名为 `ai文字-v1.3.1-Windows-x64.zip`。

1. 将便携包完整解压到一个文件夹。
2. 双击 **`ai文字.exe`**，启动器会自动打开浏览器写作台。
3. 展开“模型与服务商设置”，选择服务商、API 地址和模型，填写对应平台的 API Key。
4. 填写写作要求，第一次选择“直接生成”，点击“开始写作”。润色、续写和诊断时还需粘贴原文。
5. 复制或下载成果。需要结束时，在启动器里点击“停止并退出”。

默认地址是 `http://127.0.0.1:8765/`。浏览器没有自动打开时，可以点击启动器里的“打开写作台”，或手动打开该地址。关闭浏览器后，启动器仍保持服务运行；重复双击 EXE 会打开已有的同版本服务，不启动第二个后台。

适用于 **Windows 10/11 x64**，无需管理员权限。EXE 内置运行环境、网页、模型预设与文学提示词，可以单独使用。真实模型调用仍需网络、对应平台的 Key，并按平台计费。本版未进行代码签名；目前验证的是本机 Windows 环境，未逐一测试所有 Windows 版本。

命名配置和 token 记录仍保存在本机浏览器中。使用同一浏览器和默认地址，可继续读取源码版保存的配置；更换端口或浏览器不会共享。作品不会自动保存，退出前请下载。更新 EXE 前先保存稿件并停止旧版服务，再替换文件；端口被旧版或其他程序占用时，启动器会提示，不会自动结束其他程序。

更多操作见 [Windows 使用说明](Windows使用说明.txt)。macOS、Linux 用户可使用下面的 Python 源码版。

## Python 源码版：快速开始

### 1. 准备环境

安装 **Python 3.10 或以上版本**。源码写作台仅使用 Python 标准库，不需要执行 `pip install`；Windows EXE 已内置运行环境，可跳过这一节。

下载仓库文件后，在包含 `server.py` 的项目目录打开终端。

### 2. 启动本地写作台

Windows 用户可以双击 **`启动ai文字.bat`**，也可以运行：

```bash
python server.py
```

浏览器打开终端显示的地址，默认是：

```text
http://127.0.0.1:8765
```

服务仅监听本机回环地址。通过终端启动时，按 `Ctrl+C` 可停止服务。

### 3. 选择服务商并配置连接

展开“模型与服务商设置”，依次选择服务商、API 地址和模型，再填写该服务商的 Key。首次使用可从默认 DeepSeek 配置开始：

| 设置 | 默认值 |
| --- | --- |
| API 地址 | `https://api.deepseek.com` |
| 模型名 | `deepseek-flash` |
| 参数适配 | 自动（DeepSeek 原生格式） |
| 思考模式 | 关闭 |
| 连接方式 | 使用系统代理设置 |
| 每阶段等待上限 | 240 秒 |
| 生成 token 上限 | 8192 |

支持连接检查的服务商可点击 **“测试连接与密钥”**。它检查鉴权与模型列表，不生成作品；OpenRouter 会先单独验证 Key。未配置列表检查的预设会显示提示，请用短任务直接生成验证，写作请求按平台规则计费。

本项目按 2026-10-01 核对的官方文档设置预设模型名称。后续如服务商调整别名，可从账户获取模型列表，或选择自定义模型名。[DeepSeek 官方更新记录](https://api-docs.deepseek.com/updates/)

### 4. 写作与保存

选择任务，填写要求；润色、续写和诊断时粘贴原文。第一次可以选择“直接生成”，用一段短文本确认接入正常，再尝试“文学编辑”。

示例要求：

> 润色一段父亲送女儿到车站的离别场景。保持第一人称，语言朴素，略带口语；保留鸡蛋袋子和父亲粗糙的手，不增加家庭背景，约 300 字。

点击“开始写作”。完成后可在“定稿”“初稿”“编辑意见”之间切换，复制或下载当前页，也可下载全部阶段的 JSON。

**作品不会自动保存，请在关闭页面前下载需要保留的成果。**

## 在其他软件中使用

### 作为文学系统提示词

支持自定义系统提示词的客户端，可以使用 [prompts/literary-system.txt](prompts/literary-system.txt) 的内容，再提供本次写作任务与材料。

也可以在本地写作台填写任务，点击“导出写作提示词”，将导出的文字粘贴到 DeepSeek 新对话。这个方式不需要在本地写作台填写 API Key，但不会自动执行三阶段 API 流程。

### 接入第三方 API 平台

使用该平台提供的 API 地址、模型别名和 Key。地址可以是根地址、含 `/v1` 的地址，或完整的 `/chat/completions` 地址。

如果平台不支持专用思考参数，选择“通用兼容 · 仅标准参数”。不同平台的默认推理模式、参数支持和模型可用性需要按该平台配置。本插件只适配 Chat Completions 格式；使用其他原生协议的服务需要兼容端点。

本项目提供可移植的提示词与 Python 接口；`plugin.json` 是项目自己的描述文件，不是 Chrome、SillyTavern 或其他软件的原生扩展清单。要集成到具体客户端，需要按该客户端的扩展机制制作适配器。

## Python 接口

将项目目录加入 Python 模块搜索路径，或在该目录下运行自己的脚本。先设置 `DEEPSEEK_API_KEY` 环境变量，再调用插件：

```python
from plugin import DeepSeekClient, enhance_text

client = DeepSeekClient()

result = enhance_text(
    {
        "mode": "create",
        "brief": "写母女在厨房谈搬家的场景，双方都回避真正担心的事。",
        "genre": "小说",
        "profile": "oral",
        "length": "约 1000 字",
        "constraints": "不安排和解，不添加重大疾病。",
        "pipeline": "editor",
    },
    client,
)

print(result["final"])
if not result["complete"]:
    print("本次生成未完成：", result["warning"])
```

任务模式为 `create`、`polish`、`continue`、`diagnose`；生成方式为 `single` 或 `editor`。任务结构示例见 [examples/task.json](examples/task.json)。

| 接口 | 作用 |
| --- | --- |
| `build_messages(task, stage="draft")` | 构造 `system` 和 `user` 消息，供已有客户端调用 |
| `run_pipeline(task, client)` | 按阶段产出进度、文本和结果事件 |
| `enhance_text(task, client)` | 执行任务并返回汇总结果 |
| `client.test_connection()` | 对已配置检查的服务验证鉴权与模型列表；公开目录另行鉴权 |
| `client.list_models()` | 返回已配置列表接口的模型 ID；公开目录不代表账户权限 |

通过预设配置服务商，可使用 `providers.create_client`：

```python
from providers import create_client

client = create_client({
    "provider": "deepseek",
    "model": "deepseek-v4-pro",
})  # 读取 DEEPSEEK_API_KEY

qwen_client = create_client({
    "provider": "qwen",
    "endpoint": "beijing",
    "workspace": "你的业务空间ID",
    "model": "qwen3.8-max",
})  # 读取 DASHSCOPE_API_KEY；示例 ID 需替换为真实值
```

| 服务商 | 环境变量 |
| --- | --- |
| DeepSeek | `DEEPSEEK_API_KEY` |
| 百炼 | `DASHSCOPE_API_KEY` |
| 硅基流动 | `SILICONFLOW_API_KEY` |
| Kimi | `MOONSHOT_API_KEY` |
| 智谱 | `ZHIPU_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| 火山方舟 | `ARK_API_KEY` |
| Gemini | `GEMINI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| 自定义地址 | `AITEXT_API_KEY` |

不会把某服务商的环境变量 Key 自动用于其他服务商；选择自定义地址后也不沿用该服务商环境变量或专用鉴权路径。`ModelClient` 是 `DeepSeekClient` 的通用别名，原有 Python 接口仍可使用。

结果包含 `draft`、`review`、`final`、`usage`、`stage_usage`、`complete` 和 `warning`。`stage_usage` 按 `draft`、`review`、`revise` 保存用量，阶段事件也包含 `usage` 与当前累计的 `usage_total`。`final` 在流程失败时可能包含已保留的初稿，请检查 `complete`。

第三方兼容平台示例：

```python
import os
from plugin import DeepSeekClient

client = DeepSeekClient(
    api_key=os.environ["YOUR_PROVIDER_API_KEY"],
    base_url=os.environ["YOUR_PROVIDER_BASE_URL"],
    model=os.environ["YOUR_PROVIDER_MODEL"],
    native=False,
)
```

支持通过 `transport="direct"` 让本插件直连 API，或使用默认的 `transport="system"` 读取系统代理设置；不会修改系统代理。

## 命令行使用

在本机环境中设置 `DEEPSEEK_API_KEY` 后运行：

```bash
python plugin.py examples/task.json --output result.json
```

也支持 `--base-url`、`--model`、`--generic` 和 `--thinking`。查看完整参数：

```bash
python plugin.py --help
```

## 连接问题排查

| 提示或情况 | 处理方式 |
| --- | --- |
| 接口不存在／连接参数无效 | 确认页面与后台版本一致。下载需要保留的稿件，关闭旧启动窗口，再启动新版服务；仅刷新网页不能更新已经运行的 Python 后台。 |
| 端口已被占用 | 关闭之前的本地服务，或用 `python server.py --port 8766` 启动，然后打开终端显示的新地址。 |
| 连接被拒绝 | 检查代理软件是否运行，或在插件中选择“直连 API”后测试。 |
| 连接测试成功，但写作超时 | 先尝试短任务、直接生成和关闭思考模式；每阶段等待上限最多可调整到 600 秒。 |
| HTTP 401 | 检查 Key 是否有效、是否属于当前 API 服务。 |
| HTTP 402 | 检查服务账户余额。 |
| 当前模型名不可用 | 使用服务商提供的模型别名，重新测试连接。 |

不使用 Key 的网络检查：

```bash
python diagnose_connection.py
```

此脚本比较系统代理和直连能否到达 DeepSeek 官方 API，不发送作品。无 Key 时返回 HTTP 401 说明已到达服务，不代表某个 Key 有效。

## 数据与参数说明

- Key 默认不持久保存，也不写入项目文件或应用日志。主动勾选保存 Key 后，它会明文保存到本机浏览器的配置中；取消勾选后更新，或删除配置可移除。
- 命名配置与累计 token 数保存在本机浏览器网站数据中，不同步到其他电脑或浏览器；写作任务与作品不随配置保存。
- 写作请求会将任务、原文和相关资料发送给配置的 API 服务。编辑流程还会发送初稿与编辑意见。
- 稿件保留在当前页面，不自动写入服务器文件；用户主动下载或指定命令行输出文件时才保存成果。
- 编辑诊断和修订只使用正文，不回传模型的 `reasoning_content`。当前工作流不包含工具调用。
- 初稿、诊断、修订的温度起点分别为 0.9、0.35、0.7；这些值没有经过文学质量基准验证。Kimi、GLM 及专用适配器的思考模式下不发送温度，使用平台默认值。
- 界面统计的是去空白后的字符数，含标点；token 上限与中文目标字数不是同一个概念。

建议逐段或逐场景打磨长篇作品，在连续性资料里维护人物关系、时间线和伏笔。每次约 5000 中文字以内是便于编辑的工作规模建议，不是模型上下文上限。

## 项目结构

```text
literary-deepseek/
├── README.md                 项目介绍与使用方法
├── plugin.py                 提示词构造、API 客户端与编辑流程
├── server.py                 本地写作台后台
├── launcher.py               EXE 桌面启动器、打开浏览器与停止服务
├── build_windows.py          构建、检查并打包 Windows EXE
├── build-requirements.txt    仅供构建使用的依赖
├── Windows使用说明.txt       便携版操作说明
├── plugin.json               插件描述与默认接入配置
├── providers.json            服务商、地址与模型预设
├── providers.py              服务商配置解析与密钥作用域
├── profiles.json             可选文字气质
├── diagnose_connection.py    无 Key 网络检查
├── 启动ai文字.bat            Windows 启动器
├── 使用说明.md               补充使用说明
├── SKILL.md                  提供给技能型助手的使用入口
├── prompts/
│   ├── literary-system.txt   文学写作指令
│   ├── review.txt            编辑诊断指令
│   └── revise.txt            定向修订指令
├── web/                      本地网页界面
├── examples/task.json        示例任务
└── tests/test_plugin.py      接口与流程测试
```

## 自行构建 Windows EXE

在 Windows x64 上安装 64 位 Python，在项目目录运行以下命令。构建环境需要包含 `tkinter`，标准 Windows Python 安装包提供此模块。

```powershell
python -m venv .venv-build
.\.venv-build\Scripts\python.exe -m pip install -r build-requirements.txt
.\.venv-build\Scripts\python.exe build_windows.py
```

构建脚本使用 [PyInstaller](https://pyinstaller.org/en/stable/usage.html) 的单文件、无控制台模式，并明确打包网页、提示词与配置数据。构建完成后，会从没有源码的目录运行真实 EXE 自检，检查启动器窗口、全部网页资源、服务商配置、文学指令和 TLS 证书加载；自检不调用模型。

输出文件在 `dist/`：

- `ai文字.exe`：可单独分发的程序。
- `ai文字-v1.3.1-Windows-x64.zip`：包含 EXE、先读我和 README 的便携包。
- `SHA256SUMS.txt`：EXE 与便携包的 SHA-256 校验值。

核对下载文件可运行 `Get-FileHash .\ai文字-v1.3.1-Windows-x64.zip -Algorithm SHA256`，与校验文件中的对应行比较。构建不包含 API Key 或浏览器里的个人配置。

### 发布到 GitHub

将源码上传到仓库，保留目录结构。`.gitignore` 已排除 `.venv-build/`、`build/` 和 `dist/`。创建 `v1.3.1` 的 Release，并将便携包与 `SHA256SUMS.txt` 作为附件上传；如希望用户直接下载单个 EXE，也可同时上传 `ai文字.exe`。二进制文件的构建完成不等于已发布到 GitHub。

## 测试与效果评估

在项目目录运行：

```bash
python -m unittest discover -s tests -v
node --test tests/test_state.cjs
```

Python 测试使用本地模拟 API，覆盖请求格式、六家新增服务商的端点与密钥隔离、模型思考参数、公开目录与鉴权分离、三阶段流程、错误处理、截断稿保留、阶段用量和端口独占。可选的 Node.js 测试使用内置测试运行器，验证配置序列化、新适配器保存、Key 保存开关、作品排除及用量累计；运行写作台本身不需要 Node.js。测试不需要真实 Key，只验证程序行为，不证明真实模型的文学质量提升。

评估文学效果时，可以隐藏版本来源，对同一题材多次比较普通写作、单次插件与编辑流程，重点观察事实与声音的保留、细节是否具体、人物是否有辨识度、节奏与意象是否有效。三阶段流程的生成预算更大，应单独考虑这个因素。

目前没有公开的文学质量提升百分比，也不保证每次修订优于初稿。作者可以保留初稿、采用部分建议，或进一步提出修改要求。

## 参考资料

- [DeepSeek 首次 API 调用](https://api-docs.deepseek.com/)
- [DeepSeek Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)
- [DeepSeek 模型更新记录](https://api-docs.deepseek.com/updates/)
- [百炼首次调用千问 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)
- [硅基流动 Chat Completions](https://docs.siliconflow.cn/docs/api/chat-completions-post)
- [Kimi 思考模型](https://platform.kimi.ai/docs/guide/use-thinking-models)
- [智谱 GLM-5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)
- [MiniMax OpenAI 兼容接口](https://platform.minimax.cn/docs/api-reference/text-openai-api)
- [火山方舟地址与鉴权](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=zh)
- [Gemini OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai)
- [OpenRouter 快速开始](https://openrouter.ai/docs/quickstart)
- [OpenRouter 密钥鉴权接口](https://openrouter.ai/docs/api_reference/limits)
