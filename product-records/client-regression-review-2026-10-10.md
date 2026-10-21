# 客户端整体回归复核（2026-10-10）

运行automation目录90个.test.js文件：初次622项，596通过、26失败，无跳过。完整证据client-regression-20261010.txt保留在wechat-miniprogram/.artifacts。

已修正4项定位测试失败：home-preferences的3个首用组件测试缺少require，现使用组件真实相对模块加载器；未替换掉性能实现、未删行为断言。upload-authorization仍按定位未批准时期禁止所有getFuzzyLocation，依据用户明确已批准状态改为只允许模糊定位声明及首次同意/已授权启动两处调用，禁止精确定位调用及权限。手动选城市、拒绝授权、切号/离页回调、坐标不持久化等继续验证，相关12项通过。未修改产品代码、未同步或上传。

复跑同90文件622项：600通过、22失败，0跳过。证据client-regression-after-location-20261010.txt。整体回归未通过，不能以局部绿色代替。

剩余分类（尚未全量判定根因）：协议测试仍期待v2而当前v4；设计影响列表漏新增me-social消费者；CLI夹具未提供company-deploy-preflight；注册夹具未提供account-names；登录夹具缺getStorageSync；个人中心夹具缺getApp或仍断言旧统计结构；作品菜单调用已不存在的方法；原生按钮悬停检查失败；四个业务入口身份测试返回通用失败而非预期身份错误，须优先追查实际模块加载与鉴权路径，不能直接调整期望。不要更新baseline或删除失败用例来得到绿色。

下一步：先排查公司业务身份9项失败及注册门禁失败，之后跟进其他夹具/结构迁移和实际产品问题；所有新的结论依当前源码证据，保持真实云端与原生验收待办。


## 身份与注册测试续查

四个业务入口及公开档期共9项失败根因为旧测试未提供./request-context，仍假设SDK全局getCloudbaseContext身份可用。现加载每个函数真实request-context，并从本次调用environment输入身份；保留缺失/错误AppID/非法openid在SDK初始化与DB访问前拒绝、伪造事件身份无效、正向逐动作派发与匿名公开档期检查。新增旧SDK身份存在但当前上下文缺失必须拒绝，不能为测试恢复被废弃的全局身份回退。

注册测试原缺account-names并沿用旧register注册路线。按当前代码：legacy register应在SDK初始化前PHONE_AUTH_REQUIRED；checkRegistration/phoneRegister经真实identity-core/account-names及可信上下文，风险昵称在手机号授权消费、账号写入前拒绝。数据库夹具只允许微信绑定/名称查重读取，缺其他写方法；不再错误要求校验昵称前完全不读数据库。协议版本取真实identity-core导出，未改产品规则或放宽断言。

定向13项通过。复跑90文件：623项，611通过、12失败、0跳过。证据wechat-miniprogram/.artifacts/client-regression-after-identity-20261010.txt。新增1项安全反例，原10项失败修正；产品源码未改、未部署/同步/上传。剩余12项仍待按证据分类修复，整体回归未通过。


## 协议、CLI与登录续查

协议两项旧v2断言现明确为当前v4，同时与identity-core.NOTICE_VERSION、完整正文一致；逐节非空、末节及负数/越界目录导航验证保留。CLI夹具补process.argv并加载真实company-deploy-preflight，不用空预检替代；新增非法批量部署在登录目录切换和CLI启动前拒绝。登录夹具补getStorageSync/setData，正式版仍忽略audit参数并检查真实会话。此批只改三个测试文件，产品代码/协议内容/部署配置均未修改。

定向11项通过。全量624项：617通过、7失败、0跳过；证据wechat-miniprogram/.artifacts/client-regression-after-contracts-20261010.txt。剩余为作品预览/菜单、喜欢模块消费清单、我的缓存/加载三项及原生按钮悬停检查；未将其清除或跳过。无部署/上传。


## 个人中心缓存与加载续查

修正三个测试文件：display-cache沿用旧me:buyer:v3现改为产品实际v4快照，仍验证慢请求前数据显示、缓存头像及成功后统计替换；quiet-page-loading补真实会话宿主、独立存储及隔离后台预读调度（调度本身由background-reads测试覆盖），验证同账号角色切换而非用不匹配账号夹具冒充角色切换；设计影响检查加入实际已登记me-social第四消费者，保留所有消费者变体与未知路径拒绝检查。

定向15项通过。整体624项：621通过、3失败、0跳过；证据wechat-miniprogram/.artifacts/client-regression-after-dashboard-20261010.txt。剩余是单作品草稿预览、已迁移作品菜单测试及原生按钮悬停检查。仅测试修改，无产品变更/部署/上传，整体仍未通过。


## 作品预览与直接操作续查

creator-profile预览方法已包含异步草稿保存，旧测试立即断言导航。现await真实方法后检查原作者/作品/预览参数，17项通过。publication-stage仍调用已删除openWorkMenu，迁移到当前直接openWorkEditor/togglePortfolioPin；检查正常编辑与置顶、已移除/缺失作品、保存/加载/离页阻止、取消置顶、两件上限和失败回滚，28项通过。原弹窗等待期间的对象版本/置顶变化场景已无该异步入口，未恢复废弃菜单。

全量624项：623通过、1失败、0跳过；证据wechat-miniprogram/.artifacts/client-regression-after-works-20261010.txt。剩余native-button-state检查：首次定位两个按钮data-am-disabled=busy但bindtap是固定方法，方法内已有busy保护，模板不符合统一条件绑定规则。尚未修改模板或放宽检查，须按UI规范进行范围受限修正及检查后再结案。本轮仅两个测试文件修改，无产品变更/部署/上传。


## 按钮状态规范收口

实际全包检查揭示并非只有首用按钮：先修正首次定位2处、偏好移动2处和共用分页1处条件绑定；随后按既有按钮规则检查10个页面/模板的116个按钮，补齐hover-class声明，将其中52处原生disabled原条件迁移至aria-disabled、data-am-disabled及条件事件绑定。范围只涉及按钮属性，文案、布局、处理函数、原禁用条件均保持。逐按钮逆向还原比较确认属性之外无变化；包含条件带>=的两个数量上限入口。

native-button-state原正则在属性内遇到>提前结束，已改为识别引号边界，新增比较运算符反例。作品设计对齐测试同步验证保存/预览完整禁用表达式与原处理方法，不放松为只检查文字存在。发现/搜索结果模块目录补登记真实已存在的loadMoreCatalog，未改baseline。

90个测试文件共625项全部通过、0失败、0跳过；证据wechat-miniprogram/.artifacts/client-regression-after-buttons-20261010.txt。设计清单重生成并检查通过。按钮迁移逐项记录native-button-migration-20261010.json；迁移前剩余清单native-button-remaining-20261010.json仅为历史快照，现已处理，不能当作当前待办。

13个WXML文件同步到唯一公司客户端，AppID核对正确、逐文件SHA256一致；335文件完整性对比零异常、99脚本语法/本地依赖与发布配置检查通过（cloudbase配置保留既定源关闭/客户端开启差异）。证据native-button-client-sync-20261010.json、prefetch-client-integrity-20261010.json。未上传、未修改云端或资金配置；尚无当前原生完整画面及真机按压/禁用状态证据，不能称视觉或正式上线验收完成。
