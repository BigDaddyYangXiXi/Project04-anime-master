const test = require("node:test");
const assert = require("node:assert/strict");
const { decryptContact, encryptContact, handleOrder, requestHash } = require("./order-core");

const KEY = Buffer.alloc(32, 7).toString("base64");
const PROVIDER = "acct_provider";
const BUYER = "acct_buyer";
const publication = {
  provider_id: PROVIDER,
  publication_version: 1,
  payload: JSON.stringify({
    profile: { career: "摄影", city: "杭州", cityCode: "330100" },
    services: [{ id: "service_1", name: "正片", unit: "套", priceFen: 68000, serviceMode: "ONSITE", serviceAreas: [] }],
    works: [{ id: "work_1" }]
  })
};

function mockDb() {
  const orders = [];
  return {
    orders,
    from(table) {
      let operation = "select";
      let value = null;
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, expected) { filters.push([column, expected]); return builder; },
        insert(input) { operation = "insert"; value = input; return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          let data = [];
          if (table === "wechat_identities") {
            const openId = filters.find(([column]) => column === "open_id")[1];
            data = [{ account_id: openId === "openid-provider" ? PROVIDER : BUYER }];
          } else if (table === "account_roles") {
            const id = filters.find(([column]) => column === "account_id")[1];
            data = [{ role: id === PROVIDER ? "PROVIDER" : "BUYER" }];
          } else if (table === "accounts") {
            const id = filters.find(([column]) => column === "id")[1];
            data = [{ id, uid: id === PROVIDER ? "AM-PROVIDER" : "AM-BUYER", nickname: id === PROVIDER ? "迟霜" : "阿遥", status: "ACTIVE" }]
              .filter((row) => filters.every(([column, expected]) => row[column] === expected));
          } else if (table === "provider_catalog_publications") {
            data = filters.every(([column, expected]) => publication[column] === expected) ? [publication] : [];
          } else if (table === "media_assets") {
            const requestedId = filters.find(([column]) => column === "id")[1];
            const deliveryOrder = orders[0] && orders[0].id;
            const asset = requestedId === "asset_reference"
              ? { id: "asset_reference", owner_account_id: BUYER, purpose: "PROJECT_REFERENCE", status: "READY" }
              : {
                id: requestedId, owner_account_id: PROVIDER, purpose: "ORDER_DELIVERY", scope_id: deliveryOrder,
                storage_key: `cloud://quest-band-d1gem4bxt3fa17720.bucket/user-uploads/${PROVIDER}/order_delivery/${deliveryOrder}/${requestedId}.pdf`,
                mime_type: "application/pdf", size_bytes: 1024, status: "READY"
              };
            data = filters.every(([column, expected]) => asset[column] === expected) ? [asset] : [];
          } else if (table === "order_aggregates" && operation === "select") {
            data = orders.filter((row) => filters.every(([column, expected]) => column === "version" ? Number(row[column]) === Number(expected) : row[column] === expected));
          } else if (table === "order_aggregates" && operation === "insert") {
            orders.push(value);
            data = [value];
          } else if (table === "order_aggregates" && operation === "update") {
            const row = orders.find((item) => filters.every(([column, expected]) => column === "version" ? Number(item[column]) === Number(expected) : item[column] === expected));
            if (row) { Object.assign(row, value); data = [{ id: row.id }]; }
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

function createEvent(overrides = {}) {
  return {
    action: "createOrder", providerId: PROVIDER, serviceIds: ["service_1"], referenceWorkId: "work_1",
    city: "杭州", cityCode: "330100", location: "场地待沟通", requirement: "需要完成一组正式角色摄影作品",
    timeSegments: [{ startsAt: 2000, endsAt: 3000 }],
    contact: { name: "阿遥", wechat: "coser_ayao", phone: "" },
    idempotencyKey: "request-key-000001",
    ...overrides
  };
}

function uuidSequence() {
  let value = 0;
  return () => `${String(++value).padStart(8, "0")}-0000-0000-0000-000000000000`;
}

function forceProduction(db, orderId) {
  const row = db.orders.find((item) => item.id === orderId);
  const payload = JSON.parse(row.payload);
  payload.public.paymentStatus = "PAID";
  payload.public.buyerAgreementConfirmedAt = 3500;
  row.payload = JSON.stringify(payload);
  row.stage = "IN_PRODUCTION";
  return row;
}

function deliveryStorage(fileIds) {
  return {
    async getFileInfo({ fileList }) {
      return {
        fileList: fileList.map((fileID) => ({
          fileID,
          code: fileIds.includes(fileID) ? "SUCCESS" : "STORAGE_FILE_NONEXIST",
          mime: "application/pdf",
          size: 1024
        }))
      };
    }
  };
}

test("contact encryption round-trips without plaintext storage", () => {
  const encrypted = encryptContact({ name: "阿遥", wechat: "coser_ayao" }, KEY, () => Buffer.alloc(12, 3));
  assert.equal(JSON.stringify(encrypted).includes("阿遥"), false);
  assert.deepEqual(decryptContact(encrypted, KEY), { name: "阿遥", wechat: "coser_ayao", phone: "" });
});

test("creates one server-priced order and reuses an identical idempotency key", async () => {
  const db = mockDb();
  const event = createEvent({ amountFen: 1 });
  const first = await handleOrder(db, event, { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const second = await handleOrder(db, event, { WX_OPENID: "openid-buyer" }, KEY, 2000, uuidSequence());
  assert.equal(first.id, second.id);
  assert.equal(first.amountFen, 68000);
  assert.equal(first.buyer.nickname, "阿遥");
  assert.equal(first.provider.nickname, "迟霜");
  assert.equal(first.provider.career, "摄影");
  assert.equal(first.items[0].serviceMode, "ONSITE");
  assert.equal(first.items[0].locationMatch, "LOCAL");
  assert.equal(first.viewerRole, "BUYER");
  assert.equal(first.contact, null);
  assert.equal(db.orders.length, 1);
  assert.equal(JSON.stringify(db.orders[0]).includes("coser_ayao"), false);
});

test("rejects a city outside the published service coverage", async () => {
  await assert.rejects(
    () => handleOrder(mockDb(), createEvent({ city: "上海", cityCode: "310000" }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence()),
    (error) => error.code === "SERVICE_CITY_UNAVAILABLE"
  );
});

test("rejects a district code where the order contract requires a city code", async () => {
  await assert.rejects(
    () => handleOrder(mockDb(), createEvent({ city: "徐汇区", cityCode: "310104" }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence()),
    (error) => error.code === "VALIDATION_ERROR"
  );
});

test("same idempotency key with different payload conflicts", async () => {
  const db = mockDb();
  await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  await assert.rejects(
    () => handleOrder(db, createEvent({ requirement: "另一份完全不同的订单需求说明" }), { WX_OPENID: "openid-buyer" }, KEY, 1001, uuidSequence()),
    (error) => error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("buyer reference image must be owned and READY", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent({ referenceWorkId: null, referenceAssetId: "asset_reference" }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  assert.equal(created.referenceAssetId, "asset_reference");
  await assert.rejects(
    () => handleOrder(mockDb(), createEvent({ referenceWorkId: null, referenceAssetId: "asset_missing" }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence()),
    (error) => error.code === "REFERENCE_MEDIA_NOT_READY"
  );
});

test("server rejects past or overlapping booking segments", async () => {
  await assert.rejects(
    () => handleOrder(mockDb(), createEvent({ timeSegments: [{ startsAt: 900, endsAt: 1100 }] }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence()),
    (error) => error.code === "INVALID_TIME_SEGMENTS"
  );
  await assert.rejects(
    () => handleOrder(mockDb(), createEvent({ timeSegments: [{ startsAt: 2000, endsAt: 4000 }, { startsAt: 3000, endsAt: 5000 }] }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence()),
    (error) => error.code === "INVALID_TIME_SEGMENTS"
  );
});

test("buyer cannot create an order with the same account as provider", async () => {
  const db = mockDb();
  await assert.rejects(
    () => handleOrder(db, createEvent({ providerId: BUYER }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence()),
    (error) => error.code === "SELF_ORDER_NOT_ALLOWED"
  );
  assert.equal(db.orders.length, 0);
});

test("provider transition reveals encrypted contact and records the event atomically", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const updated = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_INTERESTED"
  }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence());
  assert.equal(updated.stage, "CONTACTING");
  assert.equal(updated.version, 2);
  assert.equal(updated.contact.wechat, "coser_ayao");
  assert.equal(updated.viewerRole, "PROVIDER");
  assert.deepEqual(updated.events.map((item) => item.event), ["ORDER_CREATED", "PROVIDER_INTERESTED"]);
  assert.equal(db.orders[0].version, 2);
});

test("normalizes a CloudBase string version before an order transition", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  db.orders[0].version = "1";
  db.orders[0].created_at = "1000";
  db.orders[0].updated_at = "1000";
  const read = await handleOrder(db, { action: "getOrder", orderId: created.id }, { WX_OPENID: "openid-provider" }, KEY, 1500, uuidSequence());
  assert.equal(read.version, 1);
  assert.equal(read.createdAt, 1000);
  assert.equal(read.updatedAt, 1000);
  const updated = await handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: read.version, event: "PROVIDER_INTERESTED" }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence());
  assert.equal(updated.version, 2);
});

test("provider can lock one bounded quote and cannot change it twice", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const contacting = await handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_INTERESTED" }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence());
  const quoted = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: contacting.version,
    event: "PROVIDER_LOCKS_QUOTE", items: [{ serviceId: "service_1", finalPriceFen: 70000 }]
  }, { WX_OPENID: "openid-provider" }, KEY, 3000, uuidSequence());
  assert.equal(quoted.amountFen, 70000);
  assert.equal(quoted.priceEdited, true);
  await assert.rejects(
    () => handleOrder(db, {
      action: "transitionOrder", orderId: created.id, expectedVersion: quoted.version,
      event: "PROVIDER_LOCKS_QUOTE", items: [{ serviceId: "service_1", finalPriceFen: 69000 }]
    }, { WX_OPENID: "openid-provider" }, KEY, 4000, uuidSequence()),
    (error) => error.code === "QUOTE_ALREADY_LOCKED"
  );
});

test("communication failure and buyer agreement persist as explicit events", async () => {
  const failedDb = mockDb();
  const failedOrder = await handleOrder(failedDb, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  await handleOrder(failedDb, { action: "transitionOrder", orderId: failedOrder.id, expectedVersion: 1, event: "PROVIDER_INTERESTED" }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence());
  const declined = await handleOrder(failedDb, {
    action: "transitionOrder", orderId: failedOrder.id, expectedVersion: 2,
    event: "PROVIDER_ENDS_COMMUNICATION_FAILED", detail: "双方未能确认本次服务范围"
  }, { WX_OPENID: "openid-provider" }, KEY, 3000, uuidSequence());
  assert.equal(declined.stage, "DECLINED");
  assert.equal(declined.declinePhase, "communication");

  const confirmedDb = mockDb();
  const confirmedOrder = await handleOrder(confirmedDb, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  await handleOrder(confirmedDb, { action: "transitionOrder", orderId: confirmedOrder.id, expectedVersion: 1, event: "PROVIDER_INTERESTED" }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence());
  await assert.rejects(
    () => handleOrder(confirmedDb, { action: "transitionOrder", orderId: confirmedOrder.id, expectedVersion: 2, event: "PROVIDER_ENDS_COMMUNICATION", ndaRequired: false }, { WX_OPENID: "openid-provider" }, KEY, 2500, uuidSequence()),
    (error) => error.code === "CONTACT_NOT_ACCESSED"
  );
  await handleOrder(confirmedDb, { action: "transitionOrder", orderId: confirmedOrder.id, expectedVersion: 2, event: "PROVIDER_RECORDS_CONTACT" }, { WX_OPENID: "openid-provider" }, KEY, 2600, uuidSequence());
  await handleOrder(confirmedDb, { action: "transitionOrder", orderId: confirmedOrder.id, expectedVersion: 3, event: "PROVIDER_ENDS_COMMUNICATION", ndaRequired: false }, { WX_OPENID: "openid-provider" }, KEY, 3000, uuidSequence());
  const agreement = await handleOrder(confirmedDb, { action: "transitionOrder", orderId: confirmedOrder.id, expectedVersion: 4, event: "BUYER_CONFIRMS_AGREEMENT" }, { WX_OPENID: "openid-buyer" }, KEY, 4000, uuidSequence());
  assert.equal(agreement.stage, "BUYER_FINAL_CONFIRM");
  assert.equal(agreement.buyerAgreementConfirmedAt, 4000);
});

test("wrong participant role and stale version cannot mutate an order", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_INTERESTED" }, { WX_OPENID: "openid-buyer" }, KEY, 2000, uuidSequence()),
    (error) => error.code === "ORDER_ROLE_FORBIDDEN"
  );
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 2, event: "PROVIDER_INTERESTED" }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence()),
    (error) => error.code === "VERSION_CONFLICT"
  );
  assert.equal(db.orders[0].version, 1);
});

test("buyer cannot enter production before a server-verified payment", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const contacting = await handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_INTERESTED" }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence());
  await handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 2, event: "PROVIDER_RECORDS_CONTACT" }, { WX_OPENID: "openid-provider" }, KEY, 2500, uuidSequence());
  const confirmed = await handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 3, event: "PROVIDER_ENDS_COMMUNICATION", ndaRequired: false }, { WX_OPENID: "openid-provider" }, KEY, 3000, uuidSequence());
  assert.equal(confirmed.stage, "BUYER_FINAL_CONFIRM");
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 4, event: "BUYER_CONFIRMS_EXECUTION" }, { WX_OPENID: "openid-buyer" }, KEY, 4000, uuidSequence()),
    (error) => error.code === "PAYMENT_NOT_VERIFIED"
  );
  assert.equal(db.orders[0].version, 4);
  assert.equal(contacting.contact.name, "阿遥");
});

