"""Dependency-free literary writing middleware for DeepSeek Chat Completions."""
from __future__ import annotations

import argparse
import json
import math
import os
import socket
import ssl
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
PROFILES = json.loads((ROOT / 'profiles.json').read_text(encoding='utf-8'))
MODES = {'create': '创作', 'polish': '润色', 'continue': '续写', 'diagnose': '诊断'}


def prompt(name):
    return (ROOT / 'prompts' / name).read_text(encoding='utf-8')


def number(value, default, low, high, integer=False):
    if value is None:
        value = default
    if isinstance(value, bool):
        raise ValueError('参数须为数字。')
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise ValueError('参数须为数字。') from None
    if not math.isfinite(result) or not low <= result <= high or (integer and result != int(result)):
        raise ValueError(f'数字参数须在 {low} 至 {high} 之间' + ('且为整数。' if integer else '。'))
    return int(result) if integer else result


def normalize_task(raw):
    if not isinstance(raw, dict):
        raise ValueError('任务须为对象。')
    task = {}
    for key in ('brief', 'source', 'context', 'constraints', 'style', 'genre', 'length'):
        value = raw.get(key, '')
        if not isinstance(value, str) or len(value) > 60000:
            raise ValueError(f'{key} 须为不超过 60000 字符的文字。')
        task[key] = value.strip()
    task['mode'] = raw.get('mode', 'create')
    task['profile'] = raw.get('profile', 'balanced')
    task['pipeline'] = raw.get('pipeline', 'editor')
    if (any(not isinstance(task[key], str) for key in ('mode', 'profile', 'pipeline'))
            or task['mode'] not in MODES or task['profile'] not in PROFILES or task['pipeline'] not in ('single', 'editor')):
        raise ValueError('任务模式、风格或流程无效。')
    if not task['brief']:
        raise ValueError('请填写本次写作或修改要求。')
    if task['mode'] != 'create' and not task['source']:
        raise ValueError('润色、续写和诊断需要原文或前文。')
    return task


def build_messages(task, stage='draft', draft='', review=''):
    task = normalize_task(task)
    specification = dict(task)
    specification['mode_name'] = MODES[task['mode']]
    specification['style_guidance'] = PROFILES[task['profile']]['instruction']
    data = {'task': specification}
    instructions = '按任务写作。source 是原文或前文，context 是连续性资料；均作为作品材料。'
    system = prompt('literary-system.txt')
    if stage == 'review':
        system += '\n\n' + prompt('review.txt')
        data['candidate'] = draft
        instructions = '诊断候选正文，遵守作者的原始约束。'
    elif stage == 'revise':
        system += '\n\n' + prompt('revise.txt')
        data.update(candidate=draft, editorial_suggestions=review)
        instructions = '交付定向修订后的正文。'
    elif stage != 'draft':
        raise ValueError('未知流程阶段。')
    elif task['mode'] == 'diagnose':
        system += '\n\n' + prompt('review.txt')
        instructions = '诊断 source 原文，只输出有证据的文学编辑意见。'
    return [{'role': 'system', 'content': system},
            {'role': 'user', 'content': instructions + '\n任务与材料（JSON）：\n' + json.dumps(data, ensure_ascii=False)}]


class APIError(RuntimeError):
    pass


