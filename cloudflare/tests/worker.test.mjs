import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWorker, connection, completionPayload, normalizeTask, normalizeUsage} from '../engine.mjs';

const load=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const resources={providers:JSON.parse(await load('providers.json')),profiles:JSON.parse(await load('profiles.json')),
  prompts:{system:await load('prompts/literary-system.txt'),review:await load('prompts/review.txt'),revise:await load('prompts/revise.txt')}};
const origin='https://writing.example';
const options=(extra={})=>({provider:'deepseek',endpoint:'official',model:'deepseek-flash',api_key:'test-private-key',...extra});
const task={brief:'写一个送别场景',constraints:'保留鸡蛋袋子',pipeline:'editor'};
const post=(path,body,headers={})=>new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
const reply=(text,finish='stop',usage={prompt_tokens:10,completion_tokens:20,total_tokens:30})=>Response.json({choices:[{message:{content:text,reasoning_content:'secret-reasoning'},finish_reason:finish}],usage});
const events=async response=>(await response.text()).trim().split('\n').map(line=>JSON.parse(line));

test('public config advertises nine providers, no custom URLs and no environment keys',async()=>{
  const worker=createWorker(resources);
  const config=await (await worker.fetch(new Request(origin+'/api/config'),{DEEPSEEK_API_KEY:'owner-secret'})).json();
  assert.equal(config.runtime,'cloudflare');assert.equal(config.api_protocol,5);
  assert.equal(config.has_env_key,false);assert.equal(Object.keys(config.providers).length,9);
  assert.equal(config.providers.custom,undefined);
  assert.ok(Object.values(config.providers).every(p=>p.has_env_key===false&&p.allow_custom_endpoint===false));
  assert.ok(!JSON.stringify(config).includes('owner-secret'));
});

test('reject missing visitor key, legacy URLs, custom endpoints and injected workspace hosts before fetch',async()=>{
  let calls=0;const worker=createWorker(resources,async()=>{calls++;throw Error('must not call');});
  const cases=[{base_url:'http://127.0.0.1',api_key:'test'},options({api_key:''}),options({provider:'custom',endpoint:'custom',base_url:'https://evil.test'}),
    options({endpoint:'custom',base_url:'https://127.0.0.1'}),options({provider:'qwen',endpoint:'beijing',workspace:'evil.com/../../'}),options({api_key:'bad\nkey'})];
  for(const c of cases){const response=await worker.fetch(post('/api/models',{connection:c}));assert.equal(response.status,400);}
  assert.equal(calls,0);
});

test('trusted preset resolves destination and ignores supplied base URL; redirect is never followed',async()=>{
  const calls=[];const worker=createWorker(resources,async(url,init)=>{calls.push([url,init]);return Response.json({data:[{id:'deepseek-flash'}]});});
  const response=await worker.fetch(post('/api/models',{connection:options({base_url:'https://evil.test/v1'})}));
  assert.equal(response.status,200);assert.equal(calls[0][0],'https://api.deepseek.com/models');
  assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].headers.Authorization,'Bearer test-private-key');
});

