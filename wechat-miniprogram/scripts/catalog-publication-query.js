// Local candidate extraction only; final filtering, media validation and paging remain separate.
function publishedWorkCandidatesQuery(event) {
  const values = [], filters = [];
  if (event) {
    const options = require('../cloudfunctions/catalog-read/catalog-core').discoveryOptions(event);
    if (options.mode !== 'works') { const error = new Error('work candidate query requires works mode'); error.code = 'INVALID_ARGUMENT'; throw error; }
    filters.push(`(links.service_mode COLLATE utf8mb4_0900_bin IN ('ONLINE', 'BOTH')
      OR (links.service_mode COLLATE utf8mb4_0900_bin = 'ONSITE' AND (
        JSON_UNQUOTE(JSON_EXTRACT(p.payload, '$.profile.cityCode')) COLLATE utf8mb4_0900_bin = ?
        OR EXISTS (SELECT 1 FROM JSON_TABLE(
          IF(JSON_TYPE(JSON_EXTRACT(links.service_payload, '$.serviceAreas')) = 'ARRAY',
            JSON_EXTRACT(links.service_payload, '$.serviceAreas'), JSON_ARRAY()),
          '$[*]' COLUMNS (city_code VARCHAR(64) PATH '$.cityCode' NULL ON ERROR)
        ) area WHERE area.city_code COLLATE utf8mb4_0900_bin = ?))))`);
    values.push(options.cityCode, options.cityCode);
    if (options.career) {
      filters.push("JSON_UNQUOTE(JSON_EXTRACT(p.payload, '$.profile.career')) COLLATE utf8mb4_0900_bin = ?");
      values.push(options.career);
    }
    for (const [bound, operator] of [[options.priceMinFen, '>='], [options.priceMaxFen, '<=']]) {
      if (bound != null) {
        filters.push(`CAST(JSON_UNQUOTE(JSON_EXTRACT(p.payload, CONCAT('$.works[', w.work_index - 1, '].priceFen'))) AS DECIMAL(20,0)) ${operator} ?`);
        values.push(bound);
      }
    }
  }
  return { values, sql: `WITH published AS (
    SELECT p.provider_id, p.payload, p.publication_version, p.published_at
    FROM provider_catalog_publications p JOIN accounts a ON a.id = p.provider_id
    WHERE a.status = 'ACTIVE'
      AND JSON_TYPE(JSON_EXTRACT(p.payload, '$.profile')) = 'OBJECT'
      AND JSON_TYPE(JSON_EXTRACT(p.payload, '$.services')) = 'ARRAY'
      AND JSON_TYPE(JSON_EXTRACT(p.payload, '$.works')) = 'ARRAY'
  ), raw_service_links AS (
    SELECT p.provider_id, s.service_index,
      JSON_EXTRACT(p.payload, CONCAT('$.services[', s.service_index - 1, ']')) AS service_payload, s.work_id,
      ROW_NUMBER() OVER (PARTITION BY p.provider_id COLLATE utf8mb4_0900_bin,
        s.work_id COLLATE utf8mb4_0900_bin ORDER BY s.service_index DESC) AS link_rank
    FROM published p
    JOIN JSON_TABLE(CAST(p.payload AS JSON), '$.services[*]' COLUMNS (
      service_index FOR ORDINALITY,
      NESTED PATH '$.workIds[*]' COLUMNS (work_id VARCHAR(64) PATH '$' ERROR ON ERROR)
    )) s
  ), service_links AS (
    SELECT *, CASE
      WHEN JSON_EXTRACT(service_payload, '$.serviceMode') IS NULL
        OR JSON_TYPE(JSON_EXTRACT(service_payload, '$.serviceMode')) = 'NULL'
        OR JSON_EXTRACT(service_payload, '$.serviceMode') = CAST('false' AS JSON)
        OR JSON_EXTRACT(service_payload, '$.serviceMode') = CAST('0' AS JSON)
        OR OCTET_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(service_payload, '$.serviceMode'))) = 0
      THEN 'ONSITE' ELSE JSON_UNQUOTE(JSON_EXTRACT(service_payload, '$.serviceMode')) END AS service_mode
    FROM raw_service_links
  )
  SELECT p.provider_id, p.publication_version, p.published_at,
    w.work_index, JSON_EXTRACT(p.payload, CONCAT('$.works[', w.work_index - 1, ']')) AS work_payload, links.service_payload
  FROM published p
  JOIN JSON_TABLE(CAST(p.payload AS JSON), '$.works[*]' COLUMNS (
    work_index FOR ORDINALITY, work_id VARCHAR(64) PATH '$.id' ERROR ON ERROR
  )) w
  LEFT JOIN service_links links ON links.provider_id COLLATE utf8mb4_0900_bin = p.provider_id COLLATE utf8mb4_0900_bin
    AND links.work_id COLLATE utf8mb4_0900_bin = w.work_id COLLATE utf8mb4_0900_bin AND links.link_rank = 1
  ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
  ORDER BY p.provider_id COLLATE utf8mb4_0900_bin, w.work_index` };
}

module.exports = { publishedWorkCandidatesQuery };
