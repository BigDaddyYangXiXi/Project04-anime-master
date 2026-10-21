# 退款入账本地回归补充

用户UI反馈到来前完成：新增refund-results.test.js直接调用真实recordRefundResult及fund-ledger，使用合成事务存储验证部分退款累计20%舍入、重复回调不重复记账、写中途失败回滚后同退款重试、金额/成功时间冲突拒绝。连同金额与事务相关24项通过。仅测试文件新增，无产品修改、生产SQL、资金动作或部署。模拟事务不证明真实MySQL锁、并发或通道验签验收。


## 当前源码真实本机MySQL补验

核对既有portable MySQL8.4.11位于项目.artifacts/payment-mysql/runtime、data位于同项目后，启动仅绑定127.0.0.1:33317的实例。payment-mysql.integration.js固定本机连接、随机anime_payment_test库、自动应用本地迁移并清理，未使用应用生产配置。完整178项全部通过、0跳过，证据wechat-miniprogram/.artifacts/payment-mysql-current-20261010.txt。

包含实际SQL/事务/锁下的支付幂等、退款/争议/结算互斥、资金账本及对账、净额批准竞争与失败回滚、提交响应丢失恢复、订单资料下载访问边界。回调使用合成签名/本机HTTP，不能证明真实微信通知网关、支付到账或真实税务资料。

结束后SQL确认anime_payment_test_%库数量0；核对33317监听PID实际exe/datadir属于本轮项目后mysqladmin正常关闭，再独立确认监听0、项目mysqld进程0。最初只读脚本自动审批超时未执行，按工具允许重试一次后成功；不是不安全判定或生产权限批准。没有修改产品代码、生产权限/数据库、上传版本或操作真实资金。
