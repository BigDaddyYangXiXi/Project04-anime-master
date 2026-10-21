# 全站启动与读取性能排查

2026-09-28 用户最新真机反馈：图片略有改善，但整个小程序启动和读取仍明显慢。性能目标扩大为全站系统性排查，不以图片局部优化作为完成。

## 当前可确认的问题与修改

1. 发现页/搜索列表只展示封面，原服务层却解析全部作品图片链接。已改只解析首图；保留 imageFileIds 和真实数量，详情页独立读取完整图集。测试验证列表请求只含封面，详情补齐其余图片。
2. 服务方工作台原等待 getProvider 为全部作品解析图片链接，但该页实际只使用作品/服务数量及发布状态。已指定 images:false 跳过链接申请，保持服务器业务读取和其他页面默认行为。
3. 工作台账号、订单、档期、主页已有并行请求，不能宣称“改为并行”是本次新增；最终视图仍等最慢一项，拆分各模块更新尚未实施。登录 getSession 后点击登录仍重新校验账号；不能为了省请求而未经确认取消登录流程或跳过账号有效性检查。
4. 九个业务服务接入共用 cloud-call 本地计时，保留原请求/响应/异常，不重试、不缓存业务结果、不修改支付调用语义。只在内存保留最近100条函数名、动作名、开始毫秒、持续毫秒、成功标志；不记录参数/返回正文、账号和URL，注销清理且阻止迟到结果重填。开发工具读取 `require('utils/cloud-call.js').read()`。图片分段计时另存，不重复改业务流程。

## 真实测量与边界

- 当前公司 catalog-read 上海目录查询返回0人/63字节，函数执行3次为285/178/127毫秒，管理CLI往返为1901/1611/1597毫秒。证据：`wechat-miniprogram/.artifacts/catalog-latency-20260928.json`。管理API不是小程序网关；空目录不是有数据的工作台或订单列表，这些样本不能证明全站快，也不能解释用户全站慢。
- 开发工具9425 WebSocket当前连接成功；直接evaluate只读登录/账号延迟测量仍无响应，进程已终止报SYSTEM_RUNTIME_PROBE_UNAVAILABLE，未获得真实客户端毫秒数。最初脚本依赖路径错误已改为复用automation目录依赖；不能将其混称浏览器/插件故障。未伪造微信身份、未清缓存或强制重启工具。
- 尚未验证手机网络到云函数网关、冷/热调用、各表查询、头像签名读取及页面渲染占比。下一步优先获取新包记录或恢复可靠调试通道；不凭猜测购买资源、更换网络或放宽缓存权限。

## 测试与交付

- 当前38项计时、账号、登录、退款、图片、项目私有图回归通过；订单/catalog客户端映射审计与design check通过。
- 另运行旧cloud-error-redaction测试，其中8个“authenticated business failure”案例失败于未进入业务处理器：其request-context依赖替身不符合当前函数式接口。该文件本轮未修改，不能声称全部后端QA通过；须修复测试替身后重新验证身份与错误脱敏，不绕过生产身份校验。
- covers官方预览已成功1283869字节，但被后续system-timing预览替代。system-timing包包含封面优化、工作台跳过图片解析以及九服务计时；正式上线/支付闭环仍未完成，双账号待办继续保留。

## 2026-09-28 后续核验

- 已修复 cloud-error-redaction 测试替身：直接使用各函数的真实 request-context 解析器，并通过受控 environment 夹具进入业务处理；新增缺少身份/外部AppID/伪造请求体不得进入业务处理反例。35项全部通过，证据 `.artifacts/cloud-error-redaction-current.txt`；没有改生产鉴权或降低断言。上文8项失败已由本节新证据解决。
- 开发工具控制层 Tool.getInfo 即时响应，版本2.02.2608040；Computer Use当前能列窗口，但选中窗口截图及激活重试均超时，停止该通道。官方auto打开system-timing指定9431返回成功，实际监听仍为9425与18255，没有9431；这意味着CLI成功不是新端口已启动的证明。已转回实际9425检查应用层，并保存独立运行证据。
- 本轮未改客户端业务代码，不另生成二维码；最新仍system-timing。

