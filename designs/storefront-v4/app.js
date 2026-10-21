'use strict';
// 独立设计原型；只使用当前浏览器存储，不调用微信、账号或业务接口。
const KEY='wanjiang-storefront-design-v4';
const clone=x=>JSON.parse(JSON.stringify(x)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
const blank=()=>({draft:{profile:{career:'妆娘',city:'杭州',bio:'',tags:'',specialties:'',declines:'',hours:'',banner:''},services:[],works:[],notice:{text:'',image:''}},account:{name:'南池',avatar:'',pending:''},published:null,publication:{status:'idle',snapshot:null,rev:null},rev:0,accepting:true,days:{},savedAt:'',writes:0});
const freshUI=()=>({page:'manager',stack:[],edit:null,original:null,kind:'',id:'',child:null,suspended:null,publicView:false,viewId:'',tab:'works',flash:'',error:'',modal:null,month:0});
let S=blank(),U=freshUI(),storageWarning='',testing={saveFailure:false,uploadFailure:false,capability:true};
try{const a=JSON.parse(localStorage.getItem(KEY));if(a?.state?.draft){S=a.state;U={...freshUI(),...a.ui,modal:null};}}catch{}
function persist(){try{localStorage.setItem(KEY,JSON.stringify({state:S,ui:{...U,modal:null}}));storageWarning='';return true;}catch{storageWarning='浏览器未能保留本次演示数据，请减少图片或检查存储空间。';return false;}}
function chooseDemo(){S=blank();S.draft.profile.bio='清透自然的角色妆造，适合漫展与外景拍摄。';S.draft.services=[{id:'service-demo',name:'漫展角色妆造',price:'520',unit:'次',mode:'线下',cities:['杭州'],description:'包含角色妆面、妆前沟通与基础假发整理。',includes:'不含假发、饰品与服装。',extras:'跨城交通费另行确认。',preparation:'请提供角色参考图、活动时间及地点。'}];S.draft.works=[{id:'work-demo',title:'森系角色妆造',subtitle:'',referencePrice:'',description:'负责妆面设计及妆造。偏青绿眼妆，搭配暖金饰品。',tags:'森系，角色妆造',serviceId:'service-demo',images:[{id:'image-demo',url:'sample.png',watermark:{enabled:false,text:'南池',position:'右下角',size:4,opacity:60}}],credits:{coser:'',photo:'',makeup:'南池',retouch:'',mine:'妆造'},pinned:false}];S.rev=1;U=freshUI();}
const field=(label,key,value,placeholder='',hint='',type='text',max=200)=>`<label class="field"><span>${label}</span><input data-field="${key}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${max}" oninput="inputValue('${key}',this.value)">${hint?`<p class="help">${hint}</p>`:''}</label>`;
const area=(label,key,value,placeholder='',max=1200)=>`<label class="field"><span>${label}</span><textarea data-field="${key}" maxlength="${max}" placeholder="${esc(placeholder)}" oninput="inputValue('${key}',this.value)">${esc(value)}</textarea></label>`;
const btn=(text,action,cls='outline',disabled=false)=>`<button type="button" class="${cls}" onclick="${action}" ${disabled?'disabled':''}>${text}</button>`;
const action=(text,code,cls='primary')=>btn(text,code,cls);
const row=(title,detail,code)=>`<button class="row rowbutton" onclick="${code}"><span>${title}</span><span class="muted">${esc(detail)} <b class="chevron">›</b></span></button>`;
const summary=(title,text,code,placeholder='尚未填写')=>`<button class="summaryrow" onclick="${code}"><div><h3>${title}</h3><p class="${text?'field-value':'field-placeholder'}">${esc(text||placeholder)}</p></div><span class="chevron">›</span></button>`;
const notice=(title,body)=>`<div class="notice"><strong>${title}</strong>${body?`<p>${body}</p>`:''}</div>`;
const help=t=>`<p class="help">${t}</p>`;
const photo=(url,cls='art',alt='作品图片')=>url?`<img class="${cls}" src="${esc(url)}" alt="${alt}" onerror="this.outerHTML='<div class=&quot;photoempty&quot;>图片暂不可用，请重新选择</div>'">`:`<div class="photoempty">还没有图片</div>`;
const positionedPhoto=(url,cls,obj,prefix,alt)=>photo(url,cls,alt).replace('<img ',`<img style="object-position:${obj[prefix+'X']??50}% ${obj[prefix+'Y']??50}%" `);
function cropControls(prefix){return `<div class="cropcontrols">${['X','Y'].map((axis,i)=>`<label class="rangefield">${i?'上下取景':'左右取景'}<input type="range" min="0" max="100" value="${U.edit[prefix+axis]??50}" aria-label="${i?'上下取景':'左右取景'}" oninput="U.edit['${prefix+axis}']=Number(this.value);const im=document.querySelector('.cropcontrol img');if(im)im.style.objectPosition=(U.edit['${prefix}X']??50)+'% '+(U.edit['${prefix}Y']??50)+'%';persist()"></label>`).join('')}</div>`;}
const footer=(text,code,secondary='')=>`<footer>${secondary}${action(text,code)}</footer>`;
const pill=t=>`<span class="tag">${t}</span>`;
const select=(label,key,value,options,hint='')=>`<label class="field"><span>${label}</span><select data-field="${key}" onchange="inputValue('${key}',this.value);render()">${options.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select>${hint?help(hint):''}</label>`;
const optional=(title,content)=>`<details><summary>${title}</summary><div>${content}</div></details>`;
function fileButton(label,kind,cls='outline',multiple=false){return `<label class="${cls} filelabel">${label}<input type="file" accept="image/*" ${multiple?'multiple':''} onchange="loadFiles(this,'${kind}')"></label>`;}
const identity=()=>`<div class="identity">${S.account.avatar?positionedPhoto(S.account.avatar,'avatar',S.account,'avatar','头像'):`<div class="avatar blankavatar">${esc(S.account.name.slice(0,1))}</div>`}<div><h1>${esc(S.account.name)}</h1><p>${esc(S.draft.profile.career)} · ${esc(S.draft.profile.city||'待设置城市')}</p></div></div>`;
function draftHeader(){return '<div class="viewstate"><strong>草稿 · 仅自己可见</strong>　保存后再预览发布</div>';}
function imageSettings(){return U.edit?.images?.find(x=>x.id===U.imageId);}
function editorDirty(){return U.edit&&!same(U.edit,U.original);}
function getValue(obj,key){return key.split('.').reduce((v,k)=>v?.[k],obj);}
function setValue(obj,key,value){const parts=key.split('.');let cur=obj;for(const p of parts.slice(0,-1))cur=cur[p]??=( {} );cur[parts.at(-1)]=value;}
function inputValue(key,value){
if(U.page==='text'){U.child.value=value;const counter=document.querySelector('.phone .counter');if(counter)counter.textContent=value.length+' / '+U.child.max;}else if(U.page==='watermark'){setValue(U.child,key,value);updateWatermarkPreview();}
else if(U.page==='account'){setValue(U.edit,key,value);}
else if(U.edit)setValue(U.edit,key,value);
persist();
}
function push(page){if(page==='associatedworks')U.associatedDraft=clone(U.edit.workIds||S.draft.works.filter(w=>w.serviceId===U.edit.id).map(w=>w.id));U.stack.push({page:U.page,publicView:U.publicView,viewId:U.viewId,tab:U.tab,scroll:scrollY});U.page=page;U.error='';persist();render();scrollTo(0,0);}
function openPage(page){if(U.edit&&['service','work','profile','notice','account','calendar'].includes(U.page)&&editorDirty()){U.modal={type:'leave',target:page};return render();}U.edit=null;U.original=null;push(page);}
function returnPage(){const prev=U.stack.pop();Object.assign(U,prev||{page:'manager'});U.error='';persist();render();requestAnimationFrame(()=>scrollTo(0,prev?.scroll||0));}
function back(){
if(U.modal){U.modal=null;return render();}
if(U.page==='watermark'&&U.batch){saveBatchWatermark();return returnPage();}
if(U.page==='photoPicker'){U.batch=null;return returnPage();}
if(['text','watermark'].includes(U.page)){if(U.child&&!same(U.child,U.childOriginal)){U.modal={type:'childLeave'};return render();}U.child=null;return returnPage();}
if(['service','work','profile','notice','account','calendar'].includes(U.page)){
if(editorDirty()){U.modal={type:'leave'};return render();}
return cancelEditor();
}
returnPage();
}
function blankWork(){return {id:uid(),title:'',subtitle:'',referencePrice:'',description:'',tags:'',serviceId:'',images:[],credits:{coser:'',photo:'',makeup:'',retouch:'',mine:''},pinned:false};}
function blankService(){return {id:uid(),name:'',price:'',unit:'次',mode:'线下',cities:[],description:'',includes:'',extras:'',preparation:''};}
function edit(kind,id=''){
if(S.publication.status==='pending'&&!['account','calendar'].includes(kind)){U.modal={type:'pendingEdit',kind,id};return render();}
U.stack.push({page:U.page,publicView:U.publicView,viewId:U.viewId,tab:U.tab});
U.kind=kind;U.id=id;U.page=kind;U.error='';
if(kind==='work')U.edit=clone(S.draft.works.find(x=>x.id===id)||blankWork());
if(kind==='service')U.edit=clone(S.draft.services.find(x=>x.id===id)||blankService());
if(kind==='profile'||kind==='notice')U.edit=clone(S.draft[kind]);
if(kind==='account')U.edit=clone(S.account);
if(kind==='calendar')U.edit={accepting:S.accepting,days:clone(S.days)};
U.original=clone(U.edit);persist();render();scrollTo(0,0);
}
function cancelEditor(){
if(U.suspended){const old=U.suspended;U={...old,suspended:null,modal:null};persist();return render();}
U.edit=null;U.original=null;U.modal=null;returnPage();
}
function saveEditor(){
if(testing.saveFailure){U.error='未保存成功。输入和已上传的图片都在，请重试。';return render();}
const kind=U.kind;
if(kind==='account'&&!U.edit.name.trim()){U.error='请填写昵称。';return render();}
const changed=!same(U.edit,U.original)||(['work','service'].includes(kind)&&!U.id);
if(changed){
if(kind==='work'||kind==='service'){const arr=S.draft[kind==='work'?'works':'services'];const i=arr.findIndex(x=>x.id===U.edit.id);if(i<0)arr.push(clone(U.edit));else arr[i]=clone(U.edit);S.rev++;S.writes++;}
else if(kind==='profile'||kind==='notice'){S.draft[kind]=clone(U.edit);S.rev++;S.writes++;}
else if(kind==='account'){S.account.name=U.edit.name;if(U.edit.avatar!==S.account.avatar||U.edit.avatarX!==S.account.avatarX||U.edit.avatarY!==S.account.avatarY){S.account.pending=U.edit.avatar;S.account.pendingCrop={avatarX:U.edit.avatarX??50,avatarY:U.edit.avatarY??50};S.account.avatarError='';}S.writes++;}
else if(kind==='calendar'){S.accepting=U.edit.accepting;S.days=clone(U.edit.days);S.writes++;}
S.savedAt=new Date().toISOString();
}
if(kind==='service'&&U.edit.workIds){for(const w of S.draft.works){if(U.edit.workIds.includes(w.id))w.serviceId=U.edit.id;else if(w.serviceId===U.edit.id)w.serviceId='';}}
U.modal=null;U.error='';
if(U.suspended){const old=U.suspended;U={...old,suspended:null,flash:'服务草稿已保存。请选择这件案例对应的服务。'};persist();return render();}
const target=kind==='work'?'works':kind==='service'?'services':'manager';
U=freshUI();U.page=target;U.flash=changed?(kind==='calendar'?'档期与接单状态已保存，立即生效。':kind==='account'?'昵称已保存；新头像通过检测后更新。':'草稿已保存，仅自己可见。'):'没有新的修改，无需重复保存。';
persist();render();scrollTo(0,0);
}
function childText(key,title,max=1200){
U.child={key,title,value:getValue(U.edit,key)||'',max};U.childOriginal=clone(U.child);push('text');
}
function finishChild(){
if(U.page==='text')setValue(U.edit,U.child.key,U.child.value);
if(U.page==='watermark'){const images=U.child.all?U.edit.images:U.edit.images.filter(i=>i.id===U.imageId);for(const i of images)i.watermark=clone(U.child.spec);}
U.child=null;U.childOriginal=null;returnPage();
}
function goAssociation(){U.associationDraft=U.edit.serviceId;push('association');}
function addServiceFromWork(){U.suspended=clone(U);edit('service');}
function chooseService(id){U.edit.serviceId=id;U.flash='已选择服务；保存案例草稿后保留。';persist();returnPage();}
function toggleWorkForService(id,checked){
U.associatedDraft??=clone(U.edit.workIds||S.draft.works.filter(x=>x.serviceId===U.edit.id).map(x=>x.id));
U.associatedDraft=checked?[...new Set([...U.associatedDraft,id])]:U.associatedDraft.filter(x=>x!==id);persist();
}
async function loadFiles(input,kind){
const files=[...input.files];if(!files.length)return;
if(kind==='works'&&U.edit.images.length+files.length>5){U.error='一件案例最多添加 5 张图片。';return render();}
U.error='';
const add=[];
for(const f of files){
if(!f.type.startsWith('image/'))continue;
if(f.size>4*1024*1024){U.error='当前浏览器演示请使用小于 4 MB 的图片；这不是小程序上传上限。';continue;}
const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f)});
add.push(url);
}
if(testing.uploadFailure){U.failedUpload={kind,urls:add};U.error='这批图片未上传成功。之前的图片和文字已保留，可重试。';persist();return render();}
applyImages(kind,add);
}
function applyImages(kind,urls){
if(kind==='works'){startCasePhotos();U.batch.candidates.push(...urls.map(caseImage));persist();return render();}
if(kind.startsWith('replace:')&&urls[0]){const im=U.edit.images.find(x=>x.id===kind.slice(8));if(im)im.url=urls[0];}
if(kind==='banner')U.edit.banner=urls[0]||U.edit.banner;
if(kind==='avatar')U.edit.avatar=urls[0]||U.edit.avatar;
if(kind==='notice')U.edit.image=urls[0]||U.edit.image;
U.error='';U.failedUpload=null;persist();render();
}
function retryUpload(){if(testing.uploadFailure){U.error='网络仍不可用，已保留待重试图片。';return render();}applyImages(U.failedUpload.kind,U.failedUpload.urls);}
function sampleImage(){if(!U.edit)return;if(U.kind==='work'){if(!U.batch)startCasePhotos();U.batch.candidates.push(caseImage('sample.png'));persist();return render();}applyImages(U.kind==='work'?'works':U.kind==='account'?'avatar':U.kind==='notice'?'notice':'banner',['sample.png']);}


