const allowed = {
  REQUESTED: { PROVIDER_INTERESTED: "CONTACTING", PROVIDER_REQUESTS_SUPPLEMENT: "SUPPLEMENT_REQUESTED", PROVIDER_DECLINES: "DECLINED" },
  SUPPLEMENT_REQUESTED: { BUYER_SUPPLEMENTS: "SUPPLEMENTED" },
  SUPPLEMENTED: { PROVIDER_INTERESTED: "CONTACTING", PROVIDER_REQUESTS_SUPPLEMENT: "SUPPLEMENT_REQUESTED", PROVIDER_DECLINES: "DECLINED" },
  CONTACTING: { PROVIDER_ENDS_COMMUNICATION_FAILED: "DECLINED" },
  NDA_BUYER_PENDING: { BUYER_SIGNS_NDA: "NDA_PROVIDER_PENDING" },
  NDA_PROVIDER_PENDING: { PROVIDER_SIGNS_NDA: "BUYER_FINAL_CONFIRM" },
  BUYER_FINAL_CONFIRM: { PAYMENT_VERIFIED: "IN_PRODUCTION" },
  IN_PRODUCTION: { PROVIDER_SUBMITS_DELIVERY: "DELIVERY_PENDING" },
  REVISION_REQUESTED: { PROVIDER_SUBMITS_DELIVERY: "DELIVERY_PENDING" },
  DELIVERY_PENDING: { BUYER_REQUESTS_REVISION: "REVISION_REQUESTED", BUYER_ACCEPTS_AND_SETTLES: "COMPLETED" },
  COMPLETED: {},
  DECLINED: {}
};

function transitionOrder(stage, event, ndaRequired, order = {}) {
  if (["REQUESTED", "SUPPLEMENTED"].includes(stage) && event === "PROVIDER_INTERESTED" && ndaRequired
    && !(order.buyerNdaSigned && order.providerNdaSigned)) return "NDA_BUYER_PENDING";
  if (stage === "NDA_PROVIDER_PENDING" && event === "PROVIDER_SIGNS_NDA" && order.ndaFlowVersion === 2
    && !order.communicationDone) return "CONTACTING";
  if (stage === "CONTACTING" && event === "PROVIDER_ENDS_COMMUNICATION") {
    return ndaRequired && !(order.buyerNdaSigned && order.providerNdaSigned) ? "NDA_BUYER_PENDING" : "BUYER_FINAL_CONFIRM";
  }
  const next = allowed[stage] && allowed[stage][event];
  if (!next) throw new Error(`Illegal order transition: ${stage} -> ${event}`);
  return next;
}

module.exports = { allowed, transitionOrder };