test("request hash is stable across object key order", () => {
  assert.equal(requestHash({ b: 2, a: 1 }), requestHash({ a: 1, b: 2 }));
});

test("provider progress and delivery persist before buyer revision and acceptance", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  forceProduction(db, created.id);
  const progressed = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: 1,
    event: "PROVIDER_UPDATES_PROGRESS", progress: 65
  }, { WX_OPENID: "openid-provider" }, KEY, 4000, uuidSequence());
  assert.equal(progressed.stage, "IN_PRODUCTION");
  assert.equal(progressed.progress, 65);

  const assetId = "asset_33333333333333333333333333333333";
  const fileId = `cloud://quest-band-d1gem4bxt3fa17720.bucket/user-uploads/${PROVIDER}/order_delivery/${created.id}/${assetId}.pdf`;
  const storage = deliveryStorage([fileId]);
  const delivered = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: progressed.version,
    event: "PROVIDER_SUBMITS_DELIVERY", deliveryNote: "本轮正式交付文件，请核对。",
    deliveryFiles: [{ name: "正式成片.pdf", assetId, fileId }]
  }, { WX_OPENID: "openid-provider" }, KEY, 5000, uuidSequence(), storage);
  assert.equal(delivered.stage, "DELIVERY_PENDING");
  assert.equal(delivered.progress, 100);
  assert.equal(delivered.deliveryFiles[0].sizeBytes, 1024);
  assert.equal(delivered.deliveryHistory.length, 1);

  const revision = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: delivered.version,
    event: "BUYER_REQUESTS_REVISION", detail: "请降低第二张成片的背景高光。"
  }, { WX_OPENID: "openid-buyer" }, KEY, 6000, uuidSequence());
  assert.equal(revision.stage, "REVISION_REQUESTED");
  assert.equal(revision.revisionCount, 1);
  assert.equal(revision.progress, 99);

  const redelivered = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: revision.version,
    event: "PROVIDER_SUBMITS_DELIVERY", deliveryNote: "已根据反馈调整背景高光。",
    deliveryFiles: [{ name: "修订成片.pdf", assetId, fileId }]
  }, { WX_OPENID: "openid-provider" }, KEY, 7000, uuidSequence(), storage);
  const completed = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: redelivered.version,
    event: "BUYER_ACCEPTS_DELIVERY"
  }, { WX_OPENID: "openid-buyer" }, KEY, 8000, uuidSequence());
  assert.equal(completed.stage, "COMPLETED");
  assert.equal(completed.completedAt, 8000);
  assert.equal(completed.deliveryHistory.length, 2);
});

