const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const output = path.resolve(__dirname, "..", ".artifacts", "auth-page-audit");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const cliPath = process.env.WECHAT_CLI_PATH;

async function capture(miniProgram, state, name) {
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
    await registration.setData({ fieldError: true, noticeError: false });
    await registration.waitFor(120);
    await miniProgram.screenshot({ path: path.join(output, "04-register-missing-nickname.png") });
    await registration.setData({ nickname: "桃桃造型师", nicknameLength: 6, fieldError: false, noticeError: true });
    await registration.waitFor(120);
    await miniProgram.screenshot({ path: path.join(output, "05-register-missing-notice.png") });
    await registration.setData({ acceptedNotice: true, noticeError: false, canRegister: true });
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
  console.log("Login and registration full-page visual audit captured 9 states");
}

main().catch((error) => { console.error(error); process.exit(1); });
