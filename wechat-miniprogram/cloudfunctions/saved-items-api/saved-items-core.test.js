const test = require("node:test"); const assert = require("node:assert/strict"); const { handleSavedItems } = require("./saved-items-core");
function mockDb() {
  const saved = [
    { account_id: "acct_other", target_type: "PROVIDER", target_id: "acct_buyer", saved: 1, created_at: 1, updated_at: 1 },
    { account_id: "acct_other", target_type: "WORK", target_id: "work_mine", saved: 1, created_at: 1, updated_at: 1 },
    { account_id: "acct_other_2", target_type: "WORK", target_id: "work_mine", saved: 0, created_at: 1, updated_at: 2 }
  ]; const publications = [
    { provider_id: "acct_provider", payload: JSON.stringify({ profile: {}, services: [], works: [{ id: "work_1" }] }) },
    { provider_id: "acct_buyer", payload: JSON.stringify({ profile: {}, services: [], works: [{ id: "work_mine" }] }) }
  ];
  const accounts = [{ id: 'acct_provider', status: 'ACTIVE' }, { id: 'acct_buyer', status: 'ACTIVE' }];
  const profiles = [], works = [];
  return { saved, publications, accounts, profiles, works, from(table) { let operation = "select"; let value,options={},limit=20,orders=[]; const filters = []; const builder = {
    order(k,o) { orders.push([k,o.ascending]); return builder; }, limit(n) { limit=n; return builder; }, gt(column, expected) { filters.push(row => row[column] > expected); return builder; }, lt(column, expected) { filters.push(row => row[column] < expected); return builder; }, select(columns,input={}) { options=input; return builder; }, eq(column, expected) { filters.push((row) => row[column] === expected); return builder; }, in(column, values) { filters.push((row) => values.includes(row[column])); return builder; }, upsert(input) { operation = "upsert"; value = input; return builder; },
    then(resolve) { const source = table === "account_saved_items" ? saved : table === "provider_catalog_publications" ? publications : table === 'accounts' ? accounts : table === 'provider_profiles' ? profiles : table === 'works' ? works : table === "wechat_identities" ? [{ open_id: "openid", account_id: "acct_buyer" }] : [];
      let data = source.filter((row) => filters.every((filter) => filter(row)));
      if (table === "account_saved_items" && operation === "upsert") { const row = saved.find((item) => item.account_id === value.account_id && item.target_type === value.target_type && item.target_id === value.target_id); if (row) Object.assign(row, value); else saved.push(value); data = [value]; }
      const count=options.count==='exact'?data.length:null;
      data=data.slice().sort((a,b)=>{for(const[k,asc]of orders)if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(asc?1:-1);return 0;}).slice(0,limit);
      return Promise.resolve({ data:options.head?null:data, count, error: null }).then(resolve); }
  }; return builder; } };
}
test("saves and removes public providers and works idempotently", async () => {
  const db = mockDb();
  await handleSavedItems(db, { action: "setSaved", targetType: "PROVIDER", targetId: "acct_provider", saved: true }, { WX_OPENID: "openid" }, 1000);
  await handleSavedItems(db, { action: "setSaved", targetType: "WORK", targetId: "work_1", saved: true }, { WX_OPENID: "openid" }, 2000);
  let list = await handleSavedItems(db, { action: "listMine" }, { WX_OPENID: "openid" });
  assert.deepEqual(list, { providerIds: ["acct_provider"], workIds: ["work_1"], receivedProviderFollows: 1, receivedWorkLikes: 1 });
  await handleSavedItems(db, { action: "setSaved", targetType: "WORK", targetId: "work_1", saved: false }, { WX_OPENID: "openid" }, 3000);
  list = await handleSavedItems(db, { action: "listMine" }, { WX_OPENID: "openid" }); assert.deepEqual(list.workIds, []);
});
test("counts only active follows and likes received by the current account", async () => {
  const result = await handleSavedItems(mockDb(), { action: "listMine" }, { WX_OPENID: "openid" });
  assert.equal(result.receivedProviderFollows, 1);
  assert.equal(result.receivedWorkLikes, 1);
});
test('received counts and work totals exceed the default twenty-row response limit',async()=>{
 const db=mockDb();db.saved.length=0;
 for(let i=0;i<237;i++){db.saved.push({account_id:'fan_'+i,target_type:'PROVIDER',target_id:'acct_buyer',saved:1,updated_at:100});db.saved.push({account_id:'fan_'+i,target_type:'WORK',target_id:'work_mine',saved:1,updated_at:100});}
 db.saved.push({account_id:'hidden',target_type:'WORK',target_id:'work_mine',saved:0},{account_id:'other',target_type:'WORK',target_id:'work_1',saved:1});
 const totals=await handleSavedItems(db,{action:'listMine'},{WX_OPENID:'openid'}),details=await handleSavedItems(db,{action:'listReceived',type:'likes'},{WX_OPENID:'openid'});
 assert.equal(totals.receivedProviderFollows,237);assert.equal(totals.receivedWorkLikes,237);assert.equal(details.items[0].count,237);
 const ids=[];let cursor=null;do{const page=await handleSavedItems(db,{action:'listReceived',type:'followers',cursor},{WX_OPENID:'openid'});ids.push(...page.items.map(x=>x.id));cursor=page.cursor;}while(cursor);
 assert.equal(ids.length,237);assert.equal(new Set(ids).size,237);
});
test('own saved ids remain complete across pages and retain newest-first order',async()=>{
 const db=mockDb();for(let i=0;i<67;i++)for(const type of ['WORK','PROVIDER'])db.saved.push({account_id:'acct_buyer',target_type:type,target_id:'saved_'+String(i).padStart(3,'0'),saved:1,updated_at:i});
 db.saved.push({account_id:'acct_buyer',target_type:'WORK',target_id:'removed',saved:0,updated_at:999});
 const result=await handleSavedItems(db,{action:'listMine'},{WX_OPENID:'openid'});
 for(const ids of [result.providerIds,result.workIds]){assert.equal(ids.length,67);assert.equal(new Set(ids).size,67);assert.equal(ids[0],'saved_066');assert.equal(ids.at(-1),'saved_000');}
});
test('a missing or approximate count is not silently replaced by a truncated row count',async()=>{
 for(const count of [undefined,null,-1,1.5,'237']){
  const base=mockDb(),db={from(table){const q=base.from(table);if(table==='account_saved_items'){const select=q.select;q.select=(columns,options)=>{select(columns,options);if(options?.count)q.then=resolve=>Promise.resolve({data:[{}],count,error:null}).then(resolve);return q;};}return q;}};
  await assert.rejects(handleSavedItems(db,{action:'listMine'},{WX_OPENID:'openid'}),{code:'DATABASE_OPERATION_FAILED'});
 }
});