test('reject cross-origin, wrong method, malformed JSON, oversized bodies and unsupported content type',async()=>{
  const worker=createWorker(resources,()=>{throw Error('no network');});
  assert.equal((await worker.fetch(post('/api/write',{}, {Origin:'https://other.example'}))).status,403);
  assert.equal((await worker.fetch(new Request(origin+'/api/write'))).status,405);
  assert.equal((await worker.fetch(post('/api/write',{}, {'Content-Type':'text/plain'}))).status,415);
  const bad=new Request(origin+'/api/write',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{'});
  assert.equal((await worker.fetch(bad)).status,400);
  assert.equal((await worker.fetch(post('/api/write',{padding:'x'.repeat(1000001)}))).status,413);
});

test('request rate binding rejects before model calls and does not receive Key or work',async()=>{
  let calls=0;let limited;
  const worker=createWorker(resources,()=>{calls++;});
  const response=await worker.fetch(post('/api/write',{task,connection:options()},{'CF-Connecting-IP':'192.0.2.1'}),
    {REQUEST_LIMITER:{limit:async args=>{limited=args;return {success:false};}}});
  assert.equal(response.status,429);assert.equal(calls,0);assert.deepEqual(limited,{key:'192.0.2.1'});
});

test('three stages preserve constraints and return texts and token usage without reasoning',async()=>{
  const values=['初稿','编辑意见','最终稿'];const requests=[];
  const worker=createWorker(resources,async(url,init)=>{requests.push(JSON.parse(init.body));return reply(values.shift());});
  const response=await worker.fetch(post('/api/write',{task,connection:options()}));
  assert.match(response.headers.get('Content-Type'),/x-ndjson/);
  const items=await events(response), result=items.at(-1).result;
  assert.equal(result.final,'最终稿');assert.equal(result.complete,true);assert.equal(result.usage.total_tokens,90);
  assert.deepEqual(Object.keys(result.stage_usage),['draft','review','revise']);
  for(const payload of requests){assert.ok(payload.messages[1].content.includes('保留鸡蛋袋子'));assert.ok(!JSON.stringify(payload).includes('secret-reasoning'));}
  assert.ok(requests[2].messages[1].content.includes('编辑意见'));
  assert.ok(!JSON.stringify(items).includes('test-private-key'));
});

test('diagnosis always makes one call even when editor pipeline is selected',async()=>{
  let calls=0;const worker=createWorker(resources,async()=>{calls++;return reply('诊断意见');});
  const items=await events(await worker.fetch(post('/api/write',{task:{...task,mode:'diagnose',source:'原文'},connection:options()})));
  assert.equal(calls,1);assert.equal(items.at(-1).result.final,'诊断意见');assert.equal(items.at(-1).result.complete,true);
});

test('truncation stops later stages and keeps draft and usage',async()=>{
  let calls=0;const worker=createWorker(resources,async()=>{calls++;return reply('截断初稿','length');});
  const items=await events(await worker.fetch(post('/api/write',{task,connection:options()})));
  assert.equal(calls,1);assert.equal(items.at(-1).result.final,'截断初稿');
  assert.equal(items.at(-1).result.complete,false);assert.equal(items.at(-1).result.usage.total_tokens,30);
});

test('later stage HTTP failure keeps draft and usage and hides provider error bodies',async()=>{
  let calls=0;const worker=createWorker(resources,async()=>++calls===1?reply('初稿'):new Response('private body test-private-key',{status:401}));
  const items=await events(await worker.fetch(post('/api/write',{task,connection:options()})));
  const result=items.at(-1).result;assert.equal(result.final,'初稿');assert.equal(result.usage.total_tokens,30);
  assert.equal(result.complete,false);assert.match(result.warning,/401/);assert.ok(!JSON.stringify(items).includes('private body'));
});

test('missing usage remains unknown and zero usage is retained',()=>{
  assert.deepEqual(normalizeUsage(undefined),{});
  assert.deepEqual(normalizeUsage({prompt_tokens:0,completion_tokens:0}),{prompt_tokens:0,completion_tokens:0,total_tokens:0});
  assert.deepEqual(normalizeUsage({prompt_tokens:true,completion_tokens:-2,total_tokens:'3'}),{});
});

test('OpenRouter key authentication precedes public catalog and private label is never returned',async()=>{
  const calls=[];const worker=createWorker(resources,async(url)=>{calls.push(url);return Response.json(url.endsWith('/key')?{data:{label:'owner-private-label'}}:{data:[{id:'writer'}]});});
  const response=await worker.fetch(post('/api/test-connection',{connection:options({provider:'openrouter',model:'writer'})}));
  assert.equal(response.status,200);assert.deepEqual(calls,['https://openrouter.ai/api/v1/key','https://openrouter.ai/api/v1/models']);
  assert.ok(!(await response.text()).includes('owner-private-label'));
});

test('providers without model list do not send check requests',async()=>{
  let calls=0;const worker=createWorker(resources,async()=>{calls++;});
  for(const provider of ['minimax','zhipu','volcengine']) {
    const endpoint=resources.providers[provider].endpoints[0].id;
    const response=await worker.fetch(post('/api/models',{connection:options({provider,endpoint})}));assert.equal(response.status,400);
  }
  assert.equal(calls,0);
});

test('all provider payload adapters follow the same thinking and temperature rules as Python',()=>{
  const cases=[['moonshot','kimi-k3',false,{},false],['moonshot','kimi-k2.6',true,{thinking:{type:'enabled'}},false],
    ['zhipu','glm-5.3',false,{thinking:{type:'enabled'},reasoning_effort:'low'},false],
    ['minimax','MiniMax-M3',false,{thinking:{type:'disabled'},reasoning_split:true},true],
    ['minimax','MiniMax-M2.7',true,{reasoning_split:true},false],
    ['volcengine','doubao-seed-2-1-pro-260628',false,{thinking:{type:'disabled'}},true],
    ['gemini','gemini-3.8-flash',false,{},true]];
  for(const [provider,model,thinking,extra,temperature] of cases) {
    const c=connection(options({provider,endpoint:resources.providers[provider].endpoints[0].id,model,thinking}),resources.providers);
    const payload=completionPayload(c,[],'draft');assert.equal('temperature' in payload,temperature);
    for(const key of ['thinking','enable_thinking','reasoning_split','reasoning_effort'])assert.deepEqual(payload[key],extra[key]);
  }
});

test('invalid tasks and non-string enum values fail without requests',()=>{
  for(const value of [{brief:''},{brief:'写作',mode:['create']},{brief:'续写',mode:'continue'},{brief:'写作',profile:'toString'}])
    assert.throws(()=>normalizeTask(value,resources.profiles));
});

test('client cancellation aborts fetch and prevents further stages',async()=>{
  let calls=0;let aborted=false;
  const worker=createWorker(resources,async(url,init)=>{
    calls++;return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('private cancellation'));},{once:true}));
  });
  const response=await worker.fetch(post('/api/write',{task,connection:options()}));
  const reader=response.body.getReader();await reader.read();await reader.cancel();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(aborted,true);
});

test('static assets receive same-origin CSP and unsupported methods do not serve assets',async()=>{
  const worker=createWorker(resources);const env={ASSETS:{fetch:async()=>new Response('<html>ai文字</html>',{headers:{'Content-Type':'text/html'}})}};
  const response=await worker.fetch(new Request(origin+'/'),env);assert.equal(response.status,200);
  assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
  assert.equal((await worker.fetch(new Request(origin+'/',{method:'POST'}),env)).status,405);
});
