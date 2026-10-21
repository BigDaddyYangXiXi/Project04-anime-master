let cache=null,pending=null;
function cityCode(value){const code=String(value||'');return /^\d{6}$/.test(code)&&(code.endsWith('00'))?code:'';}
function parseCities(value){
 if(value?.status!==0||!Array.isArray(value.result))throw Error('city lookup failed');
 const provinces=value.result[0]||[],cities=new Map();
 for(const item of [...provinces,...(value.result[1]||[])]){
  const code=cityCode(item.id),lat=Number(item.location?.lat),lng=Number(item.location?.lng);
  if(!code||!Number.isFinite(lat)||!Number.isFinite(lng))continue;
  if(code.endsWith('0000')&&!['110000','120000','310000','500000','710000','810000','820000'].includes(code))continue;
  const province=provinces.find(p=>String(p.id).slice(0,2)===code.slice(0,2));
  cities.set(code,{cityCode:code,cityName:item.fullname||item.name,provinceName:province?.fullname||province?.name||'',districtName:'',latitude:lat,longitude:lng});
 }
 return [...cities.values()];
}
async function resolveCities(){
 const key=String(process.env.TENCENT_MAP_KEY||'').trim(),secret=String(process.env.TENCENT_MAP_SK||'').trim();if(!key||!secret)throw Error('map service not configured');
 if(cache&&Date.now()-cache.at<15*60*1000)return cache.value;
 if(pending)return pending;
 pending=(async()=>{const response=await fetch(districtUrl(key,secret),{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('city lookup failed');const value=parseCities(await response.json());cache={at:Date.now(),value};return value;})().finally(()=>{pending=null;});return pending;
}
function districtUrl(key,secret){const path='/ws/district/v1/list/';const sig=require('node:crypto').createHash('md5').update(path+'?key='+key+secret).digest('hex');return 'https://apis.map.qq.com'+path+'?key='+encodeURIComponent(key)+'&sig='+sig;}
function distance(a,b){const rad=Math.PI/180,lat=(b.latitude-a.latitude)*rad,lng=(b.longitude-a.longitude)*rad;const h=Math.sin(lat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(lng/2)**2;return 2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
function nearestCities(cities,originCode,codes){const origin=cities.find(c=>c.cityCode===originCode);if(!origin)throw Error('origin city unavailable');return cities.filter(c=>c.cityCode!==originCode&&codes.has(c.cityCode)).sort((a,b)=>distance(origin,a)-distance(origin,b)||a.cityCode.localeCompare(b.cityCode));}
module.exports={parseCities,resolveCities,nearestCities,districtUrl};
