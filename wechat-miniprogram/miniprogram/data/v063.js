const stageLabels = {
  REQUESTED: "待服务方处理", SUPPLEMENT_REQUESTED: "待补充信息", SUPPLEMENTED: "已补充待复核",
  CONTACTING: "沟通中", NDA_BUYER_PENDING: "待需求方签署 NDA", NDA_PROVIDER_PENDING: "待服务方签署 NDA",
  BUYER_FINAL_CONFIRM: "待需求方确认并支付", IN_PRODUCTION: "执行制作中", REVISION_REQUESTED: "修改中",
  DELIVERY_PENDING: "待需求方验收", COMPLETED: "已完成", DECLINED: "已婉拒"
};

const stageFlows = {
  booking: ["REQUESTED", "SUPPLEMENT_REQUESTED", "SUPPLEMENTED", "CONTACTING", "NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM"],
  production: ["IN_PRODUCTION", "REVISION_REQUESTED"], acceptance: ["DELIVERY_PENDING"], history: ["COMPLETED", "DECLINED"]
};

const providers = [
  { id: 1, name: "南烛", handle: "@nanzhu_makeup", career: "妆娘", city: "杭州", orders: 56, rating: 5, replyHours: 2, bio: "擅长骨相调整、男性角色与轻伤效妆，重视镜头近景的皮肤质感。", notice: "请提前提供角色设定；改期请至少提前 48 小时。", tags: ["男角", "骨相调整", "伤效妆"], services: [{ id: "makeup", name: "角色妆造", price: 520, unit: "人次", description: "角色妆面、基础发型调整与拍摄前补妆建议。", workIds: ["w-mu-2", "w-mu-3"] }, { id: "makeup-follow", name: "现场跟妆", price: 360, unit: "4小时", description: "拍摄现场补妆、妆面连续性检查与简单发型复位。", workIds: ["w-mu-1"] }], works: [
    { id: "w-mu-1", code: "AM-MU-3H8KP", title: "夜航者", subtitle: "男性角色妆", tone: "coral", price: 520, description: "强化骨相转折与眉眼英气，保留镜头下的皮肤质感。", tags: ["男角", "骨相调整"], referenceCount: 31, imageCount: 4 },
    { id: "w-mu-2", code: "AM-MU-5C2RY", title: "雨夜逃亡", subtitle: "轻伤效妆", tone: "grape", price: 680, description: "适合剧情短片的擦伤、血迹与疲惫感妆面。", tags: ["伤效妆", "剧情感"], referenceCount: 24, imageCount: 5 },
    { id: "w-mu-3", code: "AM-MU-1T9BN", title: "花间宴", subtitle: "东方浓颜", tone: "rose", price: 580, description: "强调眼妆层次与东方角色的华丽感。", tags: ["浓颜", "古风"], referenceCount: 17, imageCount: 3 }
  ] },
  { id: 2, name: "绒光", handle: "@rongguang_wig", career: "毛娘", city: "杭州", orders: 29, rating: 4.9, replyHours: 3, bio: "擅长长发结构、古风发髻和角色特征还原。", notice: "需提前提供角色设定图；当天加急请先确认档期。", tags: ["复杂造型", "长发", "古风"], services: [{ id: "wig-style", name: "假发修剪与造型", price: 680, unit: "顶", description: "修剪、分区、定型与上头调整。", workIds: ["w-wg-1", "w-wg-2"] }], works: [
    { id: "w-wg-1", code: "AM-WG-8A4ZU", title: "雪国长发", subtitle: "长发结构", tone: "blue", price: 720, description: "长发分区与蓬松结构造型。", tags: ["长发", "复杂造型"], referenceCount: 19, imageCount: 4 },
    { id: "w-wg-2", code: "AM-WG-2L6FM", title: "赤羽冠", subtitle: "古风发髻", tone: "coral", price: 980, description: "带发冠与羽饰的高复杂度造型。", tags: ["复杂造型", "古风"], referenceCount: 28, imageCount: 5 }
  ] },
  { id: 3, name: "迟霜", handle: "@chishuang_photo", career: "摄影", city: "杭州", orders: 38, rating: 4.9, replyHours: 2, bio: "偏爱有叙事线索的角色摄影，擅长环境光与小型灯组。", notice: "拍摄前确认场地许可；高危动作需提供安全方案。", tags: ["剧情感", "夜景", "冷色光影"], services: [{ id: "photo-day", name: "角色正片摄影", price: 1600, unit: "天", description: "前期沟通、现场拍摄与 9 张精选后期。", workIds: ["w-ph-1"] }, { id: "photo-edit", name: "追加精选后期", price: 680, unit: "组", description: "在原拍摄素材中追加 9 张精选后期。", workIds: ["w-ph-2"] }], works: [
    { id: "w-ph-1", code: "AM-PH-7K2P9", title: "机械城夜巡", subtitle: "赛博夜景", tone: "grape", price: 1800, description: "机械义肢与城市霓虹为视觉核心。", tags: ["夜景", "剧情感"], referenceCount: 26, imageCount: 5 },
    { id: "w-ph-2", code: "AM-PH-4M8TX", title: "潮汐来信", subtitle: "水下氛围", tone: "blue", price: 1600, description: "薄雾、水纹投影与蓝绿色光线。", tags: ["棚拍", "冷色光影"], referenceCount: 18, imageCount: 3 }
  ] },
  { id: 4, name: "竹野", handle: "@zhuye_studio", career: "摄影", city: "上海", orders: 21, rating: 4.8, replyHours: 4, bio: "商业棚拍为主，拍摄前提供灯位和动作参考。", notice: "临时改期与超时需重新确认费用。", tags: ["棚拍", "电影光", "动作指导"], services: [{ id: "studio-day", name: "棚拍摄影", price: 2200, unit: "天", description: "棚拍布光、动作指导与 9 张精选后期。", workIds: ["w-ph-3"] }], works: [{ id: "w-ph-3", code: "AM-PH-6D1LR", title: "赤月审判", subtitle: "电影光棚拍", tone: "rose", price: 2400, description: "红黑电影光和强动作设计。", tags: ["电影光", "动作指导"], referenceCount: 22, imageCount: 5 }] },
  { id: 5, name: "墨帧", handle: "@mozhen_post", career: "后期", city: "杭州", orders: 44, rating: 4.9, replyHours: 2, bio: "专注角色短视频节奏、氛围调色与轻量特效合成。", notice: "请保留原始素材；结构性重剪需另行确认。", tags: ["短视频", "氛围调色", "赛博特效"], services: [{ id: "video-edit", name: "角色短视频后期", price: 360, unit: "条", description: "节奏剪辑、氛围调色与轻量特效。", workIds: ["w-po-1", "w-po-2"] }], works: [
    { id: "w-po-1", code: "AM-PO-4X9KC", title: "机械心跳", subtitle: "赛博特效", tone: "grape", price: 520, description: "赛博界面、故障效果与卡点节奏。", tags: ["短视频", "赛博特效"], referenceCount: 35, imageCount: 5 },
    { id: "w-po-2", code: "AM-PO-6P2HE", title: "花影一瞬", subtitle: "古风调色", tone: "coral", price: 360, description: "柔和古风调色与轻粒子氛围。", tags: ["氛围调色", "古风"], referenceCount: 16, imageCount: 3 }
  ] }
];

