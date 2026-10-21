const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const automator=require('miniprogram-automator');
const {generate}=require('./state-fixtures');
const output=path.resolve(__dirname,'../.artifacts/state-lab');
fs.mkdirSync(output,{recursive:true});
const fixture=generate();
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixture,null,2));
const token=crypto.randomBytes(24).toString('hex');
const port=9433,origin=`http://127.0.0.1:${port}`;
let busy=false;
const keys=['anime-master-v063-orders','animeMasterProjects','animeMasterRole','animeMasterLocalPreview','v063-followed-providers','anime-master-v063-liked-work-ids'];
async function openScenario(id,restore=false,capture=false) {
 if(busy) throw new Error('上一个场景正在加载，请稍候。');
 const scene=fixture.scenarios.find(row=>row.id===id);
 if(!restore&&!scene) throw new Error('未找到场景');
 busy=true;let app;
 try {
  app=await automator.connect({wsEndpoint:'ws://127.0.0.1:9422'});
  const info=await app.systemInfo();
  if(info.platform!=='devtools') throw new Error('仅允许微信开发者工具模拟器');
  const backupFile=path.join(output,'storage-backup.json');
  if(restore){
   if(!fs.existsSync(backupFile)) throw new Error('没有可恢复的测试前数据');
   const values=JSON.parse(fs.readFileSync(backupFile,'utf8'));
   for(const key of keys) {if(!(key in values))continue;if(values[key]===''||values[key]===null) await app.callWxMethod('removeStorageSync',key);else await app.callWxMethod('setStorageSync',key,values[key]);}
   await app.reLaunch('/pages/discover/index');return {message:'已恢复测试前数据与预览设置。'};
  }
  {
   const values=fs.existsSync(backupFile)?JSON.parse(fs.readFileSync(backupFile,'utf8')):{};
   for(const key of keys)if(!(key in values))values[key]=await app.callWxMethod('getStorageSync',key);
   fs.writeFileSync(backupFile,JSON.stringify(values,null,2));
  }
  // One simulator transaction resets related entities before the page reads them.
  await app.evaluate((orders,projects,role,storage)=>{
   wx.setStorageSync('animeMasterLocalPreview',true);
   wx.setStorageSync('animeMasterRole',role);
   wx.setStorageSync('anime-master-v063-orders',orders);
   wx.setStorageSync('animeMasterProjects',projects);
   wx.setStorageSync('v063-followed-providers',[1]);
   wx.setStorageSync('anime-master-v063-liked-work-ids',['w-mu-1']);
   Object.keys(storage).forEach(key=>wx.setStorageSync(key,storage[key]));
  },fixture.orders,fixture.projects,scene.role,scene.storage||{});
  const query=new URLSearchParams({audit:'1',...scene.query});
  const page=await app.reLaunch(`/pages/${scene.page}/index?${query}`);
  await page.waitFor(700);
  for(const call of scene.calls) await page.callMethod(call.method,...call.args);
  if(scene.patch) await page.setData(scene.patch);
  await page.waitFor(200);
  const actual=await page.data();
  for(const call of scene.calls){
   if(call.method==='openWorkPicker'&&!actual.workPickerOpen)throw new Error('关联作品选择层未展开');
   if(call.method==='addOrder'&&(!actual.selectingOrder||!actual.availableOrders.length))throw new Error('关联订单选择层没有可用订单');
   if(call.method==='toggleReply'&&actual.editingReplyId!==call.args[0].currentTarget.dataset.id)throw new Error('回复编辑器未展开');
   if(call.method==='renderResponse'&&actual.records.length!==call.args[0].records.length)throw new Error('资金记录未正确呈现');
  }
  for(const [key,value] of Object.entries(scene.patch||{})) if(JSON.stringify(actual[key])!==JSON.stringify(value)) throw new Error(`状态未生效：${key}`);
  if(scene.query.id&&String(scene.query.id).startsWith('UI-')&&!String(scene.query.id).startsWith('UI-PROJECT')&&!scene.patch) {
   if(!actual.order||actual.order.id!==scene.query.id)throw new Error('页面订单与测试实体不一致');
   const expected=fixture.orders.find(o=>o.id===scene.query.id);
   if(actual.order.stage!==expected.stage||actual.order.paymentStatus!==expected.paymentStatus)throw new Error('页面业务阶段与测试数据不一致');
  }
  const result={id:scene.id,label:scene.label,route:page.path,role:scene.role,checkedAt:new Date().toISOString(),order:actual.order?{id:actual.order.id,stage:actual.order.stage,paymentStatus:actual.order.paymentStatus}:null};
  result.facts=actual.order?`${actual.order.id} · 需求方 ${actual.order.buyer} · 服务方 ${actual.order.provider} · ${actual.order.service} · ￥${actual.order.finalPrice} · ${actual.order.time}`:`${scene.pageTitle} · ${scene.role==='buyer'?'需求方':'服务方'} · ${scene.label}`;
  fs.appendFileSync(path.join(output,'opened.jsonl'),JSON.stringify(result)+'\n');
  let screenshotError='';
  if(capture)try {await app.screenshot({path:path.join(output,'current.png')});}catch(error){screenshotError=error.message;}
  return {...result,screenshot:capture&&!screenshotError,message:`已打开 ${scene.id} · ${scene.label}，请在微信开发者工具检查。${screenshotError?'截图暂不可用。':''}`};
 }finally{if(app)app.disconnect();busy=false;}
}
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>动漫高手 · 测试场景台</title><style>
*{box-sizing:border-box}body{margin:0;background:#fffdfb;color:#292523;font:15px/1.6 system-ui}header{padding:28px 5%;border-bottom:1px solid #ece6e1;position:sticky;top:0;background:#fffdfbf5;z-index:2}h1{font-size:26px;margin:0 0 8px}p{margin:6px 0;color:#77706b}button,input,select{font:inherit;border:1px solid #ece6e1;border-radius:12px;padding:10px 14px;background:white;color:inherit}button{cursor:pointer}button:disabled{opacity:.5}main{max-width:1150px;margin:auto;padding:24px}#list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}.case{text-align:left;padding:18px}.case strong{display:block;font-size:17px}.case small{display:block;color:#77706b}.case.active{border-color:#c94f57;background:#fff1ef}#status{color:#b64149;min-height:26px}.tools{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}</style>
<header><h1>动漫高手 · 测试场景台</h1><p>每次点击重新载入一组数据并打开微信模拟器。订单可继续操作；“界面状态注入”用于查看临时状态，重新选择场景后恢复。所有数据仅在本地。</p><p>${fixture.orders.length}笔新订单 · ${fixture.scenarios.length}个场景 · 26个页面。测试支付不会产生真实交易；结算尚未实现的能力不伪造成功。</p><div class="tools"><input id="q" placeholder="搜索页面、状态或场景编号"><select id="role"><option value="">全部身份</option><option value="buyer">需求方</option><option value="provider">服务方</option></select><button id="restore">恢复测试前数据</button><a href="/fixtures.json" target="_blank">查看本次数据</a></div><div id="status" role="status">点击下面的场景开始检查</div></header><main><p id="facts" aria-live="polite"></p><details id="screen"><summary>查看当前微信模拟器截图（可操作界面在微信开发者工具中）</summary><img id="preview" style="width:363px;max-width:100%;border:1px solid #ece6e1;border-radius:16px" alt="选择场景后显示当前截图"></details><div id="list"></div></main><script>
const scenes=${JSON.stringify(fixture.scenarios).replace(/</g,'\u003c')};const token=${JSON.stringify(token)};let pending=false;
function render(){list.replaceChildren();for(const s of scenes.filter(s=>(!role.value||s.role===role.value)&&JSON.stringify(s).toLowerCase().includes(q.value.toLowerCase()))){const b=document.createElement('button');b.className='case';const title=document.createElement('strong');title.textContent=s.label;const meta=document.createElement('small');meta.textContent=s.id+' · '+s.pageTitle+' · '+(s.role==='buyer'?'需求方':'服务方');const note=document.createElement('small');note.textContent=s.kind;b.append(meta,title,note);b.onclick=()=>run('/open',{id:s.id},b);list.append(b)}}
async function run(url,body,b){if(pending)return;pending=true;document.getElementById("preview").removeAttribute("src");document.getElementById("screen").open=false;document.getElementById("facts").textContent="";document.querySelectorAll('button').forEach(e=>e.disabled=true);document.getElementById('status').textContent='正在加载，请稍候…';try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-State-Lab':token},body:JSON.stringify({...body,capture:captureSwitch.checked})});const data=await r.json();document.getElementById('status').textContent=data.message||data.error;if(!r.ok)throw Error(data.error);document.getElementById("facts").textContent=data.facts||"";if(data.screenshot){document.getElementById('preview').src='/current.png?t='+Date.now();document.getElementById('screen').open=true;}document.querySelectorAll('.active').forEach(e=>e.classList.remove('active'));if(b)b.classList.add('active')}catch(e){document.getElementById('status').textContent='未打开：'+e.message}finally{pending=false;document.querySelectorAll('button').forEach(e=>e.disabled=false)}}
const captureSwitch=document.createElement("input");captureSwitch.type="checkbox";const captureLabel=document.createElement("label");captureLabel.append(captureSwitch,document.createTextNode("同时截图（较慢）"));document.querySelector(".tools").append(captureLabel);q.oninput=render;role.onchange=render;document.getElementById('restore').onclick=()=>run('/restore',{});render();</script></html>`;
const server=http.createServer(async(req,res)=>{
 const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(data):data)};
 if(req.headers.host!==`127.0.0.1:${port}`)return send(403,{error:'来源不匹配'});
 if(req.method==='GET'&&req.url==='/')return send(200,html,'text/html');
 if(req.method==='GET'&&req.url==='/fixtures.json')return send(200,fixture);
 if(req.method==='GET'&&req.url.split('?')[0]==='/current.png'&&fs.existsSync(path.join(output,'current.png'))){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(output,'current.png')));}
 if(req.method!=='POST'||!['/open','/restore'].includes(req.url))return send(404,{error:'未找到'});
 if(req.headers['x-state-lab']!==token||(req.headers.origin&&req.headers.origin!==origin))return send(403,{error:'请从本机场景台操作'});
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('请求过长')};const data=JSON.parse(body||'{}');send(200,await openScenario(data.id,req.url==='/restore',data.capture===true));}catch(error){send(400,{error:error.message})}
});
server.listen(port,'127.0.0.1',()=>console.log(`测试场景台 ${origin} · ${fixture.scenarios.length} 场景`));
