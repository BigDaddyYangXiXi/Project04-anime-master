// Test-only merchant credentials and a Node HTTP stream substitute. Never contacts WeChat.
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

function createQueryFixture(verificationConfig) {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config = { ...verificationConfig, platformMchid: "1900000001", merchantSerial: "ABCDEF0123456789",
    merchantPrivateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }), wechatPublicKeyId: [...verificationConfig.publicKeys.keys()][0] };
  function requestFor(result, inspect = () => {}, stream = (response) => response.end(result.body)) {
    return (options, callback) => {
      inspect(options);
      const client = new EventEmitter();
      client.destroy = () => { client.destroyed = true; };
      client.end = () => queueMicrotask(() => {
        if (client.destroyed) return;
        const response = new PassThrough();
        response.statusCode = result.statusCode;
        response.rawHeaders = result.rawHeaders || Object.entries(result.headers || {}).flat();
        callback(response);
        if (!response.destroyed) stream(response);
      });
      return client;
    };
  }
  return { config, publicKey: pair.publicKey, requestFor };
}

module.exports = { createQueryFixture };
