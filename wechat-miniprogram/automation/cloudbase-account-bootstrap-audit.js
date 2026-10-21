// Historical entry point: use company AppID/environment guards and explicit
// read-only session checks. Never invoke implicit login/register actions.
require("./company-foundation-runtime-audit");
