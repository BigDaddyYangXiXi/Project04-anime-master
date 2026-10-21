const buyerItems = [
  { key: "market", text: "找高手", icon: "/assets/nav/market-line.svg", url: "/pages/discover/index" },
  { key: "orders", text: "订单", icon: "/assets/nav/order-line.svg", url: "/pages/orders/index" },
  { key: "projects", text: "项目", icon: "/assets/nav/project-line.svg", url: "/pages/projects/index" },
  { key: "me", text: "我的", icon: "/assets/nav/profile-line.svg", url: "/pages/me/index" }
];

const providerItems = [
  { key: "dashboard", text: "工作台", icon: "/assets/nav/workbench-line.svg", url: "/pages/discover/index" },
  { key: "orders", text: "订单", icon: "/assets/nav/order-line.svg", url: "/pages/orders/index" },
  { key: "calendar", text: "档期", icon: "/assets/nav/calendar-line.svg", url: "/pages/projects/index" },
  { key: "me", text: "我的", icon: "/assets/nav/profile-line.svg", url: "/pages/me/index" }
];

const buyerActiveByRoute = {
  "pages/discover/index": "market",
  "pages/orders/index": "orders",
  "pages/booking-status/index": "orders",
  "pages/order-detail/index": "orders",
  "pages/order-refund/index": "orders",
  "pages/fulfillment/index": "orders",
  "pages/review/index": "orders",
  "pages/projects/index": "projects",
  "pages/project-detail/index": "projects",
  "pages/brief/index": "projects",
  "pages/me/index": "me"
};

const providerActiveByRoute = {
  "pages/discover/index": "dashboard",
  "pages/provider-home/index": "dashboard",
  "pages/orders/index": "orders",
  "pages/provider-orders/index": "orders",
  "pages/provider-request/index": "orders",
  "pages/provider-task/index": "orders",
  "pages/order-refund/index": "orders",
  "pages/projects/index": "calendar",
  "pages/provider-calendar/index": "calendar",
  "pages/provider-profile/index": "dashboard",
  "pages/provider-reviews/index": "dashboard",
  "pages/me/index": "me"
};

const sharedTabRoutes = new Set(["pages/discover/index", "pages/orders/index", "pages/projects/index", "pages/me/index", "pages/order-refund/index"]);
const providerRouteSet = new Set(Object.keys(providerActiveByRoute).filter((route) => !sharedTabRoutes.has(route)));
const buyerRouteSet = new Set(Object.keys(buyerActiveByRoute).filter((route) => !sharedTabRoutes.has(route)));

Component({
  properties: {
    workspace: { type: String, value: "", observer() { this.syncNavigation(); } }
  },
  data: {
    role: "buyer",
    active: "",
    switching: false,
    items: buyerItems
  },

  lifetimes: {
    attached() {
      this.syncNavigation();
    }
  },

  pageLifetimes: {
    show() {
      this.syncNavigation();
    }
  },

  methods: {
    syncNavigation() {
      const pages = getCurrentPages();
      const route = pages.length ? pages[pages.length - 1].route : "";
      const storedRole = wx.getStorageSync("animeMasterRole") === "provider" ? "provider" : "buyer";
      const workspace = ["buyer", "provider"].includes(this.data.workspace) ? this.data.workspace : storedRole;
      const role = providerRouteSet.has(route) ? "provider" : buyerRouteSet.has(route) ? "buyer" : workspace;
      if (role !== storedRole && (providerRouteSet.has(route) || buyerRouteSet.has(route))) {
        wx.setStorageSync("animeMasterRole", role);
      }
      const active = role === "provider" ? providerActiveByRoute[route] || "" : buyerActiveByRoute[route] || "";
      const items = (role === "provider" ? providerItems : buyerItems).map((item) => ({ ...item, activeIcon: item.icon.replace('.svg', '-active.svg') }));
      this.setData({ role, active, switching: false, items });
    },

    openRoot(event) {
      const url = event.currentTarget.dataset.url;
      const pages = getCurrentPages();
      const current = pages.length ? `/${pages[pages.length - 1].route}` : "";
      if (!url || current === url || this.data.switching) return;
      wx.setStorageSync("animeMasterRole", this.data.role);
      const previousActive = this.data.active;
      const target = this.data.items.find((item) => item.url === url);
      this.setData({ active: target ? target.key : previousActive, switching: true });
      wx.switchTab({
        url,
        success: () => this.setData({ switching: false }),
        fail: () => this.setData({ active: previousActive, switching: false })
      });
    }
  }
});
