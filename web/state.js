'use strict';
// Shared browser state helpers; also runnable with Node's built-in test runner.
(function(root, factory) {
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.AiTextState=factory();
})(typeof globalThis==='object'?globalThis:this, function() {
  const fields=['prompt_tokens','completion_tokens','total_tokens'];
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  function usage(raw, derive=true) {
    const result={};
    for(const key of fields) if(count(raw?.[key])) result[key]=raw[key];
    if(derive && result.total_tokens===undefined && result.prompt_tokens!==undefined && result.completion_tokens!==undefined)
      result.total_tokens=result.prompt_tokens+result.completion_tokens;
    return result;
  }
  function addUsage(a,b,derive=true) {
    const result=usage(a,false), next=usage(b,derive);
    for(const key of fields) if(next[key]!==undefined) result[key]=(result[key]||0)+next[key];
    return result;
  }
  function profile(raw, providers) {
    if(!raw || typeof raw.id!=='string' || !raw.id || raw.id.length>100 || typeof raw.name!=='string' || !raw.name.trim()) return null;
    const c=raw.connection, provider=Object.hasOwn(providers,c?.provider)?providers[c.provider]:null;
    if(!provider || !Array.isArray(provider.endpoints) || (c.endpoint!=='custom'&&!provider.endpoints.some(e=>e.id===c.endpoint))) return null;
    if(c.endpoint==='custom' && provider.allow_custom_endpoint===false) return null;
    const string=(value,max=200)=>typeof value==='string'?value.slice(0,max):'';
    const numeric=(value,fallback,min,max,integer=false)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max&&(!integer||Number.isInteger(value))?value:fallback;
    const connection={provider:c.provider,endpoint:c.endpoint,workspace:string(c.workspace,63),base_url:string(c.base_url,2000),model:string(c.model),
      adapter:['auto','generic','deepseek','enable_thinking','moonshot','glm','minimax'].includes(c.adapter)?c.adapter:'auto',thinking:c.thinking===true,
      max_tokens:numeric(c.max_tokens,8192,128,32768,true),temperature:numeric(c.temperature,.9,0,2),
      timeout:numeric(c.timeout,240,1,600),transport:c.transport==='direct'?'direct':'system'};
    const rememberKey=raw.rememberKey===true;
    if(rememberKey && typeof c.api_key==='string' && /^[\x20-\x7e]{1,4096}$/.test(c.api_key)) connection.api_key=c.api_key;
    const w=raw.writing||{}, writing={};
    for(const key of ['mode','genre','profile','pipeline','length','style']) if(typeof w[key]==='string') writing[key]=string(w[key],key==='style'?60000:200);
    return {id:raw.id,name:raw.name.trim().slice(0,60),connection,writing,rememberKey,credentialScope:string(raw.credentialScope,2500)};
  }
  function loadProfiles(raw,providers) {
    return {version:1,selected:typeof raw?.selected==='string'?raw.selected:'',
      profiles:Array.isArray(raw?.profiles)?raw.profiles.slice(0,50).map(p=>profile(p,providers)).filter(Boolean):[]};
  }
  function loadLedger(raw) {
    const rows=Array.isArray(raw?.rows)?raw.rows.filter(r=>typeof r?.provider==='string'&&typeof r.model==='string').slice(0,200).map(r=>({
      provider:r.provider.slice(0,100),model:r.model.slice(0,200),usage:usage(r.usage,false),
      calls:count(r.calls)?r.calls:0,missing:count(r.missing)?r.missing:0})):[];
    return {version:1,rows};
  }
  function recordUsage(ledger,provider,model,raw) {
    let row=ledger.rows.find(r=>r.provider===provider&&r.model===model);
    if(!row) {row={provider,model,usage:{},calls:0,missing:0};ledger.rows.push(row);}
    const value=usage(raw);
    row.usage=addUsage(row.usage,value);row.calls++;
    if(fields.some(key=>value[key]===undefined)) row.missing++;
    return row;
  }
  return {usage,addUsage,profile,loadProfiles,loadLedger,recordUsage};
});
