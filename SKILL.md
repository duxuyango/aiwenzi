---
name: literary-deepseek
description: 使用多模型文学写作插件生成、润色、续写或诊断文学文本，并将文学指令适配到支持系统提示词或 Chat Completions 的客户端。
---

本技能对应当前目录中的可移植插件。主目标是作者所需的文学效果；先尊重其文体、声音、情节与修改边界。

直接写作时读取 [文学指令](prompts/literary-system.txt)。需要编辑诊断时读取 [诊断指令](prompts/review.txt)，依据其证据进行修改时读取 [修订指令](prompts/revise.txt)。不要将所有作品变成同一种克制风格；具体任务覆盖默认风格。

适配 DeepSeek 时，使用 `plugin.py` 的 `build_messages` 生成消息，或 `DeepSeekClient` 与 `enhance_text` 执行请求。默认模型为 `deepseek-flash`，地址为 `https://api.deepseek.com`，均可覆盖。其他平台的模型别名由平台提供，不凭展示名猜测。

多服务商预设见 `providers.json`，通过 `providers.create_client` 选择服务商与地址。平台环境变量 Key 按服务商隔离；自定义地址仅使用显式 Key 或 AITEXT_API_KEY。原生思考参数与 enable_thinking 参数分别适配，兼容平台可使用 generic 模式。

本地使用方法与 Python 接口见 [使用说明](使用说明.md)。聊天平台不支持执行程序时，将文学指令作为 system 提示词或新对话的首条消息，再提供任务与原文；不能宣称聊天粘贴版自动执行三次 API 调用。

未提供 API Key 时，仍可制作任务、生成提示词和检查本地接入。不能宣称完成真实模型质量验证。编辑后的质量需通过具体作品比较，不能将技术测试或模型自评分当成文学提升证据。
