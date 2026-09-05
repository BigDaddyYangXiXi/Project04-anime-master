let current = null;

function setDiscoveryContext(value) {
  if (!value || !/^\d{6}$/.test(String(value.cityCode || ""))) return;
  current = { city: String(value.city || ""), cityCode: String(value.cityCode), date: String(value.date || "") };
}

function getDiscoveryContext() {
  return current ? { ...current } : null;
}

module.exports = { getDiscoveryContext, setDiscoveryContext };
