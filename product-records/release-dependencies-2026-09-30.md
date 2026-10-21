# 最新客户端与生产依赖核对

2026-09-30 只读查询公司环境 cloudbase-d2g65rqbvee0bd978，完整分页取得 28 个云函数，状态均为 Deployment completed；3 条公开服务分别指向消息、付款、退款回调。未读取或输出函数环境变量，未部署。

客户端 services 下 11 个字面量调用目标全部存在：account-api、account-bootstrap、availability-api、catalog-read、media-security-submit、media-upload、order-api、payment-api、project-api、provider-catalog-draft、saved-items-api。另人工检查 cloud-catalog 转发 name 的来源均为这些字面量调用。证据：wechat-miniprogram/.artifacts/company-deployment-inventory.json、client-function-dependencies-20260930.json。

存在与部署状态只证明入口齐全，不能证明 action 合同、源码版本、权限或业务全链通过。当前真实身份与部分读取的证据仍以 company-session-post-publication-fix-20260930.json 为准；不将空目录认作公开发布成功。

## 当前可继续与禁止混发的内容

- 客户端最近修改仅 UID 可见行、发布版本校验、离开页面后的过时响应保护；沿用原 publishDraft/getQualification/submitQualification 参数，没有新增接口或数据库依赖。已同步身份正常的 company-startup-trial-20260929，未上传。
- 新独立目录静态检查通过但原生运行 AppID 为空，已标失败并关闭窗口；不能拿它替代已验证项目上传。配置相同不代表原生身份已通过。
- 最新本地财务/提现代码不能随客户端修正一起部署。生产仍缺 0042/0043/0050/0052/0053/0054 对象及相关最小权限（按最近只读结构证据）；新版净额/来源/预留模块必须等结构、权限和核验前置齐全。0051 已存在不能替代这些迁移。
- 本人银行卡核验只获准准备方案；未开通、购买或传送真实个人信息。真实出款、到账与特殊退款/税额更正仍未闭环。
- 2 号暂时退出测试，双账号真实发布、订单、交付验收等待测试账号。体验版二维码仍受浏览器工具初始化失败阻断，不能以开发预览码替代。

下一次上传须以最新源码指纹与实际运行项目一致为起点，补发布确认/失效提示/返回状态完整画面，再按既有授权边界推进。正式提审发布还必须通过总待办的交易、安全、资质与真机门槛；本次依赖检查没有消除这些阻断。
