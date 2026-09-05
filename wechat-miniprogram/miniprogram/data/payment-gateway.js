function validPaymentRequest(request) {
  return Boolean(request && request.timeStamp && request.nonceStr && request.package && request.paySign);
}

function requestOrderPayment(order) {
  const request = order && order.paymentRequest;
  if (!validPaymentRequest(request)) {
    return Promise.reject({ code: "PAYMENT_NOT_CONFIGURED" });
  }
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: String(request.timeStamp),
      nonceStr: request.nonceStr,
      package: request.package,
      signType: request.signType || "RSA",
      paySign: request.paySign,
      success: resolve,
      fail(error) {
        const message = error && error.errMsg || "";
        reject({ code: /cancel/i.test(message) ? "PAYMENT_CANCELLED" : "PAYMENT_FAILED", error });
      }
    });
  });
}

module.exports = { validPaymentRequest, requestOrderPayment };
