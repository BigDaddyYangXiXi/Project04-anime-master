// Display states are derived from the existing order; this model never changes it.
function statusViewFor(order, step, confirmed) {
  if (["PAYMENT_REVIEW", "VERIFYING"].includes(order.paymentStatus)) return { title: "付款信息正在核对", lead: "当前付款结果还未确认，请勿重复付款。", focus: "现在无需再次支付", hint: "核对完成后更新状态，请稍后刷新。", kind: "review" };
  if (order.stage === "DECLINED") return { title: "本次预约未达成", lead: "服务方暂时无法承接这次预约。", focus: "对方说明", hint: order.supplementNote || "本次沟通未能确认合作条件。", kind: "declined" };
  if (order.stage === "SUPPLEMENT_REQUESTED") return { title: "请补充一点信息", lead: "服务方需要更多细节，才能判断是否可以承接。", focus: "对方想了解", hint: order.supplementNote || "请补充预约需求。", kind: "supplement" };
  if (step === 4) return { title: "合作已生效", lead: "请按约定准备服务，后续进展在订单详情中查看。", focus: "按约定准备合作", hint: "执行、交付与验收均沿用本次合作信息。", kind: "active" };
  if (order.stage === "NDA_BUYER_PENDING") return { title: "先完成保密约定", lead: "本次合作需要双方签署保密协议。", focus: "阅读后再签署", hint: "双方签署后，服务方才能查看保密需求并继续沟通。", kind: "nda" };
  if (order.stage === "NDA_PROVIDER_PENDING") return { title: "等待对方签署协议", lead: "你已完成签署，对方签署后可查看保密需求并继续沟通。", focus: "你的签署已记录", hint: "无需重复签署，留意状态更新即可。", kind: "waiting" };
  if (step === 3 && confirmed) return { title: order.paymentStatus === "PAID" ? "付款已确认" : "合作已确认，待付款", lead: "双方合作信息已确认，付款完成后进入执行。", focus: "本次合作金额已确认", hint: "以最终合作约定与支付核验结果为准。", kind: order.paymentStatus === "PAID" ? "review" : "pay" };
  if (step === 3) return { title: "核对本次合作约定", lead: "服务方已提交合作条件，请核对约定后再付款。", focus: "确认内容与沟通结果一致", hint: "时间地点、服务范围、保密要求与金额都在确认面板中查看。", kind: "confirm" };
  if (step === 2) return { title: "正在沟通合作细节", lead: "请确认时间地点、服务范围和合作金额。", focus: "等对方整理合作约定", hint: "沟通达成后，你将在这里核对完整信息。", kind: "waiting" };
  return { title: order.stage === "CONTACTING" ? "对方已接受预约" : "等待对方回应", lead: "预约信息已送达，请留意服务方的回应。", focus: "现在无需重复操作", hint: "留意微信或电话，收到回应后再继续。", kind: "waiting" };
}
module.exports = { statusViewFor };
