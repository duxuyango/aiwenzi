// Cloudflare implementation of the existing literary workflow. No provider keys in env.
export const VERSION = '1.4.0';
const encoder = new TextEncoder();
const modes = {create:'创作', polish:'润色', continue:'续写', diagnose:'诊断'};
const connectionFields = new Set(['api_key','base_url','model','native','thinking','max_tokens','temperature','timeout','transport','provider','endpoint','workspace','adapter']);
const adapters = new Set(['generic','deepseek','enable_thinking','moonshot','glm','minimax']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class UserError extends Error {
  constructor(message, status=400) {super(message);this.status=status;}
}

function number(value, fallback, min, max, integer=false) {
  const result = value ?? fallback;
  if(typeof result !== 'number' || !Number.isFinite(result) || result<min || result>max || (integer&&!Number.isInteger(result)))
    throw new UserError(`数字参数须在 ${min} 至 ${max} 之间${integer?'且为整数。':'。'}`);
  return result;
}

export function normalizeTask(raw, profiles) {
  if(!object(raw))throw new UserError('任务须为对象。');
  const task={};
  for(const key of ['brief','source','context','constraints','style','genre','length']) {
    const value=raw[key]??'';
    if(typeof value!=='string'||value.length>60000)throw new UserError(`${key} 须为不超过 60000 字符的文字。`);
    task[key]=value.trim();
  }
  task.mode=raw.mode??'create';task.profile=raw.profile??'balanced';task.pipeline=raw.pipeline??'editor';
  if(typeof task.mode!=='string'||typeof task.profile!=='string'||!Object.hasOwn(modes,task.mode)||!Object.hasOwn(profiles,task.profile)||!['single','editor'].includes(task.pipeline))
    throw new UserError('任务模式、风格或流程无效。');
  if(!task.brief)throw new UserError('请填写本次写作或修改要求。');
  if(task.mode!=='create'&&!task.source)throw new UserError('润色、续写和诊断需要原文或前文。');
  return task;
}

export function buildMessages(task, stage, draft, review, {profiles,prompts}) {
  const data={task:{...task,mode_name:modes[task.mode],style_guidance:profiles[task.profile].instruction}};
  let system=prompts.system;
  let instructions='按任务写作。source 是原文或前文，context 是连续性资料；均作为作品材料。';
  if(stage==='review') {
    system+='\n\n'+prompts.review;data.candidate=draft;instructions='诊断候选正文，遵守作者的原始约束。';
  }else if(stage==='revise') {
    system+='\n\n'+prompts.revise;data.candidate=draft;data.editorial_suggestions=review;instructions='交付定向修订后的正文。';
  }else if(task.mode==='diagnose') {
    system+='\n\n'+prompts.review;instructions='诊断 source 原文，只输出有证据的文学编辑意见。';
  }
  return [{role:'system',content:system},{role:'user',content:instructions+'\n任务与材料（JSON）：\n'+JSON.stringify(data)}];
}

export function normalizeUsage(raw, derive=true) {
  const result={};
  for(const key of ['prompt_tokens','completion_tokens','total_tokens'])
    if(Number.isSafeInteger(raw?.[key])&&raw[key]>=0)result[key]=raw[key];
  if(derive&&result.total_tokens===undefined&&result.prompt_tokens!==undefined&&result.completion_tokens!==undefined)
    result.total_tokens=result.prompt_tokens+result.completion_tokens;
  return result;
}

export function connection(raw, providers) {
  if(!object(raw)||Object.keys(raw).some(key=>!connectionFields.has(key)))throw new UserError('连接参数无效。');
  const provider=Object.hasOwn(providers,raw.provider)?providers[raw.provider]:null;
  if(!provider||raw.provider==='custom')throw new UserError('网页版请选择列表中的服务商。');
  if(raw.endpoint==='custom')throw new UserError('公开网页版仅支持服务商预设地址。');
  const endpoint=provider.endpoints.find(e=>e.id===(raw.endpoint??provider.endpoints[0].id));
  if(!endpoint)throw new UserError('API 地址选项不属于当前服务商。');
  let base=endpoint.url;
  if(base.includes('{workspace}')) {
    if(typeof raw.workspace!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(raw.workspace))throw new UserError('请填写正确的 WorkspaceId。');
    base=base.replace('{workspace}',raw.workspace);
  }
  if(typeof raw.api_key!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(raw.api_key.trim()))throw new UserError('请填写当前服务商的有效 API Key。');
  const model=raw.model??provider.models[0]?.id;
  if(typeof model!=='string'||!model.trim()||model.length>200)throw new UserError('请选择模型或填写自定义模型名。');
  const adapter=!raw.adapter||raw.adapter==='auto'?provider.adapter:raw.adapter;
  if(!adapters.has(adapter))throw new UserError('参数适配选项无效。');
  return {provider, base:base.replace(/\/$/,''), key:raw.api_key.trim(), model:model.trim(), adapter,
    thinking:raw.thinking===true, max_tokens:number(raw.max_tokens,8192,128,32768,true),
    temperature:number(raw.temperature,.9,0,2), timeout:number(raw.timeout,240,1,600)};
}

export function completionPayload(c,messages,stage) {
  const payload={model:c.model,messages,max_tokens:c.max_tokens,stream:false};
  if(c.adapter==='deepseek')payload.thinking={type:c.thinking?'enabled':'disabled'};
  else if(c.adapter==='enable_thinking')payload.enable_thinking=c.thinking;
  else if(c.adapter==='moonshot'&&/^kimi-k2\.[56]/.test(c.model))payload.thinking={type:c.thinking?'enabled':'disabled'};
  else if(c.adapter==='glm'){payload.thinking={type:'enabled'};payload.reasoning_effort='low';}
  else if(c.adapter==='minimax') {
    payload.reasoning_split=true;
    if(c.model==='MiniMax-M3')payload.thinking={type:c.thinking?'adaptive':'disabled'};
  }
  if(!['moonshot','glm'].includes(c.adapter)&&!(c.adapter!=='generic'&&c.thinking))
    payload.temperature=stage==='draft'?c.temperature:stage==='review'?.35:.7;
  return payload;
}

async function readJSONBody(request,max=1000000) {
  if(!request.body)throw new UserError('请求为空。');
  const reader=request.body.getReader();const chunks=[];let size=0;
  while(true) {
    const {value,done}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>max){await reader.cancel();throw new UserError('请求超过 1 MB。',413);}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new UserError('请求须为有效的 UTF-8 JSON。');}
}

