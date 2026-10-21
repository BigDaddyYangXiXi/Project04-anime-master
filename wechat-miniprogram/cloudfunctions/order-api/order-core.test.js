const test = require("node:test");
const assert = require("node:assert/strict");
const { decryptContact, encryptContact, handleOrder: handleOrderCore, requestHash } = require("./order-core");

// State-machine tests use an in-memory writer; real concurrent locking is tested against MySQL.
function handleOrder(db, ...args) {
  while (args.length < 6) args.push(undefined);
  return handleOrderCore(db, ...args, async (row, next) => {
    const result = await db.from("order_aggregates").update(next).eq("id", row.id).eq("version", row.version).select("id");
    if (!result.data.length) { const error = new Error("VERSION_CONFLICT"); error.code = error.message; throw error; }
  });
}

const KEY = Buffer.alloc(32, 7).toString("base64");
test("交付下载仅给订单参与者，签约和文件绑定校验先于签发链接", async () => {
  const db = mockDb();
  const order = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const row = db.orders[0];
  const assetId = `asset_${"a".repeat(32)}`;
  const fileId = `cloud://quest-band-d1gem4bxt3fa17720.bucket/user-uploads/${PROVIDER}/order_delivery/${row.id}/${assetId}.pdf`;
  const payload = JSON.parse(row.payload);
  payload.public.deliveryFiles = [{ assetId, fileId, name: "交付.pdf" }];
  row.payload = JSON.stringify(payload); row.stage = "DELIVERY_PENDING";
  let issued = 0;
  const storage = { async getTempFileURL(input) {
    issued++;
    assert.deepEqual(input, { fileList: [{ fileID: fileId, maxAge: 300 }] });
    return { fileList: [{ fileID: fileId, code: "SUCCESS", tempFileURL: "https://files.example.test/signed" }] };
  } };
  const event = { action: "getDeliveryDownload", orderId: order.id, assetId };
  const request = (openId, change = {}) => handleOrder(db, { ...event, ...change }, { WX_OPENID: openId }, KEY, 2000, uuidSequence(), storage);
  for (const openId of ["openid-buyer", "openid-provider"]) assert.equal((await request(openId)).mimeType, "application/pdf");
  assert.equal(issued, 2);
  await assert.rejects(() => request("openid-outsider"), error => error.code === "ORDER_NOT_FOUND");
  await assert.rejects(() => request("openid-buyer", { assetId: `asset_${"b".repeat(32)}` }), error => error.code === "DELIVERY_FILE_INVALID");
  payload.public.ndaRequired = true;
  row.payload = JSON.stringify(payload);
  await assert.rejects(() => request("openid-buyer"), error => error.code === "NDA_REQUIRED");
  payload.public.ndaRequired = false;
  payload.public.deliveryFiles[0].fileId = fileId.replace("acct_provider", "acct_other");
  row.payload = JSON.stringify(payload);
  await assert.rejects(() => request("openid-buyer"), error => error.code === "DELIVERY_FILE_INVALID");
  row.stage = "IN_PRODUCTION";
  await assert.rejects(() => request("openid-buyer"), error => error.code === "ILLEGAL_TRANSITION");
  assert.equal(issued, 2, "所有拒绝都不能生成可访问链接");
});
const PROVIDER = "acct_provider";
const BUYER = "acct_buyer";
const CONFIRMATIONS = { timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true, ndaRequired: false };
const publication = {
  provider_id: PROVIDER,
  publication_version: 1,
  payload: JSON.stringify({
    profile: { career: "摄影", city: "杭州", cityCode: "330100" },
    services: [{ id: "service_1", name: "正片", unit: "套", priceFen: 68000, serviceMode: "ONSITE", serviceAreas: [] }],
    works: [{ id: "work_1" }]
  })
};

test("暂停接单在服务端阻止新的预约，保持已发布价格与订单不变", async () => {
  const previous = publication.payload;
  const value = JSON.parse(previous);
  value.profile.accepting = false;
  publication.payload = JSON.stringify(value);
  const db = mockDb();
  try {
    await assert.rejects(() => handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence()), error => error.code === "PROVIDER_NOT_AVAILABLE");
    assert.equal(db.orders.length, 0);
  } finally { publication.payload = previous; }
});

