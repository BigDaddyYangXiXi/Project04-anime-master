# 提现回单登记结果查回

本轮补齐财务命令的只读恢复入口。此前只能登记回单，提交成功但响应丢失后不能通过同一工具只读确认；原事件重试仍可用，不应换事件号或重新付款来排错。

在 wechat-miniprogram 目录执行 `node scripts/withdrawal-receipt-cli.js --find <私有查询文件路径>`。文件只含 eventId、requestId、paymentId（32 位小写十六进制）及 providerId。复用既有公司 BANK_RECEIPT_SCOPE、受限财务数据库身份、操作人和强制 TLS 校验，不新增公开 API 或权限。

查询用一条 SQL 关联回单事件、付款条目及提现申请，同时限定公司 AppID、商户、服务方、申请号和付款号。返回 found、eventId；找到时另返回 paymentId、recordedStatus（原事件结果）及 status（付款当前状态）。不返回银行流水、账户版本、金额、回单引用或操作人。旧 UNKNOWN 事件在付款后来成功后返回 recordedStatus=UNKNOWN、status=SUCCEEDED，不能把旧事件状态误当当前付款状态。

found=false 仅表示本次查询未见该范围内已提交事件，不证明登记失败，也不证明银行未付款。原登记可能尚未提交；保留原事件号继续查询，必要时按原内容重试登记。不得换编号、释放占用或再次提交银行付款来排错。

验证：7 项入口/输入测试与 23 项真实本地 MySQL 集成测试通过。覆盖丢失响应查回、未知转成功、公司/商户/服务方/申请/付款隔离；在 MySQL READ ONLY 事务内执行查询成功，事件数保持 2、已付金额仍 100 分。既有并发预留、回单冲突、退款冻结和来源账本测试通过。证据：wechat-miniprogram/.artifacts/withdrawal-receipt-recovery-mysql-20261003.txt。隔离数据库由测试清理，本机 MySQL 已关闭。

仅本地实现，未生产迁移、授权、部署或处理真实回单。银行卡本人核验、正式付款导出、到账账本及真实银行付款仍未完成；该查回功能不验证银行证据真伪，不代表提现闭环验收。
