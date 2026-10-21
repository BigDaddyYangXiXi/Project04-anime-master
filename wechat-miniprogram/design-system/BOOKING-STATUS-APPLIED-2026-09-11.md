# 预约状态页批准方案实施 · 2026-09-11

基准：`designs/makeup-service/booking-status.html`，包含用户追加确认的底部主导航。仅开发环境修改，未部署。

## 页面与状态

- 当前进展 → 下一步说明 → 服务方与预约资料 → 可展开需求与参考 → 预约编号。
- 状态涵盖等待回应、已接受、补充、沟通、合作确认、保密约定、等待对方签署、待付款、付款待核对、生效、未达成。
- 主导航复用 main-bottom-nav，预约状态归属订单。业务操作区位于其上，正文留白合计导航、操作区与安全区。
- 资料卡、金额和分割规则继承作品详情及确认预约。抽屉只承载补充信息、合作核对与既有保密确认。
- 合作核对需勾选确认；未满足原业务前置时仍不能确认。取消抽屉不会执行交易操作。

## 数据对应

- 状态：既有 stage、paymentStatus、buyerAgreementConfirmedAt、双方保密确认字段；booking-status-view 仅派生展示，不写入订单。
- 服务参考合计：originalPrice；最终合作金额：finalPrice，缺失才由服务明细求和。合法零值不回退到其他金额。
- 双方身份、city、schedule、requirement、reference、id 均读取当前订单，不使用设计稿姓名、日期或金额替代。
- 补充信息仍走 BUYER_SUPPLEMENTS；保密确认、合作确认、支付查询仍走原服务与版本校验。页面新增抽屉不新增数据库字段。
- 不复制设计稿演示进度或演示支付成功；真实付款仍依赖已接通的商户服务。现有保密确认仅记录顺序，未实现法律电子签章。

## 校验记录

- `booking-status-view.test.js`：付款核对优先级、确认与付款分离、反馈保留。
- `booking-payment.test.js`、`payment-refresh-page.test.js`、`order-refresh-race.test.js`：新鲜订单校验、重复操作、迟到付款与旧请求保护。
- 实屏位置 `.artifacts/booking-status-approved-20260911`；最终全页复核 `.artifacts/all-pages-final-20260911`。
- 当前证据限开发者工具及本地测试；不作为真实云端交易、真机授权或全部业务状态完成证明。

### 2026-09-24 客户端付款入口接入（本地）
预约状态页现从payment-api.createPayment取得当次付款参数，不再读取订单展示数据里的paymentRequest；传参只含订单ID、版本和跨页面重建稳定的请求键。只有READY进入微信收银台；BUSY/QUERY_REQUIRED/已收款/需人工核对/已关闭均先查询并重读订单，不把客户端回调当作付款事实。请求途中更高版本订单到达或页面卸载后不打开收银台。
验证：booking-payment、payment-refresh-page、order-refresh-race共31项通过；27页设计清单与design check通过。修正旧客户端测试依赖主配置enabled=true的问题，改为独立测试运行环境，未修改生产开关。语义关联页包含交付验收、个人中心、资金页；本次未修改其布局或状态规则，未取得当前整页/真机证据，不标体验验收。
待续：稳定请求键对应的CLOSED记录需要明确安全重开规则；QUERY_REQUIRED仍需微信查询/关单恢复，不能盲目重发。服务端版本变化错误提示、预支付超时恢复、真实云连接/产品开通、退款对账及正式交易验收仍未完成。未部署、未真实收款。
