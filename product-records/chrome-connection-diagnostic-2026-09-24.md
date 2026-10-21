# Chrome 接入故障核查（2026-09-24）

## 20:24 后新增：已修复组件缺失，Chrome 页面通信仍未恢复

- 本轮 `setupBrowserRuntime()` 实际报错：缺少 `browser/26.917.71314/scripts/browser-service.mjs`。当前 Codex 已更新至 `26.917.9434.0`；旧版缓存仍在，所需新版缓存不存在。
- 当前官方安装目录 `D:\WindowsApps\OpenAI.Codex_26.917.9434.0_x64__2p2nqsd0c76g0\app\resources\plugins\openai-bundled\plugins\browser` 的 manifest 版本确为 `26.917.71314`，服务文件存在。
- 普通复制复现“无法加密指定的文件”，与先前复制失败日志相符。随后仅读取官方包原始文件内容，补齐同版本缺失缓存，不复制安装包文件属性；383 个文件逐一 SHA256 比对，差异 0。未修改任何源码、原生宿主、注册表或浏览器数据。
- 清除初始化失败的执行会话后，官方接口已成功选择 Chrome，返回 `Name: Chrome / Type: extension / ID: 2` 并返回完整操作文档。
- 随后的会话命名、用户标签页和代理标签页读取仍在约 21 秒后报 `nodeRepl.fetch request failed`。不能把“已识别 Chrome”写成“能读取商户后台”。
- 新版诊断再次确认原生宿主注册正确、Profile 1 扩展已启用。扩展宿主进程存活。本轮没有擅自重装宿主。
- 用户截图证实 Codex 已安装插件列表不存在 Chrome 条目；撤销此前“卸载 Chrome 插件”的错误指引。已询问是否允许改用 Computer Use 在同一 Chrome 页面只读核验支付产品；收到答复前不擅自切换控制工具。

当前未恢复 Chrome 接入，尚未读取用户已打开的微信支付商户产品页面。不得以历史商户页面代替当前获批状态。

## 新增实际证据

- Codex 桌面日志位于 `%LOCALAPPDATA%\Codex\Logs\2026\09\24`。
- 04:52:48Z：内置 Chrome 插件 `plugin.json` 复制失败，`plugin_marketplace_folder_write_failed`、`UNKNOWN: unknown error, copyfile`。
- 11:53:36Z：内置 Browser 插件文件复制失败，并出现 `bundled_plugins_marketplace_resolve_failed`。
- 本任务 11:55:33Z 仍记录 `No ChatGPT browser route is available for browser session`。此错误属于 IAB 通道，不能据此认定 Chrome 故障根因。
- 提权只读检查确认 C 盘 WindowsApps 映射路径、D 盘实际安装路径及 D 盘插件市场缓存中的 Chrome `plugin.json` 均存在且可读，大小均为 3294 字节。因此不能声称路径缺失，也不能把历史复制错误直接定为当前断连根因。

## 已做与边界

此前 Chrome 安装、运行、扩展启用、原生宿主注册检查均通过；打开正确 Profile 1 窗口与用户重启插件后仍未接通。不要重复要求用户打开 Chrome。

Chrome 技能的官方故障流程在上述检查全部通过但仍断连时要求从插件界面重装 Browser 插件，且明确禁止代理自行安装或修复原生宿主。未修改注册表、宿主、Codex 内部程序或浏览器会话数据。

用户已要求行动和实际结果；该偏好已在独立记忆更新文件记录。不能将本诊断记录宣称为连接修复。