function updateWatermarkPreview(){
const e=document.querySelector('.wmtext');if(!e||!U.child)return;const w=U.child.spec;
e.textContent=w.text;e.style.cssText=wmStyle(w);e.hidden=!w.enabled;
}
function wmStyle(w){const pos={'右下角':'right:12px;bottom:12px','左下角':'left:12px;bottom:12px','右上角':'right:12px;top:12px','左上角':'left:12px;top:12px','居中':'left:50%;top:50%;transform:translate(-50%,-50%)'}[w.position];return `${pos};opacity:${Number(w.opacity)/100};font-size:${Number(w.size)*3}px`;}
function preview(publicView=false,id=''){U.publicView=publicView;U.viewId=id;U.tab='works';push(id?'workpreview':'preview');}
function changes(){
const out=[],old=S.published;
for(const [key,label] of [['services','服务'],['works','案例']]){
for(const x of S.draft[key]){const y=old?.[key]?.find(z=>z.id===x.id);if(!y||!same(x,y))out.push({kind:key==='services'?'service':'work',id:x.id,action:y?'修改':'新增',name:x.name||x.title||'未命名'+label});}
for(const x of old?.[key]||[])if(!S.draft[key].some(z=>z.id===x.id))out.push({kind:key==='services'?'service':'work',id:x.id,action:'移除',name:x.name||x.title||'未命名'+label});
}
if(!same(old?.profile,S.draft.profile))out.push({kind:'profile',action:old?'修改':'新增',name:'橱窗资料'});
if((S.draft.notice.text||S.draft.notice.image||old?.notice?.text||old?.notice?.image)&&!same(old?.notice,S.draft.notice))out.push({kind:'notice',action:old?'修改':'新增',name:'合作须知'});
return out;
}
function issues(){
const out=[];
if(!S.draft.profile.city)out.push({kind:'profile',id:'',text:'请设置常驻城市'});
if(!S.draft.services.length)out.push({kind:'service',id:'',text:'请添加一项服务，说明内容与报价'});
for(const s of S.draft.services){const miss=[];if(!s.name.trim())miss.push('服务名称');if(!s.price||!Number.isFinite(Number(s.price))||Number(s.price)<=0)miss.push('有效报价');if(!s.unit.trim())miss.push('计价单位');if(!s.description.trim())miss.push('服务介绍');if(s.mode==='线下'&&!s.cities.length)miss.push('服务城市');if(miss.length)out.push({kind:'service',id:s.id,text:`${s.name||'未命名服务'}：请补充${miss.join('、')}`});}
for(const w of S.draft.works){const miss=[];if(!w.title.trim())miss.push('案例名称');if(!w.description.trim())miss.push('案例介绍');if(!w.images.length)miss.push('图片');if(miss.length)out.push({kind:'work',id:w.id,text:`${w.title||'未命名案例'}：请补充${miss.join('、')}`});}
return out;
}
function publish(){
if(!testing.capability){U.error='发布服务暂不可用，草稿仍在，可继续编辑与预览。';return render();}
if(S.publication.status==='pending'||S.publication.status==='submitting'||!changes().length)return;
if(issues().length){U.error='请先完成下面的必要信息。';return render();}
S.publication={status:'submitting',snapshot:clone(S.draft),rev:S.rev,id:uid()};U.page='result';persist();render();
setTimeout(()=>{if(S.publication.status==='submitting'){S.publication.status='pending';persist();render();}},500);
}
function simulate(result){
if(result==='pass'&&['pending','unknown'].includes(S.publication.status)){S.published=clone(S.publication.snapshot);S.publication.status='published';}
if(result==='reject'&&['pending','unknown'].includes(S.publication.status))S.publication.status='rejected';
if(result==='unknown'&&['pending','submitting'].includes(S.publication.status))S.publication.status='unknown';
if(result==='avatarpass'&&S.account.pending){S.account.avatar=S.account.pending;Object.assign(S.account,S.account.pendingCrop||{});S.account.pending='';}
if(result==='avatarreject'&&S.account.pending){S.account.avatarError='新头像未通过内容检测，请换一张图片。当前公开头像不变。';S.account.pending='';}
persist();render();
}
function removeService(id){U.modal={type:'removeService',id};render();}
function confirmModal(type){
const m=U.modal;U.modal=null;
if(type==='stay'){render();return;}
if(type==='save'){saveEditor();return;}
if(type==='discard'){if(m.type==='childLeave'){U.child=null;return returnPage();}return cancelEditor();}
if(type==='removeImage'){U.edit.images=U.edit.images.filter(x=>x.id!==m.id);}
if(type==='removeService'){
S.draft.services=S.draft.services.filter(x=>x.id!==m.id);for(const w of S.draft.works)if(w.serviceId===m.id)w.serviceId='';S.rev++;S.writes++;U=freshUI();U.page='services';U.flash='已从草稿移除；发布更新后从公开主页移除。';
}
if(type==='withdraw'){S.publication.status='idle';persist();return edit(m.kind||'work',m.id||S.draft.works[0]?.id);}
if(type==='reset'){S=blank();U=freshUI();testing={saveFailure:false,uploadFailure:false,capability:true};}
persist();render();
}
function openModal(type,id){U.modal={type,id};render();}
function togglePin(id){const w=S.draft.works.find(x=>x.id===id);if(!w)return;if(!w.pinned&&S.draft.works.filter(x=>x.pinned).length>=2){U.error='最多置顶 2 件，请先取消一件。';return render();}w.pinned=!w.pinned;S.rev++;S.writes++;U.flash='排序已保存到草稿，发布更新后对外生效。';persist();render();}
function newServiceOption(){addServiceFromWork();}
function toggleCalendar(date){U.edit.days[date]=U.edit.days[date]==='open'?'unknown':'open';persist();render();}
const catalog=()=>U.publicView?S.published:S.draft;
function pageTitle(){return ({manager:'管理橱窗',services:'服务项目',works:'作品集',service:U.id?'编辑服务':'添加服务',work:U.id?'编辑案例':'添加妆造案例',text:U.child?.title||'编辑介绍',association:'案例对应的服务',associatedworks:'选择展示案例',photoPicker:'选择案例图片',images:'添加妆造案例',original:'查看原图',watermark:'图片水印',profile:'橱窗资料',account:'头像与昵称',notice:'合作须知',calendar:'档期与接单',preview:U.publicView?'公开主页':'主页预览',workpreview:'妆造案例',servicepreview:'服务详情',noticepreview:'合作须知',preferences:'合作偏好',reviews:'合作评价',schedulepreview:'公开档期',gallery:'案例图集',review:'确认本次发布',result:'发布进度',banner:'主页头图'})[U.page]||'管理橱窗';}
function header(){return `<div class="status"><span>9:41</span><span>▰ ▰ ▰</span></div><header>${btn('‹','back()','back')}<strong>${pageTitle()}</strong><span class="capsule">•••　⊙</span></header>`;}
function step(n,title,desc,code,done=false,active=false){return `<button class="step rowbutton ${done?'completed':''} ${active?'active':''}" onclick="${code}"><span class="num">${done?'✓':n}</span><div><h2>${title}</h2><p>${desc}</p></div><span class="chevron">›</span></button>`;}
const expression=(name,extra='')=>`<img class="brand-expression ${extra}" src="assets/expression-${name}.png" alt="" aria-hidden="true" draggable="false">`;
function manager(){
const first=!S.draft.services.length&&!S.draft.works.length&&!S.published,hasService=!!S.draft.services.length,hasWork=!!S.draft.works.length,p=S.publication.status;
const missing=issues(),serviceReady=hasService&&!missing.some(i=>i.kind==='service'),workReady=hasWork&&!missing.some(i=>i.kind==='work');
let x=identity();
if(first)x+=`<div class="intro spaced">${expression('hello','greeting-expression')}<h1>让别人了解你的妆造服务</h1><p>先添加案例展示效果，再配置服务与报价并关联案例。<br>保存的草稿仅自己可见。</p></div>`;
if(['pending','submitting','unknown','rejected'].includes(p))x+=`<div class="progresshint"><h2>${({pending:'正在检测，尚未公开',submitting:'正在提交，请勿重复',unknown:'发布结果待确认',rejected:'本次更新需要修改'})[p]}</h2><p>${S.published?'旧公开内容继续展示。':'通过检测后才会公开。'}</p>${row('查看发布进度','',"push('result')")}</div>`;
else if(S.published)x+=`<div class="progresshint"><h2>${changes().length?'有新的草稿修改':'当前内容已公开'}</h2><p>${changes().length?'修改尚未影响公开内容。':'没有新的修改，不需要重复发布。'}</p></div>`;
x+=`<div class="steps">${step(1,'配置案例',hasWork?`${S.draft.works.length} 件草稿 · ${workReady?'查看展示效果':'还有必要信息待完善'}`:'先添加图片与介绍，保存案例草稿',"openPage('works')",workReady,!workReady)}${step(2,'配置服务与报价',hasService?`${S.draft.services.length} 项草稿 · ${serviceReady?'查看报价与关联案例':'还有必要信息待完善'}`:'填写服务内容与报价，再关联已保存的案例',"openPage('services')",serviceReady,workReady&&!serviceReady)}${step(3,'预览并发布','先确认展示内容，通过检测后公开',"openPage('review')",!!S.published&&!changes().length,false)}</div>`;
if(!testing.capability)x+=notice('发布服务暂不可用','草稿和预览仍可使用。');
x+=row('橱窗资料','头图与个人介绍',"edit('profile')")+row('合作须知','选填',"edit('notice')")+row('档期与接单',S.accepting?'开放接单':'暂停接单',"edit('calendar')");
if(S.published)x+=row('查看公开主页','已发布版本',"preview(true)");
return `<main>${x}</main>`;
}
function beginnerGuide(message,detail=''){
return `<div class="beginner-guide" role="note" aria-label="填写提示"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/></svg><div><p>${message}</p>${detail?`<small>${detail}</small>`:''}</div></div>`;
}
function portfolioState(work){
const old=S.published?.works?.find(item=>item.id===work.id);
const pending=['pending','submitting','unknown'].includes(S.publication.status)&&S.publication.snapshot?.works?.some(item=>item.id===work.id);
if(pending)return {text:S.publication.status==='unknown'?'结果待确认':'检测中',tone:'pending'};
if(!work.title.trim()||!work.description.trim()||!work.images.length)return {text:'待完善',tone:'unfinished'};
return old?(same(old,work)?{text:'已公开',tone:'public'}:{text:'有修改',tone:'draft'}):{text:'草稿',tone:'draft'};
}
function portfolioPage(){
const works=[...S.draft.works].sort((a,b)=>Number(b.pinned)-Number(a.pinned)),pending=['pending','submitting','unknown'].includes(S.publication.status);
const rows=works.map(w=>{const state=portfolioState(w),missing=!w.images.length?'添加案例图片':!w.title.trim()?'填写案例名称':!w.description.trim()?'补充案例介绍':`${w.images.length} 张图片`;
return `<article class="portfolio-row"><button class="portfolio-row-edit" onclick="edit('work','${w.id}')" aria-label="编辑${esc(w.title||'未命名案例')}"></button><div class="portfolio-cover">${photo(w.images[0]?.url,'portfolio-thumb')}</div><div class="portfolio-body"><div class="portfolio-copy"><h3>${esc(w.title||'未命名案例')}</h3><div class="portfolio-meta"><span class="portfolio-state ${state.tone}">${state.text}</span><span>${missing}</span></div></div></div><button class="portfolio-pin ${w.pinned?'is-pinned':''}" onclick="togglePin('${w.id}')" aria-label="${w.pinned?'取消置顶':'置顶'}${esc(w.title||'未命名案例')}" aria-pressed="${w.pinned}" title="${w.pinned?'取消置顶':'置顶'}" ${pending?'disabled':''}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 9V4h1V2H7v2h1v5l-3 4v3h14v-3l-3-4Z"/><path d="M12 16v6"/></svg></button></article>`;}).join('');
return `<div class="viewstate">${S.published?'草稿修改不会立即改变公开内容':'保存的案例仅自己可见，发布后才公开'}</div><main class="portfolio-page">${works.length?`<div class="portfolio-heading"><h2>我的案例 <span>${works.length}</span></h2></div>${pending?row('查看发布进度','检测完成后可继续修改',"push('result')"):''}<div class="portfolio-list">${rows}</div><div class="portfolio-next">${beginnerGuide('把案例关联到服务，让客人看见报价对应的效果。')}${row('配置服务与报价','关联已保存的案例',"openPage('services')")}</div>`:`<div class="portfolio-empty">${expression('curious')}<h1>添加你的第一个案例</h1>${beginnerGuide('选几张能展示妆造效果的图片，聊聊你负责的部分。','保存后，可在服务与报价中关联这个案例。')}</div>`}</main>`+footer('添加案例',"edit('work')");
}

