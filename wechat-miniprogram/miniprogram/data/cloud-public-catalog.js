function mapCloudCatalog(sourceProviders) {
  const providers = (sourceProviders || []).map((source) => {
    const services = (source.services || []).map((service) => ({
      id: service.id,
      name: service.name,
      price: Number(service.priceFen || 0) / 100,
      unit: service.unit,
      description: service.description,
      workIds: (source.works || []).filter((work) => work.serviceId === service.id).map((work) => work.id),
      serviceMode: service.serviceMode || "ONSITE",
      serviceAreas: service.serviceAreas || [],
      locationMatch: service.locationMatch || ""
    }));
    const works = (source.works || []).map((work) => ({
      id: work.id,
      code: work.code,
      title: work.title,
      subtitle: work.subtitle,
      tone: work.tone || "coral",
      price: Number(work.priceFen || 0) / 100,
      description: work.description,
      tags: work.tags || [],
      referenceCount: work.referenceCount || 0,
      imagePreviews: work.imageUrls || [],
      imageCount: (work.imageUrls || []).length
    }));
    return {
      id: source.id,
      uid: source.uid,
      name: source.nickname,
      handle: `@${source.uid}`,
      avatar: source.avatarUrl || "",
      career: source.career,
      city: source.city,
      cityCode: source.cityCode || "",
      bio: source.bio,
      notice: source.notice,
      tags: source.tags || [],
      services,
      works,
      orders: Number(source.orders || 0),
      rating: source.rating == null ? null : Number(source.rating),
      reviewCount: Number(source.reviewCount || 0),
      averageResponseMinutes: source.averageResponseMinutes == null ? null : Number(source.averageResponseMinutes),
      responseSampleCount: Number(source.responseSampleCount || 0),
      replyHours: source.averageResponseMinutes == null ? null : Math.round(Number(source.averageResponseMinutes) / 6) / 10,
      price: services[0] ? services[0].price : 0,
      unit: services[0] ? services[0].unit : "",
      discovery: source.discovery || null
    };
  });
  const works = providers.flatMap((provider) => provider.works.map((work) => ({ ...work, provider })));
  return { providers, works };
}

module.exports = { mapCloudCatalog };
