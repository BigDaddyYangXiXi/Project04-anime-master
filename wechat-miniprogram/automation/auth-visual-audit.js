const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const output = path.resolve(__dirname, "..", ".artifacts", "auth-page-audit");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const cliPath = process.env.WECHAT_CLI_PATH;

async function capture(miniProgram, state, name) {
  console.log(`Capturing auth state: ${state}`);
  const page = await miniProgram.reLaunch(`/pages/auth/index?audit=1&state=${state}`);
  await page.waitFor(350);
  await miniProgram.screenshot({ path: path.join(output, `${name}.png`) });
  return page;
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const exceptions = [];
  const miniProgram = cliPath
    ? await automator.launch({ cliPath, projectPath: path.resolve(__dirname, "..") })
    : await automator.connect({ wsEndpoint });
  miniProgram.on("exception", (error) => exceptions.push(String(error)));
  try {
    await capture(miniProgram, "loading", "01-checking");
    await capture(miniProgram, "login", "02-login");
    const registration = await capture(miniProgram, "register", "03-register");
    assert.notEqual(await (await registration.$(".primary-button")).attribute("open-type"), "getRealtimePhoneNumber");
    await (await registration.$(".primary-button")).tap();
    await registration.waitFor(200);
    assert.equal(await registration.data("fieldError"), true);
    await registration.waitFor(120);
    await miniProgram.screenshot({ path: path.join(output, "04-register-missing-nickname.png") });
    await (await registration.$(".nickname-input")).input("桃桃造型师");
    await (await registration.$(".primary-button")).tap();
    await registration.waitFor(200);
    assert.equal(await registration.data("noticeError"), true);
    await registration.waitFor(120);
    await miniProgram.screenshot({ path: path.join(output, "05-register-missing-notice.png") });
    await (await registration.$(".notice-link")).tap();
    await registration.waitFor(200);
    await miniProgram.screenshot({ path: path.join(output, "10-account-notice.png") });
    await miniProgram.native().confirmModal();
    assert.equal(await registration.data("acceptedNotice"), false);
    await (await registration.$(".notice-row")).tap();
    await registration.waitFor(200);
    assert.equal(await registration.data("canRegister"), true);
    assert.equal(await (await registration.$(".primary-button")).attribute("open-type"), "getRealtimePhoneNumber");
    await registration.waitFor(120);
    await miniProgram.screenshot({ path: path.join(output, "06-register-ready.png") });
    const errorPage = await capture(miniProgram, "error", "07-error");
    await miniProgram.pageScrollTo(180);
    await errorPage.waitFor(120);
    await miniProgram.screenshot({ path: path.join(output, "08-error-bottom.png") });
    await capture(miniProgram, "success", "09-success");
  } finally {
    miniProgram.disconnect();
  }
  if (exceptions.length) throw new Error(exceptions.join("\n"));
  console.log("Login and registration native audit passed: 10 captures, field/notice validation and phone authorization eligibility");
}

main().catch((error) => { console.error(error); process.exit(1); });
