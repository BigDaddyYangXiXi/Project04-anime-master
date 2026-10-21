const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const discover = read("miniprogram/pages/discover/index.js");
const booking = read("miniprogram/pages/booking/index.js");
const providerDetail = read("miniprogram/pages/provider-detail/index.js");
const providerProfile = read("miniprogram/pages/provider-profile/index.js");
const providerProfileWxml = read("miniprogram/pages/provider-profile/index.wxml");
const providerReviews = read("miniprogram/pages/provider-reviews/index.js");
const brief = read("miniprogram/pages/brief/index.js");
const briefWxml = read("miniprogram/pages/brief/index.wxml");
const cloudCatalog = read("miniprogram/services/cloud-catalog.js");
const catalogCore = read("cloudfunctions/catalog-read/catalog-core.js");
const orderCore = read("cloudfunctions/order-api/order-core.js");
const projectCore = read("cloudfunctions/project-api/project-core.js");

assert.match(discover, /const previewRegion = this\.auditMode && localPreview\.isLocal\(\)/);
assert.match(discover, /city: initialRegion \? initialRegion\.cityName : ""/);
assert.match(discover, /const initialRegion = previewRegion \|\| \(this\.auditMode[\s\S]*?cityCode: "330100" \} : null\)/);
assert.match(discover, /date: this\.auditMode \? "2026-08-16" : tomorrowKey\(\)/);
assert.doesNotMatch(discover, /data:\s*\{[\s\S]*?city:\s*"杭州"/);
assert.match(discover, /this\.auditMode \? providers : \[\]/);
assert.match(discover, /listDiscovery\(serverFilters/);

assert.match(booking, /city:\s*""/);
assert.doesNotMatch(booking, /cities:\s*\["杭州"/);
assert.match(booking, /getDiscoveryPreference\(\)/);
assert.match(booking, /当前城市仅支持线上/);
assert.match(booking, /!this\.cloudMode && requestedWorkId \? findWork/);
assert.match(booking, /!this\.cloudMode && requestedDays\.some/);
assert.match(booking, /cityCode: this\.data\.cityCode/);

assert.match(providerDetail, /this\.loadCloudProvider\(options, options\.id\)/);
assert.doesNotMatch(providerDetail, /catalogProvider \|\| catalogProviders\[0\]/);
assert.match(providerDetail, /availableInCity/);
assert.match(providerDetail, /String\(draft\.providerId\) !== String\(expectedProviderId\)/);
assert.match(providerDetail, /if \(this\.auditMode\) \{\s*store\.saveProfile/);
assert.match(providerProfile, /career:\s*""/);
assert.match(providerProfileWxml, /请选择服务职业/);
assert.doesNotMatch(cloudCatalog, /career: profile\.career \|\| "妆娘"/);
assert.match(providerReviews, /const rating = reviews\.length/);
assert.match(providerReviews, /基于 \$\{reviews\.length\} 条已完成订单评价/);

assert.match(briefWxml, /picker mode="date"/);
assert.match(briefWxml, /picker mode="region"/);
assert.match(brief, /cityCode: this\.data\.cityCode/);
assert.match(projectCore, /cityCode/);

assert.match(catalogCore, /function serviceLocation/);
assert.match(catalogCore, /function enrichCatalogMetrics/);
assert.match(catalogCore, /row\.stage === "COMPLETED"/);
assert.match(catalogCore, /loadPublicationCatalog\(db, providerId\)/);
assert.match(catalogCore, /loadLegacyPublishedCatalog\(db, providerId, publishedProviderIds\)/);
assert.match(orderCore, /SERVICE_CITY_UNAVAILABLE/);
assert.match(orderCore, /function serviceSupportsCity/);
assert.match(orderCore, /function serviceLocationMatch/);
assert.match(orderCore, /cityCode must identify a city/);

process.stdout.write("Hardcoded business data audit passed: production facts come from user input, WeChat region data, publications, availability and orders\n");
