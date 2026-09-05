function createWxPhoneAdapter(cloud) {
  return {
    async getPhoneNumber(code, openid) {
      if (typeof code !== "string" || !code.trim()) {
        const error = new Error("phone authorization code is missing");
        error.code = "PHONE_CODE_MISSING";
        throw error;
      }
      try {
        const result = await cloud.openapi.phonenumber.getPhoneNumber({ code: code.trim(), openid });
        const phoneInfo = result && (result.phoneInfo || result.phone_info);
        if (!phoneInfo || !phoneInfo.phoneNumber) throw new Error("verified phone was not returned");
        return phoneInfo;
      } catch (cause) {
        const error = new Error("WeChat phone verification failed");
        error.code = "PHONE_VERIFICATION_FAILED";
        error.cause = cause;
        throw error;
      }
    }
  };
}

module.exports = { createWxPhoneAdapter };
