const os = require("os");
const path = require("path");

os.homedir = () => path.resolve(__dirname, "..", ".cloudbase-cli-config");
require("@cloudbase/cli/dist/standalone/cli.js");
