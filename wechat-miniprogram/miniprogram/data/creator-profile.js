function present(profile = {}, statistics = {}) {
  const name = profile.nickname || profile.name || "未设置昵称";
  return Object.assign({}, profile, {
    name,
    initial: name.slice(0, 1),
    handle: statistics.uid || profile.uid || statistics.handle || profile.handle || "",
    location: [profile.city, profile.district].filter(Boolean).join("·"),
    tags: Array.isArray(profile.tags) ? profile.tags : String(profile.tags || "").split(/[,，、]/).filter(Boolean),
    accepting: profile.accepting !== false,
    ordersText: Number.isFinite(statistics.orders) ? String(statistics.orders) : "—",
    ratingText: Number.isFinite(statistics.rating) ? statistics.rating.toFixed(1) : "—",
    reviewCount: Number(statistics.reviewCount || 0),
    replyText: Number.isFinite(statistics.averageResponseMinutes)
      ? statistics.averageResponseMinutes < 60 ? `${statistics.averageResponseMinutes} 分钟` : `${Math.round(statistics.averageResponseMinutes / 6) / 10} 小时`
      : Number.isFinite(statistics.replyHours) ? `${statistics.replyHours} 小时` : "暂无数据",
    verificationText: statistics.verificationText || ""
  });
}

module.exports = { present };
