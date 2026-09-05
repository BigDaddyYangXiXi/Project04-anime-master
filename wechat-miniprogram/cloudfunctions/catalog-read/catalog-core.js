function rows(result, operation) {
  if (result && result.error) {
    const error = new Error(`${operation} failed`);
    error.code = "DATABASE_OPERATION_FAILED";
    throw error;
  }
  return (result && result.data) || [];
}

function safeId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    const error = new Error(`${field} is invalid`);
    error.code = "INVALID_ARGUMENT";
    throw error;
  }
  return value;
}

function dbInteger(value, field, minimum = 0) {
  const normalized = Number(value);
  if (value == null || value === "" || typeof value === "boolean" || !Number.isSafeInteger(normalized) || normalized < minimum) {
    const error = new Error(`${field} is invalid`);
    error.code = "DATABASE_OPERATION_FAILED";
    throw error;
  }
  return normalized;
}

function dbTime(value, field) {
  return dbInteger(value, field, 0);
}

function group(items, key) {
  return items.reduce((result, item) => {
    const value = item[key];
    (result[value] ||= []).push(item);
    return result;
  }, {});
}

function parsePayload(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function publicText(value, maximum, field) {
  if (value == null) return "";
  if (typeof value !== "string") { const error = new Error(`${field} is invalid`); error.code = "INVALID_ARGUMENT"; throw error; }
  const normalized = value.trim();
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) { const error = new Error(`${field} is invalid`); error.code = "INVALID_ARGUMENT"; throw error; }
  return normalized;
}

function publicDate(value) {
  if (value == null || value === "") return "";
  const parsed = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    const error = new Error("date is invalid"); error.code = "INVALID_ARGUMENT"; throw error;
  }
  return value;
}

