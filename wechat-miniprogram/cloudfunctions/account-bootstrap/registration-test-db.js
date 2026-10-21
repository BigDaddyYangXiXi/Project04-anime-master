// In-memory relational fixture: honors filters, unique keys and conditional updates.
function createDb(seed = {}, hook = () => {}) {
  const tables = structuredClone(seed), writes = [];
  const unique = { accounts: ['id', 'uid', 'nickname_key', 'username', 'registration_phone_fingerprint'],
    wechat_identities: ['account_id', 'open_id'], account_phone_identities: ['account_id', 'phone_fingerprint'] };
  return { tables, writes, from(table) {
    const filters = []; let operation = 'select', values, ignore = false;
    const query = {
      select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      insert(value) { operation = 'insert'; values = value; return query; },
      upsert(value, options) { operation = 'insert'; values = value; ignore = options?.ignoreDuplicates; return query; },
      update(value) { operation = 'update'; values = value; return query; },
      async then(resolve, reject) {
        try {
          await hook({ table, operation, values, tables });
          const rows = tables[table] ||= [], matches = row => filters.every(([k, v]) => String(row[k]) === String(v));
          if (operation === 'select') return resolve({ data: structuredClone(rows.filter(matches)) });
          writes.push({ table, value: structuredClone(values) });
          const changes = operation === 'insert' ? (Array.isArray(values) ? values : [values]) : rows.filter(matches).map(row => ({ ...row, ...values }));
          for (const value of changes) {
            const previous = operation === 'update' ? rows.find(row => row.id === value.id && matches(row)) : null;
            const conflict = rows.some(row => row !== previous && (unique[table] || []).some(k => value[k] != null && row[k] === value[k]));
            if (conflict) { if (ignore) continue; return resolve({ error: { code: 'DUPLICATE' } }); }
            if (previous) Object.assign(previous, value); else rows.push({ ...value });
          }
          resolve({ data: structuredClone(changes) });
        } catch (e) { reject(e); }
      }
    };
    return query;
  } };
}
module.exports = { createDb };
