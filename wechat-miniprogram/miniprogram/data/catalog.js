const { providers: sourceProviders, filterOptions, allWorks: sourceAllWorks } = require("./v063");

const providers = sourceProviders.map((provider) => {
  const firstService = provider.services[0];
  return Object.assign({}, provider, { price: firstService.price, unit: firstService.unit });
});

const filters = Object.keys(filterOptions).reduce((result, career) => {
  result[career] = filterOptions[career].reduce((values, group) => values.concat(group.values), []);
  return result;
}, {});

function allWorks() {
  return sourceAllWorks().map((entry) => Object.assign({}, entry, {
    provider: providers.find((item) => item.id === entry.provider.id)
  }));
}
function findProvider(id) { return providers.find((provider) => provider.id === Number(id)); }
function findWork(id) { return allWorks().find((work) => work.id === id); }

module.exports = { providers, filters, filterOptions, allWorks, findProvider, findWork };
