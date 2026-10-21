const buyerRoutes = new Set([
  "pages/discover/index", "pages/search-results/index", "pages/work-detail/index",
  "pages/provider-detail/index", "pages/provider-schedule/index", "pages/booking/index",
  "pages/booking-status/index", "pages/order-detail/index", "pages/orders/index", "pages/order-refund/index",
  "pages/projects/index", "pages/project-detail/index", "pages/brief/index",
  "pages/fulfillment/index", "pages/review/index", "pages/me/index",
  "pages/me-assets/index", "pages/account-profile/index"
]);
const providerRoutes = new Set([
  "pages/discover/index", "pages/provider-home/index", "pages/provider-profile/index", "pages/provider-calendar/index",
  "pages/orders/index", "pages/projects/index", "pages/provider-orders/index", "pages/provider-request/index", "pages/provider-task/index",
  "pages/order-refund/index",
  "pages/provider-reviews/index", "pages/me/index", "pages/me-assets/index",
  "pages/provider-detail/index", "pages/provider-schedule/index", "pages/work-detail/index",
  "pages/account-profile/index"
]);
const sharedRoutes = new Set([
  "pages/discover/index", "pages/orders/index", "pages/projects/index", "pages/me/index", "pages/me-assets/index", "pages/provider-detail/index",
  "pages/provider-schedule/index", "pages/work-detail/index", "pages/account-profile/index", "pages/order-refund/index"
]);

// Shared personal-center interiors retain their opening workspace on return.
for (const route of ['pages/help/index', 'pages/settings/index', 'pages/support/index', 'pages/me-social/index', 'pages/me-activity/index']) {
  buyerRoutes.add(route); providerRoutes.add(route); sharedRoutes.add(route);
}

Component({
  properties: {
    title: { type: String, value: "" },
    showBack: { type: Boolean, value: true },
    customBack: { type: Boolean, value: false },
    workspace: { type: String, value: "buyer" },
    showRoleSwitch: { type: Boolean, value: false },
    roleText: { type: String, value: "" }
  },
  data: { statusBarHeight: 20, navBarHeight: 44, totalHeight: 64, sideInset: 96 },
  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const capsule = wx.getMenuButtonBoundingClientRect();
      const statusBarHeight = windowInfo.statusBarHeight || 20;
      const navBarHeight = Math.max(44, (capsule.top - statusBarHeight) * 2 + capsule.height);
      const sideInset = Math.max(52, windowInfo.windowWidth - capsule.left + 8);
      this.setData({ statusBarHeight, navBarHeight, totalHeight: statusBarHeight + navBarHeight, sideInset });
      this.triggerEvent("layout", { totalHeight: statusBarHeight + navBarHeight });
    }
  },
  methods: {
    switchRole() { this.triggerEvent("roleswitch"); },
    goBack() {
      if (!this.data.showBack) return;
      if (this.data.customBack) { this.triggerEvent("back"); return; }
      const provider = this.data.workspace === "provider";
      const allowedRoutes = provider ? providerRoutes : buyerRoutes;
      const pages = getCurrentPages();
      const previousPage = pages.length > 1 ? pages[pages.length - 2] : null;
      const previousRoute = previousPage ? previousPage.route : "";
      const expectedWorkspace = provider ? "provider" : "buyer";
      const previousWorkspace = previousPage && previousPage.data
        ? previousPage.data.navWorkspace || previousPage.data.role || "buyer" : "";
      const sharedRouteMatchesWorkspace = !sharedRoutes.has(previousRoute) || previousWorkspace === expectedWorkspace;
      if (allowedRoutes.has(previousRoute) && sharedRouteMatchesWorkspace) {
        wx.navigateBack({ delta: 1 });
        return;
      }
      wx.setStorageSync("animeMasterRole", provider ? "provider" : "buyer");
      wx.switchTab({ url: "/pages/discover/index" });
    }
  }
});

module.exports = { buyerRoutes, providerRoutes };