test("delivery rejects invalid progress, missing files, wrong paths, and buyer mutation", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  forceProduction(db, created.id);
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_UPDATES_PROGRESS", progress: 100 }, { WX_OPENID: "openid-provider" }, KEY, 4000, uuidSequence()),
    (error) => error.code === "PROGRESS_INVALID"
  );
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_SUBMITS_DELIVERY", deliveryNote: "已经完成本轮交付。", deliveryFiles: [] }, { WX_OPENID: "openid-provider" }, KEY, 5000, uuidSequence(), deliveryStorage([])),
    (error) => error.code === "DELIVERY_FILES_REQUIRED"
  );
  const foreignAsset = "asset_44444444444444444444444444444444";
  const foreignFile = `cloud://quest-band-d1gem4bxt3fa17720.bucket/user-uploads/${PROVIDER}/order_delivery/ord_ffffffffffffffffffffffffffffffff/${foreignAsset}.pdf`;
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_SUBMITS_DELIVERY", deliveryNote: "已经完成本轮交付。", deliveryFiles: [{ name: "delivery.pdf", assetId: foreignAsset, fileId: foreignFile }] }, { WX_OPENID: "openid-provider" }, KEY, 5000, uuidSequence(), deliveryStorage([foreignFile])),
    (error) => error.code === "DELIVERY_FILE_INVALID"
  );
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "PROVIDER_UPDATES_PROGRESS", progress: 50 }, { WX_OPENID: "openid-buyer" }, KEY, 4000, uuidSequence()),
    (error) => error.code === "ORDER_ROLE_FORBIDDEN"
  );
  assert.equal(db.orders[0].version, 1);
});

