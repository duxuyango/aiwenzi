"""Trusted presets and provider-scoped connection resolution."""
import json
import os
from pathlib import Path
import re

from plugin import DeepSeekClient

PROVIDERS = json.loads((Path(__file__).resolve().parent / 'providers.json').read_text(encoding='utf-8'))
CONNECTION_FIELDS = {'api_key', 'base_url', 'model', 'native', 'thinking', 'max_tokens', 'temperature',
                     'timeout', 'transport', 'provider', 'endpoint', 'workspace', 'adapter'}


def public_providers():
    return {key: {**value, 'has_env_key': bool(os.environ.get(value['env_key']))}
            for key, value in PROVIDERS.items()}


def create_client(options):
    if not isinstance(options, dict) or set(options) - CONNECTION_FIELDS:
        raise ValueError('连接参数无效。')
    options = dict(options)
    provider_id = options.pop('provider', None)
    # Existing Python/API integrations can continue sending their original fields.
    if provider_id is None:
        options.pop('endpoint', None)
        options.pop('workspace', None)
        return DeepSeekClient(**options)
    if not isinstance(provider_id, str) or provider_id not in PROVIDERS:
        raise ValueError('服务商选项无效。')
    provider = PROVIDERS[provider_id]
    endpoint_id = options.pop('endpoint', 'custom' if provider_id == 'custom' else provider['endpoints'][0]['id'])
    workspace = options.pop('workspace', '')
    custom_endpoint = endpoint_id == 'custom'
    if custom_endpoint:
        if not options.get('base_url'):
            raise ValueError('请填写自定义 API 地址。')
        env_key = 'AITEXT_API_KEY'
        default_adapter = 'generic'
    else:
        endpoint = next((item for item in provider['endpoints'] if item['id'] == endpoint_id), None)
        if endpoint is None:
            raise ValueError('API 地址选项不属于当前服务商。')
        address = endpoint['url']
        if '{workspace}' in address:
            if not isinstance(workspace, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,62}', workspace):
                raise ValueError('请填写正确的业务空间 ID（WorkspaceId）。')
            address = address.replace('{workspace}', workspace)
        options['base_url'] = address
        env_key = provider['env_key']
        default_adapter = provider['adapter']
    adapter = options.pop('adapter', 'auto')
    options['adapter'] = default_adapter if adapter == 'auto' else adapter
    options['env_key'] = env_key
    options.setdefault('model', provider['models'][0]['id'] if provider['models'] else '')
    client = DeepSeekClient(**options)
    if not custom_endpoint:
        client.can_list_models = provider.get('model_list', True)
        client.model_catalog = provider.get('model_catalog', False)
        if provider.get('auth_path'):
            client.auth_check_url = options['base_url'].rstrip('/') + provider['auth_path']
    return client
