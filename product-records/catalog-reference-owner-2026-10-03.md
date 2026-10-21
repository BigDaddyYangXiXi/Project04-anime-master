# 发现列表作品参考次数作者隔离（2026-10-03）

## 问题与范围

`catalog-read/catalog-core.js` 的 `enrichCatalogMetrics` 原以作品编号单独累计订单参考次数。公开草稿作品编号只在作者内唯一，因此两作者同编号作品会互相累计；发现列表一次读取多个作者订单，详情只读取当前作者订单，两处结果不一致。

本次按订单 `provider_id` 分组后再按作品编号累计，读取时使用当前作者 ID。保留既有快照参考数与订单数取较大值的规则，不改变历史计数语义、资格条件、排序、页面或数据库。

## 验证

- 新回归经 `readCatalog` 构造两作者同编号公开作品，甲有两条已确认参考订单、乙有一条。修复前发现列表甲实际为 3、预期为 2，测试失败。
- 修复后发现列表和两作者分别定向读取作品详情均得到甲 2、乙 1。
- `node --test cloudfunctions/catalog-read/catalog-core.test.js cloudfunctions/catalog-read/index.test.js`：24 项通过，包含作品编号碰撞、原型名称编号、草稿隔离、公开资格、筛选排序与媒体归属。
- 既有 SDK 部署包与源码比较，仅本次统计分组差异（6 增 2 删）；旧文件保留在 `.artifacts/catalog-core-pre-reference-owner-20261003.js`，已同步候选包并检查运行依赖。

## 当前边界

仅本地回归和候选包准备完成，尚未部署，不代表公司线上或手机验收通过；无业务写入、迁移、权限或资金操作。公司 0.9.3 客户端归档未修改。

发现目录数据库分页、真实跨账号公开作品及完整业务链路仍未完成，本次不将 D03 或双机验收标记完成。

## 公司部署完成（覆盖前述未部署状态）

同日沿用既有公司修复部署授权，部署前官方只读核对环境变量、运行版本、入口、内存、超时、VPC、公网/EIP均与既有配置一致。普通沙箱返回无有效身份，使用既有执行权限审查后同一公司配置查询成功，未要求重新登录或改权限。

公司 CLI 部署 `catalog-read`，任务 20429 终态 exit 0，日志明确部署成功（`wechat-miniprogram/.artifacts/catalog-reference-deploy-20261003.log`）。未重复启动部署任务。官方 GetFunctionAddress 下载代码包后，入口、核心、SDK及包元数据共6个运行文件 SHA256 全部匹配候选。部署后状态 Active，全部环境变量与运行资源、网络配置相较部署前一致。

证据：`.artifacts/catalog-reference-config-before-20261003.json`、`catalog-reference-config-after-20261003.json`、`catalog-reference-code-audit-20261003.json`、`catalog-reference-deployed-20261003.zip`（均位于 wechat-miniprogram）。

当前 9426 开发工具验收端口无监听，未进行本轮原生调用或手机验证；部署/回读证据不能代替真实跨账号统计验收。无业务数据、迁移、权限、资金或客户端版本变更。

## 部署后原生只读验证

同日确认9426无监听/开发工具未运行后，经官方CLI恢复既有公司工程，实际AppID为 `wxc94e1c1b38944511`。启动后直接处于 `pages/discover/index`；完整截图 `catalog-reference-discover-20261003.png` 已查看：万匠屋标题、作品选中、佛山南海区、日期2026-10-03、无匹配结果及底栏可见。

实际调用原客户端 `cloud-catalog.listDiscovery` 成功。初次上海查询0条仅作连通性证据（`catalog-reference-native-read-20261003.json`），之后以页面真实 `serverFilters` 生成佛山440600/妆娘/当日/limit50查询，并同时调用不带发现筛选的 `listProviders`：筛选总数0、完整公开服务方0、公开作品0、nextCursor为null。证据 `catalog-reference-native-current-filter-20261003.json`，上述文件均位于 `wechat-miniprogram/.artifacts/`。

因此当前空列表并非仅上海测试条件造成，公开目录接口当前确实未返回作品。这里只证明实际只读链路和当前空状态，不能验证非空作品参考次数、发布成功或双账号可见；未读取已退出测试者的私有草稿，未写入账号/作品/订单。首次模块调用误用相对路径失败，改用原生模块标识后成功，不计首次为验收通过。无替身/临时页面数据注入，当前页面保持发现。
