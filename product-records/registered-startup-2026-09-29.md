# 已注册账号直接进入发现作品列表｜2026-09-29

## 用户决定与范围

已注册用户正常打开小程序直接进入需求方发现／信息广场作品列表，不再点击登录。用户要求修改后提供1、2号设备使用的体验版二维码；明确为体验版，已授权准备并上传本轮版本。唯一AppID为wxc94e1c1b38944511，版本候选0.9.1。保留新用户注册、可信服务端身份校验、分享深链和热启动当前页面；本次不扩展界面重设计。

## 实现

- app.json首路由为发现；App启动使用account-bootstrap会话结果恢复已注册账号，正常冷启动选择需求方，发现页等待会话后加载作品。
- 未注册或会话失败进入认证页；认证页消费启动查询，已注册自动进入目标页，失败后可重新查询。不把本地账号缓存当作可信登录。
- 退出时使未完成会话失效；发现页隐藏或卸载后忽略迟到回调，防止干扰后续页面。
- 候选包包含本轮取消三作品门槛、草稿与公开发布区分、发布确认页隐藏主导航的修正。

## 检查与证据边界

29项启动、手机号注册、发布阶段、预览边界及地区持久化回归通过；app-auth-gate逻辑审计通过；设计检查28页22模块通过，目录已同步。以上不是双机真机验收。

候选目录：wechat-miniprogram/.artifacts/company-startup-trial-20260929。
静态摘要：wechat-miniprogram/.artifacts/startup-trial-manifest-20260929.json。
实际联网运行记录：wechat-miniprogram/.artifacts/startup-runtime-20260929/connected.json及png。

配置纠错：原先对Object.freeze导出的云配置直接赋值无效，曾使候选副本仍为enabled=false；已改用复制对象后设置enabled=true，并实际读回核对。company-publication-phone-20260929与当前startup-trial副本现均为true；源工程本地预览配置仍为false。此前仅根据赋值意图记录联网状态不足，不能作为当时真实联网证据。

## 上传阻塞与下一步

2026-09-29 20:31，官方CLI上传0.9.1返回code 10，系统错误41002 appid missing（rid:79c73e4f-1790685060、30bf5aae-1790685061）；进程exit0不代表成功。没有成功上传凭据，未设为体验版，未取得新体验二维码，0.9.0未被本次替换。

磁盘项目AppID正确且没有project.private.config.json覆盖；官方open/auto指定公司项目成功，但wx.getAccountInfoSync运行时AppID为空，cloud.callFunction同样报appid missing。界面控制工具在启动内核时因sandbox deny-read ACLs错误不可用；未绕过浏览器权限或重装用户环境。

待在已打开的“万匠屋-0.9.1体验验收-wxc94e1c1b38944511”手动编译后重新核实运行身份，再上传；上传成功后须到公司后台设为体验版并获取真实体验二维码。开发预览码不得替代。双机需复验已注册冷启动直接进入作品列表、上传者确认公开后另一账号可见，以及发布页底栏与返回路径。

## 后续更新：登录恢复后上传成功

用户确认已登录，官方open成功；随后0.9.1上传明确返回upload成功、包大小922668字节，会话48018。上传凭据见wechat-miniprogram/.artifacts/startup-upload-0.9.1-20260929.json。此前上传失败已解除，但未确认公司后台设为体验版，未取得体验二维码，尚未做双机真实冷启动验收。浏览器工具首次提示内核退出并要求重试；重试明确windows sandbox failed: apply deny-read ACLs，无法代操作公司后台。不可把开发版本上传成功记成体验版已切换。

## 2026-09-30 AppID恢复与启动运行复验

已证实当前公司候选副本基础库3.17.3下AppID为空。添加useApiHook=false后重新auto、关闭再重开，仍为空；再固定libVersion=3.17.0，重开后AppID恢复。此对照证明当前开发工具配置组合差异，不推断所有机器的3.17.3均有问题。

云端auth-probe验证serverIdentityVerified=true；account-bootstrap/getSession成功、registered=true、账号与应用会话一致。当前路由pages/discover/index，mode=works、role=buyer，cloudEnabled=true、localPreview=false；完整截图已查看。无业务写入。证据：wechat-miniprogram/.artifacts/startup-runtime-20260929/appid-restored-20260930.json与png。

prepare-company-payment-phone.js现为联网副本显式写入useApiHook=false、urlCheck=true、libVersion=3.17.0；生成company-payment-refund-phone-appid-fix-20260930成功，271文件与配置校验通过，未打开或上传该新副本。当前开发工具继续使用company-startup-trial-20260929；源码客户端仍保留本地预览设置。本轮不重传0.9.1，体验版设置、二维码和双手机真实启动仍待完成。

## 2026-09-30 真实用户业务读取复验

company-session-readonly-audit.js支持显式WECHAT_AUTO_WS以复用当前9426公司项目。身份、注册、账号资料及10项业务检查全部通过：两个目录、缺失媒体/本人媒体、订单、项目、收藏、档期、草稿、资格。目录和订单当前均为空。首次观察窗口结束时任务尚在运行，第二次调用恢复同一pending任务取得成功终态，未重复云请求。证据company-session-readonly-20260930.json。

当前开发工具账号草稿v2、0作品、0服务、妆娘、有城市、接单资格NOT_SUBMITTED。该结果只对应当前账号；不修改草稿、不代申请或批准资格，不代表2号账号状态。证据current-account-publish-readiness-20260930.json。双账号发布可见、订单写入及真实资金仍待，0.9.1体验版设置状态已向用户询问。

2026-09-30 用户明确确认：0.9.1已设为体验版。替代此前设置状态未知；二维码未由工具取得，双机冷启动验收已询问、待结果。
2026-09-30 用户双机验收：两台已注册手机完全退出后重新打开0.9.1体验版，均直接进入作品列表。本轮启动需求验收通过；其他业务闭环仍待。