## SDK加载与连接对照（后续实测）

已在原令牌保护的 network-probe-public 中运行固定只读查询，对照后恢复原入口，并通过无路由/无触发器/无令牌拒绝检查。没有新增权限、增配内存、开通付费资源或更改数据库业务数据。

- 安装的云SDK为3.18.3，其RDB实现每次操作前调用getClientCredential；云函数环境默认keepalive关闭。连接开/关对照波动明显，后续原连接关闭也曾三条查询合计195ms，不能认定保持连接必然提升，尚未统一改业务配置。
- 原包128MB诊断函数首次观测：SDK require 9413ms、init 1ms、三条只读查询1381/168/69ms，函数总11177ms。热调用SDK加载0ms。证据 `wechat-miniprogram/.artifacts/rdb-sdk-timing-20260928.json`。
- 同版本依赖合并包128MB诊断函数：SDK加载4902ms、init 1ms、三条查询2032/88/82ms，函数总7185ms。证据 `wechat-miniprogram/.artifacts/rdb-bundled-sdk-timing-20260928.json`。这是诊断函数的单次首次加载比较，不是全站P95或手机耗时。
- 当前esbuild来自仓库prototype已有依赖，无升级/新安装。SDK版本元数据使用vendor/package.json，保留原相对布局，版本与导出键核对一致。SDK源码及依赖版本未改，原依赖目录保留；SDK动态optional supports-color仍沿用原可选行为。

### 账号函数小范围应用

`scripts/prepare-account-sdk-bundle.js` 生成 `.artifacts/account-sdk-functions/account-api` 和私有 `.cloudbase-cli-config/account-sdk-deploy.json`。只在暂存入口替换SDK require，业务文件复制原样；按account-api自己的锁定依赖构建416输入文件，不复用诊断函数的不同依赖树。

已成功部署account-api，原256MB/15秒/环境变量/公网开启/EIP关闭/无VPC均核对一致。曾因CLI拼接Windows绝对路径、配置字段大小写及GetFunction只读EipAddress字段出现失败，已修正为相对functionRoot和可写字段白名单；失败后读取线上仍Active且原环境变量不变，最后部署明确成功。

同一无可信身份getMine拒绝路径：原包首次观测3772ms、随后2ms；合并包部署后首次777ms、随后1ms，均AUTH_CONTEXT_MISSING。证据 `.artifacts/account-sdk-before.json`、`account-sdk-after.json`、`account-sdk-config-audit.json`。不包含有效账号查询，不能宣称整页减少79%；真实账号/手机及其它函数首次调用仍待验证。

后续修改account-api必须更新此暂存包并核验，不能重用过期副本；直接按默认cloudbaserc部署会恢复普通SDK加载。推广到account-bootstrap、目录、订单等函数尚未完成，需逐个按自己的锁定依赖、实际配置和业务路径验收。

### 审核状态读取

media-security-submit原来getImageStatus也加载wx-server-sdk。现在仅submitImage在业务处理前加载并初始化；状态查询不加载，不在已创建送审记录后才初始化，避免改变未知结果重试语义。先复现额外依赖加载，再通过65项入口/审核/错误脱敏测试，已部署。客户端包未变，最新二维码仍system-timing。

### 登录初始化应用

account-bootstrap同版本SDK合并包部署并回读9个文件哈希一致；37项原注册/手机号/身份回归通过，配置保持256MB/15秒及原环境变量、网络、VPC。无身份getSession首次观测1629ms→778ms，后续2ms→1ms，均正确拒绝。证据 `.artifacts/account-bootstrap-sdk-before.json`、`account-bootstrap-sdk-after.json`、`account-bootstrap-sdk-code-audit.json`、`bootstrap-sdk-regression.txt`。只证明该无身份路径的加载成本改善，不代表真实登录/手机号授权或手机首屏耗时。prepare-account-sdk-bundle已支持两个账号函数，各自独立构建锁定依赖；其它业务函数尚未推广。

