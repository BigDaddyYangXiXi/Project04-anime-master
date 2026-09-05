const store = require("./v063-store");

const PROJECTS_KEY = "animeMasterProjects";
const EXECUTION_STAGES = ["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"];

function buyerOrders() {
  return store.getOrders().filter((order) => order.buyerId === store.CURRENT_BUYER_ID && order.stage !== "DECLINED");
}

function orderDate(order) {
  const draft = order.bookingDraft || {};
  return draft.startDate || draft.date || String(order.time || "").match(/\d{4}[/-]\d{2}[/-]\d{2}/)?.[0]?.replace(/\//g, "-") || "";
}

function projectSubject(orders) {
  const reference = orders.map((order) => String(order.reference || "")).find((value) => value && value !== "未提供参考资料");
  return reference ? reference.split(/[·　]/)[0].trim() : "";
}

function deriveProjectDraft(id, orders = buyerOrders()) {
  const sorted = orders.slice().sort((left, right) => (right.requestedAt || 0) - (left.requestedAt || 0));
  const latest = sorted[0] || {};
  const subject = projectSubject(sorted);
  const descriptions = [...new Set(sorted.flatMap((order) => {
    const requirement = String(order.requirement || (order.bookingDraft || {}).note || "").trim();
    const services = (order.serviceItems || []).map((item) => item.name).filter(Boolean).join("、") || order.service || "";
    const reference = String(order.reference || "").trim();
    return [
      services ? `服务内容：${services}` : "",
      requirement ? `需求说明：${requirement}` : "",
      reference && reference !== "未提供参考资料" ? `参考信息：${reference}` : ""
    ].filter(Boolean);
  }))];
  const date = orderDate(latest);
  const city = latest.city || (latest.bookingDraft || {}).city || "";
  return {
    id,
    title: subject ? `${subject}合作项目` : "未命名项目",
    shortTitle: subject ? `${subject}项目` : "未命名项目",
    date,
    dateLabel: date ? date.slice(5).replace("-", " / ") : "待定",
    city,
    location: city ? `${city} · 具体地点待确认` : "",
    description: descriptions.join("\n"),
    targetImages: [],
    sourceOrderIds: sorted.map((order) => order.id),
    bookingIds: [],
    briefSaved: false,
    completed: false,
    projectModelVersion: 2,
    createdAt: Date.now()
  };
}

function normalizeProject(project, orders = buyerOrders()) {
  const derived = deriveProjectDraft(project.id, orders);
  const legacySample = project.sample && (
    !project.projectModelVersion ||
    project.shortTitle === "绮罗计划" ||
    /摄影棚\s*B\s*馆/.test(String(project.location || (project.brief || {}).location || ""))
  );
  if (legacySample) {
    return Object.assign({}, derived, {
      sample: true,
      completed: Boolean(project.completed),
      briefSaved: false,
      bookingIds: [],
      brief: {
        date: derived.date,
        city: derived.city,
        location: derived.location,
        description: derived.description
      }
    });
  }
  const oldBrief = project.brief || {};
  const description = project.description || oldBrief.description || [oldBrief.photoTask, oldBrief.makeupTask].filter(Boolean).join("；") || derived.description;
  const next = Object.assign({}, derived, project, {
    bookingIds: project.bookingIds || [],
    targetImages: Array.isArray(project.targetImages) ? project.targetImages.filter(Boolean).slice(0, 6) : [],
    description,
    projectModelVersion: 2
  });
  next.brief = Object.assign({}, oldBrief, {
    date: oldBrief.date || next.date,
    city: oldBrief.city || next.city,
    location: oldBrief.location || next.location,
    description
  });
  next.date = next.brief.date;
  next.city = next.brief.city;
  next.location = next.brief.location;
  next.dateLabel = next.date ? next.date.slice(5).replace("-", " / ") : "待定";
  return next;
}

function getProjects() {
  return (wx.getStorageSync(PROJECTS_KEY) || []).map((project) => normalizeProject(project));
}

function saveProjects(projects) {
  wx.setStorageSync(PROJECTS_KEY, projects);
  return projects;
}

function upsertProject(project) {
  const projects = getProjects();
  const normalized = normalizeProject(project);
  const index = projects.findIndex((item) => item.id === project.id);
  if (index >= 0) projects[index] = normalized;
  else projects.unshift(normalized);
  saveProjects(projects);
  return normalized;
}

function linkOrder(projectId, orderId) {
  if (!projectId || !orderId) return null;
  const order = buyerOrders().find((item) => item.id === orderId);
  if (!order || !EXECUTION_STAGES.includes(order.stage)) return null;
  const projects = getProjects();
  const index = projects.findIndex((item) => item.id === projectId);
  if (index < 0) return null;
  projects[index] = Object.assign({}, projects[index], { bookingIds: [...new Set([...(projects[index].bookingIds || []), orderId])] });
  saveProjects(projects);
  return projects[index];
}

function unlinkOrder(projectId, orderId) {
  if (!projectId || !orderId) return null;
  const projects = getProjects();
  const index = projects.findIndex((item) => item.id === projectId);
  if (index < 0 || !(projects[index].bookingIds || []).includes(orderId)) return null;
  projects[index] = Object.assign({}, projects[index], {
    bookingIds: projects[index].bookingIds.filter((id) => id !== orderId)
  });
  saveProjects(projects);
  return projects[index];
}

module.exports = { PROJECTS_KEY, EXECUTION_STAGES, buyerOrders, deriveProjectDraft, normalizeProject, getProjects, saveProjects, upsertProject, linkOrder, unlinkOrder };
