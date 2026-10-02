const {test}=require('node:test');
const assert=require('node:assert/strict');
const State=require('../web/state.js');
test('public endpoint policy skips unsupported custom addresses when loading profiles',()=>{
  const providers={deepseek:{endpoints:[{id:'official'}],allow_custom_endpoint:false}};
  const raw={id:'test',name:'自定义',connection:{provider:'deepseek',endpoint:'custom',base_url:'https://proxy.example',model:'writer'},writing:{}};
  assert.equal(State.profile(raw,providers),null);
  raw.connection.endpoint='official';assert.ok(State.profile(raw,providers));
});
