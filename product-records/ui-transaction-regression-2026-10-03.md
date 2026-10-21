# 界面修复联合回归 · 2026-10-03

沿用用户要求优先界面、跳过工具连接排查。本轮联合验证最近订单列表、退款表单、交付输入、签署与确认弹窗修复，未重新连接开发工具，未上传。

## 发现并修正的测试问题

- payment-refresh-page 的隔离 require 未允许既有 cloud-call，导致查单/创建付款契约测试在装载服务时失败；现使用真实本地 cloud-call 模块，仍由模拟 wx.cloud 响应，未开启生产配置或发起资金操作。
- provider-confirmation 正常沟通样本没有 order；新增确认保护正确拒绝缺少订单的操作。样本补充实际必需的 id/version/stage，保留正常 NDA 两种选择、取消、档期冲突及锁价后确认检查。

没有放宽断言或删除失败用例。本轮未改变付款或界面业务代码。

## 当前证据

以下10个测试文件共89项通过，完整输出 .artifacts/ui-transaction-regression-20261003.txt：

- booking-payment、payment-refresh-page
- order-refresh-race、order-list-refresh
- delivery-submit-retry、delivery-download
- order-refund-page
- provider-confirmation、fulfillment-confirmation、nda-visibility

navigation-role-logic-audit、top-navigation-role-audit、top-navigation-contract-audit 均通过，其中顶栏契约61项断言。

## 未完成边界

0.9.5体验版未包含最近这些源码修复；未取得这些修复的当前完整页面/真机验收证据，不能称已在手机生效。其他登记页面的读取、输入和账号隔离待查；订单详情网络失败保留仍待。真实发布可见、付款退款与服务方到账、资质提审正式发布等总目标保持未完成。
