const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const projectModel = require("../../data/project-model");
const cloudProjects = require("../../services/cloud-projects");
const cloudOrders = require("../../services/cloud-orders");
const cloudAvailability = require("../../services/cloud-availability");
const calendarModel = require("../../data/calendar-model");

const PROJECT_ID = "PJ-DEMO-0822";
const LOCKED_STAGES = ["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"];

function decorate(project, orders = store.getOrders()) {
  const linkedOrders = orders.filter((order) => (project.bookingIds || []).includes(order.id) && order.stage !== "DECLINED");
  const ndaPending = linkedOrders.filter((order) => ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(order.stage)).length;
  return Object.assign({}, project, {
    orderCount: linkedOrders.length,
    ndaCopy: ndaPending ? `${ndaPending} 份 NDA 待签署` : "当前没有待签 NDA"
  });
}

function buildProject() {
  return decorate(Object.assign(projectModel.deriveProjectDraft(PROJECT_ID), { sample: true, briefSaved: true }));
}

Page({
  data: {
    role: "buyer", projects: [], navigationError: "", loading: false, loadError: "", actionPending: false,
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    days: [], originalDays: [], draftDays: [], lockedDays: [], originalDates: [], draftDates: [], lockedDates: [],
    monthTitle: "2026 年 8 月", availabilityVersion: 0, calendarLoading: false, calendarError: "", changed: false, message: ""
  },

  onLoad(options) {
    this.auditChanged = localPreview.isAudit(options) && options.changed === "1";
    this.cloudMode = !localPreview.isAudit(options);
    this.availabilityCloudMode = !localPreview.isAudit(options);
  },

  onShow() {
    this.hidden = false;
    this.setData({ actionPending: false });
    if (this.cloudMode) {
      const owner = getApp().globalData.account?.id;
      if (this.viewOwner !== owner) {
        this.viewOwner = owner;
        this.viewGeneration = (this.viewGeneration || 0) + 1;
        this.calendarRequest = (this.calendarRequest || 0) + 1;
        this.createIdempotencyKey = "";
        this.calendarOwner = null; this.calendarMonth = null;
        this.projectsOwner = null;
        this.setData({ projects: [], days: [], originalDays: [], draftDays: [], lockedDays: [],
          originalDates: [], draftDates: [], lockedDates: [], availabilityVersion: 0,
          changed: false, message: "", navigationError: "", loadError: "", calendarError: "" });
      }
    }
    const role = wx.getStorageSync("animeMasterRole") === "provider" ? "provider" : "buyer";
    this.syncNativeTabBar(role);
    this.setData({ role }, () => {
      role === "provider" ? this.loadCalendar() : this.loadProjects();
    });
  },

  onHide() { this.hidden = true; this.viewGeneration = (this.viewGeneration || 0) + 1; this.calendarRequest = (this.calendarRequest || 0) + 1; },
  onUnload() { this.unloaded = true; this.onHide(); },

  syncNativeTabBar(role) {
    if (!wx.setTabBarItem) return;
    const homeIcon = role === "provider" ? "/assets/nav/workbench-line.png" : "/assets/nav/market-line.png";
    const thirdIcon = role === "provider" ? "/assets/nav/calendar-line.png" : "/assets/nav/project-line.png";
    wx.setTabBarItem({ index: 0, text: role === "provider" ? "工作台" : "找高手", iconPath: homeIcon, selectedIconPath: homeIcon.replace(".png", "-active.png") });
    wx.setTabBarItem({ index: 2, text: role === "provider" ? "档期" : "项目", iconPath: thirdIcon, selectedIconPath: thirdIcon.replace(".png", "-active.png") });
  },

  async loadProjects() {
    if (this.unloaded || this.hidden) return;
    if (this.cloudMode) {
      const owner = getApp().globalData.account?.id, generation = this.viewGeneration || 0;
      const request = this.projectRequest = (this.projectRequest || 0) + 1;
      const current = () => !this.unloaded && !this.hidden && generation === (this.viewGeneration || 0)
        && request === this.projectRequest && owner === getApp().globalData.account?.id;
      if (this.projectsOwner !== owner) this.setData({ projects: [] });
      this.projectsOwner = owner;
      this.setData({ loading: true, loadError: "" });
      try {
        const [projects, orders] = await Promise.all([cloudProjects.listProjects(), cloudOrders.listOrders()]);
        if (!current()) return;
        this.setData({ projects: projects.map((project) => decorate(project, orders)), loading: false });
      } catch (error) {
        if (!current()) return;
        this.setData({ projects: [], loading: false, loadError: "项目读取失败，请稍后重试。" });
      }
      return;
    }
    let projects = projectModel.getProjects();
    if (!projects.length) projects = [projectModel.upsertProject(buildProject())];
    projects = projects.map((project) => decorate(project));
    projectModel.saveProjects(projects);
    this.setData({ projects });
  },

  async loadCalendar() {
    if (this.unloaded || this.hidden || this.data.actionPending) return;
    if (this.availabilityCloudMode) {
      const owner = getApp().globalData.account?.id;
      const request = this.calendarRequest = (this.calendarRequest || 0) + 1;
      this.setData({ calendarLoading: true, calendarError: "", message: "" });
      try {
        const value = await cloudAvailability.getMine();
        if (request !== this.calendarRequest || owner !== getApp().globalData.account?.id || this.data.actionPending) return;
        const month = calendarModel.monthFrom();
        const today = calendarModel.todayKey();
        const openDates = value.openDates.filter((date) => date >= today);
        const preserveDraft = this.calendarOwner === owner && this.calendarMonth
          && this.data.availabilityVersion === value.version
          && JSON.stringify([...this.data.lockedDates].sort()) === JSON.stringify([...value.lockedDates].sort());
        this.calendarOwner = owner;
        this.calendarMonth = month;
        this.setData({
          availabilityVersion: value.version, originalDates: openDates, draftDates: preserveDraft ? this.data.draftDates.filter(date => date >= today) : [...openDates], lockedDates: value.lockedDates,
          monthTitle: month.title, calendarLoading: false
        }, () => this.refreshCalendar());
      } catch (error) {
        if (request !== this.calendarRequest || owner !== getApp().globalData.account?.id) return;
        this.setData({ days: [], calendarLoading: false, calendarError: "档期读取失败，请稍后重试。" });
      }
      return;
    }
    const originalDays = store.getAvailableDays();
    const lockedDays = store.getOrders()
      .filter((order) => order.providerId === store.CURRENT_PROVIDER_ID && LOCKED_STAGES.includes(order.stage))
      .map((order) => Number((order.time.match(/2026[/-]08[/-](\d{2})/) || [])[1]))
      .filter(Boolean);
    const draftDays = [...originalDays];
    if (this.auditChanged && !lockedDays.includes(17) && !draftDays.includes(17)) draftDays.push(17);
    this.setData({ originalDays, lockedDays, draftDays, monthTitle: "2026 年 8 月", message: "" }, () => this.refreshCalendar());
  },

  refreshCalendar() {
    if (this.availabilityCloudMode) {
      const originalDates = [...this.data.originalDates].sort();
      const draftDates = [...this.data.draftDates].sort();
      this.setData({
        changed: JSON.stringify(originalDates) !== JSON.stringify(draftDates),
        days: calendarModel.buildMonth({ ...this.calendarMonth, openDates: draftDates, lockedDates: this.data.lockedDates })
      });
      return;
    }
    const sortedOriginal = [...this.data.originalDays].sort((a, b) => a - b);
    const sortedDraft = [...this.data.draftDays].sort((a, b) => a - b);
    this.setData({
      changed: JSON.stringify(sortedOriginal) !== JSON.stringify(sortedDraft),
      days: Array.from({ length: 42 }, (_, index) => {
        const value = index - 4;
        const valid = value > 0 && value <= 31;
        return {
          key: index, value: valid ? value : "", valid,
          open: valid && this.data.draftDays.includes(value),
          locked: valid && this.data.lockedDays.includes(value)
        };
      })
    });
  },

  toggle(event) {
    if (this.availabilityCloudMode) {
      const date = event.currentTarget.dataset.date;
      if (!date || date < calendarModel.todayKey() || this.data.lockedDates.includes(date)) return;
      const draftDates = this.data.draftDates.includes(date) ? this.data.draftDates.filter((item) => item !== date) : this.data.draftDates.concat(date);
      this.setData({ draftDates, message: "" }, () => this.refreshCalendar());
      return;
    }
    const value = Number(event.currentTarget.dataset.day);
    if (!value || this.data.lockedDays.includes(value)) return;
    const draftDays = this.data.draftDays.includes(value)
      ? this.data.draftDays.filter((day) => day !== value)
      : this.data.draftDays.concat(value);
    this.setData({ draftDays, message: "" }, () => this.refreshCalendar());
  },

  reset() {
    if (this.availabilityCloudMode) {
      this.setData({ draftDates: [...this.data.originalDates], message: "" }, () => this.refreshCalendar());
      return;
    }
    this.setData({ draftDays: [...this.data.originalDays], message: "" }, () => this.refreshCalendar());
  },

  async save() {
    if (this.unloaded || this.hidden || !this.data.changed) return;
    if (this.availabilityCloudMode) {
      if (this.data.actionPending) return;
      const owner = getApp().globalData.account?.id, generation = this.viewGeneration || 0;
      const current = () => !this.unloaded && !this.hidden && generation === (this.viewGeneration || 0) && owner === getApp().globalData.account?.id;
      this.calendarRequest = (this.calendarRequest || 0) + 1;
      this.setData({ actionPending: true, calendarLoading: false, message: "", calendarError: "" });
      try {
        const value = await cloudAvailability.saveMine(this.data.availabilityVersion, [...this.data.draftDates].sort());
        if (!current()) return;
        this.setData({ availabilityVersion: value.version, originalDates: value.openDates, draftDates: [...value.openDates], lockedDates: value.lockedDates, actionPending: false, message: "公开档期已保存并同步需求方详情" }, () => this.refreshCalendar());
      } catch (error) {
        if (!current()) return;
        const message = error.code === "VERSION_CONFLICT" ? "档期已在其他页面更新，请重新进入后再修改。" : error.code === "LOCKED_DATE_MUTATION" ? "订单锁定日期不能修改，请刷新后重试。" : "档期保存失败，请稍后重试。";
        this.setData({ actionPending: false, calendarError: message });
      }
      return;
    }
    const days = [...this.data.draftDays].sort((a, b) => a - b);
    store.saveAvailableDays(days);
    this.setData({ originalDays: days, message: "公开档期已保存并同步需求方详情" }, () => this.refreshCalendar());
  },

  openProject(event) {
    if (this.unloaded || this.hidden) return;
    if (this.cloudMode && (!this.projectsOwner || this.projectsOwner !== getApp().globalData.account?.id)) {
      this.setData({ projects: [], loadError: "账号已变化，请重新读取项目。" }); return;
    }
    wx.navigateTo({ url: `/pages/project-detail/index?id=${event.currentTarget.dataset.id}` });
  },

  async createProject() {
    if (this.unloaded || this.hidden) return;
    if (this.cloudMode) {
      if (this.data.actionPending) return;
      const owner = getApp().globalData.account?.id, generation = this.viewGeneration || 0;
      const current = () => !this.unloaded && !this.hidden && generation === (this.viewGeneration || 0) && owner === getApp().globalData.account?.id;
      this.createIdempotencyKey = this.createIdempotencyKey || cloudProjects.idempotencyKey();
      this.setData({ actionPending: true, navigationError: "" });
      try {
        const project = await cloudProjects.createProject(this.createIdempotencyKey);
        if (!current()) return;
        this.createIdempotencyKey = "";
        this.setData({ actionPending: false });
        wx.navigateTo({ url: `/pages/brief/index?id=${project.id}&new=1` });
      } catch (error) {
        if (!current()) return;
        this.setData({ actionPending: false, navigationError: "项目创建失败，请稍后重试。" });
      }
      return;
    }
    const previousProjects = projectModel.getProjects();
    const id = `PJ-${Date.now().toString().slice(-8)}`;
    projectModel.upsertProject(projectModel.deriveProjectDraft(id));
    this.setData({ navigationError: "" });
    wx.navigateTo({
      url: `/pages/brief/index?id=${id}&new=1`,
      fail: (error) => {
        projectModel.saveProjects(previousProjects);
        this.setData({ navigationError: error.errMsg || "navigateTo failed" });
      }
    });
  }
});

module.exports = { PROJECT_ID, buildProject, decorate };