function mockDb(qualification = { status: "APPROVED", career: "摄影", eligibility_verified: 1 }) {
  const orders = [];
  const referenceAsset = { id: "asset_reference", owner_account_id: BUYER, purpose: "PROJECT_REFERENCE", status: "READY",
    storage_key: "cloud://test.bucket/user-uploads/acct_buyer/project_reference/asset_reference.jpg", mime_type: "image/jpeg" };
  return {
    orders,
    referenceAsset,
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
            data = [{ account_id: openId === "openid-provider" ? PROVIDER : openId === "openid-outsider" ? "acct_outsider" : BUYER }];
          } else if (table === "account_roles") {
            const id = filters.find(([column]) => column === "account_id")[1];
            data = [{ role: id === PROVIDER ? "PROVIDER" : "BUYER" }];
          } else if (table === "accounts") {
            const id = filters.find(([column]) => column === "id")[1];
            data = [{ id, uid: id === PROVIDER ? "AM-PROVIDER" : "AM-BUYER", nickname: id === PROVIDER ? "迟霜" : "阿遥", status: "ACTIVE" }]
              .filter((row) => filters.every(([column, expected]) => row[column] === expected));
          } else if (table === "provider_qualifications") {
            data = qualification ? [qualification] : [];
          } else if (table === "provider_catalog_publications") {
            data = filters.every(([column, expected]) => publication[column] === expected) ? [publication] : [];
          } else if (table === "media_assets") {
            const requestedId = filters.find(([column]) => column === "id")[1];
            const deliveryOrder = orders[0] && orders[0].id;
            const asset = requestedId === "asset_reference"
              ? referenceAsset
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
    ndaRequired: false,
    ...overrides
  };
}

function uuidSequence() {
  let value = 0;
  return () => `${String(++value).padStart(8, "0")}-0000-0000-0000-000000000000`;
}

test("required NDA protects private order fields in detail and list until both participants sign", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent({ referenceAssetId: "asset_reference" }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const row = db.orders[0];
  const payload = JSON.parse(row.payload);
  Object.assign(payload.public, { ndaRequired: true, supplementNote: "private supplement" });
  payload.events.push({ event: "BUYER_SUPPLEMENTS", detail: "private history", createdAt: 1500 });
  for (const [buyerSigned, providerSigned] of [[false, false], [true, false], [false, true], [true, true]]) {
    Object.assign(payload.public, { buyerNdaSigned: buyerSigned, providerNdaSigned: providerSigned });
    row.payload = JSON.stringify(payload);
    row.stage = "NDA_PROVIDER_PENDING";
    const stored = row.payload;
    const detail = await handleOrder(db, { action: "getOrder", orderId: created.id }, { WX_OPENID: "openid-provider" }, KEY);
    const list = await handleOrder(db, { action: "listOrders" }, { WX_OPENID: "openid-provider" }, KEY);
    for (const view of [detail, list.orders[0]]) {
      const locked = !(buyerSigned && providerSigned);
      assert.equal(view.requirement, locked ? "" : payload.public.requirement);
      assert.equal(view.location, locked ? "" : payload.public.location);
      assert.equal(view.referenceAssetId, locked ? null : "asset_reference");
      assert.equal(view.supplementNote, locked ? "" : "private supplement");
      assert.equal(view.events[1].detail, locked ? "" : "private history");
      assert.equal(view.amountFen, created.amountFen);
      assert.deepEqual(view.timeSegments, created.timeSegments);
      assert.equal(view.cityCode, created.cityCode);
      const client = require("../../miniprogram/services/cloud-orders").toClientOrder(view);
      assert.equal(client.bookingDraft.note, view.requirement);
      assert.equal(client.bookingDraft.referenceFile && client.bookingDraft.referenceFile.assetId, view.referenceAssetId);
    }
    const owner = await handleOrder(db, { action: "getOrder", orderId: created.id }, { WX_OPENID: "openid-buyer" }, KEY);
    assert.equal(owner.requirement, payload.public.requirement);
    assert.equal(owner.events[1].detail, "private history");
    assert.equal(row.payload, stored, "redaction must not erase stored private data");
  }
});

