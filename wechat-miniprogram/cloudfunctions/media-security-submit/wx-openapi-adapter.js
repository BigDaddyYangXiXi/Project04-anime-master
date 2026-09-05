function createWxOpenApiAdapter(cloud) {
  return {
    async callWxOpenApi({ apiName, requestData }) {
      if (apiName !== "security.mediaCheckAsync") {
        return { code: "UNSUPPORTED_OPENAPI", message: `Unsupported OpenAPI: ${apiName}` };
      }
      try {
        const result = await cloud.openapi.security.mediaCheckAsync({
          mediaUrl: requestData.media_url,
          mediaType: requestData.media_type,
          version: requestData.version,
          scene: requestData.scene,
          openid: requestData.openid
        });
        return {
          result: {
            errcode: Number(result.errCode || 0),
            errmsg: result.errMsg || "",
            trace_id: result.traceId || ""
          }
        };
      } catch (error) {
        return {
          code: Number(error && error.errCode || error && error.code || 0) || "WX_OPENAPI_ERROR",
          message: error && (error.errMsg || error.message) || "WeChat OpenAPI request failed"
        };
      }
    }
  };
}

module.exports = { createWxOpenApiAdapter };
