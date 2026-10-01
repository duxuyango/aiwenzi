'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const State=require('../web/state.js'), providers=require('../providers.json');
const sample={id:'example-id',name:'Pro 精修',rememberKey:false,connection:{provider:'deepseek',endpoint:'official',model:'deepseek-v4-pro',api_key:'dummy-private-key',max_tokens:8192,temperature:.9,timeout:240},writing:{profile:'oral',style:'朴素',source:'不得保存的作品',brief:'不得保存的任务'}};
test('saved settings exclude credentials unless explicitly opted in, and exclude works',()=>{
  const profile=State.profile(sample,providers);
  assert.equal(profile.connection.api_key,undefined);
  assert.equal(profile.writing.source,undefined);assert.equal(profile.writing.brief,undefined);
  assert.equal(profile.writing.style,'朴素');assert.equal(profile.connection.model,'deepseek-v4-pro');
  assert.equal(JSON.stringify(profile).includes('dummy-private-key'),false);
});
test('key opt-in survives serialization; disabling opt-in strips existing key',()=>{
  const profile=State.profile({...sample,rememberKey:true,credentialScope:'bound-destination'},providers);
  assert.equal(profile.connection.api_key,'dummy-private-key');
  const restored=State.loadProfiles(JSON.parse(JSON.stringify({selected:profile.id,profiles:[profile]})),providers);
  assert.equal(restored.selected,profile.id);assert.equal(restored.profiles[0].credentialScope,'bound-destination');
  assert.equal(State.profile({...restored.profiles[0],rememberKey:false},providers).connection.api_key,undefined);
});
test('invalid saved providers and endpoints are skipped without breaking valid presets',()=>{
  const invalid=[{...sample,connection:{provider:'__proto__',endpoint:'custom'}},{...sample,connection:{provider:'deepseek',endpoint:'cn'}}];
  assert.equal(State.loadProfiles({profiles:[...invalid,sample]},providers).profiles.length,1);
  assert.equal(State.loadProfiles({profiles:'broken'},providers).profiles.length,0);
});
test('unlisted models, custom URLs and numeric parameters survive reload',()=>{
  const profile=State.profile({...sample,connection:{...sample.connection,provider:'custom',endpoint:'custom',base_url:'https://example.com/v1',model:'new-writer',thinking:true,adapter:'generic',transport:'direct',max_tokens:16000,temperature:1.1,timeout:500}},providers);
  const restored=State.loadProfiles({profiles:[profile]},providers).profiles[0];
  assert.equal(restored.connection.base_url,'https://example.com/v1');assert.equal(restored.connection.model,'new-writer');
  assert.equal(restored.connection.max_tokens,16000);assert.equal(restored.connection.transport,'direct');
});
test('usage distinguishes missing counts from reported zero and derives stage total',()=>{
  assert.deepEqual(State.usage({prompt_tokens:0,completion_tokens:5}),{prompt_tokens:0,completion_tokens:5,total_tokens:5});
  assert.deepEqual(State.usage({prompt_tokens:true,completion_tokens:-2,total_tokens:'5'}),{});
});
test('ledger persists separately for each provider and model without secrets or materials',()=>{
  const ledger=State.loadLedger(null);
  State.recordUsage(ledger,'deepseek','deepseek-flash',{prompt_tokens:10,completion_tokens:20,total_tokens:30});
  State.recordUsage(ledger,'deepseek','deepseek-v4-pro',{prompt_tokens:40,completion_tokens:50,total_tokens:90});
  State.recordUsage(ledger,'deepseek','deepseek-flash',{prompt_tokens:10,completion_tokens:20,total_tokens:30});
  const restored=State.loadLedger(JSON.parse(JSON.stringify(ledger)));
  assert.equal(restored.rows.length,2);assert.equal(restored.rows[0].usage.total_tokens,60);assert.equal(restored.rows[0].calls,2);
  assert.equal(restored.rows[1].usage.total_tokens,90);
});
test('missing stage usage keeps a partial ledger and does not fabricate totals across requests',()=>{
  const ledger=State.loadLedger(null);
  State.recordUsage(ledger,'custom','writer',{prompt_tokens:10});State.recordUsage(ledger,'custom','writer',{completion_tokens:20});
  State.recordUsage(ledger,'custom','writer',{});
  const restored=State.loadLedger(JSON.parse(JSON.stringify(ledger)));
  assert.equal(restored.rows[0].usage.total_tokens,undefined);assert.equal(restored.rows[0].missing,3);
  assert.equal(State.addUsage({},restored.rows[0].usage,false).total_tokens,undefined);
});
test('corrupt ledger counts are sanitized',()=>{
  const ledger=State.loadLedger({rows:[{provider:'custom',model:'writer',usage:{total_tokens:-2},calls:true,missing:'5'},null]});
  assert.deepEqual(ledger.rows[0].usage,{});assert.equal(ledger.rows[0].calls,0);assert.equal(ledger.rows[0].missing,0);
});
test('new provider presets and explicit adapters survive saved-settings reload',()=>{
  for(const provider of ['moonshot','zhipu','minimax','volcengine','gemini','openrouter']) {
    const preset=providers[provider], model=preset.models[0]?.id||'catalog-model';
    const p=State.profile({...sample,connection:{...sample.connection,provider,endpoint:preset.endpoints[0].id,model,adapter:preset.adapter}},providers);
    const restored=State.loadProfiles(JSON.parse(JSON.stringify({profiles:[p]})),providers).profiles[0];
    assert.equal(restored.connection.provider,provider);assert.equal(restored.connection.model,model);assert.equal(restored.connection.adapter,preset.adapter);
  }
});
test('expanding registry keeps existing Flash and Pro saved profiles',()=>{
  const saved={selected:'pro',profiles:[{...sample,id:'pro'},{...sample,id:'flash',connection:{...sample.connection,model:'deepseek-flash'}}]};
  const restored=State.loadProfiles(saved,providers);
  assert.equal(restored.selected,'pro');assert.equal(restored.profiles.length,2);assert.equal(restored.profiles[1].connection.model,'deepseek-flash');
});