test('received work likes are restricted to caller publication and reject invalid pagination', async () => {
  const result = await handleSavedItems(mockDb(), { action: 'listReceived', type: 'likes' }, { WX_OPENID: 'openid' });
  assert.deepEqual(result, { items: [{ id: 'work_mine', title: '未命名作品', count: 1, providerId: 'acct_buyer' }], cursor: null });
  await assert.rejects(handleSavedItems(mockDb(), { action: 'listReceived', type: 'likes', cursor: -1 }, { WX_OPENID: 'openid' }), { code: 'VALIDATION_ERROR' });
});

test('follower response exposes public names only and cannot select another target', async () => {
  const db = mockDb(); db.accounts.push({ id: 'acct_other', status: 'ACTIVE', nickname: '关注者', username: 'Follower', phone: 'private', open_id: 'secret' });
  const result = await handleSavedItems(db, { action: 'listReceived', type: 'followers', targetId: 'acct_provider' }, { WX_OPENID: 'openid' });
  assert.deepEqual(result.items, [{ id: 'acct_other', nickname: '关注者', username: 'Follower' }]);
  assert.equal(result.cursor, null);
});
test("rejects non-public targets and missing identity", async () => {
  await assert.rejects(() => handleSavedItems(mockDb(), { action: "setSaved", targetType: "WORK", targetId: "missing", saved: true }, { WX_OPENID: "openid" }), (error) => error.code === "TARGET_NOT_PUBLIC");
  await assert.rejects(() => handleSavedItems(mockDb(), { action: "listMine" }, {}), (error) => error.code === "AUTH_CONTEXT_MISSING");
});

test('suspended or closed authors cannot receive new follows or likes, but removal remains allowed', async () => {
  for (const status of ['SUSPENDED', 'CLOSED']) {
    for (const [targetType, targetId] of [['PROVIDER', 'acct_provider'], ['WORK', 'work_1']]) {
      const db = mockDb(); db.accounts[0].status = status;
      const event = { action: 'setSaved', targetType, targetId, saved: true };
      const before = structuredClone(db.saved);
      await assert.rejects(handleSavedItems(db, event, { WX_OPENID: 'openid' }), { code: 'TARGET_NOT_PUBLIC' });
      assert.deepEqual(db.saved, before);
      assert.equal((await handleSavedItems(db, { ...event, saved: false }, { WX_OPENID: 'openid' })).saved, false);
    }
  }
});

