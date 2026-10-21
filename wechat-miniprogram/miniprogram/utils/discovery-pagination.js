const screenPerformance = require('./screen-performance');
const displayCache = require('./display-cache');
const cloudCatalog = require('../services/cloud-catalog');
const cloudAccount = require('../services/cloud-account');
const { mapCloudCatalog } = require('../data/cloud-public-catalog');
const { serverFilters } = require('./discovery-query');
const { setDiscoveryContext } = require('../data/discovery-context');

async function loadDiscoveryPage(page, more = false) {
  if (more && (page.data.catalogLoading || page.data.catalogMoreLoading || !page.data.catalogNextCursor)) return;
  const requestId = page.catalogRequestId = (page.catalogRequestId || 0) + 1;
  const firstContent = more ? () => {} : screenPerformance.begin(page.route === 'pages/search-results/index' ? 'search-results' : 'discovery-home');
  const cursor = more ? page.data.catalogNextCursor : null;
  const { career, date, searchQuery, selectedFilters, cityCode, city } = page.data;
  const owner = displayCache.owner();
  const cacheRevision = displayCache.revision();
  let cachedResult = null;
  let snapshotKey = '';
  const mode = page.data.mode === 'people' ? 'people' : 'works';
  page.setData(more ? { catalogMoreLoading: true, catalogMoreError: '' }
    : { catalogLoading: true, catalogError: '', catalogCacheError: '', catalogNextCursor: null, catalogMoreLoading: false, catalogMoreError: '' });
  try {
    const region = cityCode ? { cityCode, cityName: city } : (await cloudAccount.getDiscoveryPreference()).preference;
    if (requestId !== page.catalogRequestId) return;
    if (!region) throw new Error('city is required');
    page.setData({ city: region.cityName, cityCode: region.cityCode });
    setDiscoveryContext({ city: region.cityName, cityCode: region.cityCode, date });
    const filters = { ...serverFilters(region.cityCode, career, date, searchQuery, selectedFilters), ...(mode === 'works' ? {pageUnit:'work'} : {}), ...(page.route === "pages/discover/index" ? {serviceableOnly:true} : {}) };
    snapshotKey = 'discovery:' + JSON.stringify({ ...filters, mode });
    cachedResult = more ? null : displayCache.read(snapshotKey);
    if (!more && !cachedResult && owner && page.catalogOwner === owner && page.catalogQueryKey === snapshotKey && Array.isArray(page.catalogProviders)) {
      cachedResult = { providers: page.catalogProviders };
    }
    if (cachedResult) {
      page.catalogProviders = cachedResult.providers;
      const mapped = mapCloudCatalog(cachedResult.providers);
      page.marketProviders = mapped.providers;
      page.marketWorks = mapped.works;
      page.setData({ catalogLoading: false, catalogCached: true, catalogNextCursor: null }, () => page.refreshResults(() => { if (requestId === page.catalogRequestId) firstContent("cache"); }));
    } else page.setData({ catalogCached: false });
    const nearest = page.route === "pages/discover/index" && !more && !searchQuery && !selectedFilters.length;
    const result = await cloudCatalog.listDiscovery({ ...filters, mode, ...(nearest ? {nearest:true} : {}), ...(more ? { cursor } : {}) });
    if (requestId !== page.catalogRequestId) return;
    if (owner !== displayCache.owner()) return;
    if (result.region && result.fallbackFrom === region.cityCode) {
      const target=result.region, noun=mode === 'people' ? '老师' : '作品';
      page.setData({city:target.cityName,cityCode:target.cityCode,locationLabel:target.cityName.replace(/市$/, ''),regionValue:[target.provinceName,target.cityName,target.districtName||''],locationMessage:'本地区暂无可服务的'+noun+'，已为您显示最近'+target.cityName+'地区的'+noun});
      setDiscoveryContext({city:target.cityName,cityCode:target.cityCode,date});
      snapshotKey='discovery:'+JSON.stringify({...filters,cityCode:target.cityCode,mode});
    } else if(!more && page.route === 'pages/discover/index') page.setData({locationMessage:result.nearbyUnavailable ? '本地区暂无匹配作品，请选择其他城市。' : ''});
    if (!more) displayCache.write(snapshotKey, result, owner, cacheRevision);
    const providers = new Map((more ? page.catalogProviders || [] : []).map(provider => [provider.id, provider]));
    if (more && mode === 'works' && result.providers.some(provider => providers.has(provider.id) && providers.get(provider.id).version !== provider.version)) {
      return loadDiscoveryPage(page);
    }
    result.providers.forEach(provider => {
      const previous = providers.get(provider.id);
      if (more && mode === 'works' && previous && previous.version === provider.version) {
        const works = new Map((previous.works || []).map(work => [work.id, work]));
        (provider.works || []).forEach(work => works.set(work.id, work));
        providers.set(provider.id, { ...provider, works: [...works.values()] });
      } else providers.set(provider.id, provider);
    });
    page.catalogProviders = [...providers.values()];
    const mapped = mapCloudCatalog(page.catalogProviders);
    page.marketProviders = mapped.providers;
    page.marketWorks = mapped.works;
    page.cloudCatalogLoaded = true;
    if (!more) {
      page.catalogLoadedAt = Date.now();
      page.catalogCacheRevision = cacheRevision;
      page.catalogOwner = owner;
      page.catalogQueryKey = snapshotKey;
    }
    page.setData({ catalogLoading: false, catalogMoreLoading: false, catalogError: '', catalogMoreError: '',
      catalogCached: false, catalogNextCursor: result.nextCursor || null }, () => page.refreshResults(() => { if (requestId === page.catalogRequestId) firstContent("network"); }));
  } catch (_) {
    if (requestId !== page.catalogRequestId || owner !== displayCache.owner()) return;
    if (more) {
      page.setData({ catalogMoreLoading: false, catalogMoreError: '后续结果加载失败，请重试' });
    } else if (cachedResult) {
      page.setData({ catalogLoading: false, catalogCached: true, catalogCacheError: '刷新失败，请稍后重试' });
    } else {
      page.catalogProviders = [];
      page.marketProviders = [];
      page.marketWorks = [];
      page.setData({ catalogLoading: false, catalogError: '公开目录加载失败，请稍后重试' }, () => page.refreshResults());
    }
  }
}

module.exports = { loadDiscoveryPage };
