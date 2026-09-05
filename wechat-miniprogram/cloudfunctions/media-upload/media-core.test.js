const test = require("node:test");
const assert = require("node:assert/strict");
const { ENV_ID, handleMediaUpload, validateFileId } = require("./media-core");

function mockDb(asset = null, order = null) {
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
          else if (table === "media_assets" && operation === "select") data = asset ? [asset] : [];
          else if (table === "order_aggregates" && operation === "select") {
            data = order ? [order].filter((row) => filters.every(([column, expected]) => row[column] === expected)) : [];
          }
          else if (operation === "insert") data = [value];
          else if (operation === "update") data = [{ id: asset && asset.id }];
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

const fixedUuid = () => "12345678-1234-1234-1234-1234567890ab";
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

test("准备上传只使用可信账号生成路径", async () => {
  const db = mockDb();
  const result = await handleMediaUpload(db, {}, {
    action: "prepareUpload", purpose: "WORK_IMAGE", mimeType: "image/png", sizeBytes: 100, originalFilename: "work.png", accountId: "attacker"
  }, { WX_OPENID: "openid-me" }, 1000, fixedUuid);
  assert.equal(result.assetId, pendingAsset.id);
  assert.match(result.cloudPath, /^user-uploads\/acct_me\/work_image\//);
  assert.equal(JSON.stringify(db.writes).includes("attacker"), false);
  assert.equal(db.writes.find((item) => item.operation === "insert").value.purpose, "WORK_IMAGE");
});

test("拒绝其他环境或错误路径的 fileId", () => {
  assert.throws(() => validateFileId("cloud://other.bucket/user-uploads/acct_me/a.png", pendingAsset.storage_key), (error) => error.code === "FILE_ID_MISMATCH");
  assert.throws(() => validateFileId(`cloud://${ENV_ID}.bucket/user-uploads/acct_other/a.png`, pendingAsset.storage_key), (error) => error.code === "FILE_ID_MISMATCH");
});

test("提交后仍保持待安全审核，不直接 READY", async () => {
  const db = mockDb(pendingAsset);
  const storage = { getFileInfo: async () => ({ fileList: [{ code: "SUCCESS", mime: "image/png", size: 100 }] }) };
  const result = await handleMediaUpload(db, storage, { action: "commitUpload", assetId: pendingAsset.id, fileId: validFileId }, { WX_OPENID: "openid-me" }, 2000);
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
  }, { WX_OPENID: "openid-me" }, 1000, fixedUuid);
  assert.match(prepared.cloudPath, new RegExp(`/order_delivery/${orderId}/${prepared.assetId}\\.pdf$`));
  const insert = db.writes.find((item) => item.operation === "insert").value;
  assert.equal(insert.scope_id, orderId);
  assert.equal(insert.purpose, "ORDER_DELIVERY");

  const deliveryAsset = { ...pendingAsset, purpose: "ORDER_DELIVERY", scope_id: orderId, storage_key: prepared.cloudPath, mime_type: "application/pdf", size_bytes: 1024 };
  const fileId = `cloud://${ENV_ID}.bucket/${prepared.cloudPath}`;
  const committedDb = mockDb(deliveryAsset);
  const storage = { getFileInfo: async () => ({ fileList: [{ code: "SUCCESS", mime: "application/pdf", size: 1024 }] }) };
  const committed = await handleMediaUpload(committedDb, storage, { action: "commitUpload", assetId: deliveryAsset.id, fileId }, { WX_OPENID: "openid-me" }, 2000);
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
    () => handleMediaUpload(mockDb(null, { id: orderId, provider_id: "acct_other", stage: "IN_PRODUCTION" }), {}, input, { WX_OPENID: "openid-me" }, 1000, fixedUuid),
    (error) => error.code === "DELIVERY_ORDER_NOT_FOUND"
  );
  await assert.rejects(
    () => handleMediaUpload(mockDb(null, { id: orderId, provider_id: "acct_me", stage: "COMPLETED" }), {}, input, { WX_OPENID: "openid-me" }, 1000, fixedUuid),
    (error) => error.code === "DELIVERY_ORDER_STATE_INVALID"
  );
});

test("实际文件类型或大小异常时拒绝并标记 REJECTED", async () => {
  const db = mockDb(pendingAsset);
  const storage = { getFileInfo: async () => ({ fileList: [{ code: "SUCCESS", mime: "application/pdf", size: 100 }] }) };
  await assert.rejects(
    () => handleMediaUpload(db, storage, { action: "commitUpload", assetId: pendingAsset.id, fileId: validFileId }, { WX_OPENID: "openid-me" }, 2000),
    (error) => error.code === "MEDIA_FILE_REJECTED"
  );
  assert.equal(db.writes.find((item) => item.operation === "update").value.status, "REJECTED");
});

test("取消上传删除已提交文件并标记 DELETED", async () => {
  const committed = { ...pendingAsset, storage_key: validFileId, committed_at: 2000 };
  const db = mockDb(committed);
  const deletedFiles = [];
  const storage = { deleteFile: async ({ fileList }) => { deletedFiles.push(...fileList); return { fileList: [{ code: "SUCCESS" }] }; } };
  const result = await handleMediaUpload(db, storage, { action: "cancelUpload", assetId: pendingAsset.id }, { WX_OPENID: "openid-me" }, 3000);
  assert.equal(result.status, "DELETED");
  assert.deepEqual(deletedFiles, [validFileId]);
  assert.equal(db.writes.find((item) => item.operation === "update").value.status, "DELETED");
});

test("存储删除缺少明确成功项时不能标记 DELETED", async () => {
  const committed = { ...pendingAsset, storage_key: validFileId, committed_at: 2000 };
  const db = mockDb(committed);
  const storage = { deleteFile: async () => ({}) };
  await assert.rejects(
    () => handleMediaUpload(db, storage, { action: "cancelUpload", assetId: committed.id }, { WX_OPENID: "openid-me" }, 3000),
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
    () => handleMediaUpload(mockDb(delivery), storage, { action: "cancelUpload", assetId: delivery.id }, { WX_OPENID: "openid-me" }, 3000),
    (error) => error.code === "MEDIA_STATE_INVALID"
  );
  assert.equal(deleteCalled, false);
});

test("批量读取只返回本人媒体且不暴露未提交存储路径", async () => {
  const committed = { ...pendingAsset, storage_key: validFileId, committed_at: 2000, status: "READY" };
  const result = await handleMediaUpload(mockDb(committed), {}, {
    action: "getOwnedMedia", assetIds: [committed.id]
  }, { WX_OPENID: "openid-me" });
  assert.deepEqual(result.assets, [{
    assetId: committed.id,
    fileId: validFileId,
    mimeType: "image/png",
    sizeBytes: 100,
    status: "READY"
  }]);

  const pending = await handleMediaUpload(mockDb(pendingAsset), {}, {
    action: "getOwnedMedia", assetIds: [pendingAsset.id]
  }, { WX_OPENID: "openid-me" });
  assert.equal(pending.assets[0].fileId, null);
  assert.equal(pending.assets[0].status, "PENDING_SECURITY_REVIEW");
});