const filterOptions = {
  妆娘: [{ group: "妆容风格", values: ["男角", "伤效妆", "浓颜", "骨相调整"] }, { group: "价格区间", values: ["￥300以下", "￥300–600", "￥600以上"] }],
  毛娘: [{ group: "服务类型", values: ["复杂造型", "长发", "古风"] }, { group: "价格区间", values: ["￥300–600", "￥600以上"] }],
  摄影: [{ group: "拍摄环境", values: ["棚拍", "夜景", "剧情感"] }, { group: "视觉风格", values: ["电影光", "冷色光影", "动作指导"] }, { group: "价格区间", values: ["￥1000以下", "￥1000–2000", "￥2000以上"] }],
  后期: [{ group: "交付类型", values: ["短视频", "赛博特效"] }, { group: "视觉风格", values: ["氛围调色", "古风"] }, { group: "价格区间", values: ["￥300以下", "￥300–600", "￥600以上"] }]
};

const availability = {
  1: { available: [16, 18, 20, 22, 25, 27], full: [17, 21] }, 2: { available: [16, 17, 19, 23, 26], full: [18, 22] },
  3: { available: [17, 20, 21, 24, 28], full: [16, 19] }, 4: { available: [16, 18, 23, 25], full: [17, 20, 22] },
  5: { available: [16, 19, 20, 22, 26, 28], full: [18, 21] }
};

function priceMatch(price, label) {
  if (label === "￥300以下") return price < 300;
  if (label === "￥300–600") return price >= 300 && price <= 600;
  if (label === "￥600以上") return price > 600;
  if (label === "￥1000以下") return price < 1000;
  if (label === "￥1000–2000") return price >= 1000 && price <= 2000;
  if (label === "￥2000以上") return price > 2000;
  return true;
}

function matchesFilters(career, filters, tags, price) {
  return filterOptions[career].every(({ values }) => {
    const selected = values.filter((value) => filters.includes(value));
    return !selected.length || selected.some((value) => value.indexOf("￥") === 0 ? priceMatch(price, value) : tags.includes(value));
  });
}

function allWorks() {
  const result = [];
  providers.forEach((provider) => provider.works.forEach((work) => result.push(Object.assign({}, work, { provider }))));
  return result;
}

module.exports = { providers, filterOptions, availability, stageLabels, stageFlows, matchesFilters, allWorks };
