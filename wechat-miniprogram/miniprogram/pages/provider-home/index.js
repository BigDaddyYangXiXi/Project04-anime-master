const store = require("../../data/v063-store");
const { providers, stageLabels, stageFlows } = require("../../data/v063");

const PRIORITY_STAGES = [
  "REQUESTED", "SUPPLEMENTED", "CONTACTING", "NDA_PROVIDER_PENDING", "REVISION_REQUESTED"
];
const PRIORITY_PREVIEW_LIMIT = 5;

function countFlow(orders, flow) {
  return orders.filter((order) => stageFlows[flow].includes(order.stage)).length;
}

Page({
  data: {
    profile: null, profileInitial: "南", career: "妆娘", metrics: [],
    priorityOrders: [], priorityTotal: 0, remainingPriority: 0, overview: []
  },

  onLoad(options = {}) {
    this.auditMode = options.audit === "1";
    if (this.auditMode) return;
    this.redirecting = true;
    wx.setStorageSync("animeMasterRole", "provider");
    wx.switchTab({ url: "/pages/discover/index" });
  },

  onShow() {
    if (this.redirecting) return;
    wx.setStorageSync("animeMasterRole", "provider");
    this.syncTabBar();
    const orders = store.getOrders().filter((order) => order.providerId === store.CURRENT_PROVIDER_ID);
    const profile = store.getProfile();
    const provider = providers.find((item) => item.id === store.CURRENT_PROVIDER_ID) || providers[0];
    const allPriority = orders.filter((order) => PRIORITY_STAGES.includes(order.stage));
    const reviewCount = orders.filter((order) => order.rating > 0).length;
    this.setData({
      profile,
      profileInitial: profile.nickname.slice(0, 1),
      career: provider.career,
      metrics: [
        { flow: "booking", count: countFlow(orders, "booking"), label: "预约沟通" },
        { flow: "production", count: countFlow(orders, "production"), label: "项目执行" },
        { flow: "acceptance", count: countFlow(orders, "acceptance"), label: "验收结算" }
      ],
      priorityOrders: allPriority.slice(0, PRIORITY_PREVIEW_LIMIT).map((order) => Object.assign({}, order, {
        statusLabel: stageLabels[order.stage]
      })),
      priorityTotal: allPriority.length,
      remainingPriority: Math.max(0, allPriority.length - PRIORITY_PREVIEW_LIMIT),
      overview: [
        { label: "作品", value: `${store.getWorks().length} 件公开作品` },
        { label: "服务", value: `${store.getServices().length} 个可预约项目` },
        { label: "档期", value: `${store.getAvailableDays().length} 个公开可约日` },
        { label: "评价", value: `${reviewCount} 条完成订单评价` }
      ]
    });
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar && tabBar.syncNavigation) tabBar.syncNavigation();
  },

  openFlow(event) {
    wx.setStorageSync("anime-master-root-order-group", event.currentTarget.dataset.flow);
    wx.switchTab({ url: "/pages/orders/index" });
  },

  openPriority(event) {
    const order = store.findOrder(event.currentTarget.dataset.id);
    if (!order) return;
    const page = order.stage === "NDA_PROVIDER_PENDING" ? "provider-task" : "provider-request";
    wx.navigateTo({ url: `/pages/${page}/index?id=${order.id}` });
  },

  openProfile() { wx.navigateTo({ url: "/pages/provider-profile/index" }); },
  openCalendar() { wx.switchTab({ url: "/pages/projects/index" }); },
  openOrders() { wx.switchTab({ url: "/pages/orders/index" }); },
  openReviews() { wx.navigateTo({ url: "/pages/provider-reviews/index" }); }
});
