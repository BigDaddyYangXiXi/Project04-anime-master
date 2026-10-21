# 单次注册与需求方默认首页｜2026-09-24

用户明确要求：填完资料点击注册直接触发微信手机号授权，不再二次点击“授权手机号并注册”；注册完成第一个页面固定为需求方信息广场。

## 原因与修改

旧版注册先调用checkRegistration，之后才把按钮换成原生授权按钮，确实多一次点击。现在单个“注册”按钮根据昵称、用户名格式及主动同意状态直接启用getRealtimePhoneNumber；缺项时仍可点击查看字段错误，但不拉手机号授权。手机号回调取得真实code并核对隐私授权后，直接调用一次phoneRegister。移除前端phoneReady阶段及不用的预检服务方法，后台最终昵称/用户名/协议校验仍保留，不放松唯一性或手机号验证。

旧版注册和登录复用finish，沿用pendingRoute和本机animeMasterRole。保留服务方状态会使discover展示工作台。现在注册完成（包括服务端返回created:false的幂等完成）明确写入buyer、清除旧pendingRoute并reLaunch到/pages/discover/index。普通登录继续原有目标/身份，不擅自覆盖用户主动选择的工作区。错误或拒绝授权不会修改身份。

只改auth页面与其cloud-auth服务；未重置账号、未修改数据库、未部署云函数，没有改交易、昵称、用户名、UID规则。协议仍默认不勾选。

## 验证

- auth-phone-flow15项及quiet-page-loading4项，共19项通过。覆盖原生按钮直接就绪、资料缺项/撤销同意、手机授权与隐私拒绝、重复请求、后台拒绝、注册/幂等注册固定需求方、普通登录目标保留。
- 设计目录和design:check通过，无新增样式债务。
- `.artifacts/single-register-runtime/runtime.json` 2026-09-24T10:24:37.865Z为ok:true。当前开发工具真实按钮文本“注册”，填写并勾选后open-type直接为getRealtimePhoneNumber，页面仅一个主按钮；没有调用真实手机号授权。
- 使用真实已注册会话，只在本机模拟注册完成触发：预设provider与工作台pendingRoute，再执行实际finish，最终实际路由discover、页面role=buyer、存储buyer、pendingRoute为空；注册页和需求方信息广场完整截图已查看。不是重新创建云账号或真机手机号闭环验收。

手机包 `.artifacts/company-phone-preview-single-register-20260924`，260个前端文件摘要，唯一预期差异为云开关。二维码目标 `D:\code\Codex-Generated\anime-master-preview-20260924\single-register-preview.png`。上传结果以该包source-manifest.json与preview-info.json为准；只生成开发预览，未提审/正式发布。

此前registration-v3-runtime/username-v4-runtime记录的是当时的两步注册流程；当前流程以single-register-runtime及本记录为准，不使用旧脚本结论冒充新流程验收。

上传已确认：preview退出成功，包体1,224,188字节，260文件摘要核对一致，新二维码已生成。
