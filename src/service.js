import { readFile } from "node:fs/promises";
import path from "node:path";
import { appendAuditLog, readAuditLog } from "./audit.js";
import { runHeuristicFirewall, normalizeModelResult } from "./firewall.js";
import { getBitgetSpotContext } from "./market-context.js";
import { analyzeWithQwen, parseModelJson } from "./qwen.js";

const DATA_PATH = path.resolve("data", "poisoned-inputs.json");
const EVIDENCE_AUDIT_PATH = path.resolve("evidence", "sample-audit.ndjson");
const SOURCE_TYPES = new Set([
  "social_post",
  "news_headline",
  "token_metadata",
  "social_cluster",
  "onchain_event",
  "market_api",
  "manual_research",
  "custom_signal"
]);

export async function loadSamples() {
  return JSON.parse(await readFile(DATA_PATH, "utf8"));
}

export async function findSample(sampleId) {
  const samples = await loadSamples();
  return samples.find((sample) => sample.id === sampleId);
}

export async function analyzeSignal(body) {
  const inputContext = await resolveInput(body);
  const input = inputContext?.input;
  if (!input || typeof input !== "object") return null;

  const heuristic = runHeuristicFirewall(input);
  const qwen = await analyzeWithQwen(input, heuristic);
  const modelJson = parseModelJson(qwen.raw);
  const verdict = normalizeModelResult(input, modelJson ?? heuristic);
  const providerWarning = [qwen.warning, ...inputContext.warnings].filter(Boolean).join(" ") || null;
  const audit = await appendAuditLog({
    sampleId: input.id ?? null,
    asset: input.asset ?? null,
    sourceType: input.sourceType ?? null,
    provider: qwen.provider,
    usedModel: qwen.usedModel,
    verdict: verdict.verdict,
    riskScore: verdict.riskScore,
    poisoningTypes: verdict.poisoningTypes,
    warning: providerWarning,
    customInput: inputContext.custom
  });

  return {
    input,
    verdict,
    provider: {
      name: qwen.provider,
      usedModel: qwen.usedModel,
      warning: providerWarning
    },
    audit
  };
}

async function resolveInput(body) {
  if (body.sampleId) {
    const sample = await findSample(body.sampleId);
    return sample ? { input: sample, custom: false, warnings: [] } : null;
  }

  const input = normalizeSubmittedInput(body.input);
  if (!input) return null;

  const warnings = [];
  if (body.useBitgetMarket !== false) {
    const bitget = await getBitgetSpotContext(input.asset);
    warnings.push(bitget.warning);
    input.marketContext = {
      ...bitget.marketContext,
      ...input.marketContext
    };
  }

  return {
    input,
    custom: true,
    warnings: warnings.filter(Boolean)
  };
}

function normalizeSubmittedInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object") return null;

  const text = String(rawInput.text ?? "").trim();
  if (text.length < 8) return null;

  const asset = normalizeAsset(rawInput.asset);
  const sourceType = SOURCE_TYPES.has(rawInput.sourceType) ? rawInput.sourceType : "custom_signal";

  return {
    id: `custom-${crypto.randomUUID()}`,
    title: String(rawInput.title ?? "Custom market signal").trim().slice(0, 120),
    sourceType,
    source: String(rawInput.source ?? "user_submitted_signal").trim().slice(0, 120),
    publishedAt: rawInput.publishedAt || new Date().toISOString(),
    asset,
    text: text.slice(0, 5000),
    marketContext: sanitizeMarketContext(rawInput.marketContext)
  };
}

function normalizeAsset(value) {
  const asset = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return asset || "CUSTOM";
}

function sanitizeMarketContext(rawContext) {
  if (!rawContext || typeof rawContext !== "object") return {};

  return Object.fromEntries(
    Object.entries(rawContext)
      .filter(([key, value]) => /^[a-zA-Z0-9_]{1,40}$/.test(key) && isAllowedContextValue(value))
      .slice(0, 24)
  );
}

function isAllowedContextValue(value) {
  return value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

export async function readAuditWithEvidenceFallback(limit = 25) {
  const runtimeAudit = await readAuditLog(limit);
  if (runtimeAudit.length > 0) return runtimeAudit;
  return readEvidenceAudit(limit);
}

async function readEvidenceAudit(limit) {
  try {
    const content = await readFile(EVIDENCE_AUDIT_PATH, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
