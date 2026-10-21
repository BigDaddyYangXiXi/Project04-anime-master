const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCities, nearestCities } = require('./nearby-cities');

test('district URL signs its exact request path without exposing the signing secret', () => {
  const url = new URL(require('./nearby-cities').districtUrl('test-key', 'test-secret'));
  assert.equal(url.searchParams.get('sig'), '493aedc61503623e825cd30cb7b9be68');
  assert.equal(url.href.includes('test-secret'), false);
});

test('district data keeps municipalities and cities, excluding ordinary provinces and districts', () => {
  const cities = parseCities({ status: 0, result: [
    [{ id: '310000', fullname: '上海市', location: { lat: 31.2, lng: 121.5 } },
      { id: '320000', fullname: '江苏省', location: { lat: 32, lng: 119 } }],
    [{ id: '320500', fullname: '苏州市', location: { lat: 31.3, lng: 120.6 } },
      { id: '320100', fullname: '南京市', location: { lat: 32, lng: 118.8 } },
      { id: '320501', fullname: '区', location: { lat: 31.3, lng: 120.6 } }]
  ] });
  assert.equal(cities.length, 3);
  assert.equal(cities.find(city => city.cityCode === '320500').provinceName, '江苏省');
  assert.deepEqual(nearestCities(cities, '310000', new Set(['320100', '320500'])).map(city => city.cityCode), ['320500', '320100']);
  assert.throws(() => nearestCities(cities, 'unknown', new Set()));
  assert.throws(() => parseCities({ status: 1 }));
});