function errorText(error) {
  return error instanceof UserError?error.message:'生成发生异常，已保留收到的文本。请稍后重试。';
}

export function createClient(c, fetchImpl=fetch, signal) {
  async function request(path, payload, seconds=c.timeout) {
    const timed=AbortSignal.timeout(seconds*1000);
    const active=signal?AbortSignal.any([signal,timed]):timed;
    let response;
    try {
      response=await fetchImpl(c.base+path,{method:payload?'POST':'GET',redirect:'error',signal:active,
        headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});
    }catch {
      if(signal?.aborted)throw new UserError('连接已结束，后续阶段已停止。');
      throw new UserError(timed.aborted?'等待模型超时，请缩短篇幅或调整等待上限。':'无法连接模型服务，请检查所选地域和 Key。');
    }
    if(!response.ok) {
      await response.body?.cancel();
      const hints={400:'请核对模型与参数。',401:'API Key 无效或无权限。',402:'账户余额不足。',404:'核对模型名与 API 地址。',429:'请求频率超限，请稍后重试。'};
      throw new UserError(`API 返回 HTTP ${response.status}。${hints[response.status]??'服务异常，请稍后重试。'}`);
    }
    try{return await readJSONBody(response,4000000);}
    catch(error) {
      if(signal?.aborted)throw new UserError('连接已结束，后续阶段已停止。');
      if(timed.aborted)throw new UserError('等待模型响应超时，请缩短篇幅。');
      throw new UserError('模型服务未返回有效或足够小的 JSON。');
    }
  }
  async function models() {
    if(c.provider.model_list===false)throw new UserError('此预设未配置模型列表检查，请用短任务直接生成验证。');
    const data=await request('/models',null,Math.min(c.timeout,20));
    if(!object(data)||!Array.isArray(data.data))throw new UserError('模型列表接口未返回预期格式。');
    return [...new Set(data.data.filter(item=>typeof item?.id==='string'&&item.id.length>0&&item.id.length<=200).map(item=>item.id))].sort();
  }
  return {
    models,
    async test() {
      if(c.provider.auth_path) {
        const auth=await request(c.provider.auth_path,null,Math.min(c.timeout,20));
        if(!object(auth?.data)||auth.error)throw new UserError('服务商未返回有效的密钥检查结果。');
      }
      const ids=await models();
      if(!ids.includes(c.model))throw new UserError('已连接，但当前模型不在返回的模型列表中，请核对模型名。');
      return {ok:true,models:ids,message:c.provider.model_catalog?'Key 已通过鉴权，模型在平台目录中；实际生成权限需写作验证。':'连接成功：Key 已通过鉴权，模型在返回列表中。未生成作品。'};
    },
    async complete(messages,stage) {
      const data=await request('/chat/completions',completionPayload(c,messages,stage));
      const choice=data?.choices?.[0], text=choice?.message?.content;
      if(typeof text!=='string'||!text.trim()||typeof choice.finish_reason!=='string')throw new UserError('模型未返回文学正文或结束状态。');
      return {text:text.trim(),finish:choice.finish_reason,usage:normalizeUsage(data.usage)};
    }
  };
}