## 2026-09-29 目录服务与剩余首读问题

catalog-read已按自身锁定依赖生成SDK合并包并部署，入口增加仅三项毫秒数的serverTiming，不输出业务记录或查询内容。目录与错误边界共57项测试通过。云端index.js、catalog-core.js、vendor SDK及package元数据4文件哈希核验通过；原256MB/15秒、环境变量和网络配置保持。

当前真实空目录listDiscovery执行2959ms，SDK加载760ms、初始化2ms、数据读取2193ms；紧接listProviders执行297ms，SDK加载1ms、初始化0ms、数据读取296ms。两次均返回0服务方。前次无分段合并后首次2579ms，对照原包2491ms，并未证实首次目录提速。不能将两个不同动作当成严格冷/热对照或有数据目录验收。

证据：wechat-miniprogram/.artifacts/catalog-read-sdk-after.json、catalog-read-sdk-after-before-timing.json、catalog-read-sdk-code-audit.json、catalog-read-sdk-bundle-manifest.json。后续部署必须更新.artifacts/account-sdk-functions/catalog-read并使用.cloudbase-cli-config/catalog-read-sdk-deploy.json，避免恢复旧依赖加载方式。

源码复核：SDK环境探测的metadata请求配置30ms超时，尚无证据证明其是2.2秒首读主因；RDB请求包含凭证请求和数据请求，仍需可靠分段。未伪造运行环境或改写SDK认证。首页已有城市缓存时会先发目录请求；无缓存时依赖账号城市，工作台多服务已并行，不应重复宣称新增并行优化。目录兼容旧发布数据、资格与订单展示校验尚有多段查询，不能为省时直接跳过。

剩余：有效身份下的手机全链路、首次数据库访问的凭证/连接/查询占比、实际有数据目录与其余读取服务。开发工具应用层仍不可用，未把云端函数时长当作手机首屏时长。客户端本轮无修改，不另生成二维码，真机验收未完成。

### 凭证请求分段准备

2026-09-29 首次RDB读取细分继续：已核实SDK每次数据请求前调用getClientCredential；现有受控只读探针新增原调用凭证耗时测量，不预取/缓存/重试、不返回凭证。4项测试通过，包含真实调用次数、参数/接收者/返回对象保持、异常不重试及不泄露。仅本地探针辅助代码更新，尚未部署该分段版本；线上原探针保持恢复状态，2.19秒首读原因仍未证实。下一步在原令牌门禁内实测并恢复入口，不能直接启用全局凭证缓存。


### 2026-09-29 凭证分段云端结果

| 调用 | SDK加载ms | 三次读取总ms | 三次凭证ms |
| --- | ---: | --- | --- |
| 1 | 1148 | 733/273/829 | 477/44/49 |
| 2 | 0 | 236/945/236 | 35/33/33 |
| 3 | 0 | 272/231/69 | 44/33/52 |

固定读取accounts的一列一行，未输出记录，keepalive=false、重试0。读取总时长包含凭证、网络与SDK处理，差值不是数据库SQL执行时间。首个总时长还含SDK外的运行开销。诊断函数128MB与业务函数256MB不相同，不能据此比较业务页面速度。

本轮定位意义：不能单独缓存凭证便宣称解决；凭证热请求稳定在33—52ms，数据请求剩余段仍显著波动。保留现有认证和连接行为，下一步继续观察数据请求链路与手机网关时延。

scripts/measure-rdb-credential-timing.js执行完成，finally恢复原入口并部署；.artifacts/company-network-probe-audit.json显示两探针Active、无路由、无触发器、缺令牌拒绝。源码备份.artifacts/credential-timing-original-index.js。4项探针回归通过。

### 发现页查询并行部署