function lists(kind){
if(kind==='works')return portfolioPage();
const works=kind==='works',a=S.draft[kind];let x='';
if(!a.length)x+=`<div class="portfolio-empty">${expression('curious')}<h1>添加你的第一项服务</h1>${beginnerGuide('写清能提供什么服务、如何服务和怎么收费。','配上对应案例，保存后就可以预览发布效果。')}</div>`;
for(const o of a)x+=works?`<div class="workrow">${o.images[0]?photo(o.images[0].url,'thumb'):'<div class="thumb photoempty">暂无图片</div>'}<div>${btn(esc(o.title||'未命名案例'),`edit('work','${o.id}')`,'textbutton')}<p>${esc(S.draft.services.find(s=>s.id===o.serviceId)?.name||'尚未选择对应服务')}</p>${o.pinned?pill('已置顶'):''}</div>${btn(o.pinned?'取消置顶':'置顶',`togglePin('${o.id}')`,'textbutton')}</div>`:`<button class="serviceitem rowbutton" onclick="edit('service','${o.id}')"><div><h3>${esc(o.name||'未命名服务')}</h3><p>${esc(o.mode)} · ${esc(o.cities.join('、')||'地区待填')}</p></div><span class="price">${o.price?'￥'+esc(o.price):'报价待填'}<small> / ${esc(o.unit)}</small></span></button>`;
if(a.length)x+=`<div class="portfolio-next">${beginnerGuide('发布前，看看报价和案例是否对应。')}${row('预览并发布','检查报价与关联案例',"openPage('review')")}</div>`;
return draftHeader()+`<main>${x}</main>`+footer(works?'添加案例':'添加服务',`edit('${works?'work':'service'}')`);
}
function serviceEditor(){
const s=U.edit;
return draftHeader()+`<main class="editor-form">${field('服务名称 <small>· 必填</small>','name',s.name,'例如：漫展角色妆造','', 'text',40)}<div class="fieldgroup"><div class="formtwo">${field('服务报价 <small>· 必填</small>','price',s.price,'例如：520','','number')}${field('计价单位 <small>· 必填</small>','unit',s.unit,'次 / 小时')}</div>${help('这里填写这项服务的报价，需求方会在服务详情看到。')}</div>${select('服务方式','mode',s.mode,['线下','线上'])}${s.mode==='线下'?`<div class="field city-field"><span id="city-label">可服务城市 <small>· 必填</small></span>${s.cities.length?`<div class="chips">${s.cities.map(c=>btn(esc(c)+' ×',`U.edit.cities=U.edit.cities.filter(x=>x!==${esc(JSON.stringify(c))});persist();render()`,'city-chip')).join('')}</div>`:''}<select aria-labelledby="city-label" aria-label="添加城市" onchange="if(this.value&&!U.edit.cities.includes(this.value))U.edit.cities.push(this.value);persist();render()"><option value="">${s.cities.length?'添加服务城市':'请选择城市'}</option>${['杭州','上海','南京','北京','广州','成都'].map(c=>`<option>${c}</option>`).join('')}</select><p class="help">可以添加多个服务城市。</p></div>`:''}${summary('服务介绍 · 必填',s.description,"childText('description','服务介绍',1000)",'例如：包含妆面、妆前沟通及基础假发整理')}${optional('合作细节 · 选填',summary('包含 / 不包含内容',s.includes,"childText('includes','包含 / 不包含内容',1000)")+summary('额外费用说明',s.extras,"childText('extras','额外费用说明',1000)")+summary('预约前准备',s.preparation,"childText('preparation','预约前准备',1000)"))}${row('展示案例',`${(s.workIds||S.draft.works.filter(w=>w.serviceId===s.id).map(w=>w.id)).length} 件`,"push('associatedworks')")}${U.id&&S.draft.services.length>1?btn('删除这项服务',`removeService('${s.id}')`,'textbutton danger spaced'):''}</main>`+footer('保存草稿',"saveEditor()");
}
function caseImage(url){return {id:uid(),url,watermark:{enabled:false,text:S.account.name,position:'右下角',size:4,opacity:60}};}
function startCasePhotos(){if(U.edit.images.length>=5)return;U.batch={candidates:[],selected:[],active:0};push('photoPicker');}
async function importCasePhotos(input){
const batch=U.batch;U.error='';
for(const f of [...input.files]){
if(!f.type.startsWith('image/'))continue;
if(f.size>4*1024*1024){U.error='浏览器演示请使用小于 4 MB 的图片。';continue;}
try{const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});if(U.batch!==batch)return;const im=caseImage(url);batch.candidates.push(im);if(input.capture&&batch.selected.length<5-U.edit.images.length)batch.selected.push(im.id);}catch{U.error='图片读取失败，请重新选择。';}
}
persist();render();
}
function selectCasePhoto(id){U.error='';const b=U.batch,i=b.selected.indexOf(id);if(i>=0)b.selected.splice(i,1);else if(b.selected.length<5-U.edit.images.length)b.selected.push(id);else U.error='本案例最多 5 张，请取消一张后再选择。';persist();render();}
function photoPicker(){const b=U.batch;return `<div class="viewstate">按点选顺序排列 · 第一张默认首图</div><main class="case-picker"><div class="case-sources"><label class="outline">从相册选择<input type="file" accept="image/*" multiple hidden onchange="importCasePhotos(this)"></label><label class="outline">拍照<input type="file" accept="image/*" capture="environment" hidden onchange="importCasePhotos(this)"></label></div>${b.candidates.length?`<p class="help">点选图片，右上角数字表示加入案例的顺序。</p><div class="case-picker-grid">${b.candidates.map((im,i)=>{const n=b.selected.indexOf(im.id);return `<button class="case-candidate ${n>=0?'selected':''}" aria-label="图片 ${i+1}${n>=0?'，已选第 '+(n+1)+' 张':''}" aria-pressed="${n>=0}" onclick="selectCasePhoto('${im.id}')">${photo(im.url)}<span class="pick-number">${n>=0?U.edit.images.length+n+1:''}</span></button>`}).join('')}</div>`:`<div class="case-picker-empty"><span class="uploadplus">＋</span><h2>选择你的妆造图片</h2><p>从相册选择，或拍照添加。<br>已有案例图片会保留，新图接在后面。</p></div>`}<p class="help">已选 ${b.selected.length} 张 · 还可选 ${5-U.edit.images.length-b.selected.length} 张</p></main>`+`<footer class="case-picker-footer">${btn('取消','back()','textbutton')}${btn('下一步'+(b.selected.length?'（'+b.selected.length+' 张）':''),'beginBatchWatermark()','primary',!b.selected.length)}</footer>`;}
function beginBatchWatermark(){if(!U.batch.selected.length)return;U.batch.active=0;U.child={spec:clone(batchPhoto().watermark),all:true};push('watermark');}
function batchPhoto(){return U.batch.candidates.find(im=>im.id===U.batch.selected[U.batch.active]);}
function saveBatchWatermark(){if(!U.child)return;const b=U.batch;for(const id of U.child.all?b.selected:[b.selected[b.active]])b.candidates.find(im=>im.id===id).watermark=clone(U.child.spec);}
function switchBatchPhoto(i){saveBatchWatermark();U.batch.active=i;U.child.spec=clone(batchPhoto().watermark);persist();render();}
function batchWatermarkEditor(){const b=U.batch,w=U.child.spec;return `<div class="viewstate">设置水印 · ${b.active+1} / ${b.selected.length}</div><main class="case-watermark"><div class="watermarkpreview">${photo(batchPhoto().url)}<span class="wmtext" style="${wmStyle(w)}" ${w.enabled?'':'hidden'}>${esc(w.text)}</span></div><div class="case-filmstrip">${b.selected.map((id,i)=>`<button aria-label="预览第 ${i+1} 张" class="${b.active===i?'selected':''}" onclick="switchBatchPhoto(${i})">${photo(b.candidates.find(im=>im.id===id).url)}<span>${U.edit.images.length+i+1}</span></button>`).join('')}</div><label class="row"><span>添加文字水印</span><input type="checkbox" ${w.enabled?'checked':''} onchange="U.child.spec.enabled=this.checked;persist();render()"></label>${w.enabled?`<div class="case-watermark-fields">${field('水印文字','spec.text',w.text,'你的昵称','','text',40)}${select('水印位置','spec.position',w.position,['右下角','左下角','右上角','左上角','居中'])}<label class="rangefield">大小 <output>${w.size}%</output><input aria-label="水印大小" type="range" min="2" max="6" value="${w.size}" oninput="inputValue('spec.size',Number(this.value));this.previousElementSibling.textContent=this.value+'%'"></label><label class="rangefield">不透明度 <output>${w.opacity}%</output><input aria-label="水印不透明度" type="range" min="20" max="90" step="10" value="${w.opacity}" oninput="inputValue('spec.opacity',Number(this.value));this.previousElementSibling.textContent=this.value+'%'"></label></div>`:''}<label class="row"><span>统一应用到本次所选图片</span><input type="checkbox" ${U.child.all?'checked':''} onchange="U.child.all=this.checked;persist()"></label>${help('下一步返回案例编辑并开始上传，你可以继续填写介绍。')}</main>`+footer('下一步','commitCasePhotos()');}
function commitCasePhotos(){saveBatchWatermark();const images=U.batch.selected.map(id=>clone(U.batch.candidates.find(im=>im.id===id)));U.edit.images.push(...images);const workId=U.edit.id;U.batch=null;U.child=null;if(U.stack.at(-1)?.page==='photoPicker')U.stack.pop();if(['work','images'].includes(U.stack.at(-1)?.page))returnPage();else{U.page='work';persist();render();}for(const im of images)simulateCaseUpload(workId,im.id);}
function caseMedia(){return `<section class="case-media"><div class="sectionhead"><h2>案例图片</h2><span class="muted">${U.edit.images.length} / 5</span></div><div class="case-thumb-grid">${U.edit.images.map((im,i)=>`<div class="case-thumb"><button class="case-open" aria-label="查看第 ${i+1} 张图片" onclick="U.imageId='${im.id}';push('original')">${photo(im.url)}<span class="case-order">${i===0?'首图':i+1}</span></button><button class="case-delete" aria-label="删除第 ${i+1} 张图片" onclick="openModal('removeImage','${im.id}')">×</button><button class="case-progress" data-upload="${im.id}" ${!im.upload||im.upload==='done'?'hidden':''} onclick="if(this.dataset.failed==='true')retryCasePhoto('${im.id}')" data-failed="${im.upload==='failed'}">${im.upload==='failed'?'上传失败<br>点击重试':'上传中<br>'+Number(im.progress||0)+'%'}</button></div>`).join('')}${U.edit.images.length<5?`<button class="case-add" onclick="startCasePhotos()"><span>＋</span>${U.edit.images.length?'继续添加':'添加图片'}</button>`:''}</div>${help('按选择顺序展示，第一张自动作为首图。')}</section>`;}
function retryCasePhoto(id){simulateCaseUpload(U.edit.id,id);}
function simulateCaseUpload(workId,imageId){
// Prototype only: no network request or cloud upload.
const find=()=>{const work=U.edit?.id===workId?U.edit:S.draft.works.find(w=>w.id===workId);return work?.images.find(im=>im.id===imageId);};
const im=find();if(!im||im.upload==='uploading')return;im.upload='uploading';im.progress=0;
const paint=()=>{const current=find();if(!current)return;const el=document.querySelector(`[data-upload="${imageId}"]`);if(el){el.hidden=current.upload==='done';el.dataset.failed=String(current.upload==='failed');el.innerHTML=current.upload==='failed'?'上传失败<br>点击重试':'上传中<br>'+current.progress+'%';}};paint();persist();
const timer=setInterval(()=>{const current=find();if(!current){clearInterval(timer);return;}if(testing.uploadFailure){current.upload='failed';clearInterval(timer);}else{current.progress=Math.min(100,current.progress+20);if(current.progress===100){current.upload='done';clearInterval(timer);}}paint();persist();},500);
}

