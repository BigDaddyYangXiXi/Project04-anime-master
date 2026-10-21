// Offline migration preflight. Input must be a consistent, complete export;
// this tool neither fetches cloud data nor authorizes a migration.
const fs = require('node:fs');
function auditWorkOwnership(input) {
  if (!input || !Array.isArray(input.publications) || !Array.isArray(input.works) || !Array.isArray(input.savedItems)) throw Error('EXPORT_TABLES_REQUIRED');
  const owners = new Map();
  const snapshotOwners = new Set();
  let invalidRows = 0;
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  function add(id, provider) {
    if (!validId(id) || !validId(provider)) { invalidRows++; return; }
    if (!owners.has(id)) owners.set(id, new Set());
    owners.get(id).add(provider);
  }
  for (const row of input.publications) {
    if (!row || !validId(row.provider_id)) { invalidRows++; continue; }
    if (snapshotOwners.has(row.provider_id)) invalidRows++;
    snapshotOwners.add(row.provider_id);
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (!payload || !payload.profile || !Array.isArray(payload.services) || !Array.isArray(payload.works)) throw Error('INVALID_SNAPSHOT');
      const seen = new Set();
      for (const work of payload.works) {
        if (!work || seen.has(work.id)) { invalidRows++; continue; }
        seen.add(work.id); add(work.id, row.provider_id);
      }
    } catch { invalidRows++; }
  }
  for (const row of input.works) {
    if (!row || !validId(row.provider_id) || !validId(row.id)) { invalidRows++; continue; }
    // A snapshot replaces its provider's legacy catalog, even when damaged.
    if (!snapshotOwners.has(row.provider_id)) add(row.id, row.provider_id);
  }
  let ambiguousSavedItems = 0, unresolvedSavedItems = 0;
  for (const row of input.savedItems) {
    if (!row || !['WORK', 'PROVIDER'].includes(row.target_type)) { invalidRows++; continue; }
    // Include inactive saved rows: their primary key is also migrated.
    if (row.target_type !== 'WORK') continue;
    if (!validId(row.target_id)) { invalidRows++; continue; }
    const candidates = owners.get(row.target_id);
    if (!candidates) unresolvedSavedItems++;
    else if (candidates.size !== 1) ambiguousSavedItems++;
  }
  const collisions = [...owners].filter(([, values]) => values.size > 1).map(([workId, values]) => ({ workId, ownerCount: values.size })).sort((a, b) => a.workId.localeCompare(b.workId));
  return {
    scope: 'publication-legacy-saved-items-only',
    completeExportDeclared: input.complete === true,
    invalidRows, workIds: owners.size, collisions, ambiguousSavedItems, unresolvedSavedItems,
    ownershipPreflightPassed: input.complete === true && invalidRows === 0 && collisions.length === 0 && ambiguousSavedItems === 0 && unresolvedSavedItems === 0,
    migrationAuthorized: false
  };
}
if (require.main === module) {
  if (process.argv.length !== 3) throw Error('USAGE: node audit-work-ownership.js <local-export.json>');
  const result = auditWorkOwnership(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ownershipPreflightPassed) process.exitCode = 1;
}
module.exports = { auditWorkOwnership };