test("an unrelated account cannot read, list, or sign another order NDA", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const row = db.orders[0];
  const payload = JSON.parse(row.payload);
  payload.public.ndaRequired = true;
  row.payload = JSON.stringify(payload);
  row.stage = "NDA_BUYER_PENDING";
  const stored = JSON.stringify(row);
  for (const event of [
    { action: "getOrder", orderId: created.id },
    { action: "transitionOrder", orderId: created.id, expectedVersion: 1, event: "BUYER_SIGNS_NDA" }
  ]) {
    await assert.rejects(handleOrder(db, event, { WX_OPENID: "openid-outsider" }, KEY), error => error.code === "ORDER_NOT_FOUND");
  }
  const list = await handleOrder(db, { action: "listOrders" }, { WX_OPENID: "openid-outsider" }, KEY);
  assert.deepEqual(list.orders, []);
  assert.equal(JSON.stringify(row), stored);
});

test("NDA transition responses hide private fields then reveal them after the final signature", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const transition = (event, openid, expectedVersion, extra = {}) => handleOrder(db,
    { action: "transitionOrder", orderId: created.id, event, expectedVersion, ...extra },
    { WX_OPENID: openid }, KEY, 1500, uuidSequence());
  await transition("PROVIDER_INTERESTED", "openid-provider", 1);
  await transition("PROVIDER_RECORDS_CONTACT", "openid-provider", 2);
  const beforeConfirmation = JSON.stringify(db.orders[0]);
  await assert.rejects(handleOrderCore(db, { action: "transitionOrder", orderId: created.id,
    event: "PROVIDER_ENDS_COMMUNICATION", expectedVersion: 3, ...CONFIRMATIONS },
  { WX_OPENID: "openid-provider" }, KEY, 1500), error => error.code === "SLOT_STORE_NOT_CONFIGURED");
  assert.equal(JSON.stringify(db.orders[0]), beforeConfirmation);
  const pending = await transition("PROVIDER_ENDS_COMMUNICATION", "openid-provider", 3, { ...CONFIRMATIONS, ndaRequired: true });
  assert.equal(pending.requirement, "");
  await transition("BUYER_SIGNS_NDA", "openid-buyer", 4);
  const signed = await transition("PROVIDER_SIGNS_NDA", "openid-provider", 5);
  assert.equal(signed.requirement, created.requirement);
  assert.equal(signed.location, created.location);
});

function forceProduction(db, orderId) {
  const row = db.orders.find((item) => item.id === orderId);
  const payload = JSON.parse(row.payload);
  payload.public.paymentStatus = "PAID";
  payload.public.paymentId = "11111111111111111111111111111111";
  payload.public.paymentTransactionId = "wx_transaction_fixture";
  payload.public.buyerAgreementConfirmedAt = 3500;
  row.payload = JSON.stringify(payload);
  row.stage = "IN_PRODUCTION";
  return row;
}

test("buyer-declared NDA hides initial details, signs before communication and cannot be waived", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent({ ndaRequired: true, referenceAssetId: "asset_reference" }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const readProvider = () => handleOrder(db, { action: "getOrder", orderId: created.id }, { WX_OPENID: "openid-provider" }, KEY);
  assert.equal((await readProvider()).requirement, "");
  assert.equal((await readProvider()).referenceAssetId, null);
  const act = (event, version, actor = "provider", fields = {}) => handleOrder(db,
    { action: "transitionOrder", orderId: created.id, expectedVersion: version, event, ...fields },
    { WX_OPENID: `openid-${actor}` }, KEY, 1500, uuidSequence());
  assert.equal((await act("PROVIDER_INTERESTED", 1)).stage, "NDA_BUYER_PENDING");
  await act("BUYER_SIGNS_NDA", 2, "buyer");
  assert.equal((await readProvider()).privateFieldsHidden, true);
  const signed = await act("PROVIDER_SIGNS_NDA", 3);
  assert.equal(signed.stage, "CONTACTING");
  assert.equal(signed.requirement, created.requirement);
  assert.equal(signed.communicationDone, false);
  await act("PROVIDER_RECORDS_CONTACT", 4);
  await assert.rejects(act("PROVIDER_ENDS_COMMUNICATION", 5, "provider", CONFIRMATIONS), error => error.code === "NDA_REQUIRED");
  const confirmed = await act("PROVIDER_ENDS_COMMUNICATION", 5, "provider", { ...CONFIRMATIONS, ndaRequired: true });
  assert.equal(confirmed.stage, "BUYER_FINAL_CONFIRM");
  assert.equal(confirmed.communicationDone, true);
});

