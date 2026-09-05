const assert = require("assert");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "miniprogram");
const forbiddenTokens = [
  "#4935ad", "#7861db", "#6546bd", "#7457d8", "#6d55d9", "#7556c9",
  "#b45ad5", "#9255d9", "#a650d8", "#4d367c", "#39267f", "#332556",
  "#3e2f69", "#ece8ff", "#eeeafd", "#f0edff", "#f0ecff", "#f1edff",
  "#f2e8ff", "#f3efff", "#f4dff5", "#f5f2ff", "#f6f3ff", "#faf7ff",
  "#fbf9ff", "#c9bdf7", "#9d8cdc", "#bfb1f3", "#b7aaf0", "#d6cdf5",
  "#d5cdf5"
];

function collect(directory, result = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target, result);
    else if (/\.(wxss|wxml|js|json|svg)$/i.test(entry.name)) result.push(target);
  });
  return result;
}

const violations = [];
collect(sourceRoot).forEach((file) => {
  const source = fs.readFileSync(file, "utf8").toLowerCase();
  forbiddenTokens.forEach((token) => {
    if (source.includes(token)) violations.push(`${path.relative(projectRoot, file)}: ${token}`);
  });
  if (/\b(?:purple|violet|lavender)\b/.test(source)) {
    violations.push(`${path.relative(projectRoot, file)}: legacy purple semantic name`);
  }
});

assert.deepStrictEqual(violations, [], `发现旧紫色主题残留：\n${violations.join("\n")}`);
process.stdout.write(`Theme color audit passed: ${collect(sourceRoot).length} production files contain no legacy purple theme tokens or semantic names\n`);
