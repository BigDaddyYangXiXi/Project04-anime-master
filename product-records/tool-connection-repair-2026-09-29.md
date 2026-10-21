# 后台控制连接修复｜2026-09-29

已定位并修复Codex沙箱状态文件损坏：deny_read_acl_state.json为22个空字节，日志报解析失败。原文件已备份为D:/Codex/home/.sandbox/deny_read_acl_state.corrupt-20260929-2124.bak，由官方初始化重新生成；没有修改权限配置、Windows ACL或关闭沙箱。重置后工具最小调用返回runtime-health-ok，普通受限命令也成功。

浏览器仍受另一个问题阻断：当前工具会话引用browser/26.924.22138/scripts/browser-service.mjs，该版本不存在；本机browser/26.915.31945/scripts/browser-service.mjs存在。插件和node_repl目录未发现该不存在版本的持久配置引用。未伪造版本目录或复制冒充版本。需要重新加载Codex宿主及工具服务后验证；已做的工具内核reset不足以解决宿主加载路径错配。

公司AppID wxc94e1c1b38944511的0.9.1已上传成功，922668字节；未确认设为体验版、未取得体验二维码。恢复连接后继续。
