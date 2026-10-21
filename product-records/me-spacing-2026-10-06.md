# 个人中心横线与卡片间距

用户指出合作数据上方横线和卡片间距不一致。核对设计 README、INVENTORY、ALL-PAGES 个人中心契约后，页面任务保持头像身份、合作/经营数据、常用功能和收藏分组。

根因：profile-business-head 的 border-top 是卡片内标题上多余分隔；profile-card margin-bottom 使用 space-3（24rpx），其余 hero-card/section-card 使用 detail-section-gap（48rpx）。仅删除前者边框声明、将 profile-card 间距改为现有 detail-section-gap，无文字/颜色/字号/结构或业务数据改动。

影响查询已执行，直接消费者为 pages/me/index；供需两身份共用。横向检索该标题选择器仅此页面定义，不修改其他身份、订单、金额模块。目录已重新生成，design:check 通过，未更新 baseline。

源码及唯一公司客户端 index.wxss 已同步并更新既有文件哈希清单；项目配置和 CLI 确认 AppID wxc94e1c1b38944511。当前自动化运行的 getAccountInfoSync 返回空 AppID，账号读取失败，故不能据此声称真实账号页面验收通过。临时原生渲染夹具分别检查两身份后恢复原页面数据，无存储和服务器写入。两份完整截图已查看，实测标题 border-top-width=0px；需求方三组间距均24px、服务方两组均24px。证据：.artifacts/me-spacing-layout-20261006.json 与 me-spacing-{buyer,provider}-fixture-20261006.png。这属于限定样式验收，不代替真实数据、导航或手机体验验收。

未上传新体验版；定位类目/权限审核仍独立等待。

## 收藏空卡片修复

用户进一步要求修复读取失败后仅剩“我的收藏”标题。根因是入口与服务端数量共用 assets 数组，首次初始化及身份切换清空数组，读取失败后不再填充。改为共用 collectionEntries 生成固定三入口，未知数量为“—”，正常成功继续填真实值（包括0）；身份切换清除旧数量但保留导航，供需共用。无模板、样式、业务请求或权限变更。

先复现首次/失败/换账号两个测试失败，再修改后与广场偏好相关7项测试全通过，覆盖两身份三个导航参数和正常重试。目录生成及设计检查通过。仅 index.js 同步唯一公司客户端并更新哈希。未再次启动导致运行身份异常的自动化会话；当前完整实屏及手机验收尚未完成，不冒充上传或账号读取故障已解决。