test("onsite delivery requires a completion note but no uploaded file", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const row = forceProduction(db, created.id);
  const payload = JSON.parse(row.payload);
  payload.public.provider.career = "妆娘";
  row.payload = JSON.stringify(payload);
  const delivered = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: 1,
    event: "PROVIDER_SUBMITS_DELIVERY", deliveryNote: "现场妆造服务已按双方约定完成。", deliveryFiles: []
  }, { WX_OPENID: "openid-provider" }, KEY, 5000, uuidSequence());
  assert.equal(delivered.stage, "DELIVERY_PENDING");
  assert.deepEqual(delivered.deliveryFiles, []);
});

test("completed order accepts one buyer review and one provider reply", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const row = forceProduction(db, created.id);
  const payload = JSON.parse(row.payload);
  payload.public.deliveryNote = "现场服务已按约定完成。";
  payload.public.completedAt = 4000;
  payload.public.provider.career = "妆娘";
  row.payload = JSON.stringify(payload);
  row.stage = "COMPLETED";

  const reviewed = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: 1,
    event: "BUYER_SUBMITS_REVIEW", rating: 5, reviewText: "沟通清楚，现场完成效果很好。"
  }, { WX_OPENID: "openid-buyer" }, KEY, 5000, uuidSequence());
  assert.equal(reviewed.rating, 5);
  assert.equal(reviewed.reviewedAt, 5000);
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 2, event: "BUYER_SUBMITS_REVIEW", rating: 4 }, { WX_OPENID: "openid-buyer" }, KEY, 5500, uuidSequence()),
    (error) => error.code === "REVIEW_ALREADY_SUBMITTED"
  );
  const replied = await handleOrder(db, {
    action: "transitionOrder", orderId: created.id, expectedVersion: 2,
    event: "PROVIDER_REPLIES_REVIEW", reviewReply: "感谢认可，期待下次合作。"
  }, { WX_OPENID: "openid-provider" }, KEY, 6000, uuidSequence());
  assert.equal(replied.reviewReply, "感谢认可，期待下次合作。");
  await assert.rejects(
    () => handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 3, event: "PROVIDER_REPLIES_REVIEW", reviewReply: "再次回复" }, { WX_OPENID: "openid-provider" }, KEY, 6500, uuidSequence()),
    (error) => error.code === "REVIEW_REPLY_ALREADY_SUBMITTED"
  );
});
