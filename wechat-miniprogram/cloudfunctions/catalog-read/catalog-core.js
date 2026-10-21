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

function argumentInteger(value, field, minimum = 0) {
  try {
    if (!["number", "string"].includes(typeof value) || typeof value === "string" && !value.trim()) throw new Error();
    return dbInteger(value, field, minimum);
  } catch {
    const error = new Error(`${field} is invalid`); error.code = "INVALID_ARGUMENT"; throw error;
  }
}

function group(items, key) {
  return items.reduce((result, item) => {
    const value = item[key];
    (result[value] ||= []).push(item);
    return result;
  }, Object.create(null));
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
  const mode = event.mode == null ? "people" : event.mode;
  if (mode !== "works" && mode !== "people") { const error = new Error("mode is invalid"); error.code = "INVALID_ARGUMENT"; throw error; }
  const pageUnit = event.pageUnit == null ? 'provider' : event.pageUnit;
  if (!['provider', 'work'].includes(pageUnit) || pageUnit === 'work' && mode !== 'works') { const error = new Error('page unit is invalid'); error.code = 'INVALID_ARGUMENT'; throw error; }
  const cityCode = String(event.cityCode || "").trim();
  if (!/^\d{6}$/.test(cityCode) || cityCode !== canonicalCityCode(cityCode)) { const error = new Error("cityCode must identify a city"); error.code = "INVALID_ARGUMENT"; throw error; }
  const career = publicText(event.career, 20, "career");
  const keyword = publicText(event.query, 80, "query").toLocaleLowerCase("zh-CN");
  const rawGroups = event.tagGroups == null
    ? (event.tags == null ? [] : [event.tags])
    : event.tagGroups;
  if (!Array.isArray(rawGroups) || rawGroups.length > 10 || rawGroups.some((items) => !Array.isArray(items) || items.length > 10)) { const error = new Error("tagGroups is invalid"); error.code = "INVALID_ARGUMENT"; throw error; }
  const tagGroups = rawGroups.map((items) => [...new Set(items.map((tag) => publicText(tag, 80, "tag")).filter(Boolean))]).filter((items) => items.length);
  const priceMinFen = event.priceMinFen == null ? null : argumentInteger(event.priceMinFen, "minimum price");
  const priceMaxFen = event.priceMaxFen == null ? null : argumentInteger(event.priceMaxFen, "maximum price");
  if (priceMinFen != null && priceMaxFen != null && priceMinFen > priceMaxFen) { const error = new Error("price range is invalid"); error.code = "INVALID_ARGUMENT"; throw error; }
  const limit = event.limit == null ? 20 : argumentInteger(event.limit, "limit", 1);
  if (limit > 50) { const error = new Error("limit is invalid"); error.code = "INVALID_ARGUMENT"; throw error; }
  const offset = event.cursor == null || event.cursor === "" ? 0 : argumentInteger(event.cursor, "cursor");
  return { mode, pageUnit, cityCode, career, keyword, tagGroups, priceMinFen, priceMaxFen, date: publicDate(event.date), limit, offset };
}

