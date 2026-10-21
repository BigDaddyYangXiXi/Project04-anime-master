# 支付部署包本地模块预检修复

2026-09-30复现：company-deploy-preflight在--install-dependency=true时提前返回，缺少延迟加载的本地业务文件仍能通过。反例使用index→fund-audit→缺失finance-result-fingerprint，预期拒绝但旧实现未抛错。在线安装npm依赖不能补项目源码。

现在线/离线安装两条路径都先检查index存在和所有字面量相对require依赖，再分别执行其余检查；不改变公司环境/身份规则。新增缺失深层模块和缺失入口反例，补齐后可以通过。

14项相关测试通过，证据wechat-miniprogram/.artifacts/payment-package-preflight-20260930.txt。首次组合回归另发现两项旧测试假定本机未安装依赖，实际已安装而失败；测试现明确模拟存在/缺失条件，保留原逻辑验证，不以删除测试放行。初次结果保留payment-package-preflight-initial-20260930.txt。

按现有公司打包文件规则生成.artifacts/payment-source-package-20260930/functions/payment-api代码候选，63个文件，无本地模块缺失，在线安装模式预检通过。逐文件SHA256及结果在同目录上级audit.json。此目录不含凭据或部署开关，未上传。源码payment-api现有第三方依赖树检查通过，但代码候选未复制node_modules，不能当作可直接离线部署的完整包。

财务指纹、净额/提现来源及实时复核模块均在规则选取范围内。公司真实部署仍有数据库结构、最小权限、本人银行卡核验和出款闭环前置，未部署、未启用新财务入口。没有将本地检查当作生产状态或真机验收。