test('legacy public targets remain usable, but an existing new snapshot forbids old work fallback', async () => {
  const db = mockDb(); db.publications.shift();
  db.profiles.push({ provider_id: 'acct_provider', publish_status: 'PUBLISHED' });
  db.works.push({ id: 'work_1', provider_id: 'acct_provider', status: 'PUBLISHED' });
  for (const [targetType, targetId] of [['PROVIDER', 'acct_provider'], ['WORK', 'work_1']]) {
    assert.equal((await handleSavedItems(db, { action: 'setSaved', targetType, targetId, saved: true }, { WX_OPENID: 'openid' })).saved, true);
  }
  db.publications.push({ provider_id: 'acct_provider', payload: '{' });
  for (const [targetType, targetId] of [['PROVIDER', 'acct_provider'], ['WORK', 'work_1']]) {
    await assert.rejects(handleSavedItems(db, { action: 'setSaved', targetType, targetId, saved: true }, { WX_OPENID: 'openid' }), { code: 'TARGET_NOT_PUBLIC' });
  }
});

test('unrelated damaged publication cannot prevent liking a valid work', async () => {
  const db = mockDb(); db.publications.unshift({ provider_id: 'damaged', payload: '{' });
  const result = await handleSavedItems(db, { action: 'setSaved', targetType: 'WORK', targetId: 'work_1', saved: true }, { WX_OPENID: 'openid' });
  assert.equal(result.saved, true);
});

for (const kind of ['snapshot', 'legacy']) test(`ambiguous ${kind} work ownership rejects new likes but permits removing old ones`, async () => {
  const db = mockDb();
  db.accounts.push({ id: 'other_author', status: 'ACTIVE' });
  if (kind === 'snapshot') db.publications.push({ provider_id: 'other_author', payload: { profile: {}, services: [], works: [{ id: 'work_1' }] } });
  else {
    db.profiles.push({ provider_id: 'other_author', publish_status: 'PUBLISHED' });
    db.works.push({ id: 'work_1', provider_id: 'other_author', status: 'PUBLISHED' });
  }
  const event = { action: 'setSaved', targetType: 'WORK', targetId: 'work_1', saved: true };
  const before = structuredClone(db.saved);
  await assert.rejects(handleSavedItems(db, event, { WX_OPENID: 'openid' }), { code: 'TARGET_NOT_PUBLIC' });
  assert.deepEqual(db.saved, before);
  assert.equal((await handleSavedItems(db, { ...event, saved: false }, { WX_OPENID: 'openid' })).saved, false);
});

for (const kind of ['snapshot', 'legacy']) test(`inactive ${kind} author does not shadow the unique public work`, async () => {
  for (const status of ['SUSPENDED', 'CLOSED']) {
    const db = mockDb();
    db.accounts.push({ id: 'other_author', status });
    if (kind === 'snapshot') db.publications.unshift({ provider_id: 'other_author', payload: { profile: {}, services: [], works: [{ id: 'work_1' }] } });
    else {
      db.profiles.push({ provider_id: 'other_author', publish_status: 'PUBLISHED' });
      db.works.push({ id: 'work_1', provider_id: 'other_author', status: 'PUBLISHED' });
    }
    assert.equal((await handleSavedItems(db, { action: 'setSaved', targetType: 'WORK', targetId: 'work_1', saved: true }, { WX_OPENID: 'openid' })).saved, true);
  }
});

test('hidden legacy author and superseded legacy work do not create a second public owner', async () => {
  const db = mockDb();
  db.accounts.push({ id: 'other_author', status: 'ACTIVE' });
  db.profiles.push({ provider_id: 'other_author', publish_status: 'DRAFT' });
  db.works.push({ id: 'work_1', provider_id: 'other_author', status: 'PUBLISHED' });
  const event = { action: 'setSaved', targetType: 'WORK', targetId: 'work_1', saved: true };
  assert.equal((await handleSavedItems(db, event, { WX_OPENID: 'openid' })).saved, true);
  db.profiles[0].publish_status = 'PUBLISHED';
  db.publications.push({ provider_id: 'other_author', payload: { profile: {}, services: [], works: [] } });
  assert.equal((await handleSavedItems(db, event, { WX_OPENID: 'openid' })).saved, true);
});

test('work ownership checks later publication pages and rejects cross-page ambiguity',async()=>{
 const db=mockDb();for(let i=0;i<45;i++){const owner='page_'+String(i).padStart(3,'0');db.accounts.push({id:owner,status:'ACTIVE'});db.publications.push({provider_id:owner,payload:JSON.stringify({profile:{},services:[],works:[{id:i===44?'late_work':'filler_'+i}]})});}
 await handleSavedItems(db,{action:'setSaved',targetType:'WORK',targetId:'late_work',saved:true},{WX_OPENID:'openid'});
 assert.ok(db.saved.some(x=>x.target_id==='late_work'&&x.saved===1));
 db.publications.at(-1).payload=JSON.stringify({profile:{},services:[],works:[{id:'work_1'}]});
 await assert.rejects(handleSavedItems(db,{action:'setSaved',targetType:'WORK',targetId:'work_1',saved:true},{WX_OPENID:'openid'}),{code:'TARGET_NOT_PUBLIC'});
 assert.equal(db.saved.some(x=>x.target_id==='work_1'&&x.saved===1),false);
});
