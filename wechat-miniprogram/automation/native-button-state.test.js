const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../miniprogram');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(dir,item.name)):[path.join(dir,item.name)]);}
function buttonTags(markup){return [...markup.matchAll(/<button\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)].map(match=>match[0]);}
test('button scanner retains comparison operators inside quoted attributes',()=>{
  const markup=`<button disabled="{{count >= 5}}" bindtap="save">保存</button><button aria-label="a > b" bindtap="next">下一步</button>`;
  const tags=buttonTags(markup);assert.equal(tags.length,2);
  assert.match(tags[0],/bindtap="save"/);assert.match(tags[1],/bindtap="next"/);
});
test('all native buttons declare a hover style and avoid native disabled backgrounds',()=>{
  let count=0,guarded=0;
  for(const file of files(root).filter(f=>f.endsWith('.wxml'))){
    for(const tag of buttonTags(fs.readFileSync(file,'utf8'))){
      count++;assert.match(tag,/\shover-class="[^"]+"/,file);assert.doesNotMatch(tag,/\sdisabled=/,file);
      const state=/data-am-disabled="\{\{(.*?)\}\}"/.exec(tag);
      if(!state)continue;guarded++;
      const handler=/\s(?:bindtap|catchtap)="\{\{\((.*?)\) \? '' : '([A-Za-z0-9_]+)'\}\}"/.exec(tag);
      assert.ok(handler,file);assert.equal(handler[1],state[1],file);assert.match(tag,/aria-disabled=/,file);
      const open=/open-type="\{\{(.*?)\}\}"/.exec(tag);
      if(open)assert.ok(open[1].startsWith(`(${state[1]}) ? '' : `),file);
    }
  }
  assert.ok(count>=211);assert.ok(guarded>=61);
});
