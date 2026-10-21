# 私网通知函数部署依赖

该函数直接访问 MySQL，不调用 CloudBase 或微信 OpenAPI。独立锁文件仅包含 mysql2 及其依赖；公网通知函数继续使用订单服务的 SDK 依赖。

`scripts/prepare-company-notification.js` 会将此处两个 JSON 文件复制至私网暂存目录，再执行离线 `npm ci --omit=dev --ignore-scripts`，清除旧包残留。首次缓存不足时，在 `wechat-miniprogram/.artifacts/company-notification-functions/order-notification-private` 执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`，然后重新准备。不要在公司云函数内安装或动态更新依赖。

依赖变更后需检查暂存包入口加载、通知测试及部署后的签名/数据库只读路径。零审计告警只表示该锁文件没有当前已知告警，不代表完整安全验收，也不覆盖公网函数。

运行现有 `automation/notification-mysql.integration.js` 时，设置 `NOTIFICATION_TEST_DEPLOYMENT_BUNDLE=true` 可同时加载暂存包内的业务模块和 MySQL 驱动。仍须显式设置 `PAYMENT_TEST_MYSQL_PORT` 指向独立本机 MySQL；测试只连接 127.0.0.1，创建随机测试库并在结束时删除，不读取公司数据库配置。

部署后执行 `scripts/audit-company-notification-code.ps1 -Side private`（或 `public`），从公司环境下载当前代码包，先核对平台摘要，再与本地暂存目录逐文件核对，包括依赖文件。脚本不解压、不输出签名地址、不调用业务；结果与代码包保存在 `.artifacts`。代码一致不等于配置一致或业务验收，应配合现有 `audit-company-notification.js`。
