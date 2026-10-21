const TEMPLATE_ID = "x5-tvzV9SaOPUjOLPT_lZBpqWnfCYKFU1LYI-JsqDGQ";

// Call directly from a user tap. A successful API callback may still mean rejection.
function requestOrderSubscription(api) {
  if (!api || !api.requestSubscribeMessage) return Promise.resolve({ status: "unavailable" });
  return new Promise(resolve => {
    try {
      api.requestSubscribeMessage({
        tmplIds: [TEMPLATE_ID],
        success(result) {
          const status = result && result[TEMPLATE_ID];
          resolve({ status: ["accept", "reject", "ban", "filter"].includes(status) ? status : "failed" });
        },
        fail() { resolve({ status: "failed" }); }
      });
    } catch (_) {
      resolve({ status: "failed" });
    }
  });
}

module.exports = { TEMPLATE_ID, requestOrderSubscription };
