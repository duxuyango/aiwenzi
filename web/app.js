'use strict';
const $ = id => document.getElementById(id);
let config = null, activeTab = 'final', result = {draft:'',review:'',final:''}, busy = false, connectionBusy = false;
const stages = {draft:'正在写初稿',review:'正在做文学诊断',revise:'正在定向修订'};
const State=AiTextState, SETTINGS_KEY='aitext.profiles.v1', USAGE_KEY='aitext.usage.v1';
let savedSettings={version:1,selected:'',profiles:[]}, ledger={version:1,rows:[]}, applyingSettings=false;
let currentStages={}, currentUsage={}, usageRun=null, ledgerStorageError='';
function readLocal(key) {
  const value=localStorage.getItem(key);
  if(value===null)return null;
  try{return JSON.parse(value);}catch{throw new Error('本机保存的数据无法读取；当前页面仍可使用。');}
}
function writeLocal(key,value) {localStorage.setItem(key,JSON.stringify(value));}
function settingsMessage(text) {$('settings-status').textContent=text;}
function credentialScope() {
  const c=connectionData(), endpoint=providerData()?.endpoints.find(e=>e.id===c.endpoint);
  const address=c.endpoint==='custom'?c.base_url:endpoint?.url.replace('{workspace}',c.workspace)||'';
  return JSON.stringify([c.provider,c.endpoint,address.replace(/\/$/,'')]);
}
function renderSavedSettings() {
  $('saved-profile').replaceChildren(new Option('当前设置（未载入配置）',''),...savedSettings.profiles.map(p=>new Option(p.name,p.id)));
  $('saved-profile').value=savedSettings.selected;
  const selected=savedSettings.profiles.some(p=>p.id===$('saved-profile').value);
  $('update-profile').disabled=!selected;$('delete-profile').disabled=!selected;
}
function markSettingsChanged() {
  if(!applyingSettings) settingsMessage('当前设置已更改；点击“更新所选配置”或“保存为新配置”后保留。');
}
function saveSettings(update=false) {
  try {
    if(!config)throw new Error('请先等待后台载入。');
    const name=$('profile-name').value.trim();if(!name)throw new Error('请为配置填写名称。');
    const id=update?$('saved-profile').value:crypto.randomUUID();
    if(update&&!savedSettings.profiles.some(p=>p.id===id))throw new Error('请先选择要更新的配置。');
    if(!update&&savedSettings.profiles.length>=50)throw new Error('最多保存 50 套配置，请更新或删除已有配置。');
    const c=connectionData();
    if(!c.model)throw new Error('请选择模型或填写自定义模型名。');
    if(c.endpoint==='custom') {
      let url;try{url=new URL(c.base_url);}catch{throw new Error('请填写有效的自定义 API 地址。');}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('API 地址须为不含凭据或查询参数的 HTTP(S) 地址。');
    }
    if(providerData()?.endpoints.find(e=>e.id===c.endpoint)?.url.includes('{workspace}')&&!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(c.workspace))throw new Error('请先填写正确的 WorkspaceId。');
    const writing={};for(const key of ['mode','genre','profile','pipeline','length','style'])writing[key]=$(key).value;
    const item=State.profile({id,name,connection:c,writing,rememberKey:$('remember-key').checked,credentialScope:credentialScope()},config.providers);
    if(!item)throw new Error('配置无效，请检查连接选项。');
    const profiles=update?savedSettings.profiles.map(p=>p.id===id?item:p):[...savedSettings.profiles,item];
    const next={version:1,selected:id,profiles};writeLocal(SETTINGS_KEY,next);savedSettings=next;renderSavedSettings();
    settingsMessage(`已${update?'更新':'保存'}“${item.name}”。${item.connection.api_key?'包含本机保存的 Key。':'API Key 未保存，切换时需填写或使用环境变量。'}`);
  }catch(error){settingsMessage(error.message||'保存失败，浏览器可能禁用了本地存储。');}
}
function applySettings(item) {
  applyingSettings=true;
  try {
    const c=item.connection;
    clearCredential();$('provider').value=c.provider;providerChanged(false);
    $('base-url').value=c.endpoint;$('workspace').value=c.workspace;$('custom-base-url').value=c.base_url;
    $('adapter').value=c.adapter;$('thinking').checked=c.thinking;
    for(const [id,key] of [['transport','transport'],['timeout','timeout'],['max-tokens','max_tokens'],['temperature','temperature']])$(id).value=c[key];
    const models=[...providerData().models];if(c.model&&!models.some(m=>m.id===c.model))models.push({id:c.model,name:c.model});
    renderModelChoices(models,c.model);endpointChanged(false);
    // A stored credential belongs to its exact saved API destination.
    const keyMatches=item.credentialScope===credentialScope();
    $('api-key').value=keyMatches?c.api_key||'':'';
    $('remember-key').checked=item.rememberKey;$('profile-name').value=item.name;
    for(const [key,value] of Object.entries(item.writing)) {
      const element=$(key);
      if(element.tagName!=='SELECT'||[...element.options].some(o=>o.value===value))element.value=value;
    }
    taskChanged();connectionChanged();
    savedSettings.selected=item.id;renderSavedSettings();
    $('test-result').textContent=supportsModelList()?'已载入配置，连接尚未测试。':'此预设未配置模型列表检查；填写 Key 并选择模型后，用短任务生成验证连接。';
    settingsMessage(`已载入“${item.name}”。${c.api_key&&keyMatches?'已恢复此地址的 Key。':'请填写当前服务商的 Key，或使用环境变量。'}`);
    try{writeLocal(SETTINGS_KEY,savedSettings);}catch{settingsMessage('配置已载入，但浏览器未能记住本次选择。');}
  }finally{applyingSettings=false;}
}
function tokenText(value) {return Number.isSafeInteger(value)?value.toLocaleString('zh-CN'):'—';}
function usageCells(row,label,value) {
  for(const content of [label,tokenText(value.prompt_tokens),tokenText(value.completion_tokens),tokenText(value.total_tokens)]) {
    const cell=document.createElement('td');cell.textContent=content;row.append(cell);
  }
}
function renderUsage() {
  $('input-tokens').textContent=tokenText(currentUsage.prompt_tokens);
  $('output-tokens').textContent=tokenText(currentUsage.completion_tokens);
  $('total-tokens').textContent=tokenText(currentUsage.total_tokens);
  const rows=Object.entries(currentStages).map(([stage,value])=>{
    const row=document.createElement('tr');
    usageCells(row,stage==='draft'&&usageRun?.diagnose?'文学诊断':({draft:'初稿',review:'编辑诊断',revise:'定向修订'}[stage]||stage),value);return row;
  });
  if(!rows.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.textContent=usageRun?(usageRun.finished?'未收到已完成阶段的用量，无法统计。':'正在等待阶段完成……'):'阶段结束后显示服务商返回的用量。';row.append(cell);rows.push(row);}
  $('stage-usage').replaceChildren(...rows);
  const missing=Object.values(currentStages).some(v=>['prompt_tokens','completion_tokens','total_tokens'].some(k=>v[k]===undefined));
  $('usage').textContent=missing?'部分阶段未返回完整用量；“—”表示未知，合计只包含已返回的数字。':usageRun?'已完成阶段的 API 用量；包含提示词与编辑材料，token 与中文字数不同。':'数字来自 API，包含提示词与编辑材料；token 与中文字数不同。';
}
function renderLedger() {
  let total={},calls=0,missing=0;
  const rows=ledger.rows.map(item=>{
    total=State.addUsage(total,item.usage,false);calls+=item.calls;missing+=item.missing;
    const row=document.createElement('tr');usageCells(row,`${config?.providers?.[item.provider]?.name||item.provider} / ${item.model}`,item.usage);return row;
  });
  if(!rows.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.textContent='尚无用量记录。';row.append(cell);rows.push(row);}
  $('history-rows').replaceChildren(...rows);
  $('history-total').textContent=calls?`${tokenText(total.total_tokens)} tokens · ${calls} 次请求`:'暂无记录';
  $('history-note').textContent=`仅统计本浏览器已收到的请求用量，不代表账户账单或余额。${missing?`其中 ${missing} 次未返回完整用量，合计可能不完整。`:''}${ledgerStorageError}`;
  $('clear-usage').disabled=!calls||busy;
}
function receiveUsage(stage,raw) {
  if(!usageRun || usageRun.seen.has(stage))return;
  usageRun.seen.add(stage);const value=State.usage(raw);currentStages[stage]=value;currentUsage=State.addUsage(currentUsage,value);
  State.recordUsage(ledger,usageRun.provider,usageRun.model,value);
  try{writeLocal(USAGE_KEY,ledger);ledgerStorageError='';}catch{ledgerStorageError='浏览器未能保存累计记录，当前页面的用量仍可查看。';}
  renderUsage();renderLedger();
}
async function checkBackend() {
  const response=await fetch('/api/config',{cache:'no-store'});
  if(!response.ok) throw new Error('无法连接本地后台，请重新启动ai文字。');
  const state=await response.json();
  if(state.api_protocol!==5 || !state.capabilities?.includes('provider-adapters')) {
    $('backend-version').textContent='页面与后台版本不一致';
    throw new Error('当前后台仍是旧版本。请先下载需要保留的稿件，关闭旧的ai文字启动窗口，再用更新后的启动器重启；仅刷新页面不能更新后台。');
  }
  config=state;
  $('backend-version').textContent=`ai文字 1.3.1 · 后台 ${state.version} · 已匹配`;
  return state;
}
function taskData() {
  const task = {};
  for (const key of ['mode','genre','brief','source','profile','length','style','context','constraints','pipeline']) task[key] = $(key).value.trim();
  return task;
}
function validateTask(task) {
  if (!task.brief) throw new Error('请先填写写作或修改要求。');
  if (task.mode !== 'create' && !task.source) throw new Error('本次任务需要原文或前文。');
}
function connectionData() {
  return {provider:$('provider').value,endpoint:$('base-url').value,workspace:$('workspace').value.trim(),
    api_key:$('api-key').value.trim(),base_url:$('custom-base-url').value.trim(),
    model:$('model').value==='custom'?$('custom-model').value.trim():$('model').value,
    adapter:$('adapter').value,thinking:$('thinking').checked,max_tokens:Number($('max-tokens').value),
    temperature:Number($('temperature').value),transport:$('transport').value,timeout:Number($('timeout').value)};
}
function providerData() { return config?.providers?.[$('provider').value]; }
function currentAdapter() {
  return $('adapter').value!=='auto'?$('adapter').value:($('base-url').value==='custom'?'generic':providerData()?.adapter||'generic');
}
function supportsModelList() {return $('base-url').value==='custom'||providerData()?.model_list!==false;}
function hasEnvironmentKey() {
  return ($('base-url').value==='custom'?config?.providers?.custom:providerData())?.has_env_key;
}
function clearCredential() {
  $('api-key').value='';
  $('test-result').textContent='连接已更改，请使用当前服务商的 Key 后测试。';
}
function renderModelChoices(models, current='') {
  const options=models.map(item=>new Option(item.name&&item.name!==item.id?`${item.name} · ${item.id}`:item.id,item.id));
  options.push(new Option('自定义模型名…','custom'));
  $('model').replaceChildren(...options);
  if(models.some(item=>item.id===current)) $('model').value=current;
  $('custom-model-wrap').hidden=$('model').value!=='custom';
  $('custom-model').required=$('model').value==='custom';
  connectionChanged();
}
function renderFetchedModels(ids) {
  const previous=connectionData().model, presets=providerData()?.models||[];
  const models=ids.map(id=>presets.find(item=>item.id===id)||{id,name:id});
  if(previous&&!ids.includes(previous)) models.unshift({id:previous,name:'当前选择（未在账户列表中）'});
  renderModelChoices(models,previous);
}
function endpointChanged(clearKey=true) {
  if(clearKey) clearCredential();
  const endpoint=providerData()?.endpoints?.find(item=>item.id===$('base-url').value);
  const custom=$('base-url').value==='custom', workspace=!!endpoint?.url.includes('{workspace}');
  $('custom-url-wrap').hidden=!custom;$('custom-base-url').required=custom;
  $('workspace-wrap').hidden=!workspace;$('workspace').required=workspace;
  $('resolved-url').textContent=custom?($('custom-base-url').value.trim()||'请填写自定义 API 地址。'):
    endpoint?.url.replace('{workspace}',$('workspace').value.trim()||'{WorkspaceId}')||'';
  $('api-key').placeholder=`当前地址的 Key；也可设置 ${custom?'AITEXT_API_KEY':providerData()?.env_key||'AITEXT_API_KEY'}`;
  if(!supportsModelList())$('test-result').textContent='此预设未配置模型列表检查；填写 Key 并选择模型后，用短任务生成验证连接。';
  connectionChanged();
}
function providerChanged(clearKey=true) {
  const provider=providerData();if(!provider)return;
  if(clearKey) clearCredential();
  $('base-url').replaceChildren(...provider.endpoints.map(item=>new Option(`${item.name} · ${item.url}`,item.id)),new Option('自定义 API 地址…','custom'));
  $('workspace').value='';$('custom-base-url').value='';$('custom-model').value='';
  $('adapter').value='auto';$('thinking').checked=false;
  $('provider-note').textContent=provider.note;
  $('provider-docs').hidden=!provider.docs_url;
  $('provider-docs').href=provider.docs_url||'#';
  $('api-key').placeholder=`当前服务商的 Key；也可设置 ${provider.env_key}`;
  renderModelChoices(provider.models);
  endpointChanged(false);
}
function notice(text='') { $('notice').textContent = text; $('notice').hidden = !text; }
function render() {
  const text = result[activeTab] || '';
  $('output').textContent = text; $('output').hidden = !text; $('empty').hidden = !!text;
  $('count').textContent = `${Array.from(text.replace(/\s/g,'')).length} 字符（含标点）`;
  $('copy').disabled = !text; $('download').disabled = !text;
  $('download-all').disabled = !result.draft && !result.review && !result.final;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === activeTab));
    button.tabIndex = button.dataset.tab === activeTab ? 0 : -1;
  }
}
function selectTab(tab) { activeTab = tab; render(); }
function download(name, text, type='text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const a = document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function taskChanged() {
  const diagnostic = $('mode').value === 'diagnose';
  $('source').required = $('mode').value !== 'create';
  $('source-note').textContent = $('mode').value === 'create' ? '创作时可选' : '本次任务必填';
  $('pipeline').disabled = diagnostic;
  $('pipeline-hint').textContent = diagnostic ? '文学诊断只调用 API 一次，不改写原文。' : ($('pipeline').value === 'editor' ? '编辑流程通常调用 API 三次。适合逐段打磨；建议每次约 5000 字以内。' : '直接生成只调用 API 一次，按写作指令检查并交付正文。');
}
function connectionChanged() {
  const adapter=currentAdapter();
  const model=connectionData().model;
  const required=adapter==='glm'||(adapter==='moonshot'&&model.startsWith('kimi-')&&!model.startsWith('kimi-k2.6')&&!model.startsWith('kimi-k2.5'))||
    (adapter==='minimax'&&model!=='MiniMax-M3');
  $('thinking').disabled=adapter==='generic'||required;
  if(adapter==='generic') $('thinking').checked=false;
  if(required)$('thinking').checked=true;
  $('temperature').disabled=['moonshot','glm'].includes(adapter)||(adapter!=='generic'&&$('thinking').checked);
  $('adapter-hint').textContent=adapter==='generic'?'仅发送标准参数，思考行为由服务商和模型默认设置决定。':
    adapter==='moonshot'?'Kimi 不发送温度。K3 与 K2.7 始终思考；K2.6 可使用思考开关。':
    adapter==='glm'?'GLM-5.3 必须思考；使用 low 强度，不发送温度。':
    adapter==='minimax'?'推理内容与文学正文分离。M3 可切换思考，其他模型保留平台默认思考行为。':'服务商预设会自动选择参数格式；自定义地址默认使用通用兼容。';
  const canList=supportsModelList();
  $('fetch-models').disabled=!canList;$('test-connection').disabled=!canList;
  $('fetch-models').textContent=$('base-url').value!=='custom'&&providerData()?.model_catalog?'获取平台模型目录':'从账户获取可用模型';
  $('test-connection').textContent=canList?'测试连接与密钥':'此预设未配置模型列表检查';
  $('connection-state').textContent=$('api-key').value.trim()?'Key 已填写':hasEnvironmentKey()?'使用当前服务商环境变量 Key':'未设置 Key';
  $('model-badge').textContent=$('model').value==='custom'?($('custom-model').value.trim()||'自定义模型'):$('model').selectedOptions[0]?.textContent||'选择模型';
}
for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click',()=>selectTab(button.dataset.tab));
  button.addEventListener('keydown',event=>{
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')]; const i=tabs.indexOf(button);
    const next = event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    selectTab(tabs[next].dataset.tab); tabs[next].focus();
  });
}
for (const id of ['mode','pipeline']) $(id).addEventListener('change',taskChanged);
$('save-profile').addEventListener('click',()=>saveSettings());
$('update-profile').addEventListener('click',()=>saveSettings(true));
$('saved-profile').addEventListener('change',()=>{
  const item=savedSettings.profiles.find(p=>p.id===$('saved-profile').value);
  if(item)applySettings(item);
  else{savedSettings.selected='';renderSavedSettings();$('profile-name').value='';$('remember-key').checked=false;settingsMessage('可将当前设置保存为新配置。');try{writeLocal(SETTINGS_KEY,savedSettings);}catch{settingsMessage('浏览器未能保存本次选择。');}}
});
$('delete-profile').addEventListener('click',()=>{
  const id=$('saved-profile').value,item=savedSettings.profiles.find(p=>p.id===id);if(!item)return;
  if(!confirm(`删除本机配置“${item.name}”？其中保存的 Key 也会删除。`))return;
  try {
    const next={version:1,selected:'',profiles:savedSettings.profiles.filter(p=>p.id!==id)};
    writeLocal(SETTINGS_KEY,next);savedSettings=next;clearCredential();$('remember-key').checked=false;$('profile-name').value='';renderSavedSettings();connectionChanged();settingsMessage('已删除此配置及保存的 Key。');
  }catch{settingsMessage('删除失败，浏览器未能修改本地存储。');}
});
$('connection-fields').addEventListener('input',event=>{if(!['profile-name','saved-profile'].includes(event.target.id))markSettingsChanged();});
for(const id of ['mode','genre','profile','pipeline','length','style'])$(id).addEventListener('input',markSettingsChanged);
$('clear-usage').addEventListener('click',()=>{
  if(busy||!confirm('清空本浏览器的累计用量记录？本次写作的用量仍保留在页面中。'))return;
  try{localStorage.removeItem(USAGE_KEY);ledger={version:1,rows:[]};ledgerStorageError='';renderLedger();}catch{ledgerStorageError='清空失败，浏览器未能修改本地存储。';renderLedger();}
});
for (const id of ['adapter','thinking','api-key','custom-model']) $(id).addEventListener('input',connectionChanged);
$('provider').addEventListener('change',()=>providerChanged());
$('base-url').addEventListener('change',()=>{renderModelChoices(providerData()?.models||[]);endpointChanged();});
for(const id of ['workspace','custom-base-url']) $(id).addEventListener('input',()=>endpointChanged());
$('model').addEventListener('change',()=>{
  $('custom-model-wrap').hidden=$('model').value!=='custom';$('custom-model').required=$('model').value==='custom';
  $('test-result').textContent='模型已更改，尚未测试。';connectionChanged();
});
async function runConnectionCheck(fetchModels=false) {
  if(busy||connectionBusy)return;
  if(!supportsModelList())return;
  connectionBusy=true;$('connection-fields').disabled=true;$('generate').disabled=true;
  $('test-result').textContent=fetchModels?'正在获取账户模型，最多等待 20 秒……':'正在检查，最多等待 20 秒……';
  try {
    await checkBackend();
    const connection=connectionData();
    if(!connection.api_key&&!hasEnvironmentKey()) throw new Error('请先填写当前服务商的 API Key。');
    if(!fetchModels&&!connection.model) throw new Error('请选择模型，或先从账户获取可用模型。');
    const response=await fetch(fetchModels?'/api/models':'/api/test-connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection})});
    const body=await response.json();
    if(!response.ok) throw new Error(response.status===404?'接口不存在，后台可能未重启。请关闭旧服务后重新启动。':body.error||'连接检查失败。');
    if(Array.isArray(body.models)) renderFetchedModels(body.models);
    $('test-result').textContent=fetchModels?`已获取 ${body.models.length} 个${body.catalog?'平台目录':'账户'}模型。请选择适合文字生成的模型；列表不保证模型能成功生成。`:body.message;
  }catch(error){$('test-result').textContent=error.message;}
  finally{connectionBusy=false;$('connection-fields').disabled=false;$('generate').disabled=false;}
}
$('test-connection').addEventListener('click',()=>runConnectionCheck());
$('fetch-models').addEventListener('click',()=>runConnectionCheck(true));
$('import').addEventListener('change',async()=>{
  const file=$('import').files[0]; if (!file) return;
  if(file.size>240000) return notice('文件过大，请选取要打磨的段落。');
  try { const text=await file.text(); if(text.length>60000) throw new Error('文本超过 60000 字符。'); $('source').value=text; notice(); }
  catch(error) { notice(error.message); }
});
$('example').addEventListener('click',()=>{
  if(busy) return;
  if (['brief','source','style','context','constraints','length'].some(id=>$(id).value.trim())) {
    if(!confirm('载入示例会替换写作台中的任务与原文，继续吗？')) return;
  }
  const example={mode:'polish',genre:'小说',brief:'润色下面的离别片段，保留父亲不善表达的性格和第一人称视角。感情通过动作与对话自然显现，允许必要的直叙；不要添加家庭背景。',source:'父亲送我到车站。他很难过，却不知道说什么。我也很难过。车快来了，他把袋子给我，说里面是鸡蛋。他的手因为常年劳动而十分粗糙。我接过袋子，眼泪不禁流了下来。这一刻，我深深感受到了父爱的伟大。',profile:'restrained',length:'约 200—300 字',style:'朴素，略带口语；不要增添华丽比喻。',context:'这是小说中的一个离别片段。',constraints:'保留父亲送行、车站、装鸡蛋的袋子、粗糙的手这些事实。',pipeline:'editor'};
  for(const [key,value] of Object.entries(example)) $(key).value=value;
  taskChanged(); notice('已载入示例任务，尚未调用模型。');
});
$('export-prompt').addEventListener('click',()=>{
  try {
    if(!config) throw new Error('写作指令尚未加载，请刷新页面。');
    const task=taskData();validateTask(task);
    task.style_guidance=config.profiles[task.profile].instruction;
    const text=config.system_prompt+'\n\n【本次任务与作品材料】\n'+JSON.stringify(task,null,2)+'\n\n请按上述任务直接交付正文；若是诊断任务，只交付编辑意见。';
    download('ai文字-写作提示词.txt',text);notice('提示词已导出，可粘贴到 DeepSeek 新对话。聊天中使用一次写作指令，不会自动运行三阶段 API 流程。');
  } catch(error) {notice(error.message);}
});
$('copy').addEventListener('click',async()=>{
  try {await navigator.clipboard.writeText(result[activeTab]);$('status').textContent='已复制';}
  catch {notice('复制不可用，请下载文本或手动选择复制。');}
});
$('download').addEventListener('click',()=>download('ai文字-'+({final:'定稿',draft:'初稿',review:'编辑意见'}[activeTab])+'.txt',result[activeTab]));
$('download-all').addEventListener('click',()=>download('ai文字-全部阶段.json',JSON.stringify(result,null,2),'application/json;charset=utf-8'));
$('writing-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(busy||connectionBusy) return;
  const task=taskData(),connection=connectionData();
  try {validateTask(task);await checkBackend();if(!connection.model)throw new Error('请选择模型或填写自定义模型名。');if(!connection.api_key&&!hasEnvironmentKey()){$('connection-panel').open=true;$('api-key').focus();throw new Error('请先填写当前服务商的 API Key，或导出提示词在聊天中使用。');}}
  catch(error){notice(error.message);return;}
  if (result.draft || result.review || result.final) {
    if(!confirm('开始新任务会清空当前稿件。请先下载需要保留的文本，继续吗？')) return;
  }
  busy=true;$('generate').disabled=true;$('example').disabled=true;$('connection-fields').disabled=true;notice();
  currentStages={};currentUsage={};usageRun={provider:connection.provider,model:connection.model,diagnose:task.mode==='diagnose',seen:new Set()};
  $('usage-model').textContent=connection.model;renderUsage();renderLedger();
  result={draft:'',review:'',final:''};activeTab=task.mode==='diagnose'?'review':'final';render();
  $('status').textContent='正在连接';
  let gotTerminal=false;
  function onEvent(event){
    if(event.type==='progress') $('status').textContent=stages[event.stage]||'正在生成';
    if(event.type==='stage'){
      receiveUsage(event.stage,event.usage);
      const slot=event.stage==='revise'?'final':event.stage;
      result[slot]=event.text;
      if(event.stage==='draft') {result.final=event.text;if(task.mode==='diagnose') result.review=event.text;}
      render();
    }
    if(event.result){
      gotTerminal=true;result=event.result;
      if(task.mode==='diagnose') result.review=result.final;
      render();notice(result.warning||'');$('status').textContent=result.complete?'已完成':'已保留当前文本';
      for(const [stage,value] of Object.entries(result.stage_usage||{}))receiveUsage(stage,value);
    }
  }
  try{
    const response=await fetch('/api/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task,connection})});
    if(!response.ok){const body=await response.json();throw new Error(body.error||`请求失败（${response.status}）`);}
    if(!response.body) throw new Error('浏览器不支持读取生成结果。');
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    while(true){const {value,done}=await reader.read();pending+=done?decoder.decode():decoder.decode(value,{stream:true});let pos;
      while((pos=pending.indexOf('\n'))>=0){const line=pending.slice(0,pos);pending=pending.slice(pos+1);if(line.trim())onEvent(JSON.parse(line));}
      if(done)break;
    }
    if(pending.trim())onEvent(JSON.parse(pending));
    if(!gotTerminal) throw new Error('连接提前结束，已保留收到的文本。');
  }catch(error){notice(error.message);$('status').textContent='生成未完成';}
  finally{busy=false;usageRun.finished=true;$('generate').disabled=false;$('example').disabled=false;$('connection-fields').disabled=false;renderUsage();renderLedger();}
});
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
async function init(){
  try {
    await checkBackend();$('provider').replaceChildren(...Object.entries(config.providers).map(([id,provider])=>new Option(provider.name,id)));providerChanged(false);
    try {
      savedSettings=State.loadProfiles(readLocal(SETTINGS_KEY),config.providers);renderSavedSettings();
      const selected=savedSettings.profiles.find(p=>p.id===savedSettings.selected);if(selected)applySettings(selected);
    }catch(error){settingsMessage(error.message||'浏览器不支持保存设置，当前页面仍可使用。');}
    try{ledger=State.loadLedger(readLocal(USAGE_KEY));}catch{ledgerStorageError='未能读取本机用量记录，当前页面仍可统计。';}
    renderLedger();
  }catch(error){notice(error.message);}
}
taskChanged();connectionChanged();render();renderUsage();init();
