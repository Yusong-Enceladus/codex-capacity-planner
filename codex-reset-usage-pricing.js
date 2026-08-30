"use strict";

// Adapted from CodexBar's MIT-licensed CostUsagePricing at the pinned version
// in scripts/bootstrap-codexbar.sh. These are offline API-equivalent estimates,
// not a bill and not the subscription's quota/credit multiplier. See NOTICE.
const rates = {
  "gpt-5": [1.25, 10, 0.125],
  "gpt-5-codex": [1.25, 10, 0.125],
  "gpt-5-mini": [0.25, 2, 0.025],
  "gpt-5-nano": [0.05, 0.4, 0.005],
  "gpt-5-pro": [15, 120, 15],
  "gpt-5.1": [1.25, 10, 0.125],
  "gpt-5.1-codex": [1.25, 10, 0.125],
  "gpt-5.1-codex-max": [1.25, 10, 0.125],
  "gpt-5.1-codex-mini": [0.25, 2, 0.025],
  "gpt-5.2": [1.75, 14, 0.175],
  "gpt-5.2-codex": [1.75, 14, 0.175],
  "gpt-5.2-pro": [21, 168, 21],
  "gpt-5.3-codex": [1.75, 14, 0.175],
  "gpt-5.3-codex-spark": [0, 0, 0],
  "gpt-5.4": [2.5, 15, 0.25, 5, 22.5, 0.5],
  "gpt-5.4-mini": [0.75, 4.5, 0.075],
  "gpt-5.4-nano": [0.2, 1.25, 0.02],
  "gpt-5.4-pro": [30, 180, 30],
  "gpt-5.5": [5, 30, 0.5, 10, 45, 1],
  "gpt-5.5-pro": [30, 180, 30],
  "gpt-5.6-sol": [5, 30, 0.5, 10, 45, 1],
  "gpt-5.6-terra": [2, 12, 0.2, 4, 18, 0.4],
  "gpt-5.6-luna": [0.2, 1.2, 0.02, 0.4, 1.8, 0.04],
};
const fastMultipliers = {
  "gpt-5.4": 2, "gpt-5.4-mini": 2, "gpt-5.5": 2.5,
  "gpt-5.6-sol": 2, "gpt-5.6-terra": 2, "gpt-5.6-luna": 2,
};

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeModel(value) {
  let model = String(value || "unknown").trim().replace(/^openai\//, "");
  if (model === "gpt-5.6") model = "gpt-5.6-sol";
  const base = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return rates[base] ? base : model;
}

function estimateCost(row) {
  if (Number.isFinite(row.knownCostNanos) && row.knownCostNanos >= 0) {
    return row.knownCostNanos / 1e9;
  }
  const model = normalizeModel(row.pricingModel || row.model);
  const rate = rates[model];
  if (!rate) return null;
  const input = tokenCount(row.input);
  const cached = Math.min(input, tokenCount(row.cached));
  const output = tokenCount(row.output);
  const offset = input > 272000 && rate.length > 3 ? 3 : 0;
  const standard = ((input - cached) * rate[offset] + output * rate[offset + 1]
    + cached * rate[offset + 2]) / 1e6;
  // Match the upstream scanner: unsupported Fast/long-context combinations
  // fall back to Standard estimates, never to the Codex quota multiplier.
  const fast = row.pricingMode === "priority" && input <= 272000
    ? (fastMultipliers[model] || 1) : 1;
  return standard * fast;
}

module.exports = { estimateCost, normalizeModel, tokenCount };
