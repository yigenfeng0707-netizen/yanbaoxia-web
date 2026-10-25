const { AlipaySdk } = require("alipay-sdk");
const { loadAlipayConfig } = require("./config");

let instance = null;
function getAlipaySdk() {
  if (!instance) {
    const cfg = loadAlipayConfig();
    instance = new AlipaySdk({
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      alipayPublicKey: cfg.alipayPublicKey,
      gateway: cfg.gateway,
      signType: cfg.signType,
    });
  }
  return instance;
}
module.exports = { getAlipaySdk };