2026-09-29 发现页独立查询并行优化已部署：原资格查询阻塞档期/订单，现对已筛选候选人并行查询，返回前仍等待资格；其他动作保持原校验顺序。新增延迟资格反例先失败后通过，相关58项回归全通过，4个线上文件哈希一致，配置保持。线上空目录listDiscovery2429ms/读取1557ms，listProviders285ms；因0候选人不执行新并行分支，不能据此声称提速效果，需有数据与真机验收。证据.artifacts/catalog-parallel-read-20260929.json。客户端未改，沿用system-timing二维码。


实现仅调整listDiscovery的资格查询时序：先按非档期条件筛选，再将候选人资格、档期和订单读取并行合并，资格返回前不输出结果。资格异常仍失败，非候选人不再查询资格。列表/作者/作品详情原行为保持。先以延迟资格测试复现原串行阻塞，再验证新行为及其他回归共58项通过。部署不改资源、环境变量与权限，云端四文件哈希核验通过。空目录运行只能证明部署与返回兼容，未覆盖并行分支的真实耗时。

### 档期服务首次加载优化

2026-09-29 档期服务SDK合并包已部署：45项档期/身份/错误边界回归通过，业务与身份文件未改，5个线上文件哈希一致，原256MB/15秒/环境变量/网络配置保持。无身份getMine首次观测4595ms→762ms，后续3ms→1ms，均AUTH_CONTEXT_MISSING；仅证明初始化拒绝路径成本下降，非真实工作台/手机验收。证据.artifacts/availability-api-sdk-before.json、after.json、code-audit.json。后续需更新.artifacts/account-sdk-functions/availability-api及对应私有部署配置，避免恢复旧加载。客户端未变，沿用system-timing二维码。


登录/首页复核：readSession账号、角色、城市已并行；seedSession已将城市带入30秒缓存，未发现可据此宣称重复的首页城市请求。档期原包仍加载416个SDK依赖，现按其自身锁定3.18.3依赖构建，版本与导出键保持，未变更鉴权、查询或资源。后续订单/收藏/项目等服务及有效身份真机仍待，不把本次拒绝路径的改善外推为全站验收。

### 订单SDK应用与未获改善的结果

2026-09-29 订单SDK合并包已部署并核验20个线上文件，116项订单/资金冻结/身份等回归通过，业务文件保持，原256MB/30秒/环境及网络配置一致。无身份listOrders首次1669ms→1917ms，后续1ms→3ms，本轮没有提速证据，也不足以将单次差异认定回归；performanceImprovementVerified=false。证据.artifacts/order-api-sdk-before.json、after.json、code-audit.json。停止仅据其他函数加载收益继续盲推；下一步须有效身份及分段证据。客户端仍system-timing，正式支付、真机与发布目标未完成。


源码工作台同时等待账号、目录、订单、档期；不是本轮新增并行。订单按自身锁定3.18.3构建416依赖输入，业务/身份/资金代码保持，只有暂存入口SDK引用改变。首次拒绝路径实际1669→1917ms，不能称提速，也不能因该结果宣称数据库变慢（此路径不进数据库）。同版本合并不保证每函数都有收益，下一步优先真实链路和分段定位，不继续将此当万能方案。后续修改订单函数需重建.artifacts/account-sdk-functions/order-api并使用.cloudbase-cli-config/order-api-sdk-deploy.json；默认部署会恢复原SDK加载方式。

### 档期两项只读查询并行

2026-09-29 档期查询串行等待修复已部署：getMine/getPublic在身份或公开状态门禁通过后，并行读取档期行与订单占用日期；保存版本检查和写入顺序保持。新增延迟查询反例先失败后通过，46项相关回归全通过，5个线上文件哈希一致。真实身份下的手机耗时仍未验证，不重复用拒绝路径当该分支提速证据。客户端未变，沿用system-timing。


此前publicAvailability(await readRow(...), await lockedDates(...))使两项独立读取串行。现用共用readAvailability在校验完成后Promise.all合并；getMine与getPublic均覆盖，未将私有数据查询提前到鉴权前。回归还保留隐藏/停用服务方不得查询档期或订单、锁定日期不可编辑等检查。部署沿用SDK合并包，证据wechat-miniprogram/.artifacts/availability-api-sdk-code-audit.json。
