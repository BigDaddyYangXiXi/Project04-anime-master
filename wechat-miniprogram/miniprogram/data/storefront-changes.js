// Compare persisted content, excluding generated codes and presentation URLs.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['code','referenceCount','accepting','schemaVersion'].includes(key) && value[key] != null && value[key] !== '' && !(Array.isArray(value[key]) && !value[key].length)).map(key => [key, stable(value[key])]));
}
function changes(draft, published) {
  const result = [], before = published || {}, after = draft || {};
  const different = (a,b) => JSON.stringify(stable(a || {})) !== JSON.stringify(stable(b || {}));
  const profile = value => { const p = { ...(value || {}) }; delete p.notice; delete p.noticeImageAssetId; if(p.bannerAssetId){p.bannerFocusX=p.bannerFocusX??50;p.bannerFocusY=p.bannerFocusY??50;}else{delete p.bannerFocusX;delete p.bannerFocusY;} return p; };
  if (different(profile(after.profile),profile(before.profile))) result.push({ key:'profile',kind:'profile',name:'橱窗资料与头图',action:published?'修改':'新增' });
  const notice = value => ({ notice:value?.notice || '',noticeImageAssetId:value?.noticeImageAssetId || null });
  if (different(notice(after.profile),notice(before.profile))) result.push({ key:'notice',kind:'notice',name:'合作须知',action:published?'修改':'新增' });
  for (const [collection,kind] of [['services','service'],['works','work']]) {
    const content = item => kind === 'work' ? { ...item, sourceImageAssetIds:item.sourceImageAssetIds || item.imageAssetIds || [], watermarks:(item.imageAssetIds || []).map((_,index)=>item.watermarks?.[index]?.enabled ? item.watermarks[index] : null) } : {...item,serviceMode:item.serviceMode || 'ONSITE'};
    const old = new Map((before[collection] || []).map(item=>[item.id,item]));
    for (const item of after[collection] || []) {
      const previous=old.get(item.id);
      const pinChanged=kind==='work' && (before.pinnedWorkIds || []).indexOf(item.id)!==(after.pinnedWorkIds || []).indexOf(item.id);
      if (!previous || different(content(item),content(previous)) || pinChanged) result.push({ key:kind+'-'+item.id,kind,id:item.id,name:item.name || item.title || '未命名'+(kind==='work'?'案例':'服务'),action:previous?'修改':'新增' });
      old.delete(item.id);
    }
    for (const item of old.values()) result.push({ key:kind+'-'+item.id,kind,id:item.id,name:item.name || item.title || '未命名内容',action:'移除' });
  }
  return result;
}
module.exports={changes};
