function pad(value) { return String(value).padStart(2, "0"); }
function dateKey(year, month, day) { return `${year}-${pad(month)}-${pad(day)}`; }
function todayKey(now = new Date()) { return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate()); }
function monthFrom(value, now = new Date()) {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})/);
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  return { year, month, title: `${year} 年 ${month} 月` };
}
function buildMonth({ year, month, openDates = [], lockedDates = [], selectedDate = "", today = todayKey() }) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = (firstWeekday + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const open = new Set(openDates); const locked = new Set(lockedDates);
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - leading + 1;
    const valid = day > 0 && day <= count;
    const date = valid ? dateKey(year, month, day) : "";
    const past = valid && date < today;
    const full = valid && locked.has(date);
    const state = full ? "full" : open.has(date) ? "open" : "unknown";
    return { key: index, value: valid ? day : "", date, valid, past, full, locked: full, open: state === "open", state, label: full ? "满客" : state === "open" ? "可约" : "未公开", selectable: valid && !past && !full, selected: date === selectedDate };
  });
}
function upcoming(openDates, lockedDates, count = 8, today = todayKey()) {
  const open = new Set(openDates); const locked = new Set(lockedDates); const start = new Date(`${today}T00:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start); date.setDate(start.getDate() + index);
    const key = todayKey(date); const state = locked.has(key) ? "full" : open.has(key) ? "open-all" : "unknown";
    return { date: key, day: date.getDate(), weekday: index === 0 ? "今天" : `周${"日一二三四五六"[date.getDay()]}`, state };
  });
}

module.exports = { buildMonth, dateKey, monthFrom, todayKey, upcoming };
