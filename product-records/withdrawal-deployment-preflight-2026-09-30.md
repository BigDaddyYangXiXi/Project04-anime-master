# 提现部署前置核查

本轮仅本地修改和生产只读查询，未执行迁移、扩权、上传或真实资金操作。

## 已修正的检查遗漏

mysql-readonly-preflight补查0042银行批次/来源、0043提现申请/付款、0050银行回单、0054提现来源的字段类型和必要索引；此前只包含财务导入及净额账本，不能覆盖新预留实现全部表依赖。来源重复分配、银行回单重复流水和批次重复占用所依赖的唯一索引不能被普通索引替代。

10项预检测试通过。真实本机MySQL执行全部迁移后，deployment schema inspection通过，且故意改变字段类型/删索引会失败。证据：wechat-miniprogram/.artifacts/withdrawal-schema-mysql-20260930.txt。该工具仍只覆盖所列字段/索引，外键、CHECK、生成列表达式、权限和完整业务并发另由集成验收证明，不宣称完整结构审计。

## 公司生产当前差距

通过既有cloudbase-company-cli只读通道运行audit-company-payment-schema；数据库匹配cloudbase-d2g65rqbvee0bd978。元数据未返回以下7表的所需字段/索引：bank_settlement_batches、bank_settlement_sources、withdrawal_requests、withdrawal_bank_payments、withdrawal_receipt_events、withdrawal_sources、finance_net_settlements。fund_journals.event_type及fund_postings.account与新净额枚举不符。orders/payments/settlements均0。检查ok=false符合尚未迁移状态，不是当前已部署支付突然失效的证据。

对应0042、0043、0050、0052、0053、0054生产迁移及最小权限仍须具体审查授权。财务导入0051已存在也不代表上述对象已齐全。不得只部署新版withdrawal-payment-store；必须连同withdrawal-backing及所有依赖准备，并完成银行卡核验、导出时实时复核、特殊退款/税额更正和到账核销后才可启用。

## 体验版优先事项本轮复验

浏览器服务仍引用不存在的browser/26.924.22138/scripts/browser-service.mjs，初始化失败；没有伪造版本目录或替换体验二维码，仍未取得公司后台体验码。

公司真实账号只读任务2026-09-29T17:58:15.561Z终态成功：服务端AppID身份、注册与本人资料匹配；公开作者/发现目录均0，项目/收藏/档期/草稿/资格读取成功。观察超时后续读同一任务取得终态，没有重启任务。证据wechat-miniprogram/.artifacts/company-session-readonly-recheck-20260930.json。未写业务数据，未把公开目录空结果当成发布或双账号可见验收。
