const { findProvider, findWork } = require("../../data/catalog");
const { availability } = require("../../data/v063");
const store = require("../../data/v063-store");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudOrders = require("../../services/cloud-orders");
const cloudAccount = require("../../services/cloud-account");
const { mapCloudCatalog } = require("../../data/cloud-public-catalog");
const { pickerRegion } = require("../../utils/discovery-region");
const { getDiscoveryContext } = require("../../data/discovery-context");

function dateTimeValue(date, time) {
  return new Date(`${date}T${time}:00`).getTime();
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const result = [];
  for (let current = start.getTime(); current <= end.getTime(); current += 86400000) result.push(formatLocalDate(new Date(current)));
  return result;
}

function isFullDate(providerId, date) {
  const fullDays = (availability[providerId] || { full: [] }).full;
  return date.startsWith("2026-08-") && fullDays.includes(Number(date.slice(-2)));
}

function hasOverlap(segments) {
  const ranges = segments.map((item) => ({
    start: dateTimeValue(item.startDate, item.startTime),
    end: dateTimeValue(item.endDate, item.endTime)
  })).sort((left, right) => left.start - right.start);
  return ranges.some((item, index) => index > 0 && item.start < ranges[index - 1].end);
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function serviceLocation(service, provider, cityCode) {
  const mode = service.serviceMode || "ONSITE";
  const local = provider.cityCode === cityCode;
  const covered = (service.serviceAreas || []).some((area) => area.cityCode === cityCode);
  if (mode === "ONLINE") return { available: true, text: "线上服务" };
  if (mode === "BOTH") return local || covered
    ? { available: true, text: "当前城市可到场，也可线上" }
    : { available: true, text: "当前城市仅支持线上" };
  if (local) return { available: true, text: "常驻城市到场服务" };
  if (covered) return { available: true, text: "服务范围内到场服务" };
  return { available: false, text: "该服务暂不覆盖当前城市" };
}

Page({
  data: {
    provider: null,
    work: null,
    selectedServices: [],
    selectedServiceText: "",
    displayedTotal: 0,
    city: "",
    cityCode: "",
    timeMode: "continuous",
    timeModes: [{ id: "day", label: "全天" }, { id: "continuous", label: "连续时段" }, { id: "segments", label: "多个时段" }],
    minDate: "",
    date: "",
    startDate: "",
    startTime: "06:30",
    endDate: "",
    endTime: "09:00",
    segments: [],
    contact: { name: "", wechat: "", phone: "" },
    note: "",
    referenceMode: "none",
    referenceFile: null,
    message: "",
    timeError: "",
    timeValid: false,
    serviceValid: false,
    contactNameValid: false,
    contactMethodValid: false,
    contactValid: false,
    noteValid: false,
    validationIssues: [],
    showValidationErrors: false,
    canSubmit: false,
    submitting: false,
    loadingProvider: false
  },

  onLoad(options) {
    this.bookingOptions = options;
    this.cloudMode = options.audit !== "1";
    this.auditConflict = options.audit === "1" && options.conflict === "1";
    this.requestIdempotencyKey = cloudOrders.idempotencyKey();
    if (this.cloudMode) {
      this.loadCloudBooking(options);
      return;
    }
    const repeatOrder = options.repeatOrderId ? store.findOrder(options.repeatOrderId) : null;
    const catalogProvider = findProvider(repeatOrder && repeatOrder.stage === "DECLINED" ? repeatOrder.providerId : options.providerId);
    this.initializeBooking(options, repeatOrder, catalogProvider);
  },

  async loadCloudBooking(options) {
    this.setData({ loadingProvider: true, message: "" });
    try {
      const [repeatOrder, preferenceResult] = await Promise.all([
        options.repeatOrderId ? cloudOrders.getOrder(options.repeatOrderId) : Promise.resolve(null),
        cloudAccount.getDiscoveryPreference()
      ]);
      const providerId = repeatOrder && repeatOrder.stage === "DECLINED" && repeatOrder.viewerRole === "BUYER"
        ? repeatOrder.providerId : options.providerId;
      const result = await cloudCatalog.getProvider(providerId);
      const provider = result.provider && mapCloudCatalog([result.provider]).providers[0];
      this.initializeBooking(options, repeatOrder, provider, preferenceResult && preferenceResult.preference);
      this.setData({ loadingProvider: false });
    } catch (error) {
      this.setData({ loadingProvider: false, provider: null, message: this.orderErrorMessage(error) });
    }
  },

  retryLoad() { if (this.cloudMode) this.loadCloudBooking(this.bookingOptions); },

  initializeBooking(options, repeatOrder, catalogProvider, discoveryPreference) {
    const repeatDraft = repeatOrder && repeatOrder.stage === "DECLINED"
      && (repeatOrder.cloudOrder ? repeatOrder.viewerRole === "BUYER" : repeatOrder.buyerId === store.CURRENT_BUYER_ID)
      ? repeatOrder.bookingDraft : null;
    if (!catalogProvider) {
      wx.showToast({ title: "没有找到服务者", icon: "none" });
      return;
    }
    const isCurrent = catalogProvider.id === store.CURRENT_PROVIDER_ID;
    const profile = isCurrent ? store.getProfile() : null;
    const servicesSource = isCurrent ? store.getServices() : catalogProvider.services;
    const worksSource = isCurrent ? store.getWorks() : catalogProvider.works;
    const provider = Object.assign({}, catalogProvider, isCurrent ? { name: profile.nickname, city: profile.city, services: servicesSource, works: worksSource } : {});
    const requestedWorkId = repeatDraft ? repeatDraft.workId : options.workId;
    const catalogWork = !this.cloudMode && requestedWorkId ? findWork(requestedWorkId) : null;
    const requestedWork = requestedWorkId
      ? provider.works.find((item) => item.id === requestedWorkId) || (catalogWork && catalogWork.provider.id === provider.id ? catalogWork : null)
      : null;
    if (requestedWorkId && !requestedWork) wx.showToast({ title: "作品与服务者不匹配", icon: "none" });
    const work = requestedWork || provider.works[0] || null;
    const discoveryContext = this.cloudMode ? getDiscoveryContext() : null;
    const region = repeatDraft && repeatDraft.cityCode ? { cityName: repeatDraft.city, cityCode: repeatDraft.cityCode }
      : discoveryContext && discoveryContext.cityCode ? { cityName: discoveryContext.city, cityCode: discoveryContext.cityCode }
      : discoveryPreference && discoveryPreference.cityCode ? { cityName: discoveryPreference.cityName, cityCode: discoveryPreference.cityCode }
      : { cityName: provider.city, cityCode: provider.cityCode || "" };
    const ids = repeatDraft ? repeatDraft.serviceIds : options.services ? decodeURIComponent(options.services).split(",").filter(Boolean) : [provider.services[0].id];
    const services = provider.services.map((service) => {
      const location = this.cloudMode ? serviceLocation(service, provider, region.cityCode) : { available: true, text: "审计夹具服务" };
      return Object.assign({}, service, { availableInCity: location.available, serviceLocationText: location.text, selected: location.available && ids.includes(service.id), priceText: `￥${service.price}` });
    });
    const selectedServices = services.filter((service) => service.selected);
    const today = formatLocalDate(new Date());
    const tomorrow = formatLocalDate(new Date(new Date(`${today}T00:00:00`).getTime() + 86400000));
    const contextDate = discoveryContext && discoveryContext.date;
    const requestedDate = repeatDraft && repeatDraft.date >= today ? repeatDraft.date : options.date && options.date >= today ? options.date : contextDate && contextDate >= today ? contextDate : tomorrow;
    const date = requestedDate;
    const legacyMultiDay = options.mode === "multi-day";
    const timeMode = repeatDraft ? repeatDraft.timeMode : ["day", "continuous", "segments"].includes(options.mode) ? options.mode : "continuous";
    const validFixture = options.fixture === "valid";
    const referenceMode = repeatDraft ? repeatDraft.referenceMode : options.reference === "file" ? "file" : requestedWork ? "work" : "none";
    const repeatStartDate = repeatDraft && repeatDraft.startDate >= today ? repeatDraft.startDate : date;
    const repeatEndDate = repeatDraft && repeatDraft.endDate >= repeatStartDate ? repeatDraft.endDate : repeatStartDate;
    const repeatSegments = repeatDraft && Array.isArray(repeatDraft.segments) && repeatDraft.segments.length && repeatDraft.segments.every((item) => item.startDate >= today)
      ? repeatDraft.segments : [{ id: 1, startDate: date, startTime: "06:30", endDate: date, endTime: "09:00" }];
    this.setData({
      provider: Object.assign({}, provider, { initial: provider.name.slice(0, 1), services }),
      work,
      selectedServices,
      selectedServiceText: selectedServices.map((service) => service.name).join(" + "),
      displayedTotal: selectedServices.reduce((sum, service) => sum + service.price, 0),
      city: region.cityName,
      cityCode: region.cityCode,
      minDate: today,
      timeMode,
      date,
      startDate: repeatDraft ? repeatStartDate : date,
      startTime: repeatDraft ? repeatDraft.startTime : "06:30",
      endDate: repeatDraft ? repeatEndDate : options.invalid === "1" ? date : legacyMultiDay ? formatLocalDate(new Date(dateTimeValue(date, "06:30") + 86400000)) : date,
      endTime: repeatDraft ? repeatDraft.endTime : options.invalid === "1" ? "06:00" : "09:00",
      segments: repeatDraft ? repeatSegments : [{ id: 1, startDate: date, startTime: "06:30", endDate: date, endTime: "09:00" }],
      contact: repeatDraft ? repeatDraft.contact : validFixture ? { name: "阿遥", wechat: "ayao_cos", phone: "" } : this.data.contact,
      note: repeatDraft ? repeatDraft.note : validFixture ? "希望完成夜航者男性角色妆造，保留近景皮肤质感。" : "",
      referenceMode,
      referenceFile: repeatDraft && repeatDraft.referenceFile ? repeatDraft.referenceFile : referenceMode === "file" ? { name: "角色设定参考.png", path: "" } : null
    }, () => this.validate());
  },

  onShow() {
    if (this.submittedOrderId && this.data.submitting) this.setData({ submitting: false });
  },

  updateCity(event) {
    const region = pickerRegion(event.detail);
    if (!region) return wx.showToast({ title: "城市信息读取失败，请重试", icon: "none" });
    const services = this.data.provider.services.map((service) => Object.assign({}, service, {
      availableInCity: !this.cloudMode || serviceLocation(service, this.data.provider, region.cityCode).available,
      serviceLocationText: this.cloudMode ? serviceLocation(service, this.data.provider, region.cityCode).text : service.serviceLocationText,
      selected: false
    }));
    this.setData({ city: region.cityName, cityCode: region.cityCode, provider: Object.assign({}, this.data.provider, { services }), selectedServices: [], selectedServiceText: "", displayedTotal: 0 }, () => this.validate());
  },
  chooseTimeMode(event) { this.setData({ timeMode: event.currentTarget.dataset.mode, message: "" }, () => this.validate()); },
  updateDate(event) { this.setData({ date: event.detail.value }, () => this.validate()); },
  updateStartDate(event) { this.setData({ startDate: event.detail.value }, () => this.validate()); },
  updateStartTime(event) { this.setData({ startTime: event.detail.value }, () => this.validate()); },
  updateEndDate(event) { this.setData({ endDate: event.detail.value }, () => this.validate()); },
  updateEndTime(event) { this.setData({ endTime: event.detail.value }, () => this.validate()); },

  updateSegment(event) {
    const id = Number(event.currentTarget.dataset.id);
    const key = event.currentTarget.dataset.key;
    const segments = this.data.segments.map((segment) => segment.id === id ? Object.assign({}, segment, { [key]: event.detail.value }) : segment);
    this.setData({ segments }, () => this.validate());
  },
  addSegment() {
    this.setData({ segments: this.data.segments.concat({ id: Date.now(), startDate: this.data.startDate, startTime: "13:30", endDate: this.data.startDate, endTime: "16:00" }) }, () => this.validate());
  },
  removeSegment(event) {
    if (this.data.segments.length === 1) return;
    const id = Number(event.currentTarget.dataset.id);
    this.setData({ segments: this.data.segments.filter((segment) => segment.id !== id) }, () => this.validate());
  },

  toggleService(event) {
    const id = event.currentTarget.dataset.id;
    const services = this.data.provider.services.map((service) => service.id === id && service.availableInCity !== false ? Object.assign({}, service, { selected: !service.selected }) : service);
    const selectedServices = services.filter((service) => service.selected);
    this.setData({ provider: Object.assign({}, this.data.provider, { services }), selectedServices, selectedServiceText: selectedServices.map((service) => service.name).join(" + "), displayedTotal: selectedServices.reduce((sum, service) => sum + service.price, 0) }, () => this.validate());
  },

  updateContact(event) {
    const key = event.currentTarget.dataset.key;
    const value = key === "phone" ? event.detail.value.replace(/\D/g, "").slice(0, 11) : event.detail.value;
    this.setData({ [`contact.${key}`]: value }, () => this.validate());
  },
  updateNote(event) { this.setData({ note: event.detail.value }, () => this.validate()); },

  chooseReference(event) {
    const referenceMode = event.currentTarget.dataset.mode;
    this.setData({ referenceMode, referenceFile: referenceMode === "work" ? null : this.data.referenceFile });
  },
  chooseReferenceFile() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], success: (result) => {
      const file = result.tempFiles[0];
      const name = file.tempFilePath.split(/[\\/]/).pop() || "参考图片";
      this.setData({ referenceMode: "file", referenceFile: { name, path: file.tempFilePath } });
    } });
  },
  clearReference() { this.setData({ referenceMode: "none", referenceFile: null }); },

  validate() {
    if (!this.data.provider) return;
    const { timeMode, date, startDate, startTime, endDate, endTime, segments, contact, selectedServices, note } = this.data;
    let timeValid = false;
    let requestedDays = [];
    let timeError = "";
    if (timeMode === "day") {
      timeValid = Boolean(date) && date >= this.data.minDate;
      requestedDays = date ? [date] : [];
      if (!timeValid) timeError = "服务日期不能早于今天。";
    } else if (timeMode === "segments") {
      const allFuture = segments.every((item) => dateTimeValue(item.startDate, item.startTime) >= Date.now());
      const ordered = segments.every((item) => dateTimeValue(item.endDate, item.endTime) > dateTimeValue(item.startDate, item.startTime));
      timeValid = segments.length > 0 && allFuture && ordered && !hasOverlap(segments);
      requestedDays = segments.flatMap((item) => dayRange(item.startDate, item.endDate));
      if (!ordered) timeError = "每段结束时间必须晚于开始时间。";
      else if (!allFuture) timeError = "合作时段不能早于当前时间。";
      else if (hasOverlap(segments)) timeError = "多个合作时段不能互相重叠。";
    } else {
      const duration = dateTimeValue(endDate, endTime) - dateTimeValue(startDate, startTime);
      const startsInFuture = dateTimeValue(startDate, startTime) >= Date.now();
      timeValid = startsInFuture && duration > 0;
      requestedDays = startDate && endDate ? dayRange(startDate, endDate) : [];
      if (!startsInFuture) timeError = "合作开始时间不能早于当前时间。";
      else if (!timeValid) timeError = "结束时间必须晚于开始时间。";
    }
    const containsFullDay = timeValid && (this.auditConflict || !this.cloudMode && requestedDays.some((requestedDate) => isFullDate(this.data.provider.id, requestedDate)));
    if (containsFullDay) timeError = "所选合作时间包含服务方已标记为满客的日期，请更换时间。";
    const contactNameValid = Boolean(contact.name.trim());
    const contactMethodValid = Boolean(contact.wechat.trim() || /^1\d{10}$/.test(contact.phone));
    const contactValid = contactNameValid && contactMethodValid;
    const serviceValid = selectedServices.length > 0;
    const noteValid = note.trim().length >= 10;
    const finalTimeValid = timeValid && !containsFullDay;
    const validationIssues = [];
    if (!finalTimeValid) validationIssues.push(timeError || "选择有效的合作时间");
    if (!serviceValid) validationIssues.push("至少选择一项预约服务");
    if (!contactNameValid) validationIssues.push("填写联系人称呼");
    if (!contactMethodValid) validationIssues.push("填写微信号或有效的 11 位手机号");
    if (!noteValid) validationIssues.push("个性化需求至少填写 10 个字");
    this.setData({
      canSubmit: validationIssues.length === 0,
      timeError,
      timeValid: finalTimeValid,
      serviceValid,
      contactNameValid,
      contactMethodValid,
      contactValid,
      noteValid,
      validationIssues
    });
  },

  async submitBooking() {
    if (this.data.submitting) return;
    if (this.submittedOrderId) {
      this.setData({ submitting: true });
      wx.navigateTo({ url: `/pages/booking-status/index?id=${this.submittedOrderId}`, fail: () => this.setData({ submitting: false, message: "页面跳转失败，请重试；预约不会重复创建。" }) });
      return;
    }
    if (!this.data.canSubmit) {
      this.setData({ showValidationErrors: true, message: "" });
      return;
    }
    this.setData({ submitting: true });
    if (this.cloudMode) {
      try {
        const referenceAssetId = await this.ensureReferenceAsset();
        const order = await cloudOrders.createOrder({
          providerId: this.data.provider.id,
          serviceIds: this.data.selectedServices.map((service) => service.id),
          referenceWorkId: this.data.referenceMode === "work" && this.data.work ? this.data.work.id : undefined,
          referenceAssetId: referenceAssetId || undefined,
          city: this.data.city,
          cityCode: this.data.cityCode,
          location: this.data.city,
          requirement: this.data.note.trim(),
          timeSegments: this.cloudTimeSegments(),
          contact: this.data.contact,
          idempotencyKey: this.requestIdempotencyKey
        });
        this.submittedOrderId = order.id;
        wx.navigateTo({
          url: `/pages/booking-status/index?id=${order.id}`,
          fail: () => this.setData({ submitting: false, message: "页面跳转失败，请重试；预约不会重复创建。" })
        });
      } catch (error) {
        this.setData({ submitting: false, message: this.orderErrorMessage(error) });
      }
      return;
    }
    const index = store.getOrders().length;
    const order = Object.assign(store.makeOrder(`AM-${Date.now().toString().slice(-8)}`, "阿遥", "REQUESTED", index, this.data.provider.career), {
      buyerId: store.CURRENT_BUYER_ID,
      buyerUid: store.CURRENT_BUYER_ID,
      buyer: store.CURRENT_BUYER_NICKNAME,
      providerId: this.data.provider.id,
      providerUid: this.data.provider.handle || String(this.data.provider.id),
      provider: this.data.provider.name,
      service: this.data.selectedServices.map((service) => service.name).join(" + "),
      city: this.data.city,
      cityCode: this.data.cityCode,
      time: this.timeSummary(),
      requirement: this.data.note.trim(),
      reference: this.referenceSummary(),
      referenceImage: this.data.referenceMode === "file" && this.data.referenceFile ? this.data.referenceFile.path : "",
      contact: this.data.contact,
      originalPrice: this.data.displayedTotal,
      finalPrice: this.data.displayedTotal,
      serviceItems: this.data.selectedServices.map((service) => ({
        id: service.id, name: service.name, displayPrice: service.price, finalPrice: service.price
      })),
      requestedAt: Date.now(),
      contactFirstCopiedAt: null,
      buyerAgreementConfirmedAt: null, paymentStatus: "UNPAID", paymentRequest: null,
      paidAt: null, paymentTransactionId: "",
      bookingDraft: {
        providerId: this.data.provider.id, workId: this.data.work ? this.data.work.id : "",
        serviceIds: this.data.selectedServices.map((service) => service.id), city: this.data.city, cityCode: this.data.cityCode,
        timeMode: this.data.timeMode, date: this.data.date, startDate: this.data.startDate, startTime: this.data.startTime,
        endDate: this.data.endDate, endTime: this.data.endTime, segments: this.data.segments,
        contact: this.data.contact, note: this.data.note.trim(), referenceMode: this.data.referenceMode, referenceFile: this.data.referenceFile
      }
    });
    this.submittedOrderId = order.id;
    store.saveOrders([order, ...store.getOrders()]);
    wx.navigateTo({ url: `/pages/booking-status/index?id=${order.id}`, fail: () => this.setData({ submitting: false, message: "页面跳转失败，请重试；预约不会重复创建。" }) });
  },

  cloudTimeSegments() {
    if (this.data.timeMode === "day") {
      const startsAt = dateTimeValue(this.data.date, "00:00");
      return [{ startsAt, endsAt: startsAt + 86400000 }];
    }
    if (this.data.timeMode === "segments") return this.data.segments.map((item) => ({
      startsAt: dateTimeValue(item.startDate, item.startTime),
      endsAt: dateTimeValue(item.endDate, item.endTime)
    }));
    return [{
      startsAt: dateTimeValue(this.data.startDate, this.data.startTime),
      endsAt: dateTimeValue(this.data.endDate, this.data.endTime)
    }];
  },

  async ensureReferenceAsset() {
    if (this.data.referenceMode !== "file" || !this.data.referenceFile) return "";
    let file = this.data.referenceFile;
    if (!file.assetId) {
      const uploaded = await cloudCatalog.uploadImage({ tempFilePath: file.path }, "PROJECT_REFERENCE");
      file = { ...file, assetId: uploaded.assetId, fileId: uploaded.fileId, status: uploaded.status };
      this.setData({ referenceFile: file, message: "参考图片正在完成安全审核…" });
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const result = await cloudCatalog.getImageStatus(file.assetId);
      if (result.status === "READY") {
        this.setData({ referenceFile: { ...file, status: "READY" }, message: "" });
        return file.assetId;
      }
      if (result.status === "REJECTED") {
        const error = new Error("参考图片未通过安全审核，请更换图片");
        error.code = "REFERENCE_MEDIA_REJECTED";
        throw error;
      }
      await wait(1000);
    }
    const error = new Error("参考图片仍在审核，请稍后再次发送预约");
    error.code = "REFERENCE_MEDIA_PENDING";
    throw error;
  },

  orderErrorMessage(error) {
    const messages = {
      PROVIDER_NOT_PUBLISHED: "该服务方的公开橱窗已下线，请返回重新选择。",
      PROVIDER_NOT_AVAILABLE: "该服务方当前不可预约。",
      SERVICE_NOT_PUBLISHED: "所选服务已更新，请刷新后重新选择。",
      SERVICE_CITY_UNAVAILABLE: "所选服务不覆盖当前城市，请更换城市或服务项目。",
      WORK_NOT_PUBLISHED: "引用作品已下线，请清除后重试。",
      REFERENCE_MEDIA_NOT_READY: "参考图片尚未通过安全审核，请稍后重试。",
      REFERENCE_MEDIA_REJECTED: "参考图片未通过安全审核，请更换图片。",
      REFERENCE_MEDIA_PENDING: "参考图片仍在审核，请稍后再次发送预约。",
      SELF_ORDER_NOT_ALLOWED: "不能向自己的服务橱窗发起预约。",
      IDEMPOTENCY_CONFLICT: "预约内容已变化，请返回后重新发起。",
      ACCOUNT_NOT_FOUND: "账号尚未初始化，请返回首页重试。"
    };
    return messages[error && error.code] || "预约发送失败，请稍后重试。";
  },

  timeSummary() {
    if (this.data.timeMode === "day") return `${this.data.date.replace(/-/g, "/")} · 全天`;
    if (this.data.timeMode === "segments") return this.data.segments.map((item) => `${item.startDate.replace(/-/g, "/")} ${item.startTime}—${item.endDate.replace(/-/g, "/")} ${item.endTime}`).join("；");
    return `${this.data.startDate.replace(/-/g, "/")} ${this.data.startTime}—${this.data.endDate.replace(/-/g, "/")} ${this.data.endTime}`;
  },

  referenceSummary() {
    if (this.data.referenceMode === "work" && this.data.work) return `${this.data.work.title} · ${this.data.work.code}`;
    if (this.data.referenceMode === "file" && this.data.referenceFile) return `上传图片：${this.data.referenceFile.name}`;
    return "未提供参考资料";
  }
});
