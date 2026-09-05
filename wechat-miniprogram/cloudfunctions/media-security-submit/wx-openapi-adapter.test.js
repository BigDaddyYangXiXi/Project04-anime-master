const assert = require("node:assert/strict");
const test = require("node:test");

const { createWxOpenApiAdapter } = require("./wx-openapi-adapter");

test("maps mediaCheckAsync request and response fields", async () => {
  let received;
  const adapter = createWxOpenApiAdapter({
    openapi: {
      security: {
        mediaCheckAsync: async (request) => {
          received = request;
          return { errCode: 0, errMsg: "ok", traceId: "trace-1" };
        }
      }
    }
  });

  const response = await adapter.callWxOpenApi({
    apiName: "security.mediaCheckAsync",
    requestData: {
      media_url: "https://example.test/image.png",
      media_type: 2,
      version: 2,
      scene: 1,
      openid: "openid-1"
    }
  });

  assert.deepEqual(received, {
    mediaUrl: "https://example.test/image.png",
    mediaType: 2,
    version: 2,
    scene: 1,
    openid: "openid-1"
  });
  assert.deepEqual(response, {
    result: { errcode: 0, errmsg: "ok", trace_id: "trace-1" }
  });
});

test("normalizes SDK errors without throwing provider details away", async () => {
  const adapter = createWxOpenApiAdapter({
    openapi: {
      security: {
        mediaCheckAsync: async () => {
          throw { errCode: 48001, errMsg: "api unauthorized" };
        }
      }
    }
  });

  const response = await adapter.callWxOpenApi({
    apiName: "security.mediaCheckAsync",
    requestData: {}
  });

  assert.deepEqual(response, { code: 48001, message: "api unauthorized" });
});
