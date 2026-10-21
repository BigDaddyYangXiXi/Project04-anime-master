# 0.9.10：启动分段耗时诊断

唯一公司客户端（AppID wxc94e1c1b38944511）已同步utils/cloud-call.js。仅增加服务器返回的sdkLoadMs/initMs/readMs数字记录；不保存请求正文、身份、坐标或额外响应字段。快照深拷贝，原有容量与退出清空保持。

9项调用、启动定位、首屏计时测试通过。291文件上传前后哈希一致；源码与客户端仅保留既有config/cloudbase.js差异。官方CLI上传0.9.10退出0，991553字节。

证据：wechat-miniprogram/.artifacts/trial-0.9.10-preflight-20261007.json、trial-upload-0.9.10-20261007.json。

本次后台体验版核对未完成：既有OpenCLI配置jjqep8ry返回未连接，随后profile list确认没有任何已连接Browser Bridge配置。未盲目重复请求或要求重新登录，未绕过被拒的wechatide连接。0.9.10开发版上传成功；最后已核实体验版为0.9.9，不能推定自动更新为0.9.10。未提审发布。

首次开启长加载与1秒定位尚未取得新手机证据。本改动补诊断能力，不等于性能修复；后台连接恢复后核对实际体验版状态。
