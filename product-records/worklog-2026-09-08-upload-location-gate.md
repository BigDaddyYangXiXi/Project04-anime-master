# 微信预览上传与城市发现恢复记录

日期：2026-09-08
版本：`0.7.0-native.16`

## 范围与成功标准

本次只处理微信开发者工具预览上传被模糊定位权限拦截的问题，并保证城市发现仍有完整可用链路。登录、支付、结算、服务端坐标解析和生产配置不在本次修改范围。

成功标准：上传包不声明、不调用当前 AppID 未获权的 `getFuzzyLocation`；用户可读取已有城市或通过原生地区选择器选择城市；手动城市继续保存到账号偏好表，并用于服务端公开目录查询；微信服务端接受预览包。

## 根因与修复

`miniprogram/app.json` 同时声明 `scope.userFuzzyLocation` 和 `requiredPrivateInfos: ["getFuzzyLocation"]`，发现页在没有可用城市偏好时立即调用 `wx.getFuzzyLocation`。当前 AppID 未获得该接口权限，因此微信在上传预览包时返回 `-80424 / getFuzzyLocation is not authorized`。

`.16` 移除了客户端的权限声明、API 调用和已成为孤儿的客户端坐标解析入口。发现页现在先读取 `getDiscoveryPreference`：已有有效城市时直接查询目录；没有有效城市或读取失败时提示用户选择服务城市。用户选择后仍通过 `saveDiscoveryPreference` 以 `MANUAL` 来源和版本锁写入 `account_discovery_preferences`，随后使用规范化城市码查询真实公开目录。

服务端 `resolveDiscoveryLocation` 和逆地理解析能力保留，数据库无迁移。待小程序完成接口授权后，可在不破坏手动选城及历史偏好的前提下恢复自动定位，并补齐隐私授权、拒绝、弱网和真机证据。

## 验证

- 上传授权专项：2／2，通过；扫描实际上传目录，不含 `getFuzzyLocation`，并核对手动选城的页面、客户端服务与服务端写入入口。
- 通用 Node 回归：222／222，通过。
- B01 检索契约：48 条，通过。
- 生产数据边界：23 个云页面及 2 个旧根入口，通过。
- 云账号页面契约：17 条，通过。
- `app.json` 与 `project.config.json` 解析通过。
- 微信开发者工具 CLI 使用当前 AppID 生成预览成功，上传包约 885 KB；未再出现 `-80424`。

本次预览成功不等于体验版发布、真机功能、自动定位权限、登录、支付或生产部署完成。