function workEditor(){
const w=U.edit;
let media=caseMedia();
return draftHeader()+`<main class="editor-form">${media}${field('案例名称 <small>· 必填</small>','title',w.title,'例如：森系角色妆造','', 'text',40)}${field('案例标签 <small>· 选填</small>','tags',w.tags,'例如：森系，清透','用逗号分隔。','text',120)}${area('案例介绍 <small>· 必填</small>','description',w.description,'写清角色 / 风格，以及你负责的妆造内容',1200)}${optional('参考价格与更多资料 · 选填',field('案例参考价（元） <small>· 选填</small>','referencePrice',w.referencePrice,'不填则不单独显示','用于说明这件案例的参考费用，不替代上方服务报价。','number')+`<div class="case-credits">${[['coser','出镜'],['photo','摄影'],['makeup','妆造'],['retouch','后期'],['mine','本人负责']].map(([k,n])=>field(n+' <small>· 选填</small>','credits.'+k,w.credits[k],k==='mine'?'例如：妆面与假发整理':'姓名或署名','', 'text',100)).join('')}</div>`)}</main>`+footer('保存草稿','saveEditor()');
}
function textEditor(){
const c=U.child;
return `<div class="viewstate">完成后回到${U.kind==='service'?'服务':U.kind==='work'?'案例':'资料'}编辑，再保存草稿</div><main><div class="writing">${area(c.title,'value',c.value,c.title.includes('案例')?'例如：负责妆面与假发整理，适合漫展或外景拍摄。':'说明服务范围、合作条件或你的个人风格。',c.max)}<p class="counter">${c.value.length} / ${c.max}</p></div></main>`+footer('完成并返回','finishChild()');
}
function associations(){
if(U.page==='association' && U.associationDraft===undefined)U.associationDraft=U.edit.serviceId;
if(U.page==='association')return `<main>${S.draft.services.length?notice('选择这件案例对应的服务','需求方通过案例找到你后，可以了解并预约这项服务。'):''}${S.draft.services.length?S.draft.services.map(s=>`<label class="option"><div><h3>${esc(s.name||'未命名服务')}</h3><p>￥${esc(s.price||'待填')} / ${esc(s.unit)}</p></div><input type="radio" name="association" ${U.associationDraft===s.id?'checked':''} onchange="U.associationDraft='${s.id}';persist()"></label>`).join(''):notice('还没有服务项目','可以先返回保存案例，再配置服务与报价并关联。当前案例输入会保留。')}${row('创建一项服务','',"newServiceOption()")}<label class="option"><div><h3>暂不选择</h3><p>可在主页展示，但不进入首页发现列表</p></div><input name="association" type="radio" ${!U.associationDraft?'checked':''} onchange="U.associationDraft='';persist()"></label></main>`+footer('完成选择并返回','U.edit.serviceId=U.associationDraft;U.associationDraft=undefined;persist();returnPage()');
const ids=U.associatedDraft??(U.edit.workIds||S.draft.works.filter(w=>w.serviceId===U.edit.id).map(w=>w.id));
return `<main>${S.draft.works.length?S.draft.works.map(w=>{const occupied=w.serviceId&&w.serviceId!==U.edit.id;return `<label class="option">${photo(w.images[0]?.url,'thumb')}<div><h3>${esc(w.title||'未命名案例')}</h3><p>${occupied?'已关联其他服务':'可以展示在这项服务下'}</p></div><input type="checkbox" ${occupied?'disabled':''} ${ids.includes(w.id)?'checked':''} onchange="toggleWorkForService('${w.id}',this.checked)"></label>`}).join(''):notice('还没有保存的案例','请先在第一步添加并保存案例。当前服务可先保存草稿，之后再关联。')}</main>`+footer('完成选择并返回','U.edit.workIds=U.associatedDraft??U.edit.workIds;U.associatedDraft=undefined;persist();returnPage()');
}
function imagesEditor(){return workEditor();}
function watermarkEditor(){return batchWatermarkEditor();}
function profileEditor(){
const p=U.edit;
return draftHeader()+`<main class="editor-form">${row('头像与昵称','单独保存后生效',"openAccountFromProfile()")}${select('服务职业','career',p.career,['妆娘','毛娘','摄影','后期'])}${field('常驻城市 <small>· 必填</small>','city',p.city,'例如：杭州')}${summary('个人简介 · 选填',p.bio,"childText('bio','个人简介',1000)",'介绍你的风格与擅长方向')}${field('主页标签 <small>· 选填</small>','tags',p.tags,'例如：清透，复古','', 'text',120)}${optional('合作偏好 · 选填',area('擅长类型','specialties',p.specialties,'例如：清透自然、角色还原',500)+area('不承接类型','declines',p.declines,'例如：特殊伤效妆',500)+field('通常沟通时间','hours',p.hours,'例如：10:00—21:00'))}${summary('主页头图 · 选填',p.banner?'已设置 · 点击更换或调整':'',"push('banner')",'未设置 · 点击选择独立头图')}</main>`+footer('保存草稿','saveEditor()');
}
function openAccountFromProfile(){U.suspended=clone(U);edit('account');}
function accountEditor(){return `<div class="viewstate">账号资料 · 单独保存，不随橱窗发布</div><main><div class="accountavatar cropcontrol">${U.edit.avatar?positionedPhoto(U.edit.avatar,'avatar',U.edit,'avatar','头像'):'<div class="avatar blankavatar">南</div>'}${fileButton('选择头像','avatar')}</div>${U.edit.avatar?optional('调整头像显示范围',cropControls('avatar')):''}${field('昵称 <small>· 必填</small>','name',U.edit.name,'填写昵称','昵称保存后更新，新头像通过检测后更新。','text',12)}${S.account.pending?notice('新头像正在检测','当前公开头像继续使用；你可以离开此页。'):''}${S.account.avatarError?notice('请更换头像',esc(S.account.avatarError)):''}</main>`+footer('保存账号资料','saveAccount()');}
function saveAccount(){const suspended=U.suspended;U.suspended=null;saveEditor();if(!U.error&&suspended){const flash=U.flash;U={...suspended,suspended:null,flash};persist();render();}else if(U.error)U.suspended=suspended;}
function bannerEditor(){return `<div class="viewstate">由你指定的头图 · 保存资料草稿后保留</div><main><div class="cropcontrol">${U.edit.banner?positionedPhoto(U.edit.banner,'heroBanner',U.edit,'banner','指定头图'):'<div class="photoempty">未设置头图，主页将从头像与简介开始</div>'}</div><div class="smallactions">${fileButton(U.edit.banner?'更换头图':'选择头图','banner')}${U.edit.banner?btn('移除头图',"U.edit.banner='';persist();render()",'textbutton'):''}</div>${U.edit.banner?cropControls('banner'):''}${help('调整可见范围，让重要内容留在头图中。不会自动使用案例图片。')}</main>`+footer('完成并返回资料','returnPage()');}
function noticeEditor(){return draftHeader()+`<main class="editor-form">${summary('合作须知 · 选填',U.edit.text,"childText('text','合作须知',1000)",'例如：预约前准备、改期与沟通方式')}${optional('说明配图 · 最多 1 张',U.edit.image?photo(U.edit.image,'docphoto','须知配图'):'<p class="help">用文字能说清楚时，无需上传配图。</p>')}<div class="smallactions">${fileButton(U.edit.image?'替换配图':'添加配图','notice')}${U.edit.image?btn('移除配图',"U.edit.image='';persist();render()",'textbutton'):''}</div></main>`+footer('保存草稿','saveEditor()');}
function calendarGrid(readonly=false){
const today=new Date(),month=new Date(today.getFullYear(),today.getMonth()+(U.month||0),1),days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate(),offset=(month.getDay()+6)%7;
const state=readonly?S.days:U.edit.days;
const key=d=>`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const cells=Array.from({length:days},(_,i)=>{const d=i+1,k=key(d),past=new Date(month.getFullYear(),month.getMonth(),d)<new Date(today.getFullYear(),today.getMonth(),today.getDate()),v=state[k]||'unknown';return `<button ${readonly||past||v==='locked'?'disabled':''} class="${v==='open'?'available':v==='locked'?'locked':''}" onclick="toggleCalendar('${k}')"><b>${d}</b><small>${past?'':v==='open'?'可约':v==='locked'?'已锁':'未公开'}</small></button>`}).join('');
return `<div class="calendarhead">${btn('‹','U.month--;render()')}<h2>${month.getFullYear()} 年 ${month.getMonth()+1} 月</h2>${btn('›','U.month++;render()')}</div><div class="calgrid">${['一','二','三','四','五','六','日'].map(x=>`<span class="weekday">${x}</span>`).join('')}${'<span></span>'.repeat(offset)}${cells}</div><div class="legend"><span>可约：明确开放</span><span>未公开：需确认</span><span>已锁：订单占用</span></div>`;
}
function calendarEditor(){
return `<div class="viewstate">档期与接单状态 · 保存后立即生效</div><main><label class="row"><span><strong>开放接单</strong><small>关闭后暂停接收新预约，已有订单不受影响</small></span><input type="checkbox" ${U.edit.accepting?'checked':''} onchange="U.edit.accepting=this.checked;persist()"></label>${calendarGrid()}${notice('未公开日期，不代表不接单','需求方仍可发起预约，等待你确认。点击日期可改为明确可约；订单锁定日期不可修改。')}</main>`+footer('保存并生效','saveEditor()',btn('撤销修改','U.edit=clone(U.original);persist();render()'));
}
function previewHeader(){return `<div class="viewstate">${U.publicView?'已公开版本':'草稿预览 · 仅自己可见'}${S.accepting?'':' · 暂停接单'}</div>`;}
function openDetail(page,id){U.stack.push({page:U.page,publicView:U.publicView,viewId:U.viewId,tab:U.tab,scroll:scrollY});U.viewId=id;U.page=page;persist();render();scrollTo(0,0);}
function previewPage(){
const d=catalog();if(!d)return `<main>${notice('还没有公开内容','请先发布草稿；内容通过检测后才会在这里展示。')}</main>`;
let x=d.profile.banner?positionedPhoto(d.profile.banner,'heroBanner',d.profile,'banner','创作者指定头图'):'';
x+=identity()+`<p class="linecopy">${esc(d.profile.bio||'')}</p>`;
x+=`<div class="previewtabs">${[['works','案例'],['services','服务'],['notice','须知'],['schedule','档期']].map(([id,t])=>btn(t,`U.tab='${id}';render()`,U.tab===id?'active':'')).join('')}</div>`;
if(U.tab==='works'){
if(!d.works.length)x+=`<div class="empty"><h2>暂未展示案例</h2></div>`;
for(const w of [...d.works].sort((a,b)=>Number(b.pinned)-Number(a.pinned))){const sv=d.services.find(s=>s.id===w.serviceId);x+=`<div class="spaced"><button class="rowbutton" style="border:0;padding:0" onclick="openDetail('workpreview','${w.id}')">${photo(w.images[0]?.url)}<div class="workcaption"><div><h3>${esc(w.title||'未命名案例')}</h3><p>${esc(w.tags)}</p></div>${sv?`<span class="previewprice">￥${esc(sv.price)}<small>/${esc(sv.unit)}</small></span>`:''}</div></button>${sv?help('对应服务报价 · '+esc(sv.name)):''}</div>`;}
}
if(U.tab==='services'){
if(!d.services.length)x+='<div class="empty"><h2>暂未展示服务</h2></div>';
for(const s of d.services)x+=row(esc(s.name||'未命名服务'),'￥'+s.price+' / '+s.unit,`openDetail('servicepreview','${s.id}')`);
}
if(U.tab==='notice')x+=`<p class="linecopy">${esc(d.notice.text||'暂未填写合作须知')}</p>${d.notice.image?photo(d.notice.image):''}`;
if(U.tab==='schedule')x+=calendarGrid(true)+help('未公开日期需与服务方确认，不等于不可预约。');
x+=row('合作偏好','',"push('preferences')")+row('合作评价','暂无评价',"push('reviews')");
return previewHeader()+`<main>${x}</main>`+footer(U.publicView?'返回管理橱窗':'返回发布确认',U.publicView?"openPage('manager')":"openPage('review')");
}
function detailsPage(){
const d=catalog();if(!d)return `<main>${notice('还没有公开内容','返回管理橱窗查看草稿。')}</main>`;
let x='';
if(U.page==='workpreview'){
const w=d.works.find(w=>w.id===U.viewId);if(!w)return `<main>${notice('这件案例已不在当前版本中','请返回主页查看最新内容。')}</main>`;
const sv=d.services.find(s=>s.id===w.serviceId);
x=`${btn(photo(w.images[0]?.url),"push('gallery')",'rowbutton')}<h1 class="spaced">${esc(w.title)}</h1>${w.subtitle?`<p class="lede">${esc(w.subtitle)}</p>`:''}<p class="linecopy">${esc(w.description)}</p>`;
if(sv)x+=`<section><h2>对应服务</h2>${row(esc(sv.name),'￥'+sv.price+' / '+sv.unit,`openDetail('servicepreview','${sv.id}')`)}</section>`;
if(w.referencePrice)x+=`<p class="priceexplain">这件案例的参考费用：￥${esc(w.referencePrice)}。预约报价以对应服务及双方确认内容为准。</p>`;
const names={coser:'出镜',photo:'摄影',makeup:'妆造',retouch:'后期',mine:'本人负责'};
x+=Object.entries(w.credits).some(([,v])=>v)?`<section><h2>创作署名</h2>${Object.entries(w.credits).filter(([,v])=>v).map(([k,v])=>`<p class="linecopy">${names[k]} / ${esc(v)}</p>`).join('')}</section>`:'';
}
if(U.page==='servicepreview'){
const s=d.services.find(s=>s.id===U.viewId);if(!s)return `<main>${notice('这项服务已不在当前版本中','请返回主页查看最新内容。')}</main>`;
x=`<h1>${esc(s.name)}</h1><p class="bigprice">￥${esc(s.price)} <small>/ ${esc(s.unit)}</small></p><p class="priceexplain">服务报价 · ${esc(s.mode)}${s.mode==='线下'?' · '+esc(s.cities.join('、')):''}</p><p class="linecopy">${esc(s.description)}</p>`;
for(const [key,title] of [['includes','包含 / 不包含'],['extras','额外费用'],['preparation','预约前准备']])if(s[key])x+=`<section><h2>${title}</h2><p class="linecopy">${esc(s[key])}</p></section>`;
const ws=d.works.filter(w=>w.serviceId===s.id);if(ws.length)x+=`<section><h2>妆造案例</h2>${ws.map(w=>`<button class="rowbutton spaced" onclick="openDetail('workpreview','${w.id}')">${photo(w.images[0]?.url)}<p class="linecopy">${esc(w.title)}</p></button>`).join('')}</section>`;
}
if(U.page==='gallery'){
const w=d.works.find(w=>w.id===U.viewId);x=w?w.images.map((im,i)=>`<div class="spaced">${photo(im.url)}<p class="help">第 ${i+1} / ${w.images.length} 张</p></div>`).join(''):'案例已移除';
}
if(U.page==='preferences'){
const names={specialties:'擅长类型',declines:'不承接类型',hours:'通常沟通时间'};
x=Object.entries(names).filter(([k])=>d.profile[k]).map(([k,t])=>`<section><h2>${t}</h2><p class="linecopy">${esc(d.profile[k])}</p></section>`).join('')||'<div class="empty"><h2>暂未填写合作偏好</h2></div>';
}
if(U.page==='reviews')x='<div class="empty"><h2>暂无合作评价</h2><p>完成真实合作后，评价将在这里展示。</p></div>';
if(U.page==='schedulepreview')x=calendarGrid(true);
if(U.page==='noticepreview')x=`<p class="linecopy">${esc(d.notice.text||'暂未填写')}</p>${d.notice.image?photo(d.notice.image):''}`;
return previewHeader()+`<main>${x}</main>`;
}
function reviewPage(){
const pending=['pending','submitting','unknown'].includes(S.publication.status),items=changes(),missing=issues();
let x=`<h1>确认别人将看到的内容</h1><p class="lede">这是已保存的草稿，预览不会重复保存。</p>${row('查看完整主页预览','',"preview(false)")}`;
if(pending)x+=`<div class="progresshint"><h2>已有一次发布正在处理</h2><p>请查看原任务结果，不要重复提交。</p>${row('查看发布进度','',"push('result')")}</div>`;
if(missing.length)x+=`<section class="requiredlist"><h2>发布前还需完善 ${missing.length} 项</h2>${missing.map(i=>summary(esc(i.text),'去填写',`edit('${i.kind}','${i.id}')`)).join('')}</section>`;
x+=`<section><div class="sectionhead"><h2>本次变更</h2><span class="muted">${items.length} 项</span></div>${items.length?items.map(i=>`<div class="row"><div><h3>${esc(i.name)}</h3><p class="help">${i.action}${({service:'服务',work:'案例',profile:'资料',notice:'须知'})[i.kind]}</p></div>${i.action!=='移除'?btn('修改',`edit('${i.kind}','${i.id||''}')`,'textbutton'):pill('发布后移除')}</div>`).join(''):'<p class="linecopy">暂无新的修改，无需再次发布。</p>'}</section>`;
if(!testing.capability)x+=notice('发布服务暂不可用','草稿仍在，可以继续编辑或预览。');
x+=`<div class="inlinehint">确认后提交内容安全检测，通过后公开。${S.published?'检测期间，旧公开内容保持展示。':'检测完成前，其他人看不到这些内容。'}</div>`;
const can=!missing.length&&!pending&&items.length&&testing.capability;
return `<main>${x}</main><footer>${btn(pending?'查看原发布进度':!items.length?'没有待发布修改':missing.length?'完善后即可发布':testing.capability?'确认提交，检测后公开':'发布暂不可用',pending?"push('result')":"publish()",'primary',!can&&!pending)}</footer>`;
}
function resultPage(){
const p=S.publication.status;let x='';
if(p==='published')x=`<div class="result">${expression('happy')}<h1>本次内容已公开</h1><p>需求方现在可以查看发布的内容。</p></div>${row('查看公开主页','',"preview(true)")}${notice(S.accepting?'目前开放接单':'目前暂停接单',S.accepting?'档期未公开的日期，仍需由你确认预约。':'主页仍可展示；开启接单后才能接收新预约。')}${row('检查接单状态与档期','',"edit('calendar')")}`;
else if(p==='rejected')x=`<div class="result"><h1>本次更新尚未公开</h1><p>有内容未通过安全检测，请修改后再提交。</p></div>${notice(S.publication.reason||'需要检查案例图片或介绍',S.published?'旧公开内容未受影响。':'草稿已保留。')}${row('修改本次内容','',S.draft.works.length?`edit('work','${S.draft.works[0].id}')`:`edit('service','${S.draft.services[0]?.id||''}')`)}`;
else if(p==='unknown')x=`<div class="result"><div class="pendingicon">?</div><h1>发布结果待确认</h1><p>网络中断，请先查询原任务状态。<br>不要重新提交。</p></div>${notice('原发布请求已保留','恢复连接后查询同一次请求，避免重复发布。')}${btn('查询原任务',"U.flash='仍在确认这次请求，请稍后查看。';persist();render()",'primary')}`;
else if(p==='pending'||p==='submitting'){
const sending=p==='submitting';
x=`<div class="result">${expression('focus')}<h1>${sending?'正在提交':'已提交，尚未公开'}</h1><p>${sending?'正在确认接收，请勿重复提交。':'正在进行内容安全检测。<br>你可以离开，在管理橱窗查看结果。'}</p></div><div class="timeline"><div class="${sending?'current':'done'}"><b>${sending?'正在接收本次内容':'✓ 已接收本次内容'}</b></div><div class="${sending?'future':'current'}"><b>${sending?'等待内容检测':'内容检测中'}</b><p>通过后才能公开</p></div><div class="future"><b>待公开</b><p>现在还没有完成这一步</p></div></div>${S.published?notice('旧版本继续展示','本次草稿通过检测后替换公开内容。'):''}${!sending?row('需要继续修改？','先撤回本次提交',"U.modal={type:'pendingEdit'};render()"):''}`;
}else x=notice('目前没有进行中的发布','返回管理橱窗，保存草稿后预览并提交。');
return `<main>${x}</main>`+footer('返回管理橱窗',"openPage('manager')");
}
function modalUI(){
if(!U.modal)return '';const m=U.modal;let title,copy,actions;
if(m.type==='leave'||m.type==='childLeave'){title='保留这次修改吗？';copy=m.type==='childLeave'?'当前内容还没有带回上一级。':'这些修改尚未保存到草稿。';actions=btn('继续编辑',"confirmModal('stay')")+btn('放弃这次修改',"confirmModal('discard')")+(m.type==='childLeave'?btn('完成并返回',"U.modal=null;finishChild()",'primary'):btn('保存草稿并返回',"confirmModal('save')",'primary'));}
if(m.type==='pendingEdit'){title='先撤回本次提交？';copy='已提交的内容正在检测。撤回后修改新草稿；已公开的旧内容不受影响。';actions=btn('继续等待检测',"confirmModal('stay')")+btn('撤回并编辑',"confirmModal('withdraw')",'primary');}
if(m.type==='removeImage'){title='移除这张图片？';copy='从本次编辑中移除，保存案例草稿后保留修改。';actions=btn('保留图片',"confirmModal('stay')")+btn('移除图片',"confirmModal('removeImage')",'primary');}
if(m.type==='removeService'){title='删除这项服务？';copy='关联案例会保留并解除关联。发布更新后才从公开主页移除，已有订单不受影响。';actions=btn('保留服务',"confirmModal('stay')")+btn('删除服务草稿',"confirmModal('removeService')",'primary');}
if(m.type==='reset'){title='重置这份演示数据？';copy='仅清空此浏览器的 V4 原型数据，不影响小程序账号。';actions=btn('取消',"confirmModal('stay')")+btn('重置为首次使用',"confirmModal('reset')",'primary');}
if(m.type==='conflict'){title='草稿在另一处更新了';copy='当前输入不会被自动覆盖。保留编辑，或放弃当前输入并读取最新草稿。';actions=btn('保留当前编辑',"confirmModal('stay')")+btn('放弃输入并读取草稿',"U.modal=null;cancelEditor()",'primary');}
return `<div class="scrim"><div class="sheet"><div class="handle"></div><h1>${title}</h1><p>${copy}</p>${actions}</div></div>`;
}
function content(){
if(U.page==='loading')return '<main><div class="skeleton"><div></div><div></div><div></div></div><p class="help">正在读取你的橱窗…</p></main>';
if(U.page==='loadfailed')return `<main><div class="empty"><h1>暂时无法读取橱窗</h1><p>当前无法确认内容，请重试。<br>不会因此清空你的草稿。</p>${btn('重新读取',"openPage('manager')",'primary')}</div></main>`;
if(U.page==='manager')return manager();
if(U.page==='services'||U.page==='works')return lists(U.page);
if(U.page==='service')return serviceEditor();
if(U.page==='work')return workEditor();
if(U.page==='photoPicker')return photoPicker();
if(U.page==='text')return textEditor();
if(['association','associatedworks'].includes(U.page))return associations();
if(U.page==='original')return `<main>${photo(imageSettings()?.url||'','docphoto','未加水印的原图')}</main>`;
if(U.page==='images')return imagesEditor();
if(U.page==='watermark')return watermarkEditor();
if(U.page==='profile')return profileEditor();
if(U.page==='account')return accountEditor();
if(U.page==='banner')return bannerEditor();
if(U.page==='notice')return noticeEditor();
if(U.page==='calendar')return calendarEditor();
if(U.page==='preview')return previewPage();
if(['workpreview','servicepreview','gallery','noticepreview','preferences','reviews','schedulepreview'].includes(U.page))return detailsPage();
if(U.page==='review')return reviewPage();
if(U.page==='result')return resultPage();
return manager();
}
function phoneHTML(){
let c=content(),message=U.error?`<div class="feedback dangerbox" role="alert">${esc(U.error)}${U.failedUpload?btn('重试失败图片','retryUpload()','outline spaced'):''}</div>`:U.flash?`<div class="feedback" role="status">${esc(U.flash)}</div>`:'';
if(message)c=c.replace(/<main(?: class="[^"]*")?>/,match=>match+message);
return `<div class="phone">${header()}${c}${modalUI()}</div>`;
}
function toolsHTML(){
return `<div class="reviewtools"><button onclick="openModal('reset')">重置为首次使用</button><button onclick="chooseDemo();persist();render()">载入示例草稿</button><button onclick="location.href='?board=all'">查看全部修订页面</button><details open><summary>演示控制 · 不属于产品界面</summary><p class="current">当前：${esc(S.publication.status)}<br>草稿保存次数：${S.writes}</p><button onclick="sampleImage()" ${U.edit?'':'disabled'}>给当前编辑加入示意图片</button><button onclick="simulate('pass')">模拟：检测通过并公开</button><button onclick="simulate('reject')">模拟：内容未通过</button><button onclick="simulate('unknown')">模拟：发布结果未知</button><button onclick="simulate('avatarpass')">模拟：头像检测通过</button><button onclick="testing.saveFailure=!testing.saveFailure;render()">保存失败：${testing.saveFailure?'开':'关'}</button><button onclick="testing.uploadFailure=!testing.uploadFailure;render()">上传失败：${testing.uploadFailure?'开':'关'}</button><button onclick="testing.capability=!testing.capability;render()">发布服务：${testing.capability?'可用':'不可用'}</button></details></div>`;
}
function routeNote(){
return ({works:'作品集是案例编辑的母页。浏览草稿、进入添加或编辑、置顶；保存返回此页。完成后去服务与报价关联案例，公开状态按发布快照区分。',manager:'首次引导按案例→服务与报价（关联案例）→预览发布的顺序进行。已使用用户直接看到管理状态。',service:'服务报价是预约服务的明确报价；案例参考价不在此处混用。',work:'先选图、再设置水印，返回此页才开始上传。方形缩略图展示进度、失败重试及删除。此处上传为演示，不连接云服务。',text:'完成会把输入带回同一对象；父页保存前仍属于未保存编辑。',images:'方形缩略图同时展示；第一张自动成为首图，不提供重排或手动选首图。',photoPicker:'这是选图组件交互示意。按点选顺序编号；浏览器导入后须在此确认顺序，微信原生能力待开发验证。',watermark:'选图后的第三步。逐张预览，可统一设置水印；下一步返回案例页并开始模拟上传。无前后移动和手动首图设置。',review:'只读检查已保存草稿；不触发保存，摘要包含新增、修改与移除。',result:'接收、检测、公开分开呈现；检测中不显示主成功对勾。',calendar:'状态与档期独立保存，明确未公开日期仍可发起待确认预约。',profile:'短字段原地填写，偏好与头图折叠；不暗中从案例选头图。',account:'独立保存，头像待检测时保留旧公开头像；昵称可以先保存。',preview:'与发布确认读取同一份已保存草稿；公开主页只读取已发布快照。'})[U.page]||'返回沿用当前对象和来源；取消不提交子层输入。';
}
function render(){
if(new URLSearchParams(location.search).has('board'))return renderBoard();
document.body.classList.toggle('onlybody',new URLSearchParams(location.search).has('only'));
document.getElementById('root').innerHTML=`<div class="shell"><aside><h1>万匠屋 · V4</h1><p class="reviewbar">交互设计原型<br>仅浏览器演示，不连接真实账号。初始昵称与城市是测试设定，示意图片非用户作品。</p>${toolsHTML()}</aside><div class="stage">${phoneHTML()}<div class="annotation"><small>新手路径与全部子页同步修订</small><h2>${pageTitle()}</h2><p>${routeNote()}</p><div class="routeinfo"><strong>可以连续操作</strong><p>输入、关联、子页回填和草稿保留在本浏览器；刷新可恢复。发布检测结果需用左侧控制模拟，不代表真实云端处理。</p><p>服务与案例可为空开始，先保存不完整草稿也不会公开。</p><p>尚未进行真实新手或微信原生验收。</p>${storageWarning?`<p>${esc(storageWarning)}</p>`:''}<a href="?board=all">全部页面与状态总览 →</a><br><a href="修订说明.md">18 项问题对应修订 →</a></div></div></div></div>`;
}
function fixtureEdit(kind,id){
U.kind=kind;U.id=id||'';U.page=kind;
U.edit=clone(kind==='work'?(S.draft.works.find(x=>x.id===id)||blankWork()):kind==='service'?(S.draft.services.find(x=>x.id===id)||blankService()):kind==='account'?S.account:kind==='calendar'?{accepting:S.accepting,days:S.days}:S.draft[kind]);
U.original=clone(U.edit);
}
const fixtures=[
['首用与管理','first','首次空橱窗',()=>{S=blank();}],
['首用与管理','manager','有草稿的管理页',()=>{}],
['首用与管理','services','服务列表与下一步',()=>{U.page='services';}],
['作品集母页','works','作品集 · 案例管理与下一步',()=>{const first=S.draft.works[0];first.pinned=true;S.draft.works.push({...clone(first),id:'work-second',title:'清透日常妆造',pinned:false},{...blankWork(),id:'work-incomplete',title:'舞台妆造',images:clone(first.images)});U.page='works';}],
['首用与管理','empty-services','服务列表空态',()=>{S.draft.services=[];U.page='services';}],
['作品集母页','empty-works','作品集 · 首次添加',()=>{S.draft.works=[];U.page='works';}],
['作品集母页','portfolio-published','作品集 · 已公开与未发布修改',()=>{S.draft.works.push({...clone(S.draft.works[0]),id:'public-second',title:'漫展角色妆造'});S.published=clone(S.draft);S.draft.works[0].description+=' 新增妆造细节';U.page='works';}],
['作品集母页','portfolio-pending','作品集 · 内容检测中',()=>{S.publication={status:'pending',snapshot:clone(S.draft),rev:S.rev};U.page='works';}],
['首用与管理','nochange','公开且没有新修改',()=>{S.published=clone(S.draft);S.publication.status='published';}],
['服务与关联','new-service','添加服务',()=>fixtureEdit('service')],
['服务与关联','edit-service','编辑服务及全部选填项',()=>{fixtureEdit('service','service-demo');U.expand=true;}],
['服务与关联','service-text','服务介绍编辑',()=>{fixtureEdit('service','service-demo');U.child={key:'description',title:'服务介绍',value:U.edit.description,max:1000};U.childOriginal=clone(U.child);U.page='text';}],
['服务与关联','associatedworks','服务选择案例',()=>{fixtureEdit('service','service-demo');U.page='associatedworks';}],
['服务与关联','no-associatedworks','没有可选案例',()=>{fixtureEdit('service','service-demo');S.draft.works=[];U.page='associatedworks';}],
['服务与关联','delete-service','删除服务确认',()=>{fixtureEdit('service','service-demo');S.draft.services.push({...blankService(),name:'舞台妆造'});U.modal={type:'removeService',id:'service-demo'};}],
['案例与图片','new-work','添加妆造案例',()=>fixtureEdit('work')],
['案例与图片','edit-work','案例编辑及全部选填项',()=>{fixtureEdit('work','work-demo');U.expand=true;}],
['案例与图片','work-text','案例介绍原页输入',()=>{fixtureEdit('work','work-demo');}],
['案例与图片','association','案例选择服务',()=>{fixtureEdit('work','work-demo');U.page='association';}],
['案例与图片','no-association','尚无服务时创建并返回',()=>{fixtureEdit('work','work-demo');S.draft.services=[];U.page='association';}],
['案例与图片','images','多图缩略展示',()=>{fixtureEdit('work','work-demo');U.edit.images.push({...clone(U.edit.images[0]),id:'image-2'});U.page='images';}],
['案例与图片','watermark','合并后的完整水印设置',()=>{fixtureEdit('work','work-demo');const im=caseImage('sample.png');U.batch={candidates:[im],selected:[im.id],active:0};U.child={spec:{...im.watermark,enabled:true},all:true};U.page='watermark';}],
['案例与图片','remove-image','移除图片确认',()=>{fixtureEdit('work','work-demo');U.page='images';U.modal={type:'removeImage',id:'image-demo'};}],
['案例与图片','upload-failure','上传失败保留原内容',()=>{fixtureEdit('work','work-demo');U.page='work';U.edit.images[0].upload='failed';}],
['资料与须知','profile','资料与短字段原地填写',()=>{fixtureEdit('profile');U.expand=true;}],
['资料与须知','banner','独立头图未设置',()=>{fixtureEdit('profile');U.page='banner';}],
['资料与须知','banner-set','用户已指定头图',()=>{fixtureEdit('profile');U.edit.banner='sample.png';U.page='banner';}],
['资料与须知','account','账号资料独立保存',()=>fixtureEdit('account')],
['资料与须知','avatar-pending','新头像检测中',()=>{S.account.pending='sample.png';fixtureEdit('account');}],
['资料与须知','avatar-rejected','头像未通过，保留旧头像',()=>{S.account.avatarError='新头像未通过内容检测，请换一张图片。当前公开头像不变。';fixtureEdit('account');}],
['资料与须知','avatar-crop','头像取景直接调整',()=>{fixtureEdit('account');U.edit.avatar='sample.png';U.expand=true;}],
['资料与须知','notice','合作须知与配图',()=>{fixtureEdit('notice');U.edit.text='请提前提供角色参考图、活动时间和地点。';U.expand=true;}],
['档期与接单','calendar','公开档期与接单状态',()=>fixtureEdit('calendar')],
['档期与接单','paused','暂停接单的含义',()=>{fixtureEdit('calendar');U.edit.accepting=false;}],
['档期与接单','locked','订单锁定日期不可修改',()=>{fixtureEdit('calendar');const d=new Date();d.setDate(d.getDate()+1);U.edit.days[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`]='locked';}],
['预览与下钻','preview','草稿主页预览',()=>{U.page='preview';}],
['预览与下钻','preview-banner','明确设置头图后的预览',()=>{S.draft.profile.banner='sample.png';U.page='preview';}],
['预览与下钻','preview-empty','没有案例时的预览',()=>{S.draft.works=[];U.page='preview';}],
['预览与下钻','public-preview','公开主页版本',()=>{S.published=clone(S.draft);U.publicView=true;U.page='preview';}],
['预览与下钻','work-preview','案例详情与价格含义',()=>{S.draft.works[0].referencePrice='460';U.page='workpreview';U.viewId='work-demo';}],
['预览与下钻','service-preview','服务详情与关联案例',()=>{U.page='servicepreview';U.viewId='service-demo';}],
['预览与下钻','gallery','原比例图集',()=>{U.page='gallery';U.viewId='work-demo';}],
['预览与下钻','notice-preview','合作须知阅读',()=>{S.draft.notice.text='请提前提供角色参考图、活动时间及地点。';U.page='noticepreview';}],
['预览与下钻','preferences','合作偏好阅读',()=>{S.draft.profile.specialties='清透自然与角色还原';S.draft.profile.declines='暂不承接特殊伤效妆';S.draft.profile.hours='10:00—21:00';U.page='preferences';}],
['预览与下钻','reviews','评价空态',()=>{U.page='reviews';}],
['预览与下钻','schedule-preview','公开档期只读',()=>{U.page='schedulepreview';}],
['发布与恢复','review','发布前确认完整变更',()=>{U.page='review';}],
['发布与恢复','review-mixed','新增、修改与移除明细',()=>{S.published=clone(S.draft);S.published.services.push({...blankService(),name:'旧服务'});S.draft.works[0].title='更新后的角色妆造';S.draft.notice.text='预约请提前 3 天。';U.page='review';}],
['发布与恢复','missing','必要信息缺项定位',()=>{S.draft.services[0].price='';S.draft.works[0].description='';U.page='review';}],
['发布与恢复','submitting','提交尚未确认',()=>{S.publication={status:'submitting',snapshot:clone(S.draft)};U.page='result';}],
['发布与恢复','pending','检测中尚未公开',()=>{S.publication={status:'pending',snapshot:clone(S.draft)};U.page='result';}],
['发布与恢复','pending-manager','检测中返回管理',()=>{S.publication={status:'pending',snapshot:clone(S.draft)};}],
['发布与恢复','published','已公开后检查接单状态',()=>{S.published=clone(S.draft);S.publication.status='published';U.page='result';}],
['发布与恢复','rejected','内容未通过',()=>{S.publication={status:'rejected',reason:'案例“森系角色妆造”的第 1 张图片未通过检测。'};U.page='result';}],
['发布与恢复','unknown','未知结果查询原任务',()=>{S.publication={status:'unknown',snapshot:clone(S.draft)};U.page='result';}],
['发布与恢复','save-failure','保存失败保留输入',()=>{fixtureEdit('work','work-demo');U.error='这次修改未保存成功，输入和已上传图片仍然保留。';}],
['发布与恢复','unsaved','未保存返回确认',()=>{fixtureEdit('work','work-demo');U.edit.title='还没保存的修改';U.modal={type:'leave'};}],
['发布与恢复','child-unsaved','子页取消编辑确认',()=>{fixtureEdit('work','work-demo');U.child={key:'description',title:'妆造案例介绍',value:'正在编辑的内容',max:1200};U.page='text';U.modal={type:'childLeave'};}],
['发布与恢复','withdraw','检测中撤回再编辑',()=>{S.publication={status:'pending',snapshot:clone(S.draft)};U.page='result';U.modal={type:'pendingEdit',kind:'work',id:'work-demo'};}],
['发布与恢复','unavailable','发布暂不可用',()=>{testing.capability=false;U.page='review';}]
];
fixtures.push(['发布与恢复','loading','读取中不显示虚假空态',()=>{U.page='loading';}],['发布与恢复','loadfailed','读取失败原处重试',()=>{U.page='loadfailed';}],['发布与恢复','conflict','版本冲突保留本页编辑',()=>{fixtureEdit('work','work-demo');U.edit.description='这段输入尚未保存';U.modal={type:'conflict'};}]);
fixtures.push(
['案例与图片','photo-picker','相册点选顺序编号',()=>{fixtureEdit('work');U.batch={candidates:Array.from({length:5},(_,i)=>({...caseImage('sample.png'),id:'pick-'+i})),selected:['pick-2','pick-0','pick-3'],active:0};U.page='photoPicker';}],
['案例与图片','batch-watermark','第三步 · 水印与逐图预览',()=>{fixtureEdit('work');const ims=Array.from({length:3},()=>caseImage('sample.png'));U.batch={candidates:ims,selected:ims.map(i=>i.id),active:0};U.child={spec:{...ims[0].watermark,enabled:true},all:true};U.page='watermark';}],
['案例与图片','photos-uploading','返回案例 · 逐图上传',()=>{fixtureEdit('work');U.edit.images=Array.from({length:4},(_,i)=>({...caseImage('sample.png'),upload:i===0?'done':'uploading',progress:24+i*12}));}],
['案例与图片','photos-full','五张图片 · 自动首图',()=>{fixtureEdit('work');U.edit.images=Array.from({length:5},()=>caseImage('sample.png'));}]
);
function prepareFixture(id){chooseDemo();testing={saveFailure:false,uploadFailure:false,capability:true};fixtures.find(f=>f[1]===id)?.[3]();}
function renderBoard(){
const saved={S:clone(S),U:clone(U),testing:clone(testing)};
const q=new URLSearchParams(location.search),group=q.get('group');
const groups=[...new Set(fixtures.map(f=>f[0]))];let markup='';
for(const g of groups.filter(g=>!group||g===group)){
markup+=`<section class="gallerygroup"><h2>${g}</h2><div class="fullboard">`;
for(const f of fixtures.filter(f=>f[0]===g)){
prepareFixture(f[1]);let phone=phoneHTML();if(U.expand)phone=phone.replaceAll('<details>','<details open>');
markup+=`<article><a class="boardlabel" href="?fixture=${f[1]}"><b>${f[2]}</b><span>打开交互场景 →</span></a>${phone}<div class="boardnote">${routeNote()}</div></article>`;
}
markup+='</div></section>';
}
S=saved.S;U=saved.U;testing=saved.testing;
document.body.classList.remove('onlybody');
document.getElementById('root').innerHTML=`<div class="gallery"><div class="galleryhead"><small>万匠屋 / V4 全范围修订</small><h1>按任务组织，而不是让新手走遍每个页面</h1><p>七组完整修订；原独立短字段、水印位置、图片设置合并到所属页面。图中是明确标注的演示场景，点击标题进入可连续操作的原型。</p><p>仅浏览器原型 · AI 示意图不证明真实妆造图片效果 · 无真实发布或审核</p><div class="groupnav"><a href="/">继续我的演示</a><a href="?board=all">全部</a>${groups.map(g=>`<a href="?board=all&group=${encodeURIComponent(g)}">${g}</a>`).join('')}<a href="修订说明.md">报告逐项处理</a></div></div>${markup}</div>`;
// 总览卡片只展示画面，避免操作到不属于这张卡片的演示数据。
document.querySelectorAll('.fullboard .phone').forEach(p=>{p.inert=true;});
}
const params=new URLSearchParams(location.search);
if(params.has('fixture')){
// 场景试用与“继续我的演示”分开，不覆盖用户已有原型数据。
prepareFixture(params.get('fixture'));U.fixtureMode=true;
}
const persistOriginal=persist;
persist=function(){if(params.has('fixture'))return true;return persistOriginal();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!params.has('board'))back();});
render();