function dateForTimestamp(value) { return new Date(Number(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }

function canonicalCityCode(value) {
  if (!/^\d{6}$/.test(value)) return "";
  return new Set(["11", "12", "31", "50", "71", "81", "82"]).has(value.slice(0, 2))
    ? `${value.slice(0, 2)}0000`
    : `${value.slice(0, 4)}00`;
}

function discoveryOptions(event) {
  const cityCode = String(event.cityCode || "").trim();
  if (!/^\d{6}$/.test(cityCode) || cityCode !== canonicalCityCode(cityCode)) { const error = new Error("cityCode must identify a city"); error.code = "INVALID_ARGUMENT"; throw error; }
  const career = publicText(event.career, 20, "career");
  const keyword = publicText(event.query, 80, "query").toLocaleLowerCase("zh-CN");
  const rawGroups = event.tagGroups == null
    ? (event.tags == null ? [] : [event.tags])
    : event.tagGroups;
  if (!Array.isArray(rawGroups) || rawGroups.length > 10 || rawGroups.some((items) => !Array.isArray(items) || items.length > 10)) { const error = new Error("tagGroups is invalid"); error.code = "INVALID_ARGUMENT"; throw error; }
  const tagGroups = rawGroups.map((items) => [...new Set(items.map((tag) => publicText(tag, 80, "tag")).filter(Boolean))]).filter((items) => items.length);
  const priceMinFen = event.priceMinFen == null ? null : dbInteger(event.priceMinFen, "minimum price");
  const priceMaxFen = event.priceMaxFen == null ? null : dbInteger(event.priceMaxFen, "maximum price");
  if (priceMinFen != null && priceMaxFen != null && priceMinFen > priceMaxFen) { const error = new Error("price range is invalid"); error.code = "INVALID_ARGUMENT"; throw error; }
  const limit = event.limit == null ? 20 : dbInteger(event.limit, "limit", 1);
  if (limit > 50) { const error = new Error("limit is invalid"); error.code = "INVALID_ARGUMENT"; throw error; }
  const offset = event.cursor == null || event.cursor === "" ? 0 : dbInteger(event.cursor, "cursor");
  return { cityCode, career, keyword, tagGroups, priceMinFen, priceMaxFen, date: publicDate(event.date), limit, offset };
}

function serviceLocation(service, provider, cityCode) {
  const mode = service.serviceMode || "ONSITE";
  const areas = Array.isArray(service.serviceAreas) ? service.serviceAreas : [];
  if ((mode === "ONSITE" || mode === "BOTH") && String(provider.cityCode || "") === cityCode) return { rank: 0, type: "LOCAL" };
  if ((mode === "ONSITE" || mode === "BOTH") && areas.some((area) => String(area.cityCode || "") === cityCode)) return { rank: 1, type: "SERVICE_AREA" };
  if (mode === "ONLINE" || mode === "BOTH") return { rank: 2, type: "ONLINE" };
  return null;
}

function matchingText(provider, service, works) {
  return [provider.nickname, provider.career, provider.bio, ...(provider.tags || []), service.name, service.description, ...works.flatMap((work) => [work.title, work.subtitle, work.description, ...(work.tags || [])])].join(" ").toLocaleLowerCase("zh-CN");
}

function applyDiscovery(catalog, options, availabilityRows = [], orderRows = []) {
  const availabilityByProvider = Object.fromEntries(availabilityRows.map((row) => [row.provider_id, parsePayload(row.payload) || { openDates: [] }]));
  const locked = new Set();
  if (options.date) orderRows.filter((row) => new Set(["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"]).has(row.stage)).forEach((row) => {
    const payload = parsePayload(row.payload); const segments = payload && payload.public && payload.public.timeSegments || [];
    if (segments.some((segment) => options.date >= dateForTimestamp(segment.startsAt) && options.date <= dateForTimestamp(Math.max(segment.startsAt, Number(segment.endsAt) - 1)))) locked.add(row.provider_id);
  });
  return catalog.providers.flatMap((provider) => {
    if (options.career && provider.career !== options.career) return [];
    if (locked.has(provider.id)) return [];
    const availability = availabilityByProvider[provider.id];
    const availabilityState = !options.date ? "UNSPECIFIED" : availability && (availability.openDates || []).includes(options.date) ? "OPEN" : "UNKNOWN";
    const matchedServices = (provider.services || []).flatMap((service) => {
      const location = serviceLocation(service, provider, options.cityCode);
      if (!location || options.priceMinFen != null && service.priceFen < options.priceMinFen || options.priceMaxFen != null && service.priceFen > options.priceMaxFen) return [];
      const serviceWorks = (provider.works || []).filter((work) => work.serviceId === service.id);
      const text = matchingText(provider, service, serviceWorks);
      if (options.keyword && !text.includes(options.keyword)) return [];
      if (options.tagGroups.length && !options.tagGroups.every((group) => group.some((tag) => text.includes(tag.toLocaleLowerCase("zh-CN"))))) return [];
      return [{ ...service, locationMatch: location.type, locationRank: location.rank }];
    });
    if (!matchedServices.length) return [];
    const serviceIds = new Set(matchedServices.map((service) => service.id));
    const works = (provider.works || []).filter((work) => serviceIds.has(work.serviceId));
    const locationRank = Math.min(...matchedServices.map((service) => service.locationRank));
    const availabilityRank = availabilityState === "OPEN" ? 0 : availabilityState === "UNKNOWN" ? 1 : 2;
    return [{ ...provider, services: matchedServices, works, discovery: { cityCode: options.cityCode, locationMatch: matchedServices.find((service) => service.locationRank === locationRank).locationMatch, availabilityState, locationRank, availabilityRank } }];
  }).sort((left, right) => left.discovery.locationRank - right.discovery.locationRank
    || left.discovery.availabilityRank - right.discovery.availabilityRank
    || Number(right.rating || 0) - Number(left.rating || 0)
    || Number(right.reviewCount || 0) - Number(left.reviewCount || 0)
    || Number(right.orders || 0) - Number(left.orders || 0)
    || right.publishedAt - left.publishedAt
    || left.id.localeCompare(right.id));
}

function enrichCatalogMetrics(catalog, orderRows = []) {
  const metrics = {};
  const references = {};
  orderRows.forEach((row) => {
    const payload = parsePayload(row.payload);
    const value = payload && payload.public;
    if (!value) return;
    const metric = metrics[row.provider_id] ||= { completedOrders: 0, ratingTotal: 0, ratingCount: 0, responseTotalMs: 0, responseCount: 0 };
    if (row.stage === "COMPLETED") metric.completedOrders += 1;
    if (row.stage === "COMPLETED" && Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5) { metric.ratingTotal += value.rating; metric.ratingCount += 1; }
    if (Number.isSafeInteger(value.contactFirstCopiedAt) && Number.isSafeInteger(Number(row.created_at)) && value.contactFirstCopiedAt >= Number(row.created_at)) {
      metric.responseTotalMs += value.contactFirstCopiedAt - Number(row.created_at); metric.responseCount += 1;
    }
    if (value.buyerAgreementConfirmedAt && value.referenceWorkId) references[value.referenceWorkId] = (references[value.referenceWorkId] || 0) + 1;
  });
  const providers = catalog.providers.map((provider) => {
    const metric = metrics[provider.id] || { completedOrders: 0, ratingTotal: 0, ratingCount: 0, responseTotalMs: 0, responseCount: 0 };
    const works = (provider.works || []).map((work) => ({ ...work, referenceCount: Math.max(Number(work.referenceCount || 0), references[work.id] || 0) }));
    return {
      ...provider, works, orders: metric.completedOrders,
      rating: metric.ratingCount ? Math.round(metric.ratingTotal / metric.ratingCount * 10) / 10 : null,
      reviewCount: metric.ratingCount,
      averageResponseMinutes: metric.responseCount ? Math.round(metric.responseTotalMs / metric.responseCount / 60000) : null,
      responseSampleCount: metric.responseCount
    };
  });
  return { providers, works: providers.flatMap((provider) => provider.works || []) };
}

async function loadPublicationCatalog(db) {
  const publications = rows(
    await db.from("provider_catalog_publications")
      .select("provider_id,payload,draft_version,publication_version,published_at"),
    "read publication snapshots"
  );
  if (!publications.length) return null;

  const providerIds = publications.map((item) => item.provider_id);
  const accounts = rows(
    await db.from("accounts").select("id,uid,nickname,avatar_asset_id").in("id", providerIds).eq("status", "ACTIVE"),
    "read publication accounts"
  );
  const accountsById = Object.fromEntries(accounts.map((item) => [item.id, item]));
  const records = publications.map((publication) => ({ publication, payload: parsePayload(publication.payload) }));
  const assetIds = [...new Set([
    ...accounts.map((account) => account.avatar_asset_id).filter(Boolean),
    ...records.flatMap(({ payload }) => payload && payload.profile && Array.isArray(payload.works)
    ? [payload.profile.noticeImageAssetId, ...payload.works.flatMap((work) => work.imageAssetIds || [])].filter(Boolean)
    : [])
  ])];
  const media = assetIds.length
    ? rows(
        await db.from("media_assets").select("id,owner_account_id,purpose,storage_key").in("id", assetIds).eq("status", "READY"),
        "read publication media"
      )
    : [];
  const fileByAssetId = Object.fromEntries(media
    .filter((item) => String(item.storage_key || "").startsWith("cloud://"))
    .map((item) => [item.id, item.storage_key]));
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const mediaFile = (assetId, ownerId, purpose) => {
    const item = mediaById.get(assetId);
    return item && item.owner_account_id === ownerId && item.purpose === purpose ? fileByAssetId[assetId] || null : null;
  };
  const providers = [];
  const publicWorks = [];

  records.forEach(({ publication, payload }) => {
    const account = accountsById[publication.provider_id];
    if (!account || !payload || !payload.profile || !Array.isArray(payload.services) || !Array.isArray(payload.works)) return;

    const serviceByWork = {};
    payload.services.forEach((service) => {
      (service.workIds || []).forEach((workId) => { serviceByWork[workId] = service.id; });
    });
    const works = payload.works.map((work) => ({
      id: work.id,
      providerId: publication.provider_id,
      serviceId: serviceByWork[work.id] || null,
      code: work.code,
      title: work.title,
      subtitle: work.subtitle,
      priceFen: dbInteger(work.priceFen, "work price"),
      description: work.description,
      tone: work.tone,
      referenceCount: dbInteger(work.referenceCount, "work reference count"),
      imageAssetIds: Array.isArray(work.imageAssetIds) ? work.imageAssetIds : [],
      imageFileIds: (work.imageAssetIds || []).map((assetId) => mediaFile(assetId, publication.provider_id, "WORK_IMAGE")).filter(Boolean),
      tags: Array.isArray(work.tags) ? work.tags : [],
      publishedAt: dbTime(publication.published_at, "publication timestamp"),
      version: dbInteger(publication.publication_version, "publication version", 1)
    }));
    const workIds = new Set(works.map((work) => work.id));
    publicWorks.push(...works);
    providers.push({
      id: publication.provider_id,
      uid: account.uid,
      nickname: account.nickname,
      avatarAssetId: account.avatar_asset_id,
      avatarFileId: mediaFile(account.avatar_asset_id, publication.provider_id, "AVATAR"),
      career: payload.profile.career,
      city: payload.profile.city,
      cityCode: payload.profile.cityCode || "",
      bio: payload.profile.bio,
      notice: payload.profile.notice,
      noticeImageAssetId: payload.profile.noticeImageAssetId || null,
      noticeImageFileId: mediaFile(payload.profile.noticeImageAssetId, publication.provider_id, "NOTICE_IMAGE"),
      tags: Array.isArray(payload.profile.tags) ? payload.profile.tags : [],
      services: payload.services.map((service) => ({
        id: service.id,
        name: service.name,
        priceFen: dbInteger(service.priceFen, "service price"),
        unit: service.unit,
        description: service.description,
        serviceMode: service.serviceMode || "ONSITE",
        serviceAreas: Array.isArray(service.serviceAreas) ? service.serviceAreas : []
      })),
      pinnedWorkIds: (payload.pinnedWorkIds || []).filter((workId) => workIds.has(workId)),
      works,
      publishedAt: dbTime(publication.published_at, "publication timestamp"),
      version: dbInteger(publication.publication_version, "publication version", 1),
      draftVersion: dbInteger(publication.draft_version, "draft version", 1)
    });
  });

  return { providers, works: publicWorks };
}

async function loadLegacyPublishedCatalog(db) {
  const profiles = rows(
    await db.from("provider_profiles")
      .select("provider_id,career,city,bio,notice,notice_image_asset_id,published_at,version")
      .eq("publish_status", "PUBLISHED"),
    "read published profiles"
  );
  if (!profiles.length) return { providers: [], works: [] };

  const providerIds = profiles.map((item) => item.provider_id);
  const [accountsResult, profileTagsResult, servicesResult, worksResult, pinsResult] = await Promise.all([
    db.from("accounts").select("id,uid,nickname,avatar_asset_id").in("id", providerIds).eq("status", "ACTIVE"),
    db.from("provider_profile_tags").select("provider_id,tag,sort_order").in("provider_id", providerIds),
    db.from("provider_services").select("id,provider_id,name,price_fen,unit,description,sort_order").in("provider_id", providerIds).eq("status", "ACTIVE"),
    db.from("works").select("id,provider_id,code,title,subtitle,price_fen,description,tone,reference_count,published_at,version").in("provider_id", providerIds).eq("status", "PUBLISHED"),
    db.from("provider_pinned_works").select("provider_id,work_id,position").in("provider_id", providerIds)
  ]);

  const accounts = rows(accountsResult, "read provider accounts");
  const profileTags = rows(profileTagsResult, "read provider tags");
  const services = rows(servicesResult, "read provider services");
  const works = rows(worksResult, "read published works");
  const pins = rows(pinsResult, "read pinned works");
  const workIds = works.map((item) => item.id);
  const [workTags, serviceWorks] = workIds.length
    ? await Promise.all([
        db.from("work_tags").select("work_id,tag,sort_order").in("work_id", workIds).then((result) => rows(result, "read work tags")),
        db.from("service_works").select("work_id,service_id,provider_id,sort_order").in("work_id", workIds).then((result) => rows(result, "read service works"))
      ])
    : [[], []];

  const accountsById = Object.fromEntries(accounts.map((item) => [item.id, item]));
  const profileTagsByProvider = group(profileTags, "provider_id");
  const servicesByProvider = group(services, "provider_id");
  const workTagsByWork = group(workTags, "work_id");
  const serviceByWork = Object.fromEntries(serviceWorks.map((item) => [item.work_id, item.service_id]));
  const pinsByProvider = group(pins, "provider_id");

  const publicWorks = works
    .filter((work) => accountsById[work.provider_id])
    .map((work) => ({
      id: work.id,
      providerId: work.provider_id,
      serviceId: serviceByWork[work.id] || null,
      code: work.code,
      title: work.title,
      subtitle: work.subtitle,
      priceFen: dbInteger(work.price_fen, "work price"),
      description: work.description,
      tone: work.tone,
      referenceCount: dbInteger(work.reference_count, "work reference count"),
      tags: (workTagsByWork[work.id] || []).sort((a, b) => a.sort_order - b.sort_order).map((item) => item.tag),
      publishedAt: dbTime(work.published_at, "work publication timestamp"),
      version: dbInteger(work.version, "work version", 1)
    }));
  const worksByProvider = group(publicWorks, "providerId");

  const providers = profiles
    .filter((profile) => accountsById[profile.provider_id])
    .map((profile) => {
      const account = accountsById[profile.provider_id];
      const providerWorks = worksByProvider[profile.provider_id] || [];
      const pinnedIds = (pinsByProvider[profile.provider_id] || [])
        .sort((a, b) => a.position - b.position)
        .map((item) => item.work_id)
        .filter((workId) => providerWorks.some((work) => work.id === workId));
      return {
        id: profile.provider_id,
        uid: account.uid,
        nickname: account.nickname,
        avatarAssetId: account.avatar_asset_id,
        career: profile.career,
        city: profile.city,
        cityCode: profile.city_code || "",
        bio: profile.bio,
        notice: profile.notice,
        noticeImageAssetId: profile.notice_image_asset_id,
        tags: (profileTagsByProvider[profile.provider_id] || []).sort((a, b) => a.sort_order - b.sort_order).map((item) => item.tag),
        services: (servicesByProvider[profile.provider_id] || []).sort((a, b) => a.sort_order - b.sort_order).map((service) => ({
          id: service.id,
          name: service.name,
          priceFen: dbInteger(service.price_fen, "service price"),
          unit: service.unit,
          description: service.description,
          serviceMode: service.service_mode || "ONSITE",
          serviceAreas: []
        })),
        pinnedWorkIds: pinnedIds,
        works: providerWorks,
        publishedAt: dbTime(profile.published_at, "profile publication timestamp"),
        version: dbInteger(profile.version, "profile version", 1)
      };
    });

  return { providers, works: publicWorks };
}

async function loadPublishedCatalog(db) {
  const [publications, legacy] = await Promise.all([loadPublicationCatalog(db), loadLegacyPublishedCatalog(db)]);
  if (!publications) return legacy;
  const publishedProviderIds = new Set(publications.providers.map((provider) => provider.id));
  const providers = publications.providers.concat(legacy.providers.filter((provider) => !publishedProviderIds.has(provider.id)));
  return { providers, works: providers.flatMap((provider) => provider.works || []) };
}

async function readCatalog(db, event = {}) {
  const action = event.action || "listProviders";
  if (!new Set(["listProviders", "listDiscovery", "getProvider", "getWork"]).has(action)) {
    const error = new Error("action is not supported");
    error.code = "INVALID_ACTION";
    throw error;
  }

  const catalog = await loadPublishedCatalog(db);
  if (action === "listProviders") {
    return { providers: catalog.providers };
  }
  if (action === "listDiscovery") {
    const options = discoveryOptions(event);
    const providerIds = catalog.providers.map((provider) => provider.id);
    const [availability, orders] = providerIds.length ? await Promise.all([
      options.date ? db.from("provider_availability").select("provider_id,payload").in("provider_id", providerIds).then((result) => rows(result, "read discovery availability")) : Promise.resolve([]),
      db.from("order_aggregates").select("provider_id,stage,payload,created_at").in("provider_id", providerIds).then((result) => rows(result, "read discovery orders"))
    ]) : [[], []];
    const matched = applyDiscovery(enrichCatalogMetrics(catalog, orders), options, availability, orders);
    const page = matched.slice(options.offset, options.offset + options.limit);
    return { providers: page, nextCursor: options.offset + page.length < matched.length ? String(options.offset + page.length) : null, total: matched.length };
  }
  if (action === "getProvider") {
    const providerId = safeId(event.providerId, "providerId");
    const orders = rows(await db.from("order_aggregates").select("provider_id,stage,payload,created_at").eq("provider_id", providerId), "read provider metrics");
    return { provider: enrichCatalogMetrics(catalog, orders).providers.find((item) => item.id === providerId) || null };
  }
  const workId = safeId(event.workId, "workId");
  const rawWork = catalog.works.find((item) => item.id === workId);
  const orders = rawWork ? rows(await db.from("order_aggregates").select("provider_id,stage,payload,created_at").eq("provider_id", rawWork.providerId), "read work metrics") : [];
  const enriched = enrichCatalogMetrics(catalog, orders);
  const work = enriched.works.find((item) => item.id === workId);
  return {
    work: work ? { ...work, provider: enriched.providers.find((item) => item.id === work.providerId) || null } : null
  };
}

module.exports = { applyDiscovery, discoveryOptions, enrichCatalogMetrics, loadPublishedCatalog, loadPublicationCatalog, loadLegacyPublishedCatalog, readCatalog, safeId, serviceLocation };
