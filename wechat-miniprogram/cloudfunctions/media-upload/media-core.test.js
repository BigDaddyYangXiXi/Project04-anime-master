const test = require("node:test");
const assert = require("node:assert/strict");
const { handleMediaUpload, validateFileId } = require("./media-core");

const ENV_ID = "cloudbase-d2g65rqbvee0bd978";
const caller = { WX_OPENID: "openid-me", TCB_ENV: ENV_ID };

function mockDb(asset = null, order = null, beforeUpdate) {
  let media = asset ? { ...asset } : null;
  const writes = [];
  return {
    writes,
    from(table) {
      let operation = "select";
      let value;
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, expected) { filters.push([column, expected]); return builder; },
        in(column, values) { filters.push([column, values]); return builder; },
        is(column, expected) { filters.push([column, expected]); return builder; },
        insert(input) { operation = "insert"; value = input; return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          if (operation !== "select") writes.push({ table, operation, value, filters });
          let data = [];
          if (table === "wechat_identities") data = [{ account_id: "acct_me" }];
          else if (table === "accounts") data = [{ id: "acct_me", status: "ACTIVE" }].filter(row => filters.every(([key, expected]) => row[key] === expected));
          else if (table === "media_assets" && operation === "select") data = media ? [{ ...media }].filter(row => filters.every(([column, expected]) => Array.isArray(expected) ? expected.includes(row[column]) : row[column] === expected)) : [];
          else if (table === "order_aggregates" && operation === "select") {
            data = order ? [order].filter((row) => filters.every(([column, expected]) => row[column] === expected)) : [];
          }
          else if (operation === "insert") data = [value];
          else if (operation === "update" && table === "media_assets") {
            if (beforeUpdate) { beforeUpdate(media); beforeUpdate = null; }
            if (media && filters.every(([column, expected]) => rowMatches(media, column, expected))) {
              Object.assign(media, value); data = [{ id: media.id }];
            }
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}
function rowMatches(row, column, expected) { return Array.isArray(expected) ? expected.includes(row[column]) : row[column] === expected; }

test('所有用途的可引用文件都不能通过取消上传直接删除', async () => {
  for (const purpose of ['AVATAR', 'NOTICE_IMAGE', 'WORK_IMAGE', 'PROJECT_REFERENCE', 'PROJECT_TARGET', 'ORDER_DELIVERY', 'SUPPORT_IMAGE']) {
    for (const status of ['READY', 'ORPHAN_CANDIDATE']) {
      const db = mockDb({ ...pendingAsset, purpose, status, storage_key: validFileId, committed_at: 2000 });
      let deletes = 0;
      await assert.rejects(handleMediaUpload(db, { deleteFile: async () => { deletes++; return { fileList: [{ code: 'SUCCESS' }] }; } },
        { action: 'cancelUpload', assetId: pendingAsset.id }, caller), { code: 'MEDIA_STATE_INVALID' });
      assert.equal(deletes, 0); assert.equal(db.writes.length, 0);
    }
  }
});

test('取消与审核同时发生时，审核先完成则不得删除文件', async () => {
  const db = mockDb({ ...pendingAsset, storage_key: validFileId, committed_at: 2000 }, null, row => { row.status = 'READY'; });
  let deletes = 0;
  await assert.rejects(handleMediaUpload(db, { deleteFile: async () => { deletes++; return { fileList: [{ code: 'SUCCESS' }] }; } },
    { action: 'cancelUpload', assetId: pendingAsset.id }, caller), { code: 'MEDIA_STATE_CONFLICT' });
  assert.equal(deletes, 0);
});

test('取消读取旧上传记录后提交已完成，不得删除新提交的文件', async () => {
  const db = mockDb(pendingAsset, null, row => { row.storage_key = validFileId; row.committed_at = 3000; });
  let deletes = 0;
  await assert.rejects(handleMediaUpload(db, { deleteFile: async () => { deletes++; } },
    { action: 'cancelUpload', assetId: pendingAsset.id, fileId: validFileId }, caller), { code: 'MEDIA_STATE_CONFLICT' });
  assert.equal(deletes, 0);
});

test('取消先隔离再删除，存储失败后仍不可发布且允许重试', async () => {
  const db = mockDb({ ...pendingAsset, storage_key: validFileId, committed_at: 2000 });
  const event = { action: 'cancelUpload', assetId: pendingAsset.id };
  const storage = { deleteFile: async () => {
    const media = await handleMediaUpload(db, {}, { action: 'getOwnedMedia', assetIds: [pendingAsset.id] }, caller);
    assert.equal(media.assets[0].status, 'REJECTED');
    return {};
  } };
  await assert.rejects(handleMediaUpload(db, storage, event, caller), { code: 'MEDIA_DELETE_FAILED' });
  const result = await handleMediaUpload(db, { deleteFile: async () => ({ fileList: [{ code: 'SUCCESS', fileID: validFileId }] }) }, event, caller);
  assert.equal(result.status, 'DELETED');
});

test('重复提交返回已保存的审核结果和文件地址', async () => {
  for (const status of ['PENDING', 'READY', 'REJECTED']) {
    const db = mockDb({ ...pendingAsset, storage_key: validFileId, committed_at: 2000, status });
    const result = await handleMediaUpload(db, {}, { action: 'commitUpload', assetId: pendingAsset.id }, caller);
    assert.equal(result.status, status === 'PENDING' ? 'PENDING_SECURITY_REVIEW' : status);
    assert.equal(result.fileId, validFileId); assert.equal(db.writes.length, 0);
  }
});

test('取消上传只接受目标文件明确成功的删除回执，异常后可重试', async () => {
  for (const item of [{}, { fileID: validFileId }, { code: '' }, { code: 0 }, { code: 'SUCCESS' },
    { code: 'SUCCESS', fileID: 'cloud://other/file.png' }]) {
    const db = mockDb({ ...pendingAsset, storage_key: validFileId, committed_at: 2000 });
    const event = { action: 'cancelUpload', assetId: pendingAsset.id };
    await assert.rejects(handleMediaUpload(db, { deleteFile: async () => ({ fileList: [item] }) }, event, caller), { code: 'MEDIA_DELETE_FAILED' });
    assert.equal(db.writes.some(write => write.value.status === 'DELETED'), false);
    const result = await handleMediaUpload(db, { deleteFile: async () => ({ fileList: [{ fileID: validFileId, code: 'SUCCESS' }] }) }, event, caller);
    assert.equal(result.status, 'DELETED');
  }
});

const fixedUuid = () => "12345678-1234-1234-1234-1234567890ab";

test('未提交文件编号的取消从本人上传路径解析并实际删除，不能仅改数据库', async () => {
  const db = mockDb(pendingAsset);
  let deleted = false;
  const result = await handleMediaUpload(db, {
    getUploadMetadata: async ({ cloudPath }) => { assert.equal(cloudPath, pendingAsset.storage_key); return { data: { fileId: validFileId } }; },
    deleteFile: async ({ fileList }) => { assert.deepEqual(fileList, [validFileId]); deleted = true; return { fileList: [{ fileID: validFileId, code: 'SUCCESS' }] }; }
  }, { action: 'cancelUpload', assetId: pendingAsset.id }, caller);
  assert.equal(deleted, true); assert.equal(result.status, 'DELETED');
});

test('路径解析失败或返回其他文件不得标记删除，之后可恢复取消', async () => {
  for (const metadata of [null, {}, { fileId: validFileId }, { data: { fileId: `cloud://${ENV_ID}.bucket/another-file.png` } },
    { code: 'FAILED', data: { fileId: validFileId } }]) {
    const db = mockDb(pendingAsset);
    let deletes = 0;
    const event = { action: 'cancelUpload', assetId: pendingAsset.id };
    await assert.rejects(handleMediaUpload(db, { getUploadMetadata: async () => metadata, deleteFile: async () => { deletes++; } }, event, caller));
    assert.equal(deletes, 0);
    assert.equal(db.writes.some(write => write.value.status === 'DELETED'), false);
    const result = await handleMediaUpload(db, { getUploadMetadata: async () => ({ data: { fileId: validFileId } }),
      deleteFile: async () => ({ fileList: [{ fileID: validFileId, code: 'SUCCESS' }] }) }, event, caller);
    assert.equal(result.status, 'DELETED');
  }
});
const pendingAsset = {
  id: "asset_123456781234123412341234567890ab",
  owner_account_id: "acct_me",
  purpose: "WORK_IMAGE",
  scope_id: null,
  storage_key: "user-uploads/acct_me/work_image/asset_123456781234123412341234567890ab.png",
  original_filename: "work.png",
  mime_type: "image/png",
  size_bytes: 100,
  status: "PENDING",
  committed_at: null,
  deleted_at: null
};
const validFileId = `cloud://${ENV_ID}.bucket/user-uploads/acct_me/work_image/asset_123456781234123412341234567890ab.png`;

test('不存在回执仅用于诊断，不能当成删除成功或泄露存储错误正文', async () => {
  const db = mockDb(pendingAsset);
  const storage = {
    getUploadMetadata: async () => ({ data: { fileId: validFileId } }),
    deleteFile: async () => ({ fileList: [{ fileID: validFileId, code: 'STORAGE_FILE_NONEXIST', message: 'private-sentinel' }] })
  };
  await assert.rejects(handleMediaUpload(db, storage, { action: 'cancelUpload', assetId: pendingAsset.id }, caller), error => {
    assert.equal(error.code, 'MEDIA_DELETE_FAILED');
    assert.equal(error.reason, 'STORAGE_NONEXIST');
    assert.equal(JSON.stringify(error).includes('private-sentinel'), false);
    return true;
  });
  assert.equal(db.writes.some(item => item.value.status === 'DELETED'), false);
});

test("新环境校验不接受旧环境、相似前缀或额外路径", () => {
  assert.equal(validateFileId(validFileId, pendingAsset.storage_key, ENV_ID), validFileId);
  for (const fileId of [
    validFileId.replace(ENV_ID, "quest-band-d1gem4bxt3fa17720"),
    validFileId.replace(ENV_ID, ENV_ID + "-other"),
    validFileId.replace(".bucket/", ".bucket/extra/")
  ]) assert.throws(() => validateFileId(fileId, pendingAsset.storage_key, ENV_ID), { code: "FILE_ID_MISMATCH" });
});

test("提交与取消只信任服务端环境，拒绝请求伪造或环境缺失", async () => {
  for (const action of ["commitUpload", "cancelUpload"]) {
    for (const context of [caller, { WX_OPENID: "openid-me" }]) {
      const db = mockDb(pendingAsset);
      let storageCalls = 0;
      const storage = {
        getFileInfo: async () => { storageCalls++; },
        deleteFile: async () => { storageCalls++; }
      };
      await assert.rejects(() => handleMediaUpload(db, storage, {
        action, assetId: pendingAsset.id,
        fileId: validFileId.replace(ENV_ID, "quest-band-d1gem4bxt3fa17720"),
        envId: "quest-band-d1gem4bxt3fa17720", TCB_ENV: "quest-band-d1gem4bxt3fa17720"
      }, context), { code: context.TCB_ENV ? "FILE_ID_MISMATCH" : "MEDIA_ENV_NOT_CONFIGURED" });
      assert.equal(storageCalls, 0);
      assert.equal(db.writes.length, 0);
    }
  }
});

test("服务端 SCF_NAMESPACE 可校验并取消本环境待提交文件", async () => {
  const db = mockDb(pendingAsset);
  let deleted;
  const storage = { deleteFile: async ({ fileList }) => {
    deleted = fileList;
    return { fileList: [{ code: "SUCCESS", fileID: fileList[0] }] };
  } };
  const result = await handleMediaUpload(db, storage, {
    action: "cancelUpload", assetId: pendingAsset.id, fileId: validFileId
  }, { WX_OPENID: "openid-me", SCF_NAMESPACE: ENV_ID });
  assert.equal(result.status, "DELETED");
  assert.deepEqual(deleted, [validFileId]);
});

test("准备上传只使用可信账号生成路径", async () => {
  const db = mockDb();
  const result = await handleMediaUpload(db, {}, {
    action: "prepareUpload", purpose: "WORK_IMAGE", mimeType: "image/png", sizeBytes: 100, originalFilename: "work.png", accountId: "attacker"
  }, caller, 1000, fixedUuid);
  assert.equal(result.assetId, pendingAsset.id);
  assert.match(result.cloudPath, /^user-uploads\/acct_me\/work_image\//);
  assert.equal(JSON.stringify(db.writes).includes("attacker"), false);
  assert.equal(db.writes.find((item) => item.operation === "insert").value.purpose, "WORK_IMAGE");
});

test('support screenshots are image-only and remain pending security review', async()=>{
 const db=mockDb();const prepared=await handleMediaUpload(db,{}, {action:'prepareUpload',purpose:'SUPPORT_IMAGE',mimeType:'image/png',sizeBytes:100,originalFilename:'screen.png'},caller,1000,fixedUuid);
 assert.match(prepared.cloudPath,/\/support_image\//);
 await assert.rejects(handleMediaUpload(mockDb(),{}, {action:'prepareUpload',purpose:'SUPPORT_IMAGE',mimeType:'application/pdf',sizeBytes:100,originalFilename:'file.pdf'},caller));
 const asset=db.writes.find(w=>w.operation==='insert').value,fileId=`cloud://${ENV_ID}.bucket/${prepared.cloudPath}`;
 const storage={getFileInfo:async()=>({fileList:[{fileID:fileId,code:'SUCCESS',mime:'image/png',size:100}]})};
 const result=await handleMediaUpload(mockDb(asset),storage,{action:'commitUpload',assetId:prepared.assetId,fileId},caller,2000);
 assert.equal(result.status,'PENDING_SECURITY_REVIEW');
});

test("拒绝其他环境或错误路径的 fileId", () => {
  assert.throws(() => validateFileId("cloud://other.bucket/user-uploads/acct_me/a.png", pendingAsset.storage_key, ENV_ID), (error) => error.code === "FILE_ID_MISMATCH");
  assert.throws(() => validateFileId(`cloud://${ENV_ID}.bucket/user-uploads/acct_other/a.png`, pendingAsset.storage_key, ENV_ID), (error) => error.code === "FILE_ID_MISMATCH");
});

test("提交后仍保持待安全审核，不直接 READY", async () => {
  const db = mockDb(pendingAsset);
  const storage = { getFileInfo: async ({ fileList }) => ({ fileList: [{ fileID: fileList[0], code: "SUCCESS", mime: "image/png", size: 100 }] }) };
  const result = await handleMediaUpload(db, storage, { action: "commitUpload", assetId: pendingAsset.id, fileId: validFileId }, caller, 2000);
  assert.equal(result.status, "PENDING_SECURITY_REVIEW");
  const update = db.writes.find((item) => item.operation === "update");
  assert.equal(update.value.storage_key, validFileId);
  assert.equal(update.value.status, undefined);
});

test("订单交付上传绑定服务方订单并在存储校验后直接 READY", async () => {
  const orderId = "ord_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const db = mockDb(null, { id: orderId, provider_id: "acct_me", stage: "IN_PRODUCTION" });
  const prepared = await handleMediaUpload(db, {}, {
    action: "prepareUpload", purpose: "ORDER_DELIVERY", scopeId: orderId,
    mimeType: "application/pdf", sizeBytes: 1024, originalFilename: "交付.pdf"
  }, caller, 1000, fixedUuid);
  assert.match(prepared.cloudPath, new RegExp(`/order_delivery/${orderId}/${prepared.assetId}\\.pdf$`));
  const insert = db.writes.find((item) => item.operation === "insert").value;
  assert.equal(insert.scope_id, orderId);
  assert.equal(insert.purpose, "ORDER_DELIVERY");

  const deliveryAsset = { ...pendingAsset, purpose: "ORDER_DELIVERY", scope_id: orderId, storage_key: prepared.cloudPath, mime_type: "application/pdf", size_bytes: 1024 };
  const fileId = `cloud://${ENV_ID}.bucket/${prepared.cloudPath}`;
  const committedDb = mockDb(deliveryAsset);
  const storage = { getFileInfo: async ({ fileList }) => ({ fileList: [{ fileID: fileList[0], code: "SUCCESS", mime: "application/pdf", size: 1024 }] }) };
  const committed = await handleMediaUpload(committedDb, storage, { action: "commitUpload", assetId: deliveryAsset.id, fileId }, caller, 2000);
  assert.equal(committed.status, "READY");
  assert.equal(committed.fileId, fileId);
  assert.equal(committedDb.writes.find((item) => item.operation === "update").value.status, "READY");
});

test("订单交付上传拒绝非服务方订单和不可交付阶段", async () => {
  const orderId = "ord_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const input = {
    action: "prepareUpload", purpose: "ORDER_DELIVERY", scopeId: orderId,
    mimeType: "application/pdf", sizeBytes: 1024, originalFilename: "交付.pdf"
  };
  await assert.rejects(
    () => handleMediaUpload(mockDb(null, { id: orderId, provider_id: "acct_other", stage: "IN_PRODUCTION" }), {}, input, caller, 1000, fixedUuid),
    (error) => error.code === "DELIVERY_ORDER_NOT_FOUND"
  );
  await assert.rejects(
    () => handleMediaUpload(mockDb(null, { id: orderId, provider_id: "acct_me", stage: "COMPLETED" }), {}, input, caller, 1000, fixedUuid),
    (error) => error.code === "DELIVERY_ORDER_STATE_INVALID"
  );
});

test("实际文件类型或大小异常时拒绝并标记 REJECTED", async () => {
  const db = mockDb(pendingAsset);
  const storage = { getFileInfo: async ({ fileList }) => ({ fileList: [{ fileID: fileList[0], code: "SUCCESS", mime: "application/pdf", size: 100 }] }) };
  await assert.rejects(
    () => handleMediaUpload(db, storage, { action: "commitUpload", assetId: pendingAsset.id, fileId: validFileId }, caller, 2000),
    (error) => error.code === "MEDIA_FILE_REJECTED"
  );
  assert.equal(db.writes.find((item) => item.operation === "update").value.status, "REJECTED");
});

test("取消上传删除已提交文件并标记 DELETED", async () => {
  const committed = { ...pendingAsset, storage_key: validFileId, committed_at: 2000 };
  const db = mockDb(committed);
  const deletedFiles = [];
  const storage = { deleteFile: async ({ fileList }) => { deletedFiles.push(...fileList); return { fileList: [{ code: "SUCCESS", fileID: fileList[0] }] }; } };
  const result = await handleMediaUpload(db, storage, { action: "cancelUpload", assetId: pendingAsset.id }, caller, 3000);
  assert.equal(result.status, "DELETED");
  assert.deepEqual(deletedFiles, [validFileId]);
  assert.ok(db.writes.some((item) => item.operation === "update" && item.value.status === "DELETED"));
});

test("存储删除缺少明确成功项时不能标记 DELETED", async () => {
  const committed = { ...pendingAsset, storage_key: validFileId, committed_at: 2000 };
  const db = mockDb(committed);
  const storage = { deleteFile: async () => ({}) };
  await assert.rejects(
    () => handleMediaUpload(db, storage, { action: "cancelUpload", assetId: committed.id }, caller, 3000),
    (error) => error.code === "MEDIA_DELETE_FAILED"
  );
  assert.equal(db.writes.some((item) => item.operation === "update" && item.value.status === "DELETED"), false);
});

test("客户端不能即时删除 READY 订单交付证据", async () => {
  const delivery = {
    ...pendingAsset,
    purpose: "ORDER_DELIVERY",
    scope_id: "ord_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    storage_key: validFileId,
    status: "READY",
    committed_at: 2000
  };
  let deleteCalled = false;
  const storage = { deleteFile: async () => { deleteCalled = true; return { fileList: [{ code: "SUCCESS" }] }; } };
  await assert.rejects(
    () => handleMediaUpload(mockDb(delivery), storage, { action: "cancelUpload", assetId: delivery.id }, caller, 3000),
    (error) => error.code === "MEDIA_STATE_INVALID"
  );
  assert.equal(deleteCalled, false);
});

test("批量读取只返回本人媒体且不暴露未提交存储路径", async () => {
  const committed = { ...pendingAsset, storage_key: validFileId, committed_at: 2000, status: "READY" };
  const result = await handleMediaUpload(mockDb(committed), {}, {
    action: "getOwnedMedia", assetIds: [committed.id]
  }, caller);
  assert.deepEqual(result.assets, [{
    assetId: committed.id,
    fileId: validFileId,
    mimeType: "image/png",
    sizeBytes: 100,
    status: "READY"
  }]);

  const pending = await handleMediaUpload(mockDb(pendingAsset), {}, {
    action: "getOwnedMedia", assetIds: [pendingAsset.id]
  }, caller);
  assert.equal(pending.assets[0].fileId, null);
  assert.equal(pending.assets[0].status, "PENDING_SECURITY_REVIEW");
});

test('commit rejects metadata for a different or unidentified file without writing', async () => {
  for (const fileID of [undefined, 'cloud://other/file.png']) {
    const db = mockDb(pendingAsset);
    await assert.rejects(handleMediaUpload(db, { getFileInfo: async () => ({fileList:[{fileID,code:'SUCCESS',mime:'image/png',size:100}]}) },
      {action:'commitUpload',assetId:pendingAsset.id,fileId:validFileId},caller), {code:'MEDIA_FILE_MISSING'});
    assert.equal(db.writes.length,0);
  }
});

test('commit selects only the matching metadata and rejects ambiguous duplicate receipts', async () => {
  const matching={fileID:validFileId,code:'SUCCESS',mime:'image/png',size:100};
  const db=mockDb(pendingAsset);
  const result=await handleMediaUpload(db,{getFileInfo:async()=>({fileList:[{...matching,fileID:'cloud://other/file',mime:'application/pdf'},matching]})},
    {action:'commitUpload',assetId:pendingAsset.id,fileId:validFileId},caller);
  assert.equal(result.status,'PENDING_SECURITY_REVIEW');
  const duplicate=mockDb(pendingAsset);
  await assert.rejects(handleMediaUpload(duplicate,{getFileInfo:async()=>({fileList:[matching,matching]})},
    {action:'commitUpload',assetId:pendingAsset.id,fileId:validFileId},caller),{code:'MEDIA_FILE_MISSING'});
  assert.equal(duplicate.writes.length,0);
});