function discoveryPage(providers, options) {
  let page, total;
  if (options.pageUnit === 'work') {
    const entries = providers.flatMap(provider => provider.works.map(work => ({ provider, work })));
    total = entries.length;
    const grouped = new Map();
    for (const { provider, work } of entries.slice(options.offset, options.offset + options.limit)) {
      if (!grouped.has(provider.id)) grouped.set(provider.id, { ...provider, works: [] });
      grouped.get(provider.id).works.push(work);
    }
    page = [...grouped.values()];
  } else { total = providers.length; page = providers.slice(options.offset, options.offset + options.limit); }
  const count = options.pageUnit === 'work' ? page.reduce((sum, provider) => sum + provider.works.length, 0) : page.length;
  return { providers: page, total, nextCursor: options.offset + count < total ? String(options.offset + count) : null };
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
  if (options.date) orderRows.filter((row) => new Set(["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING", "COMPLETED"]).has(row.stage)).forEach((row) => {
    const payload = parsePayload(row.payload); const segments = payload && payload.public && payload.public.timeSegments || [];
    if (payload && payload.public && ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(row.stage)
      && payload.public.ndaFlowVersion === 2 && payload.public.communicationDone === false) return;
    if (segments.some((segment) => options.date >= dateForTimestamp(segment.startsAt) && options.date <= dateForTimestamp(Math.max(segment.startsAt, Number(segment.endsAt) - 1)))) locked.add(row.provider_id);
  });
  return catalog.providers.flatMap((provider) => {
    if (options.career && provider.career !== options.career) return [];
    if (locked.has(provider.id)) return [];
    const availability = availabilityByProvider[provider.id];
    const availabilityState = !options.date ? "UNSPECIFIED" : availability && (availability.openDates || []).includes(options.date) ? "OPEN" : "UNKNOWN";
    const matchedWorkIds = new Set();
    const priceMatches = price => (options.priceMinFen == null || price >= options.priceMinFen)
      && (options.priceMaxFen == null || price <= options.priceMaxFen);
    const matchedServices = (provider.services || []).flatMap((service) => {
      const location = serviceLocation(service, provider, options.cityCode);
      if (!location || options.mode !== "works" && !priceMatches(service.priceFen)) return [];
      const serviceWorks = (provider.works || []).filter((work) => work.serviceId === service.id);
      if (options.mode === "works") {
        const matches = serviceWorks.filter(work => {
          const tags = new Set([...(provider.tags || []), ...(work.tags || [])].map(tag => tag.toLocaleLowerCase("zh-CN")));
          return priceMatches(service.priceFen) && (!options.keyword || matchingText(provider, service, [work]).includes(options.keyword))
            && options.tagGroups.every(group => group.some(tag => tags.has(tag.toLocaleLowerCase("zh-CN"))));
        });
        if (!matches.length) return [];
        matches.forEach(work => matchedWorkIds.add(work.id));
        return [{ ...service, locationMatch: location.type, locationRank: location.rank }];
      }
      const text = matchingText(provider, service, serviceWorks);
      if (options.keyword && !text.includes(options.keyword)) return [];
      if (options.tagGroups.length && !options.tagGroups.every((group) => group.some((tag) => text.includes(tag.toLocaleLowerCase("zh-CN"))))) return [];
      return [{ ...service, locationMatch: location.type, locationRank: location.rank }];
    });
    if (!matchedServices.length) return [];
    const serviceIds = new Set(matchedServices.map((service) => service.id));
    const works = (provider.works || []).filter((work) => serviceIds.has(work.serviceId)
      && (options.mode !== "works" || matchedWorkIds.has(work.id)));
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
  const metrics = Object.create(null);
  const references = Object.create(null);
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
    if (value.buyerAgreementConfirmedAt && value.referenceWorkId) {
      const providerReferences = references[row.provider_id] ||= Object.create(null);
      providerReferences[value.referenceWorkId] = (providerReferences[value.referenceWorkId] || 0) + 1;
    }
  });
  const providers = catalog.providers.map((provider) => {
    const metric = metrics[provider.id] || { completedOrders: 0, ratingTotal: 0, ratingCount: 0, responseTotalMs: 0, responseCount: 0 };
    const providerReferences = references[provider.id] || Object.create(null);
    const works = (provider.works || []).map((work) => ({ ...work, referenceCount: Math.max(Number(work.referenceCount || 0), providerReferences[work.id] || 0) }));
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

function publicationPayload(publication) {
  const payload = parsePayload(publication.payload);
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const optionalArray = value => value == null || Array.isArray(value);
  if (!object(payload) || !object(payload.profile) || !Array.isArray(payload.services) || !Array.isArray(payload.works)
    || !optionalArray(payload.pinnedWorkIds)
    || payload.services.some(service => !object(service) || !optionalArray(service.workIds)
      || !optionalArray(service.serviceAreas) || (service.serviceAreas || []).some(area => !object(area)))
    || payload.works.some(work => !object(work) || !optionalArray(work.imageAssetIds))) return null;
  try {
    dbTime(publication.published_at, "publication timestamp");
    dbInteger(publication.publication_version, "publication version", 1);
    dbInteger(publication.draft_version, "draft version", 1);
    payload.services.forEach(service => dbInteger(service.priceFen, "service price"));
    payload.works.forEach(work => {
      if (work.priceFen != null) dbInteger(work.priceFen, "work price");
      dbInteger(work.referenceCount, "work reference count");
    });
  } catch (error) {
    if (error.code !== "DATABASE_OPERATION_FAILED") throw error;
    return null;
  }
  return payload;
}

async function resolvePublicationMedia(db, providers) {
  const snapshots = providers.filter(provider => Object.hasOwn(provider, 'draftVersion'));
  const assetIds = [...new Set(snapshots.flatMap(provider => [provider.avatarAssetId, provider.noticeImageAssetId, provider.bannerAssetId,
    ...provider.works.flatMap(work => work.imageAssetIds)].filter(Boolean)))];
  const media = assetIds.length ? rows(await db.from("media_assets")
    .select("id,owner_account_id,purpose,storage_key").in("id", assetIds).eq("status", "READY"), "read publication media") : [];
  const mediaById = new Map(media.map(item => [item.id, item]));
  const file = (assetId, owner, purpose) => {
    const item = mediaById.get(assetId);
    return item && item.owner_account_id === owner && item.purpose === purpose
      && String(item.storage_key || '').startsWith('cloud://') ? item.storage_key : null;
  };
  for (const provider of snapshots) {
    provider.avatarFileId = file(provider.avatarAssetId, provider.id, 'AVATAR');
    provider.noticeImageFileId = file(provider.noticeImageAssetId, provider.id, 'NOTICE_IMAGE');
    provider.bannerFileId = file(provider.bannerAssetId, provider.id, 'PROVIDER_BANNER');
    for (const work of provider.works) work.imageFileIds = work.imageAssetIds.map(id => file(id, provider.id, 'WORK_IMAGE')).filter(Boolean);
  }
}

async function loadPublicationCatalog(db, providerId, deferMedia = false) {
  let query = db.from("provider_catalog_publications")
    .select("provider_id,payload,draft_version,publication_version,published_at");
  if (providerId) query = query.eq("provider_id", providerId);
  const publications = rows(
    await query,
    "read publication snapshots"
  );
  if (!publications.length) return null;

  const providerIds = publications.map((item) => item.provider_id);
  const accounts = rows(
    await db.from("accounts").select("id,uid,nickname,avatar_asset_id").in("id", providerIds).eq("status", "ACTIVE"),
    "read publication accounts"
  );
  const accountsById = Object.fromEntries(accounts.map((item) => [item.id, item]));
  const records = publications.map((publication) => ({ publication, payload: publicationPayload(publication) }));
  const providers = [];
  const publicWorks = [];

  records.forEach(({ publication, payload }) => {
    const account = accountsById[publication.provider_id];
    if (!account || !payload || !payload.profile || !Array.isArray(payload.services) || !Array.isArray(payload.works)) return;

    const serviceByWork = Object.create(null);
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
      creditCoser: work.creditCoser || "",
      creditPhoto: work.creditPhoto || "",
      creditMakeup: work.creditMakeup || "",
      creditRetouch: work.creditRetouch || "",
      creditMine: work.creditMine || "",

      priceFen: work.priceFen == null ? null : dbInteger(work.priceFen, "work price"),
      description: work.description,
      tone: work.tone,
      referenceCount: dbInteger(work.referenceCount, "work reference count"),
      imageAssetIds: Array.isArray(work.imageAssetIds) ? work.imageAssetIds : [],
      imageFileIds: [],
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
      avatarFileId: null,
      career: payload.profile.career,
      city: payload.profile.city,
      cityCode: payload.profile.cityCode || "",
      district: payload.profile.district || "",
      specialties: payload.profile.specialties || "",
      declines: payload.profile.declines || "",
      contactHours: payload.profile.contactHours || "",
      accepting: payload.profile.accepting !== false,
      bio: payload.profile.bio,
      notice: payload.profile.notice,
      noticeImageAssetId: payload.profile.noticeImageAssetId || null,
      bannerAssetId: payload.profile.bannerAssetId || null,
      noticeImageFileId: null,
      tags: Array.isArray(payload.profile.tags) ? payload.profile.tags : [],
      services: payload.services.map((service) => ({
        id: service.id,
        name: service.name,
        priceFen: dbInteger(service.priceFen, "service price"),
        unit: service.unit,
        description: service.description,
        serviceMode: service.serviceMode || "ONSITE",
        includes: service.includes || "",
        extras: service.extras || "",
        preparation: service.preparation || "",
        serviceAreas: Array.isArray(service.serviceAreas) ? service.serviceAreas : []
      })),
      pinnedWorkIds: (payload.pinnedWorkIds || []).filter((workId) => workIds.has(workId)),
      works,
      publishedAt: dbTime(publication.published_at, "publication timestamp"),
      version: dbInteger(publication.publication_version, "publication version", 1),
      draftVersion: dbInteger(publication.draft_version, "draft version", 1)
    });
  });

  if (!deferMedia) await resolvePublicationMedia(db, providers);
  return { providers, works: publicWorks, publicationProviderIds: providerIds };
}

async function readPublishedProfiles(db, providerId) {
  let query = db.from("provider_profiles")
    .select("provider_id,career,city,bio,notice,notice_image_asset_id,published_at,version")
    .eq("publish_status", "PUBLISHED");
  if (providerId) query = query.eq("provider_id", providerId);
  return rows(
    await query,
    "read published profiles"
  );
}

async function loadLegacyPublishedCatalog(db, providerId, excludedProviderIds = new Set(), prefetchedProfiles) {
  const profiles = (prefetchedProfiles || await readPublishedProfiles(db, providerId))
    .filter(profile => !excludedProviderIds.has(profile.provider_id));
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
      creditCoser: work.creditCoser || "",
      creditPhoto: work.creditPhoto || "",
      creditMakeup: work.creditMakeup || "",
      creditRetouch: work.creditRetouch || "",
      creditMine: work.creditMine || "",

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

async function loadPublishedCatalog(db, providerId, deferMedia = false) {
  // List reads overlap independent sources; detail reads still skip legacy when a snapshot exists.
  const [publications, profiles] = providerId
    ? [await loadPublicationCatalog(db, providerId, deferMedia), undefined]
    : await Promise.all([loadPublicationCatalog(db, undefined, deferMedia), readPublishedProfiles(db)]);
  const publishedProviderIds = new Set(publications ? publications.publicationProviderIds : []);
  if (providerId && publishedProviderIds.has(providerId)) return { providers: publications.providers, works: publications.works };
  const legacy = await loadLegacyPublishedCatalog(db, providerId, publishedProviderIds, profiles);
  if (!publications) return legacy;
  const providers = publications.providers.concat(legacy.providers);
  return { providers, works: providers.flatMap((provider) => provider.works || []) };
}

async function applyProviderRestrictions(db, catalog) {
  const qualifications = catalog.providers.length ? rows(await db.from("provider_qualifications")
    .select("provider_id,status").in("provider_id", catalog.providers.map(provider => provider.id)), "read provider restrictions") : [];
  const qualificationById = new Map(qualifications.map(item => [item.provider_id, item]));
  const states = catalog.providers.length ? rows(await db.from("provider_availability").select("provider_id,payload").in("provider_id", catalog.providers.map(provider => provider.id)), "read accepting state") : [];
  const stateById = new Map(states.map(row => [row.provider_id, parsePayload(row.payload)]));
  catalog.providers.forEach(provider => {
    const qualification = qualificationById.get(provider.id);
    const accepting = stateById.get(provider.id)?.accepting;
    provider.accepting = (typeof accepting === "boolean" ? accepting : provider.accepting !== false) && (!qualification || qualification.status !== "SUSPENDED");
  });
}

async function readCatalog(db, event = {}, dependencies = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    const error = new Error("request must be an object"); error.code = "INVALID_ARGUMENT"; throw error;
  }
  const action = event.action || "listProviders";
  if (!new Set(["listProviders", "listDiscovery", "getProvider", "getWork"]).has(action)) {
    const error = new Error("action is not supported");
    error.code = "INVALID_ACTION";
    throw error;
  }

  // Reject invalid detail/filter input before doing any database work.
  const providerId = action === "getProvider" || action === "getWork" && event.providerId !== undefined
    ? safeId(event.providerId, "providerId") : undefined;
  const workId = action === "getWork" ? safeId(event.workId, "workId") : undefined;
  const options = action === "listDiscovery" ? discoveryOptions(event) : undefined;
  const catalog = await loadPublishedCatalog(db, providerId, action === 'listDiscovery');
  if (action === "listProviders") {
    await applyProviderRestrictions(db, catalog);
    return { providers: catalog.providers };
  }
  if (action === "listDiscovery") {
    // Apply non-calendar criteria before fetching private order payloads.
    const candidates = { providers: applyDiscovery(catalog, { ...options, date: "" }) };
    const providerIds = candidates.providers.map((provider) => provider.id);
    const [availability, orders] = providerIds.length ? await Promise.all([
      options.date ? db.from("provider_availability").select("provider_id,payload").in("provider_id", providerIds).then((result) => rows(result, "read discovery availability")) : Promise.resolve([]),
      db.from("order_aggregates").select("provider_id,stage,payload,created_at").in("provider_id", providerIds).then((result) => rows(result, "read discovery orders")),
      applyProviderRestrictions(db, candidates)
    ]) : [[], []];
    const matched = applyDiscovery(enrichCatalogMetrics(candidates, orders), options, availability, orders).filter(provider=>event.serviceableOnly !== true || provider.accepting !== false);
    if(event.nearest === true && options.offset === 0 && !matched.some(provider => provider.works.length)) {
      const alternatives={providers:catalog.providers.filter(provider=>provider.career===options.career && provider.accepting!==false)};
      if(alternatives.providers.some(provider=>provider.works.length)) {
        await applyProviderRestrictions(db, alternatives);
        alternatives.providers=alternatives.providers.filter(provider=>provider.accepting===true);
        const ids=alternatives.providers.filter(provider=>provider.works.length).map(provider=>provider.id);
        if(ids.length && typeof dependencies.resolveCities === 'function') {
          let cities;
          try { cities=await dependencies.resolveCities(); } catch (_) { return {providers:[],nextCursor:null,total:0,nearbyUnavailable:true}; }
          const codes=new Set(alternatives.providers.flatMap(provider=>[provider.cityCode,...provider.services.flatMap(service=>(service.serviceAreas||[]).map(area=>area.cityCode))]).filter(Boolean));
          let ranked;
          try { ranked=require('./nearby-cities').nearestCities(cities,options.cityCode,codes); } catch (_) { return {providers:[],nextCursor:null,total:0,nearbyUnavailable:true}; }
          const [nearAvailability,nearOrders]=await Promise.all([
            options.date ? db.from('provider_availability').select('provider_id,payload').in('provider_id',ids).then(result=>rows(result,'read nearby availability')) : Promise.resolve([]),
            db.from('order_aggregates').select('provider_id,stage,payload,created_at').in('provider_id',ids).then(result=>rows(result,'read nearby orders'))
          ]);
          const enriched=enrichCatalogMetrics(alternatives,nearOrders);
          for(const region of ranked){
            const nearby=applyDiscovery(enriched,{...options,cityCode:region.cityCode},nearAvailability,nearOrders);
            if(!nearby.some(provider=>provider.works.length))continue;
            const page=discoveryPage(nearby,options);
            await resolvePublicationMedia(db, page.providers);
            const {cityCode,cityName,provinceName,districtName}=region;
            return {...page,region:{cityCode,cityName,provinceName,districtName},fallbackFrom:options.cityCode};
          }
        }
      }
    }
    const page = discoveryPage(matched, options);
    await resolvePublicationMedia(db, page.providers);
    return page;
  }
  if (action === "getProvider") {
    if (!catalog.providers.length) return { provider: null };
    const [orderResult] = await Promise.all([
      db.from("order_aggregates").select("provider_id,stage,payload,created_at").eq("provider_id", providerId),
      applyProviderRestrictions(db, catalog)
    ]);
    const orders = rows(orderResult, "read provider metrics");
    const provider = enrichCatalogMetrics(catalog, orders).providers.find((item) => item.id === providerId) || null;
    if (provider) provider.reviews = orders.filter((row) => row.stage === "COMPLETED").map((row) => {
      const payload = parsePayload(row.payload);
      const value = payload && payload.public || {};
      return { rating: value.rating, text: String(value.reviewText || ""), reply: String(value.reviewReply || "") };
    }).filter((review) => Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5);
    return { provider };
  }
  const matchingWorks = catalog.works.filter((item) => item.id === workId);
  // Draft-local identifiers are not a global ownership index. Never resolve an
  // observed collision by returning whichever author's snapshot arrived first.
  if (matchingWorks.length > 1) return { work: null };
  const rawWork = matchingWorks[0];
  const [orderResult] = await Promise.all([
    rawWork ? db.from("order_aggregates").select("provider_id,stage,payload,created_at").eq("provider_id", rawWork.providerId) : Promise.resolve({ data: [] }),
    applyProviderRestrictions(db, catalog)
  ]);
  const orders = rows(orderResult, "read work metrics");
  const enriched = enrichCatalogMetrics(catalog, orders);
  const work = enriched.works.find((item) => item.id === workId);
  const provider = work && enriched.providers.find((item) => item.id === work.providerId);
  return {
    work: work ? { ...work, provider: provider || null, service: provider && provider.services.find((item) => item.id === work.serviceId) || null } : null
  };
}

module.exports = { applyDiscovery, discoveryOptions, enrichCatalogMetrics, loadPublishedCatalog, loadPublicationCatalog, loadLegacyPublishedCatalog, readCatalog, safeId, serviceLocation };