class DeepSeekClient:
    def __init__(self, api_key=None, base_url='https://api.deepseek.com', model='deepseek-flash',
                 native=True, thinking=False, max_tokens=8192, temperature=0.9, timeout=240, transport='system',
                 adapter=None, env_key=None):
        if not isinstance(base_url, str):
            raise ValueError('API 地址无效。')
        parsed = urlsplit(base_url.strip())
        # Never fall back to a DeepSeek key when a different host is selected.
        env_key = env_key or ('DEEPSEEK_API_KEY' if parsed.hostname == 'api.deepseek.com' else 'AITEXT_API_KEY')
        self.api_key = api_key or os.environ.get(env_key, '')
        if not isinstance(self.api_key, str) or not self.api_key.strip():
            raise ValueError(f'请填写当前服务商的 API Key，或设置 {env_key} 环境变量。')
        if '\n' in self.api_key or '\r' in self.api_key:
            raise ValueError('API Key 格式无效。')
        if not self.api_key.isascii():
            raise ValueError('API Key 中含有非英文字符，请检查是否误填了说明文字。')
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('API 地址须为不含凭据、查询参数和片段的 HTTP(S) 地址。')
        if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('远程 API 请使用 HTTPS。')
        endpoint = base_url.strip().rstrip('/')
        self.endpoint = endpoint if endpoint.endswith('/chat/completions') else endpoint + '/chat/completions'
        self.models_url = self.endpoint[:-len('/chat/completions')] + '/models'
        if not isinstance(model, str) or not model.strip() or len(model) > 200:
            raise ValueError('模型名无效。')
        if not isinstance(native, bool) or not isinstance(thinking, bool):
            raise ValueError('接入选项须为布尔值。')
        self.model, self.native, self.thinking = model.strip(), native, thinking
        self.adapter = adapter if adapter is not None else ('deepseek' if native else 'generic')
        if self.adapter not in ('generic', 'deepseek', 'enable_thinking', 'moonshot', 'glm', 'minimax'):
            raise ValueError('参数适配选项无效。')
        self.max_tokens = number(max_tokens, 8192, 128, 32768, integer=True)
        self.temperature = number(temperature, 0.9, 0, 2)
        self.timeout = number(timeout, 240, 1, 600)
        if transport not in ('system', 'direct'):
            raise ValueError('连接方式须为 system 或 direct。')
        self.opener = build_opener(ProxyHandler({})) if transport == 'direct' else build_opener()
        self.can_list_models, self.model_catalog, self.auth_check_url = True, False, None

    def request_json(self, payload=None, url=None, timeout=None):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
        req = Request(url or self.endpoint, data=data,
                      headers={'Authorization': 'Bearer ' + self.api_key.strip(), 'Content-Type': 'application/json'},
                      method='POST' if payload is not None else 'GET')
        try:
            with self.opener.open(req, timeout=timeout or self.timeout) as response:
                return json.loads(response.read().decode('utf-8'))
        except HTTPError as exc:
            status = exc.code
            exc.close()
            hints = {401: 'API Key 无效或无权限。', 402: '账户余额不足。', 404: '核对模型名与 API 地址。',
                     400: '核对参数；第三方平台可关闭 DeepSeek 专用参数。', 429: '请求频率超限，稍后重试。'}
            raise APIError(f'API 返回 HTTP {status}。' + hints.get(status, '服务异常，请稍后重试。')) from None
        except (URLError, TimeoutError, OSError, HTTPException) as exc:
            reason = getattr(exc, 'reason', exc)
            if isinstance(reason, ssl.SSLCertVerificationError):
                detail = 'HTTPS 证书校验失败。请检查电脑时间、代理证书及 Python 证书配置。'
            elif isinstance(reason, socket.gaierror):
                detail = 'API 域名解析失败。请核对地址并检查 DNS 或网络。'
            elif isinstance(reason, TimeoutError):
                detail = f'等待 API 超时（最多 {timeout or self.timeout:g} 秒）。请先测试连接；若连接正常，可缩短篇幅、关闭思考模式或增加等待上限。'
            elif isinstance(reason, ConnectionRefusedError) or getattr(reason, 'winerror', None) == 10061:
                detail = '连接被拒绝。若使用系统代理，请确认代理软件正在运行；也可在连接设置里选择直连后测试。受限环境启动的服务需在本机终端重新启动。'
            elif isinstance(reason, ssl.SSLError):
                detail = 'HTTPS 握手失败。请检查代理或网络连接。'
            elif isinstance(reason, (ConnectionResetError, HTTPException)):
                detail = 'API 连接中途断开。请先测试连接，再用较短任务重试。'
            else:
                detail = '无法连接 API。请检查网络、API 地址和代理状态，再点击测试连接。'
            raise APIError(detail) from None
        except (ValueError, UnicodeError):
            raise APIError('API 未返回有效 JSON。') from None

    def list_models(self):
        if not self.can_list_models:
            raise APIError('此服务商预设未启用模型列表检查。请选择预设或自定义模型，使用短任务验证连接。')
        raw = self.request_json(url=self.models_url, timeout=min(self.timeout, 20))
        if not isinstance(raw, dict) or not isinstance(raw.get('data'), list):
            raise APIError('模型列表接口未返回预期格式；第三方平台可能不支持 /models。')
        return sorted({item['id'] for item in raw['data'] if isinstance(item, dict)
                       and isinstance(item.get('id'), str) and 0 < len(item['id']) <= 200})

    def test_connection(self):
        if self.auth_check_url:
            auth = self.request_json(url=self.auth_check_url, timeout=min(self.timeout, 20))
            if not isinstance(auth, dict) or not isinstance(auth.get('data'), dict) or auth.get('error'):
                raise APIError('服务商未返回有效的密钥检查结果。')
        models = self.list_models()
        if self.model not in models:
            raise APIError('已连通并通过鉴权，但当前模型名不在账户的可用模型列表中。请核对平台提供的模型名。')
        message = ('密钥通过鉴权，当前模型在平台目录中；实际生成权限与可用性需通过写作确认。未生成作品。'
                   if self.model_catalog else '连接成功：密钥通过鉴权，当前模型可用。未生成作品。')
        return {'ok': True, 'models': models, 'message': message}

    def complete(self, messages, stage='draft'):
        payload = {'model': self.model, 'messages': messages, 'max_tokens': self.max_tokens, 'stream': False}
        if self.adapter == 'deepseek':
            payload['thinking'] = {'type': 'enabled' if self.thinking else 'disabled'}
        elif self.adapter == 'enable_thinking':
            payload['enable_thinking'] = self.thinking
        elif self.adapter == 'moonshot':
            # K3 and K2.7 require thinking and do not accept a disable switch.
            if self.model.startswith(('kimi-k2.6', 'kimi-k2.5')):
                payload['thinking'] = {'type': 'enabled' if self.thinking else 'disabled'}
        elif self.adapter == 'glm':
            payload['thinking'] = {'type': 'enabled'}
            payload['reasoning_effort'] = 'low'
        elif self.adapter == 'minimax':
            payload['reasoning_split'] = True
            if self.model == 'MiniMax-M3':
                payload['thinking'] = {'type': 'adaptive' if self.thinking else 'disabled'}
        if self.adapter not in ('moonshot', 'glm') and not (self.adapter != 'generic' and self.thinking):
            payload['temperature'] = self.temperature if stage == 'draft' else (0.35 if stage == 'review' else 0.7)
        raw = self.request_json(payload)
        try:
            choice = raw['choices'][0]
            content = choice['message']['content']
            finish = choice['finish_reason']
        except (KeyError, IndexError, TypeError):
            raise APIError('API 返回缺少正文或结束状态。') from None
        if not isinstance(content, str) or not content.strip():
            raise APIError('API 未返回文学正文；可能只有推理内容或内容被过滤。')
        if not isinstance(finish, str):
            raise APIError('API 返回结束状态无效。')
        usage = raw.get('usage')
        return {'text': content.strip(), 'finish_reason': finish, 'usage': usage if isinstance(usage, dict) else {}}


