const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function present(work){let definition;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/components/work-card/index.js'),'utf8'),{Component:value=>definition=value});let result;definition.properties.work.observer.call({setData:value=>result=value},work);return result;}
test('作品卡不把缺失统计或成交统计冒充参考次数',()=>{
 for(const count of [undefined,null,-1,'18',NaN])assert.equal(present({referenceCount:count,soldCount:99}).referenceText,'');
 assert.equal(present({referenceCount:0}).referenceText,'被参考 0 次');
 assert.equal(present({referenceCount:31}).referenceText,'被参考 31 次');
});
test('作品卡兼容上传预览图与公开封面，优先展示预览图',()=>{
 assert.equal(present({imagePreviews:['preview'],coverImage:'public'}).coverImage,'preview');
 assert.equal(present({coverImage:'public'}).coverImage,'public');
 assert.equal(present(null).coverImage,'');
});
