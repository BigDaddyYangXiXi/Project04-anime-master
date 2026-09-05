const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");

function deploymentPlan(name) {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, "cloudbaserc.json"), "utf8"));
  const functionConfig = config.functions.find((item) => item.name === name);
  if (!functionConfig) throw new Error(`未知云函数：${name}`);
  const functionDir = path.join(projectRoot, config.functionRoot || "cloudfunctions", name);
  const packageFile = path.join(functionDir, "package.json");
  if (!fs.existsSync(packageFile)) throw new Error(`云函数缺少 package.json：${name}`);
  const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  const dependencies = Object.keys(manifest.dependencies || {});
  const missingDependencies = dependencies.filter((dependency) => !fs.existsSync(path.join(functionDir, "node_modules", ...dependency.split("/"), "package.json")));
  return {
    name,
    functionDir,
    dependencies,
    missingDependencies,
    installDependency: missingDependencies.length > 0,
    runtime: functionConfig.runtime
  };
}

function deploymentCommands(plan) {
  return [
    ["fn", "deploy", plan.name, "--force", "--install-dependency", String(plan.installDependency), "--json"],
    ["config", "update", "fn", plan.name, "--runtime", plan.runtime, "--json"]
  ];
}

function main(argv = process.argv.slice(2)) {
  const name = argv.find((value) => !value.startsWith("--"));
  if (!name) throw new Error("用法：node scripts/deploy-cloud-function.js <函数名> [--dry-run]");
  const plan = deploymentPlan(name);
  console.log(JSON.stringify({
    function: plan.name,
    dependencies: plan.dependencies,
    missingDependencies: plan.missingDependencies,
    installDependency: plan.installDependency,
    dryRun: argv.includes("--dry-run")
  }, null, 2));
  if (argv.includes("--dry-run")) return;
  for (const args of deploymentCommands(plan)) {
    const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts/cloudbase-cli.js"), ...args], { cwd: projectRoot, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(2); }
}

module.exports = { deploymentCommands, deploymentPlan };
