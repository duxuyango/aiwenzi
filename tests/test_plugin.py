import json
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import socket
import ssl
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from plugin import APIError, DeepSeekClient, build_messages, enhance_text, normalize_task, run_pipeline, normalize_usage
from server import Handler, LocalHTTPServer, API_PROTOCOL, VERSION
from providers import create_client, PROVIDERS


class MockAPI(BaseHTTPRequestHandler):
    requests = []
    replies = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.requests.append((self.path, body, self.headers['Authorization']))
        self.respond()

    def do_GET(self):
        self.requests.append((self.path, {}, self.headers.get('Authorization')))
        self.respond()

    def respond(self):
        status, payload = self.replies.pop(0)
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def reply(text, finish='stop'):
    return (200, {'choices': [{'message': {'content': text, 'reasoning_content': '不得传入后续正文的推理内容'}, 'finish_reason': finish}],
                  'usage': {'prompt_tokens': 10, 'completion_tokens': 20, 'total_tokens': 30}})


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = ThreadingHTTPServer(('127.0.0.1', 0), MockAPI)
        cls.web = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.threads = []
        for server in (cls.api, cls.web):
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            cls.threads.append(thread)
        cls.base = f'http://127.0.0.1:{cls.api.server_port}'
        cls.web_url = f'http://127.0.0.1:{cls.web.server_port}'

    @classmethod
    def tearDownClass(cls):
        for server in (cls.api, cls.web):
            server.shutdown()
            server.server_close()

    def setUp(self):
        MockAPI.requests = []
        MockAPI.replies = []
        self.client = DeepSeekClient(api_key='test-key', base_url=self.base, timeout=5)
        self.task = {'mode': 'polish', 'brief': '保留父女关系与事实，调整节奏。', 'source': '父亲站在门口。',
                     'constraints': '不能改变父女关系。', 'pipeline': 'editor'}

    def test_three_passes_preserve_constraints_and_separate_review(self):
        MockAPI.replies = [reply('初稿正文'), reply('编辑意见'), reply('修订正文')]
        result = enhance_text(self.task, self.client)
        self.assertTrue(result['complete'])
        self.assertEqual(result['draft'], '初稿正文')
        self.assertEqual(result['review'], '编辑意见')
        self.assertEqual(result['final'], '修订正文')
        self.assertEqual(result['usage']['total_tokens'], 90)
        self.assertEqual(len(MockAPI.requests), 3)
        for path, body, auth in MockAPI.requests:
            self.assertEqual(path, '/chat/completions')
            self.assertEqual(auth, 'Bearer test-key')
            self.assertEqual(body['model'], 'deepseek-flash')
            self.assertEqual(body['thinking'], {'type': 'disabled'})
            self.assertNotIn('reasoning_content', json.dumps(body))
            data = json.loads(body['messages'][1]['content'].split('任务与材料（JSON）：\n')[1])
            self.assertEqual(data['task']['constraints'], self.task['constraints'])
        data = json.loads(MockAPI.requests[2][1]['messages'][1]['content'].split('任务与材料（JSON）：\n')[1])
        self.assertEqual(data['candidate'], '初稿正文')
        self.assertEqual(data['editorial_suggestions'], '编辑意见')

    def test_diagnose_is_one_call_even_if_editor_selected(self):
        self.task['mode'] = 'diagnose'
        MockAPI.replies = [reply('意见')]
        result = enhance_text(self.task, self.client)
        self.assertTrue(result['complete'])
        self.assertEqual(len(MockAPI.requests), 1)

    def test_truncated_draft_stops_and_preserves_text(self):
        MockAPI.replies = [reply('半篇文本', 'length')]
        result = enhance_text(self.task, self.client)
        self.assertFalse(result['complete'])
        self.assertEqual(result['final'], '半篇文本')
        self.assertEqual(len(MockAPI.requests), 1)
        self.assertIn('token', result['warning'])

    def test_failure_preserves_finished_stages_without_retry_or_secret_leak(self):
        MockAPI.replies = [reply('初稿'), reply('意见'), (401, {'error': 'test-key sensitive body'})]
        result = enhance_text(self.task, self.client)
        self.assertFalse(result['complete'])
        self.assertEqual(result['final'], '初稿')
        self.assertEqual(result['review'], '意见')
        self.assertIn('401', result['warning'])
        self.assertNotIn('test-key', json.dumps(result))
        self.assertEqual(len(MockAPI.requests), 3)

    def test_native_thinking_omits_ineffective_temperature(self):
        self.client.thinking = True
        MockAPI.replies = [reply('正文')]
        self.client.complete(build_messages(self.task))
        body = MockAPI.requests[0][1]
        self.assertEqual(body['thinking'], {'type': 'enabled'})
        self.assertNotIn('temperature', body)

    def test_generic_accepts_full_endpoint_and_omits_native_parameters(self):
        client = DeepSeekClient(api_key='test-key', base_url=self.base+'/v1/chat/completions', native=False, model='platform-alias')
        MockAPI.replies = [reply('正文')]
        client.complete(build_messages(self.task))
        path, body, _ = MockAPI.requests[0]
        self.assertEqual(path, '/v1/chat/completions')
        self.assertEqual(body['model'], 'platform-alias')
        self.assertNotIn('thinking', body)

    def test_empty_content_is_failure(self):
        MockAPI.replies = [reply('')]
        with self.assertRaises(APIError):
            self.client.complete(build_messages(self.task))

    def test_network_errors_explain_the_actual_cause_without_secrets(self):
        cases = [(ConnectionRefusedError(10061, 'test-key'), '连接被拒绝'),
                 (TimeoutError('test-key'), '超时'),
                 (socket.gaierror(-2, 'test-key'), '域名解析失败'),
                 (ssl.SSLCertVerificationError('test-key'), '证书校验失败')]
        for reason, expected in cases:
            with self.subTest(reason=type(reason).__name__):
                with patch.object(self.client.opener, 'open', side_effect=URLError(reason)):
                    with self.assertRaises(APIError) as caught:
                        self.client.complete(build_messages(self.task))
                self.assertIn(expected, str(caught.exception))
                self.assertNotIn('test-key', str(caught.exception))

    def test_authenticated_connection_test_does_not_generate(self):
        MockAPI.replies = [(200, {'data': [{'id': 'deepseek-flash'}]})]
        self.assertTrue(self.client.test_connection()['ok'])
        self.assertEqual(MockAPI.requests[0][0], '/models')
        self.assertEqual(MockAPI.requests[0][1], {})

    def test_connection_test_identifies_unavailable_model(self):
        MockAPI.replies = [(200, {'data': [{'id': 'another-model'}]})]
        with self.assertRaises(APIError) as caught:
            self.client.test_connection()
        self.assertIn('当前模型名', str(caught.exception))

    def test_connection_test_route_needs_no_writing_task(self):
        MockAPI.replies = [(200, {'data': [{'id': 'deepseek-flash'}]})]
        body = {'connection': {'api_key': 'test-key', 'base_url': self.base, 'transport': 'direct', 'timeout': 30}}
        request = Request(self.web_url+'/api/test-connection', data=json.dumps(body).encode(),
                          headers={'Content-Type': 'application/json', 'Origin': self.web_url})
        with urlopen(request, timeout=5) as response:
            data = response.read().decode()
        self.assertTrue(json.loads(data)['ok'])
        self.assertNotIn('test-key', data)
        self.assertEqual(len(MockAPI.requests), 1)

    def test_bad_usage_does_not_break_result(self):
        value = reply('正文')[1]
        value['usage'] = ['invalid']
        MockAPI.replies = [(200, value)]
        self.task['pipeline'] = 'single'
        result = enhance_text(self.task, self.client)
        self.assertTrue(result['complete'])
        self.assertEqual(result['usage'], {})
        self.assertEqual(result['stage_usage'], {'draft': {}})

    def test_stage_usage_is_available_before_later_failure(self):
        MockAPI.replies = [reply('初稿'), reply('意见'), (401, {})]
        events = list(run_pipeline(self.task, self.client))
        stages = [event for event in events if event['type'] == 'stage']
        self.assertEqual(stages[0]['usage']['total_tokens'], 30)
        self.assertEqual(stages[0]['usage_total']['total_tokens'], 30)
        self.assertEqual(stages[1]['usage_total']['total_tokens'], 60)
        final = events[-1]['result']
        self.assertEqual(final['usage']['total_tokens'], 60)
        self.assertEqual(set(final['stage_usage']), {'draft', 'review'})
        self.assertFalse(final['complete'])

    def test_usage_preserves_zero_derives_total_and_rejects_invalid_counts(self):
        self.assertEqual(normalize_usage({'prompt_tokens':0, 'completion_tokens':20}),
                         {'prompt_tokens':0, 'completion_tokens':20, 'total_tokens':20})
        self.assertEqual(normalize_usage({'prompt_tokens':True, 'completion_tokens':-1, 'total_tokens':'30'}), {})
        self.assertEqual(normalize_usage({'prompt_tokens':7}), {'prompt_tokens':7})

    def test_missing_usage_is_not_added_as_zero_to_partial_totals(self):
        missing = reply('意见')[1]
        missing.pop('usage')
        MockAPI.replies = [reply('初稿'), (200,missing), reply('定稿')]
        result = enhance_text(self.task,self.client)
        self.assertEqual(result['stage_usage']['review'], {})
        self.assertEqual(result['usage']['total_tokens'],60)
        self.assertTrue(result['complete'])

    def test_task_validation_and_unsafe_endpoint(self):
        for task in ({'brief': ''}, {'mode': 'continue', 'brief': '续写'}, {'brief': '写作', 'mode': []}):
            with self.assertRaises(ValueError):
                normalize_task(task)
        for address in ('https://user:pass@example.com', 'https://example.com?key=secret', 'http://example.com', 'file:///etc/passwd'):
            with self.assertRaises(ValueError):
                DeepSeekClient(api_key='test-key', base_url=address)
        for value in (float('nan'), 1.5, True):
            with self.assertRaises(ValueError):
                DeepSeekClient(api_key='test-key', max_tokens=value)

    def test_web_returns_stage_stream_and_no_key_in_output(self):
        MockAPI.replies = [reply('初稿'), reply('意见'), reply('定稿')]
        data = {'task': self.task, 'connection': {'api_key': 'test-key', 'base_url': self.base}}
        request = Request(self.web_url+'/api/write', data=json.dumps(data).encode(),
                          headers={'Content-Type': 'application/json', 'Origin': self.web_url})
        with urlopen(request, timeout=10) as response:
            text = response.read().decode()
            events = [json.loads(line) for line in text.splitlines()]
        self.assertTrue(events[-1]['result']['complete'])
        self.assertEqual(events[-1]['result']['final'], '定稿')
        self.assertNotIn('test-key', text)
        self.assertEqual([event['stage'] for event in events if event['type']=='progress'], ['draft', 'review', 'revise'])

    def test_web_rejects_cross_origin_without_api_call(self):
        request = Request(self.web_url+'/api/write', data=b'{}',
                          headers={'Content-Type': 'application/json', 'Origin': 'https://other.example'})
        with self.assertRaises(HTTPError) as caught:
            urlopen(request, timeout=5)
        self.assertEqual(caught.exception.code, 403)
        caught.exception.close()
        self.assertEqual(MockAPI.requests, [])

    def test_config_and_static_page(self):
        with urlopen(self.web_url+'/api/config', timeout=5) as response:
            config = json.loads(response.read())
        self.assertIn('balanced', config['profiles'])
        self.assertNotIn('api_key', config)
        self.assertEqual(config['api_protocol'], API_PROTOCOL)
        self.assertEqual(config['version'], VERSION)
        self.assertIn('test-connection', config['capabilities'])
        self.assertIn('providers', config['capabilities'])
        self.assertIn('stage-usage', config['capabilities'])
        self.assertIn('deepseek-v4-pro', [item['id'] for item in config['providers']['deepseek']['models']])
        with urlopen(self.web_url, timeout=5) as response:
            self.assertIn('ai文字', response.read().decode())
        with urlopen(self.web_url+'/state.js', timeout=5) as response:
            self.assertIn('AiTextState', response.read().decode())

    def test_only_one_backend_can_own_a_port(self):
        server = LocalHTTPServer(('127.0.0.1', 0), Handler)
        try:
            with self.assertRaises(OSError):
                duplicate = LocalHTTPServer(('127.0.0.1', server.server_port), Handler)
                duplicate.server_close()
        finally:
            server.server_close()

    def test_provider_presets_and_request_adapters(self):
        cases = [
            ({'provider':'deepseek','model':'deepseek-v4-pro'}, 'https://api.deepseek.com/chat/completions', 'thinking'),
            ({'provider':'qwen','endpoint':'beijing','workspace':'w-example','model':'qwen3.8-max'},
             'https://w-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions', 'enable_thinking'),
            ({'provider':'siliconflow','model':'deepseek-ai/DeepSeek-V4-Pro'},
             'https://api.siliconflow.cn/v1/chat/completions', 'enable_thinking'),
        ]
        for options, endpoint, field in cases:
            with self.subTest(provider=options['provider']):
                client=create_client({**options, 'api_key':'test-key'})
                data=json.dumps(reply('正文')[1]).encode()
                with patch.object(client.opener,'open',return_value=io.BytesIO(data)) as opened:
                    client.complete(build_messages(self.task))
                request=opened.call_args.args[0]
                self.assertEqual(request.full_url,endpoint)
                payload=json.loads(request.data)
                self.assertEqual(payload['model'],options['model'])
                self.assertIn(field,payload)
                self.assertEqual(payload[field],{'type':'disabled'} if field=='thinking' else False)
                self.assertNotIn('thinking' if field=='enable_thinking' else 'enable_thinking',payload)

    def test_environment_keys_are_scoped_to_selected_provider(self):
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY':'deepseek-private-key'}, clear=True):
            with self.assertRaises(ValueError):
                create_client({'provider':'siliconflow','model':'some-model'})
            with self.assertRaises(ValueError):
                create_client({'provider':'deepseek','endpoint':'custom','base_url':'https://third.example/v1','model':'some-model'})
            with self.assertRaises(ValueError):
                DeepSeekClient(base_url='https://third.example/v1')
            self.assertEqual(create_client({'provider':'deepseek'}).api_key,'deepseek-private-key')
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY':'deepseek-private-key','DASHSCOPE_API_KEY':'qwen-private-key'}, clear=True):
            client=create_client({'provider':'qwen','endpoint':'legacy-beijing','model':'qwen-plus'})
            self.assertEqual(client.api_key,'qwen-private-key')

    def test_custom_endpoint_does_not_inherit_native_adapter(self):
        client=create_client({'provider':'deepseek','endpoint':'custom','base_url':self.base,'model':'local-model','api_key':'test-key'})
        self.assertEqual(client.adapter,'generic')
        MockAPI.replies=[reply('正文')]
        client.complete(build_messages(self.task))
        self.assertNotIn('thinking',MockAPI.requests[0][1])
        self.assertNotIn('enable_thinking',MockAPI.requests[0][1])

    def test_invalid_workspace_and_wrong_provider_endpoint_are_rejected(self):
        for workspace in ('', 'example.com/path', 'a?token=secret'):
            with self.assertRaises(ValueError):
                create_client({'provider':'qwen','workspace':workspace,'api_key':'test-key'})
        with self.assertRaises(ValueError):
            create_client({'provider':'deepseek','endpoint':'cn','api_key':'test-key'})

    def test_fetch_models_without_selecting_a_model(self):
        MockAPI.replies=[(200,{'data':[{'id':'writer-b'},{'id':'writer-a'},{'id':'writer-a'},{'id':123}]})]
        connection={'provider':'custom','endpoint':'custom','base_url':self.base,'api_key':'test-key','model':''}
        request=Request(self.web_url+'/api/models',data=json.dumps({'connection':connection}).encode(),
                        headers={'Content-Type':'application/json','Origin':self.web_url})
        with urlopen(request,timeout=5) as response:
            result=json.loads(response.read())
        self.assertEqual(result['models'],['writer-a','writer-b'])
        self.assertEqual(MockAPI.requests[0][0],'/models')
        self.assertEqual(len(MockAPI.requests),1)

    def test_generic_override_omits_provider_specific_parameters(self):
        client=create_client({'provider':'qwen','endpoint':'legacy-beijing','adapter':'generic','api_key':'test-key'})
        data=json.dumps(reply('正文')[1]).encode()
        with patch.object(client.opener,'open',return_value=io.BytesIO(data)) as opened:
            client.complete(build_messages(self.task))
        payload=json.loads(opened.call_args.args[0].data)
        self.assertNotIn('enable_thinking',payload)
        self.assertNotIn('thinking',payload)

    def test_new_providers_resolve_endpoints_and_isolate_credentials(self):
        with patch.dict('os.environ', {'DEEPSEEK_API_KEY':'do-not-forward-this'}, clear=True):
            for provider_id in ('moonshot','zhipu','minimax','volcengine','gemini','openrouter'):
                provider=PROVIDERS[provider_id]
                for endpoint in provider['endpoints']:
                    options={'provider':provider_id,'endpoint':endpoint['id'],'model':provider['models'][0]['id'] if provider['models'] else 'catalog-model'}
                    with self.subTest(provider=provider_id,endpoint=endpoint['id']):
                        with self.assertRaises(ValueError):
                            create_client(options)
                        with patch.dict('os.environ',{provider['env_key']:'provider-only-key'}):
                            client=create_client(options)
                        self.assertEqual(client.api_key,'provider-only-key')
                        self.assertEqual(client.endpoint,endpoint['url']+'/chat/completions')
                        self.assertEqual(client.can_list_models,provider.get('model_list',True))

    def test_provider_specific_thinking_modes_and_reasoning_separation(self):
        cases=[('moonshot','kimi-k3',False,{},False),
               ('moonshot','kimi-k2.6',False,{'thinking':{'type':'disabled'}},False),
               ('moonshot','kimi-k2.6',True,{'thinking':{'type':'enabled'}},False),
               ('zhipu','glm-5.3',False,{'thinking':{'type':'enabled'},'reasoning_effort':'low'},False),
               ('minimax','MiniMax-M3',False,{'thinking':{'type':'disabled'},'reasoning_split':True},True),
               ('minimax','MiniMax-M3',True,{'thinking':{'type':'adaptive'},'reasoning_split':True},False),
               ('minimax','MiniMax-M2.7',True,{'reasoning_split':True},False),
               ('volcengine','doubao-seed-2-1-pro-260628',False,{'thinking':{'type':'disabled'}},True),
               ('gemini','gemini-3.8-flash',False,{},True),
               ('openrouter','catalog-model',False,{},True)]
        for provider,model,thinking,extra,temperature in cases:
            with self.subTest(provider=provider,model=model,thinking=thinking):
                client=create_client({'provider':provider,'model':model,'thinking':thinking,'api_key':'test-key'})
                with patch.object(client.opener,'open',return_value=io.BytesIO(json.dumps(reply('正文')[1]).encode())) as opened:
                    value=client.complete(build_messages(self.task))
                payload=json.loads(opened.call_args.args[0].data)
                self.assertEqual(value['text'],'正文')
                self.assertEqual('temperature' in payload,temperature)
                for key in ('thinking','enable_thinking','reasoning_effort','reasoning_split'):
                    if key in extra:self.assertEqual(payload[key],extra[key])
                    else:self.assertNotIn(key,payload)

    def test_presets_without_model_list_do_not_send_network_requests(self):
        for provider in ('zhipu','minimax','volcengine'):
            client=create_client({'provider':provider,'api_key':'test-key'})
            with patch.object(client.opener,'open') as opened:
                with self.assertRaises(APIError):client.list_models()
                with self.assertRaises(APIError):client.test_connection()
                opened.assert_not_called()

    def test_openrouter_public_catalog_does_not_count_as_authentication(self):
        client=create_client({'provider':'openrouter','model':'writer','api_key':'test-key'})
        with patch.object(client,'request_json',side_effect=APIError('API 返回 HTTP 401。')) as request:
            with self.assertRaises(APIError):client.test_connection()
            self.assertEqual(request.call_args.kwargs['url'],'https://openrouter.ai/api/v1/key')
            self.assertEqual(request.call_count,1)
        responses=[{'data':{'label':'private-label'}},{'data':[{'id':'writer'}]}]
        with patch.object(client,'request_json',side_effect=responses) as request:
            result=client.test_connection()
        self.assertTrue(result['ok'])
        self.assertIn('平台目录',result['message'])
        self.assertNotIn('private-label',json.dumps(result))
        self.assertEqual(request.call_args_list[1].kwargs['url'],'https://openrouter.ai/api/v1/models')

    def test_custom_endpoint_does_not_inherit_preset_auth_or_model_list_limit(self):
        for provider in ('openrouter','minimax','zhipu'):
            client=create_client({'provider':provider,'endpoint':'custom','base_url':self.base,'model':'writer','api_key':'test-key'})
            self.assertTrue(client.can_list_models)
            self.assertFalse(client.model_catalog)
            self.assertIsNone(client.auth_check_url)
            self.assertEqual(client.adapter,'generic')


if __name__ == '__main__':
    unittest.main()