test("new booking must explicitly declare NDA and declaration is part of idempotency", async () => {
  const db = mockDb();
  await assert.rejects(handleOrder(db, createEvent({ ndaRequired: undefined }), { WX_OPENID: "openid-buyer" }, KEY, 1000), error => error.code === "VALIDATION_ERROR");
  await handleOrder(db, createEvent({ ndaRequired: true }), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  await assert.rejects(handleOrder(db, createEvent({ ndaRequired: false }), { WX_OPENID: "openid-buyer" }, KEY, 1000), error => error.code === "IDEMPOTENCY_CONFLICT");
});

test("booking no longer requires onboarding approval but cannot override explicit suspension", async () => {
  for (const qualification of [null, { status: "PENDING", career: "摄影", eligibility_verified: 0 },
    { status: "REJECTED", career: "摄影", eligibility_verified: 0 }, { status: "APPROVED", career: "妆娘", eligibility_verified: 1 }]) {
    const db = mockDb(qualification);
    await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
    assert.equal(db.orders.length, 1);
  }
  const db = mockDb({ status: "SUSPENDED" });
  await assert.rejects(handleOrder(db, createEvent({ qualification: { status: "APPROVED" } }), { WX_OPENID: "openid-buyer" }, KEY, 1000), { code: "PROVIDER_NOT_AVAILABLE" });
  assert.equal(db.orders.length, 0);
});

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

for (const outcome of ['lost-response', 'sdk-error-result', 'concurrent-conflict', 'not-written']) {
  test(`order creation recovers only a matching persisted request after ${outcome}`, async () => {
    const db = mockDb(), originalFrom = db.from.bind(db);
    let writes = 0;
    db.from = table => {
      const builder = originalFrom(table);
      if (table === 'order_aggregates') builder.insert = async row => {
        writes++;
        if (outcome !== 'not-written') db.orders.push({ ...row,
          request_hash: outcome === 'concurrent-conflict' ? '0'.repeat(64) : row.request_hash });
        if (outcome === 'sdk-error-result') return { error: { message: 'synthetic duplicate' } };
        throw Object.assign(new Error('synthetic insertion failure'), { code: 'SYNTHETIC_WRITE_FAILURE' });
      };
      return builder;
    };
    const operation = handleOrder(db, createEvent(), { WX_OPENID: 'openid-buyer' }, KEY, 1000, uuidSequence());
    if (['lost-response', 'sdk-error-result'].includes(outcome)) assert.equal((await operation).id, db.orders[0].id);
    else await assert.rejects(operation, error => error.code === (outcome === 'concurrent-conflict' ? 'IDEMPOTENCY_CONFLICT' : 'SYNTHETIC_WRITE_FAILURE'));
    assert.equal(writes, 1);
    assert.equal(db.orders.length, outcome === 'not-written' ? 0 : 1);
  });
}

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

test('原预约重试跨过开始时间仍返回原订单，新请求不能预约过去时间', async () => {
  const db = mockDb(), event = createEvent();
  const original = await handleOrder(db, event, { WX_OPENID: 'openid-buyer' }, KEY, 1000, uuidSequence());
  const recovered = await handleOrder(db, event, { WX_OPENID: 'openid-buyer' }, KEY, 4000, uuidSequence());
  assert.equal(recovered.id, original.id);
  assert.equal(db.orders.length, 1);
  await assert.rejects(handleOrder(db, { ...event, requirement: '同一编号但修改后的不同预约需求' },
    { WX_OPENID: 'openid-buyer' }, KEY, 4000, uuidSequence()), error => error.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(handleOrder(db, { ...event, idempotencyKey: 'new-expired-request-0001' },
    { WX_OPENID: 'openid-buyer' }, KEY, 4000, uuidSequence()), error => error.code === 'INVALID_TIME_SEGMENTS');
  assert.equal(db.orders.length, 1);
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
  await handleOrder(confirmedDb, { action: "transitionOrder", orderId: confirmedOrder.id, expectedVersion: 3, event: "PROVIDER_ENDS_COMMUNICATION", ...CONFIRMATIONS }, { WX_OPENID: "openid-provider" }, KEY, 3000, uuidSequence());
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
  const confirmed = await handleOrder(db, { action: "transitionOrder", orderId: created.id, expectedVersion: 3, event: "PROVIDER_ENDS_COMMUNICATION", ...CONFIRMATIONS }, { WX_OPENID: "openid-provider" }, KEY, 3000, uuidSequence());
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

test("communication requires explicit confirmations and rejects incomplete input without changing the order", async () => {
  const db = mockDb();
  const order = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const provider = { WX_OPENID: "openid-provider" };
  const transition = (event, expectedVersion, fields = {}) => handleOrder(db, {
    action: "transitionOrder", orderId: order.id, expectedVersion, event, ...fields
  }, provider, KEY, 2000, uuidSequence());
  await transition("PROVIDER_INTERESTED", 1);
  await transition("PROVIDER_RECORDS_CONTACT", 2);
  const before = JSON.stringify(db.orders[0]);
  for (const field of ["timePlaceConfirmed", "serviceScopeConfirmed", "amountConfirmed"]) {
    for (const value of [undefined, false, "true", 1]) {
      await assert.rejects(() => transition("PROVIDER_ENDS_COMMUNICATION", 3, { ...CONFIRMATIONS, [field]: value }),
        (error) => error.code === "COOPERATION_CONFIRMATION_REQUIRED");
      assert.equal(JSON.stringify(db.orders[0]), before);
    }
  }
  await assert.rejects(() => transition("PROVIDER_ENDS_COMMUNICATION", 3, { ...CONFIRMATIONS, ndaRequired: undefined }),
    (error) => error.code === "VALIDATION_ERROR");
  const confirmed = await transition("PROVIDER_ENDS_COMMUNICATION", 3, CONFIRMATIONS);
  assert.equal(confirmed.stage, "BUYER_FINAL_CONFIRM");
  for (const [field, value] of Object.entries(CONFIRMATIONS)) assert.equal(confirmed[field], value);
});

test("confirmations apply to the current quote version and preserve the NDA signing stage", async () => {
  const db = mockDb();
  const order = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const transition = (event, expectedVersion, fields = {}) => handleOrder(db, {
    action: "transitionOrder", orderId: order.id, expectedVersion, event, ...fields
  }, { WX_OPENID: "openid-provider" }, KEY, 2000, uuidSequence());
  await transition("PROVIDER_INTERESTED", 1);
  await transition("PROVIDER_RECORDS_CONTACT", 2);
  await transition("PROVIDER_LOCKS_QUOTE", 3, { items: [{ serviceId: "service_1", finalPriceFen: 70000 }] });
  await assert.rejects(() => transition("PROVIDER_ENDS_COMMUNICATION", 3, CONFIRMATIONS), (error) => error.code === "VERSION_CONFLICT");
  const confirmed = await transition("PROVIDER_ENDS_COMMUNICATION", 4, { ...CONFIRMATIONS, ndaRequired: true });
  assert.equal(confirmed.stage, "NDA_BUYER_PENDING");
  assert.equal(confirmed.amountFen, 70000);
  assert.equal(confirmed.ndaRequired, true);
});

test("verified payment still requires buyer agreement before execution", async () => {
  const db = mockDb();
  const buyer = { WX_OPENID: "openid-buyer" };
  const provider = { WX_OPENID: "openid-provider" };
  const order = await handleOrder(db, createEvent(), buyer, KEY, 1000, uuidSequence());
  const transition = (event, expectedVersion, actor, fields = {}) => handleOrder(db, {
    action: "transitionOrder", orderId: order.id, expectedVersion, event, ...fields
  }, actor, KEY, 4000, uuidSequence());
  await transition("PROVIDER_INTERESTED", 1, provider);
  await transition("PROVIDER_RECORDS_CONTACT", 2, provider);
  await transition("PROVIDER_ENDS_COMMUNICATION", 3, provider, CONFIRMATIONS);
  // In-memory payment fixture only; this does not invoke or simulate a production payment API.
  const payload = JSON.parse(db.orders[0].payload);
  payload.public.paymentStatus = "PAID";
  db.orders[0].payload = JSON.stringify(payload);
  const before = JSON.stringify(db.orders[0]);
  await assert.rejects(() => transition("BUYER_CONFIRMS_EXECUTION", 4, buyer), (error) => error.code === "AGREEMENT_NOT_CONFIRMED");
  assert.equal(JSON.stringify(db.orders[0]), before);
  await transition("BUYER_CONFIRMS_AGREEMENT", 4, buyer);
  const executing = await transition("BUYER_CONFIRMS_EXECUTION", 5, buyer);
  assert.equal(executing.stage, "IN_PRODUCTION");
  await assert.rejects(() => transition("BUYER_CONFIRMS_EXECUTION", 5, buyer), (error) => error.code === "VERSION_CONFLICT");
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

test("退款或争议冻结阻止两种验收入口，不写完成或结算意向", async () => {
  for (const reason of ['REFUND_REQUEST', 'DISPUTE']) {
    for (const event of ['BUYER_ACCEPTS_DELIVERY', 'BUYER_ACCEPTS_AND_SETTLES']) {
      const db = mockDb();
      const created = await handleOrder(db, createEvent(), { WX_OPENID: 'openid-buyer' }, KEY, 1000, uuidSequence());
      const row = forceProduction(db, created.id), payload = JSON.parse(row.payload);
      Object.assign(payload.public, { deliveryNote:'现场服务已经完成', provider:{career:'妆娘'} });
      row.payload=JSON.stringify(payload); row.stage='DELIVERY_PENDING';
      const from=db.from.bind(db);
      db.from=table => table === 'order_funds_interlocks'
        ? { select:()=>({eq:async()=>({data:[{hold_reason:reason}]})}) } : from(table);
      await assert.rejects(handleOrder(db, {action:'transitionOrder',orderId:row.id,expectedVersion:1,event},
        {WX_OPENID:'openid-buyer'},KEY,2000,uuidSequence()), {code:'ORDER_FUNDS_HELD'});
      assert.equal(row.stage,'DELIVERY_PENDING');
      assert.equal(JSON.parse(row.payload).settlementIntent,undefined);
    }
  }
});
test("两种验收入口原子保存待结算记录，客户端不能伪造到账或费用", async () => {
  for (const event of ["BUYER_ACCEPTS_DELIVERY", "BUYER_ACCEPTS_AND_SETTLES"]) {
    const db = mockDb();
    const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
    const row = forceProduction(db, created.id);
    const payload = JSON.parse(row.payload);
    Object.assign(payload.public, { deliveryNote: "现场服务已经完成", provider: { career: "妆娘" } });
    row.payload = JSON.stringify(payload);
    row.stage = "DELIVERY_PENDING";
    const request = { action: "transitionOrder", orderId: row.id, expectedVersion: 1, event,
      settlement: { status: "SUCCEEDED" }, platformFeeFen: 1, paymentId: "forged" };
    const results = await Promise.allSettled([2000, 2001].map(now =>
      handleOrder(db, request, { WX_OPENID: "openid-buyer" }, KEY, now, uuidSequence())));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.code, "VERSION_CONFLICT");
    const stored = JSON.parse(row.payload);
    assert.equal(row.stage, "COMPLETED");
    assert.deepEqual(stored.settlementIntent, { status: "PENDING", paymentId: payload.public.paymentId,
      acceptedOrderVersion: 2, createdAt: stored.public.completedAt });
    assert.equal(results.find(result => result.status === "fulfilled").value.settlementIntent, undefined);
    const before = row.payload;
    await assert.rejects(() => handleOrder(db, { ...request, expectedVersion: 2 },
      { WX_OPENID: "openid-buyer" }, KEY, 3000, uuidSequence()), { code: "ILLEGAL_TRANSITION" });
    assert.equal(row.payload, before);
    await handleOrder(db, { action: "transitionOrder", orderId: row.id, expectedVersion: 2,
      event: "BUYER_SUBMITS_REVIEW", rating: 5 }, { WX_OPENID: "openid-buyer" }, KEY, 4000, uuidSequence());
    assert.deepEqual(JSON.parse(row.payload).settlementIntent, stored.settlementIntent);
  }
});

test("验收写入失败不会留下已完成状态或孤立结算记录，重试可恢复", async () => {
  const db = mockDb();
  const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  const row = forceProduction(db, created.id);
  const payload = JSON.parse(row.payload);
  Object.assign(payload.public, { deliveryNote: "现场服务已经完成", provider: { career: "妆娘" } });
  row.payload = JSON.stringify(payload);
  row.stage = "DELIVERY_PENDING";
  const before = JSON.stringify(row);
  const from = db.from;
  db.from = table => {
    const query = from(table);
    if (table === "order_aggregates") query.update = () => {
      query.then = resolve => Promise.resolve({ data: null, error: { message: "write failed" } }).then(resolve);
      return query;
    };
    return query;
  };
  const request = { action: "transitionOrder", orderId: row.id, expectedVersion: 1, event: "BUYER_ACCEPTS_DELIVERY" };
  await assert.rejects(() => handleOrder(db, request, { WX_OPENID: "openid-buyer" }, KEY, 2000, uuidSequence()),
    { code: "DATABASE_OPERATION_FAILED" });
  assert.equal(JSON.stringify(row), before);
  db.from = from;
  await handleOrder(db, request, { WX_OPENID: "openid-buyer" }, KEY, 3000, uuidSequence());
  assert.equal(row.stage, "COMPLETED");
  assert.equal(JSON.parse(row.payload).settlementIntent.createdAt, 3000);
});

test("验收拒绝缺失付款证据及服务方代验收，不产生完成或结算记录", async () => {
  for (const changes of [{ paymentStatus: "UNPAID" }, { paymentStatus: "PAYMENT_REVIEW" },
    { paymentId: null }, { paymentTransactionId: null }, {}]) {
    const db = mockDb();
    const created = await handleOrder(db, createEvent(), { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
    const row = forceProduction(db, created.id);
    const payload = JSON.parse(row.payload);
    Object.assign(payload.public, { deliveryNote: "现场服务已经完成", provider: { career: "妆娘" } }, changes);
    row.payload = JSON.stringify(payload);
    row.stage = "DELIVERY_PENDING";
    const before = JSON.stringify(row);
    const provider = Object.keys(changes).length === 0;
    await assert.rejects(() => handleOrder(db, { action: "transitionOrder", orderId: row.id,
      expectedVersion: 1, event: "BUYER_ACCEPTS_DELIVERY", paymentStatus: "PAID" },
    { WX_OPENID: provider ? "openid-provider" : "openid-buyer" }, KEY, 2000, uuidSequence()),
    { code: provider ? "ORDER_ROLE_FORBIDDEN" : "PAYMENT_NOT_VERIFIED" });
    assert.equal(JSON.stringify(row), before);
  }
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

test("私人参考图签前仅需求方可取，签后双方可取，错归属或不可用资产不签发", async () => {
  const db = mockDb();
  const order = await handleOrder(db, { ...createEvent(), referenceAssetId: "asset_reference", ndaRequired: true }, { WX_OPENID: "openid-buyer" }, KEY, 1000, uuidSequence());
  let issued = 0;
  const storage = { async getTempFileURL({ fileList }) { issued++; return { fileList: [{ fileID: fileList[0].fileID, code: "SUCCESS", tempFileURL: "https://files.example.test/reference" }] }; } };
  const request = openId => handleOrder(db, { action: "getReferenceDownload", orderId: order.id, assetId: "attacker-controlled-ignored" }, { WX_OPENID: openId }, KEY, 2000, uuidSequence(), storage);
  assert.equal((await request("openid-buyer")).url, "https://files.example.test/reference");
  await assert.rejects(() => request("openid-provider"), error => error.code === "NDA_REQUIRED");
  await assert.rejects(() => request("openid-outsider"), error => error.code === "ORDER_NOT_FOUND");
  assert.equal(issued, 1);
  const payload = JSON.parse(db.orders[0].payload);
  payload.public.buyerNdaSigned = true; payload.public.providerNdaSigned = true;
  db.orders[0].payload = JSON.stringify(payload);
  await request("openid-provider"); assert.equal(issued, 2);
  for (const [key, value] of [["status", "REJECTED"], ["owner_account_id", PROVIDER], ["purpose", "PROJECT_TARGET"], ["mime_type", "application/pdf"], ["storage_key", "https://evil.example/image"]]) {
    const before = db.referenceAsset[key]; db.referenceAsset[key] = value;
    await assert.rejects(() => request("openid-provider"), error => error.code === "REFERENCE_MEDIA_NOT_READY");
    db.referenceAsset[key] = before;
  }
  assert.equal(issued, 2);
});