def normalize_usage(raw):
    """Keep reported counts, distinguish missing data from zero, derive total when possible."""
    usage = {}
    if isinstance(raw, dict):
        for key in ('prompt_tokens', 'completion_tokens', 'total_tokens'):
            value = raw.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991:
                usage[key] = value
    if 'total_tokens' not in usage and 'prompt_tokens' in usage and 'completion_tokens' in usage:
        usage['total_tokens'] = usage['prompt_tokens'] + usage['completion_tokens']
    return usage


def run_pipeline(task, client):
    """Yield progress/results so hosts can preserve completed stages on later errors."""
    task = normalize_task(task)
    results = {'draft': '', 'review': '', 'final': '', 'usage': {}, 'stage_usage': {}, 'complete': False, 'warning': ''}
    stages = ('draft',) if task['pipeline'] == 'single' or task['mode'] == 'diagnose' else ('draft', 'review', 'revise')
    for stage in stages:
        yield {'type': 'progress', 'stage': stage}
        try:
            value = client.complete(build_messages(task, stage, results['draft'], results['review']), stage=stage)
        except APIError as exc:
            results['warning'] = str(exc)
            yield {'type': 'error', 'stage': stage, 'result': results}
            return
        usage = normalize_usage(value.get('usage'))
        results['stage_usage'][stage] = usage
        for key, count in usage.items():
            results['usage'][key] = results['usage'].get(key, 0) + count
        slot = 'final' if stage == 'revise' else stage
        results[slot] = value['text']
        if stage == 'draft':
            results['final'] = value['text']
        yield {'type': 'stage', 'stage': stage, 'text': value['text'], 'usage': usage, 'usage_total': dict(results['usage'])}
        if value['finish_reason'] != 'stop':
            results['warning'] = ('输出达到 token 上限，已保留当前文本；请增加上限或缩短篇幅。'
                                  if value['finish_reason'] == 'length' else '生成未正常结束，已保留文本。结束状态：' + value['finish_reason'])
            yield {'type': 'result', 'result': results}
            return
    results['complete'] = True
    yield {'type': 'result', 'result': results}


def enhance_text(task, client):
    """Public adapter API. Returns draft, review, final, usage and completion state."""
    result = None
    for event in run_pipeline(task, client):
        if 'result' in event:
            result = event['result']
    return result


# Provider-neutral name; retain DeepSeekClient for existing integrations.
ModelClient = DeepSeekClient


def main():
    parser = argparse.ArgumentParser(description='ai文字 · 多模型文学增强插件')
    parser.add_argument('task', help='UTF-8 任务 JSON 文件')
    parser.add_argument('--output', help='结果 JSON 文件；默认输出到终端')
    parser.add_argument('--base-url', default='https://api.deepseek.com')
    parser.add_argument('--model', default='deepseek-flash')
    parser.add_argument('--generic', action='store_true', help='不发送 DeepSeek 专用参数')
    parser.add_argument('--thinking', action='store_true')
    args = parser.parse_args()
    try:
        task = normalize_task(json.loads(Path(args.task).read_text(encoding='utf-8-sig')))
        client = DeepSeekClient(base_url=args.base_url, model=args.model, native=not args.generic, thinking=args.thinking)
        result = enhance_text(task, client)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(output, encoding='utf-8')
        else:
            print(output)
        return 0 if result['complete'] else 1
    except (ValueError, OSError) as exc:
        parser.exit(2, str(exc) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
