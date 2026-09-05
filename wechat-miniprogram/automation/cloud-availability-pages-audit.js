const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "miniprogram");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const projects = read("pages/projects/index.js");
const projectsView = read("pages/projects/index.wxml");
const schedule = read("pages/provider-schedule/index.js");
const scheduleView = read("pages/provider-schedule/index.wxml");
const detail = read("pages/provider-detail/index.js");
const client = read("services/cloud-availability.js");

assert.match(client, /availability-api/);
assert.match(client, /getMine/);
assert.match(client, /getPublic/);
assert.match(client, /saveMine/);
assert.match(projects, /cloudAvailability\.getMine/);
assert.match(projects, /cloudAvailability\.saveMine/);
assert.match(projects, /availabilityVersion/);
assert.match(projects, /VERSION_CONFLICT/);
assert.match(projectsView, /calendarLoading/);
assert.match(projectsView, /calendarError/);
assert.match(schedule, /cloudCatalog\.getProvider/);
assert.match(schedule, /cloudAvailability\.getPublic/);
assert.match(schedule, /calendarModel\.todayKey/);
assert.match(scheduleView, /loadError/);
assert.match(detail, /cloudAvailability\.getPublic/);
assert.match(detail, /calendarModel\.upcoming/);

console.log("Cloud availability page audit passed: 16 assertions");
