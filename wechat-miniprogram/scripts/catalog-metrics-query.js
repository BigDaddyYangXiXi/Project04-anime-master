// Local SQL prototype; not wired into the deployed catalog function.
function checkedProviderIds(providerIds) {
  if (!Array.isArray(providerIds) || providerIds.length > 200
    || providerIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error('Invalid provider IDs');
  return [...new Set(providerIds)];
}

function catalogMetricsQuery(providerIds) {
  const ids = checkedProviderIds(providerIds);
  if (!ids.length) return null;
  return {
    values: ids,
    sql: `WITH source AS (
      SELECT provider_id, stage, created_at,
        JSON_EXTRACT(payload, '$.public') AS public_value,
        JSON_EXTRACT(payload, '$.public.rating') AS rating,
        JSON_EXTRACT(payload, '$.public.contactFirstCopiedAt') AS copied_at,
        JSON_EXTRACT(payload, '$.public.buyerAgreementConfirmedAt') AS confirmed_at,
        JSON_EXTRACT(payload, '$.public.referenceWorkId') AS work_id
      FROM order_aggregates WHERE provider_id IN (${ids.map(() => '?').join(',')})
    ), normalized AS (
      SELECT *,
        CASE WHEN JSON_TYPE(rating) IN ('INTEGER', 'DOUBLE')
          AND CAST(rating AS DOUBLE) BETWEEN 1 AND 5
          AND CAST(rating AS DOUBLE) = FLOOR(CAST(rating AS DOUBLE))
          THEN CAST(rating AS UNSIGNED) ELSE NULL END AS valid_rating,
        CASE WHEN JSON_TYPE(copied_at) IN ('INTEGER', 'DOUBLE')
          AND CAST(copied_at AS DOUBLE) BETWEEN 0 AND 9007199254740991
          AND CAST(copied_at AS DOUBLE) = FLOOR(CAST(copied_at AS DOUBLE))
          AND created_at <= 9007199254740991
          AND CAST(copied_at AS DOUBLE) >= created_at
          THEN CAST(copied_at AS UNSIGNED) - created_at ELSE NULL END AS response_ms,
        CASE WHEN work_id IS NOT NULL AND JSON_TYPE(work_id) <> 'NULL'
          AND NOT (JSON_TYPE(work_id) = 'BOOLEAN' AND JSON_UNQUOTE(work_id) = 'false')
          AND NOT (JSON_TYPE(work_id) IN ('INTEGER', 'DOUBLE') AND CAST(work_id AS DOUBLE) = 0)
          AND NOT (JSON_TYPE(work_id) = 'STRING' AND OCTET_LENGTH(JSON_UNQUOTE(work_id)) = 0)
          AND confirmed_at IS NOT NULL AND JSON_TYPE(confirmed_at) <> 'NULL'
          AND NOT (JSON_TYPE(confirmed_at) = 'BOOLEAN' AND JSON_UNQUOTE(confirmed_at) = 'false')
          AND NOT (JSON_TYPE(confirmed_at) IN ('INTEGER', 'DOUBLE') AND CAST(confirmed_at AS DOUBLE) = 0)
          AND NOT (JSON_TYPE(confirmed_at) = 'STRING' AND OCTET_LENGTH(JSON_UNQUOTE(confirmed_at)) = 0)
          THEN CAST(work_id AS CHAR CHARACTER SET utf8mb4) ELSE NULL END AS reference_work_json
      FROM source WHERE public_value IS NOT NULL AND JSON_TYPE(public_value) <> 'NULL'
        AND NOT (JSON_TYPE(public_value) = 'BOOLEAN' AND JSON_UNQUOTE(public_value) = 'false')
        AND NOT (JSON_TYPE(public_value) IN ('INTEGER', 'DOUBLE') AND CAST(public_value AS DOUBLE) = 0)
        AND NOT (JSON_TYPE(public_value) = 'STRING' AND OCTET_LENGTH(JSON_UNQUOTE(public_value)) = 0)
    )
    SELECT provider_id COLLATE utf8mb4_0900_bin AS provider_id,
      reference_work_json COLLATE utf8mb4_0900_bin AS reference_work_json,
      SUM(stage = 'COMPLETED') AS completed_orders,
      SUM(CASE WHEN stage = 'COMPLETED' THEN COALESCE(valid_rating, 0) ELSE 0 END) AS rating_total,
      SUM(stage = 'COMPLETED' AND valid_rating IS NOT NULL) AS rating_count,
      COALESCE(SUM(response_ms), 0) AS response_total_ms,
      COUNT(response_ms) AS response_count,
      COUNT(reference_work_json) AS reference_count
    FROM normalized GROUP BY provider_id COLLATE utf8mb4_0900_bin, reference_work_json COLLATE utf8mb4_0900_bin`
  };
}

function catalogLocksQuery(providerIds) {
  const ids = checkedProviderIds(providerIds);
  if (!ids.length) return null;
  return { values: ids, sql: `SELECT provider_id, stage,
    JSON_OBJECT('public', JSON_OBJECT(
      'timeSegments', JSON_EXTRACT(payload, '$.public.timeSegments'),
      'ndaFlowVersion', JSON_EXTRACT(payload, '$.public.ndaFlowVersion'),
      'communicationDone', JSON_EXTRACT(payload, '$.public.communicationDone')
    )) AS payload
    FROM order_aggregates WHERE provider_id IN (${ids.map(() => '?').join(',')})
      AND stage IN ('NDA_BUYER_PENDING','NDA_PROVIDER_PENDING','BUYER_FINAL_CONFIRM',
        'IN_PRODUCTION','REVISION_REQUESTED','DELIVERY_PENDING','COMPLETED')` };
}

function applyCatalogMetrics(catalog, rows) {
  const byProvider = new Map();
  for (const row of rows) {
    if (!byProvider.has(row.provider_id)) byProvider.set(row.provider_id, {
      completed: 0, ratings: 0, ratingTotal: 0, responses: 0, responseTotal: 0, references: new Map()
    });
    const metric = byProvider.get(row.provider_id);
    metric.completed += Number(row.completed_orders);
    metric.ratings += Number(row.rating_count);
    metric.ratingTotal += Number(row.rating_total);
    metric.responses += Number(row.response_count);
    metric.responseTotal += Number(row.response_total_ms);
    if (row.reference_work_json !== null) {
      // Preserve the existing JS property-key conversion for historical non-string IDs.
      const id = String(JSON.parse(row.reference_work_json));
      metric.references.set(id, (metric.references.get(id) || 0) + Number(row.reference_count));
    }
  }
  const providers = catalog.providers.map(provider => {
    const metric = byProvider.get(provider.id);
    return { ...provider,
      works: (provider.works || []).map(work => ({ ...work,
        referenceCount: Math.max(Number(work.referenceCount || 0), metric?.references.get(work.id) || 0) })),
      orders: metric?.completed || 0,
      rating: metric?.ratings ? Math.round(metric.ratingTotal / metric.ratings * 10) / 10 : null,
      reviewCount: metric?.ratings || 0,
      averageResponseMinutes: metric?.responses ? Math.round(metric.responseTotal / metric.responses / 60000) : null,
      responseSampleCount: metric?.responses || 0
    };
  });
  return { providers, works: providers.flatMap(provider => provider.works) };
}

module.exports = { catalogMetricsQuery, applyCatalogMetrics, catalogLocksQuery };

