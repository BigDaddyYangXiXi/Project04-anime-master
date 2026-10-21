// Price and style share stored filters, but each panel edits only its own group.
function groupsForKind(groups, kind) {
  return groups.filter(group => (group.group === '价格区间') === (kind === 'price'));
}
function resetKind(filters, groups, kind) {
  const values = new Set(groupsForKind(groups, kind).flatMap(group => group.values));
  return filters.filter(value => !values.has(value));
}
module.exports = { groupsForKind, resetKind };