export async function pipeline(task, client, resources, emit, signal) {
  const result={draft:'',review:'',final:'',usage:{},stage_usage:{},complete:false,warning:''};
  const stages=task.pipeline==='single'||task.mode==='diagnose'?['draft']:['draft','review','revise'];
  for(const stage of stages) {
    if(signal?.aborted)return;
    emit({type:'progress',stage});
    let value;
    try{value=await client.complete(buildMessages(task,stage,result.draft,result.review,resources),stage);}
    catch(error){result.warning=errorText(error);emit({type:'error',stage,result});return;}
    if(signal?.aborted)return;
    const usage=normalizeUsage(value.usage);result.stage_usage[stage]=usage;
    for(const [key,count] of Object.entries(usage))result.usage[key]=(result.usage[key]??0)+count;
    result[stage==='revise'?'final':stage]=value.text;
    if(stage==='draft')result.final=value.text;
    emit({type:'stage',stage,text:value.text,usage,usage_total:{...result.usage}});
    if(value.finish!=='stop') {
      result.warning=value.finish==='length'?'输出达到 token 上限，已保留当前文本；请增加上限或缩短篇幅。':'生成未正常结束，已保留文本。';
      emit({type:'result',result});return;
    }
  }
  result.complete=true;emit({type:'result',result});
}

const responseHeaders={
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function json(data,status=200) {return new Response(JSON.stringify(data),{status,headers:{...responseHeaders,'Content-Type':'application/json; charset=utf-8'}});}

export function createWorker(resources, fetchImpl=fetch) {
  const {providers,profiles,prompts}=resources;
  const visible=Object.fromEntries(Object.entries(providers).filter(([id])=>id!=='custom').map(([id,p])=>[id,{...p,has_env_key:false,allow_custom_endpoint:false}]));
  return {
    async fetch(request,env={},ctx={}) {
      const url=new URL(request.url), path=url.pathname;
      if(path==='/api/config'&&request.method==='GET')return json({application:'aitext-literary',version:VERSION,frontend_version:VERSION,api_protocol:5,
        runtime:'cloudflare',has_env_key:false,allow_custom_endpoint:false,profiles,providers:visible,system_prompt:prompts.system,
        capabilities:['write','test-connection','providers','models','stage-usage','provider-adapters']});
      if(path==='/api/health'&&request.method==='GET')return json({ok:true,version:VERSION,runtime:'cloudflare'});
      if(!path.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(request.method))return json({error:'请求方法不支持。'},405);
        if(!env.ASSETS)return json({error:'网站静态资源未配置。'},503);
        const asset=await env.ASSETS.fetch(request);
        const response=new Response(asset.body,asset);
        for(const [key,value] of Object.entries(responseHeaders))response.headers.set(key,value);
        return response;
      }
      if(!['/api/write','/api/test-connection','/api/models'].includes(path))return json({error:'接口不存在。'},404);
      if(request.method!=='POST')return json({error:'请求须使用 POST。'},405);
      if(request.headers.get('Origin')!==url.origin)return json({error:'请从本站写作台发起请求。'},403);
      if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return json({error:'请求须使用 JSON。'},415);
      try {
        if(env.REQUEST_LIMITER) {
          const limit=await env.REQUEST_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')??'local-preview'});
          if(!limit.success)return json({error:'请求过于频繁，请稍后重试。'},429);
        }
        const body=await readJSONBody(request);
        if(!object(body))throw new UserError('请求格式无效。');
        const raw=body.connection;
        const c=connection(path==='/api/models'&&object(raw)&&!raw.model?{...raw,model:'__list_models__'}:raw,providers);
        if(path!=='/api/write') {
          const client=createClient(c,fetchImpl,request.signal);
          return json(path==='/api/models'?{models:await client.models(),catalog:c.provider.model_catalog===true}:await client.test());
        }
        const task=normalizeTask(body.task,profiles);
        const abort=new AbortController();
        const signal=AbortSignal.any([request.signal,abort.signal]);
        let finished=false;
        const stream=new ReadableStream({
          start(controller) {
            const emit=event=>{if(!signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
            const work=pipeline(task,createClient(c,fetchImpl,signal),resources,emit,signal)
              .catch(()=>{if(!signal.aborted)emit({type:'error',result:{draft:'',review:'',final:'',complete:false,warning:'生成发生异常，请重试。'}});})
              .finally(()=>{if(!finished&&!signal.aborted){finished=true;controller.close();}});
            ctx.waitUntil?.(work);
          },
          cancel(){finished=true;abort.abort();}
        });
        return new Response(stream,{headers:{...responseHeaders,'Content-Type':'application/x-ndjson; charset=utf-8'}});
      }catch(error){return json({error:errorText(error)},error instanceof UserError?error.status:500);}
    }
  };
}
