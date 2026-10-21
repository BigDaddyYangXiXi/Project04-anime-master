# 发现与搜索后续结果读取

## 已确认问题及修改

2026-10-03检查发现 `discover` 和 `search-results` 均只读取一次 `listDiscovery`，条件默认limit50，忽略返回的nextCursor。因此第51位以后的匹配创作者及其作品没有读取入口。

两页共用 `utils/discovery-pagination.js`，按服务端游标逐页读取，以作者ID合并去重。共用 `templates/discovery-pagination.wxml`，复用原次级按钮，无新增样式值。触底或点击加载更多均可读取；并发触发合并，失败保留已有数据和原游标重试；新条件重置游标，迟到结果及离页结果按原请求序号失效。服务方工作台及本地审计数据不触发公开分页。

范围为需求方发现作品/创作者列表和搜索作品结果；不改变搜索草稿与提交、城市/日期/职业、服务方工作台、卡片结构及底栏规则。已读设计README、INVENTORY和UI-QUALITY-STANDARD检索契约，执行影响查询。search模块登记共用逻辑/模板及两页分页状态，重生成清单；没有刷新baseline。

## 验证与边界

- `node --test automation/catalog-response-order.test.js` 17项通过，新增两页追加去重、重复触底、失败原游标重试、末页不请求、换搜索及离页丢弃旧分页。既有地区异步、工作台、错误恢复测试继续通过。
- `design:inventory`、`design:check`通过：28页22模块，未增加局部样式债务。
- 公司既有验收副本同步6文件，未改已上传0.9.3归档。公司开发工具临时替换目录读取，两页分别真实点击“加载更多”，请求序列均为无游标、50，数据由one追加two，末页cursor=null。前后完整截图已查看。
- 首次点击立即读取尚未收到事件，不记通过；后续等待事件完成再读取，成功追加。原生证据 `.artifacts/discovery-pagination-native-20261003.json`，四张 `discovery-pagination-{discover,search-results}-{before,after}-20261003.png`，均位于wechat-miniprogram。
- finally恢复原读取方法、清除临时状态并reLaunch真实发现页，无云业务写入。临时数据不是真实作品发布或双账号证明。

当前仅源码及开发工具候选，尚未上传新客户端。真实超过50位创作者数据、手机触底弱网、创作者模式/工作台完整运行状态仍待验收；此次未宣告全部视觉状态通过。服务端目前仍先查询目录并内存排序分页，本次客户端接续不能代替D03数据库分页/索引优化，也不能保证并发目录变化时offset游标绝不漏项。

## 分页作者标识与失败状态补查

发现和搜索的卡片循环原使用作品ID作为wx:key，不同作者的相同作品编号造成重复渲染标识。两页buildWork新增由作者ID与作品ID组成的listKey，循环引用此字段，原业务作品ID和详情链接不变。核查同模块消费者：work-card仅这两页使用；me-assets原已有kind/providerId/id组合键，无需修改。搜索还有下一页时增加“已显示”字样，避免当前页数量被理解为全部结果。

新增两页跨页同编号作品渲染键断言，以及工作台/审计模式触底不请求断言；catalog-response-order共21项通过，设计检查通过。两页候选已同步，未上传客户端。

本轮原生完整复验未完成：首次自动化超时后确认开发工具进程及9426监听均消失，再用官方CLI恢复原公司工程。随后通过原生页面方法注入一次分页失败，实际保留1位作者、错误提示和游标50；重试请求序列为null/50/50，成功后游标null、错误清空。立即读取渲染keys仍为空，故整组断言失败，未继续搜索页或截图，不能据此宣告同编号卡片原生验收。页面setData回调时序可能影响观察，仍需等实际画面状态后复核，不能仅凭推断算通过。

该有限结果见 `wechat-miniprogram/.artifacts/discovery-pagination-retry-native-20261003.json`（results仅discover，methodCalls=true）；方法替身在finally恢复并返回真实发现页，无业务写入。先前17项/两页按钮成功证据只覆盖先前已明确场景，不覆盖本轮渲染键、创作者模式和完整工作台画面。

## 原生失败重试及渲染补验通过

后续同日再次恢复公司工具后，先核对AppID、已完成初始化、实际佛山/妆娘/无查询筛选，再执行 `.artifacts/pagination-runtime-recheck-20261003.js`。本轮用页面真实“加载更多”和“重试加载”按钮，等渲染状态完成再断言，发现和搜索均通过，无需追加产品代码修复。前轮的立即读取为空未再出现；本轮增加初始化等待和渲染等待，不能单独断言前轮仅由其中某一因素造成。

两页证据均显示：首次失败后1位作者保留、错误可见、游标50保留；重试后2位作者、渲染键分别author_a:same与author_b:same、错误清空、cursor=null；请求序列null/50/50。两页失败/成功完整屏幕及发现创作者模式首屏已查看，按钮与卡片无底栏遮挡（创作者长列表首屏只显示第一位，不据此接受完整长列表）。

证据 `wechat-miniprogram/.artifacts/pagination-runtime-final-20261003.json`；`pagination-discover-failure/retry-final-20261003.png`、`pagination-search-results-failure/retry-final-20261003.png`、`pagination-people-final-20261003.png`。替身finally恢复，清除测试状态并返回真实发现页，无云写入。仅本轮明确状态获得原生证据，真实大数据量、手机触底、工作台完整运行画面及返回筛选状态仍待；未上传客户端。
