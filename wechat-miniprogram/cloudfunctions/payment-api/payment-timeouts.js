// Guard: 2s; WeChat HTTP: 8s; relay transport allowance: 2s; caller allowance: 2s.
// These are deadlines, not evidence that cold cloud calls meet them.
module.exports = { MUTATION_RELAY_TIMEOUT_MS: 12000, MUTATION_BUDGET_MS: 14000 };
