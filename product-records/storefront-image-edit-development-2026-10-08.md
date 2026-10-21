> 2026-10-08：橱窗图片/署名/水印前后端依赖已更新；catalog-read及provider-catalog-draft均Active、配置保留、变更文件回读一致，真实公开读取成功。唯一公司客户端0.9.18上传成功（1,098,474字节、332文件无变化），用户明确确认0.9.18已显示为体验版。体验版绑定据用户确认；真实账号保存重进、水印原生导出及完整画面待验收。未提审/正式发布。详见product-records/trial-0.9.18-2026-10-08.md。

# 橱窗图片编排、署名与水印开发 · 2026-10-08

用户批准“OK 开始开发”，承接图片编排—署名—展示预览审查。本轮仅本地开发与唯一客户端同步，不自动上传或部署。

## 已实现
- 首图为封面，设为封面即移到首位；前移/后移、单张替换、删除使展示图、原图、审核状态、水印设置同步移动。替换失败保留原图。
- 复用实际work-card作为封面裁切预览，不建立第二套卡片；图片设置独立视图，顶部返回确认放弃尚未应用的设置。
- 水印默认关闭，开启默认@用户名；位置五档、字号短边2%—6%、不透明度20%—90%，单张或整组应用。白字阴影，不去除既有水印。原始上传保留源文件，展示图由Canvas 2D导出JPEG（长边最大2560），另走既有上传/审核流程。
- 关闭水印恢复源图；设置未改变不生成不上传；预览结果应用时复用。整组中途失败保持原作品，产生的待处理资源沿用取消/清理机制。
- 出镜、摄影、妆造、后期、本人负责为选填字段，沿用独立文字编辑器。公开详情在作品正文后显示署名。
- 保存草稿并预览，仍不等于公开发布。
- 草稿JSON持久化新增字段，发布时源图与展示图同时核对本人所有权、用途和审核；公开目录仅返回署名及展示图，不返回源图ID和水印设置。无DDL。
- 本人媒体分批读取遵守100条上限，沿用草稿/图片URL缓存。新增能力标志imageEditingVersion，旧云服务未启用时拒绝水印/署名保存，保留本地编辑内容。

## 验证
97项测试通过：.artifacts/work-image-final-tests.txt。覆盖原图恢复、设置复用、取消隔离、组图失败、云端字段往返、错位拒绝、原图所有权/用途/审核、公开源图隔离，以及原草稿发布缓存流程。
Canvas测试为API替身调用契约，不是微信真机图片生成证据。
34页导航、设计目录/token检查、7个修改JS语法、2个WXML结构通过。未改baseline。
12文件同步到.artifacts/company-startup-trial-20260929，配置AppID wxc94e1c1b38944511，逐文件哈希一致：.artifacts/work-image-sync-20261008.json。

## 未完成的上线与验收项
- provider-catalog-draft（draft-core/publication-core）及catalog-read（catalog-core）未部署；新字段云端读写尚未真实验收。部署后需重新读取草稿获得能力标志；必须先云端后手机版本，避免字段丢失。
- 当前完整画面、320/375/414及大字体、微信iOS/Android Canvas导出、图片旋转/长图、键盘避让、上传审核、保存重开及公开端原图隔离待运行验收。浏览器工具此前初始化ACL失败，未恢复被拒绝的wechatide连接或停止的桌面操作，不以测试代替。
- 未上传体验版，未提审，未正式发布。

参考API依据：https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.canvas.d.ts 及官方示例https://github.com/wechat-miniprogram/miniprogram-demo/tree/master/miniprogram/packageAPI/pages/page/canvas 。

## 用户查看入口
2026-10-08用户要求“让我看下”：既有storefront网页接入图片设置、图序/替换、署名和保存预览的交互映射，直达http://127.0.0.1:4317/storefront/index.html#image-edit 。浏览器Canvas生成仅为网页效果演示，原生生成/云审核未验收。JS语法与4项页面/资源HTTP200已核对；浏览器工具初始化报trusted Node process exited unexpectedly，未取得当前画面，不声称已自动打开。
