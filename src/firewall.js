const BLOCK_THRESHOLD = 70;
const WARN_THRESHOLD = 34;

const PATTERNS = [
  {
    id: "prompt_injection",
    label: "Prompt injection",
    weight: 62,
    match: (input) => /\b(system|developer|ignore previous|do not mention|max available balance|override)\b/i.test(input.text)
  },
  {
    id: "unverified_listing_claim",
    label: "Unverified listing claim",
    weight: 42,
    match: (input) => /listing|listed|will be listed|bitget spot/i.test(input.text)
      && input.marketContext?.officialListingConfirmed !== true
  },
  {
    id: "stale_news_replay",
    label: "Stale news replay",
    weight: 26,
    match: (input) => Boolean(input.marketContext?.originalArticleDate || input.marketContext?.knownRepostCount > 10)
  },
  {
    id: "coordinated_sentiment",
    label: "Coordinated sentiment manipulation",
    weight: 25,
    match: (input) => (input.marketContext?.uniquePhraseSimilarityPct ?? 0) > 80
      || (input.marketContext?.newAccountSharePct ?? 0) > 70
      || /\b(near-identical|coordinated|bot wave|bot accounts|same wording|new accounts)\b/i.test(input.text)
  },
  {
    id: "feed_disagreement",
    label: "Market feed disagreement",
    weight: 35,
    match: (input) => (input.marketContext?.feedDisagreementPct ?? 0) > 5
      || /\b(feed disagreement|third-party api|backup feeds|not confirmed elsewhere|abnormal price)\b/i.test(input.text)
  },
  {
    id: "exchange_inflow_overread",
    label: "Misleading on-chain interpretation",
    weight: 18,
    match: (input) => input.marketContext?.exchangeInflow === true && /accumulation|long signal|buy/i.test(input.text)
      || /\b(whale|exchange inflow|moved).*\b(accumulation|long signal|buy)\b/i.test(input.text)
  },
  {
    id: "thin_liquidity",
    label: "Thin liquidity",
    weight: 18,
    match: (input) => typeof input.marketContext?.liquidityUsd === "number"
      && input.marketContext.liquidityUsd < 50000
      || /\b(thin liquidity|low liquidity|illiquid)\b/i.test(input.text)
  },
  {
    id: "crowded_leverage",
    label: "Crowded leverage",
    weight: 14,
    match: (input) => Math.abs(input.marketContext?.fundingRatePct ?? 0) > 0.02
      || Math.abs(input.marketContext?.openInterestChange1hPct ?? 0) > 35
      || /\b(crowded leverage|funding spike|open interest spike|overleveraged)\b/i.test(input.text)
  },
  {
    id: "hyperbolic_claim",
    label: "Hyperbolic market claim",
    weight: 10,
    match: (input) => /\b(100x|insiders|guaranteed|confirmed next|rush back|breaking)\b/i.test(input.text)
  }
];

export function runHeuristicFirewall(input) {
  const detections = PATTERNS
    .filter((pattern) => pattern.match(input))
    .map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      weight: pattern.weight
    }));

  const marketStress = scoreMarketStress(input.marketContext ?? {});
  const riskScore = clamp(
    detections.reduce((sum, detection) => sum + detection.weight, 0) + marketStress,
    0,
    100
  );

  const verdict = riskScore >= BLOCK_THRESHOLD ? "BLOCK" : riskScore >= WARN_THRESHOLD ? "WARN" : "ALLOW";

  return {
    verdict,
    riskScore,
    confidence: clamp(52 + detections.length * 8 + Math.floor(marketStress / 3), 0, 94) / 100,
    poisoningTypes: detections.map((detection) => detection.id),
    evidence: buildEvidence(input, detections, marketStress),
    recommendedAgentAction: getRecommendedAction(verdict),
    safeSignal: {
      safe_to_use: verdict === "ALLOW",
      action: verdict.toLowerCase(),
      max_position_risk_pct: verdict === "ALLOW" ? 1.0 : verdict === "WARN" ? 0.25 : 0,
      require_human_review: verdict !== "ALLOW"
    },
    analysisSummary: summarize(input, verdict, detections)
  };
}

export function normalizeModelResult(input, modelResult) {
  const heuristic = runHeuristicFirewall(input);
  if (!modelResult || typeof modelResult !== "object") {
    return heuristic;
  }

  const verdict = normalizeVerdict(modelResult.verdict) ?? heuristic.verdict;
  const riskScore = clamp(Number(modelResult.riskScore ?? modelResult.risk_score ?? heuristic.riskScore), 0, 100);
  const evidence = Array.isArray(modelResult.evidence) && modelResult.evidence.length > 0
    ? modelResult.evidence.map(String).slice(0, 8)
    : heuristic.evidence;
  const poisoningTypes = Array.isArray(modelResult.poisoningTypes)
    ? modelResult.poisoningTypes.map(String).slice(0, 8)
    : Array.isArray(modelResult.poisoning_types)
      ? modelResult.poisoning_types.map(String).slice(0, 8)
      : heuristic.poisoningTypes;

  return {
    verdict,
    riskScore,
    confidence: clamp(Number(modelResult.confidence ?? heuristic.confidence), 0, 1),
    poisoningTypes,
    evidence,
    recommendedAgentAction: String(
      modelResult.recommendedAgentAction
      ?? modelResult.recommended_agent_action
      ?? getRecommendedAction(verdict)
    ),
    safeSignal: {
      safe_to_use: verdict === "ALLOW",
      action: verdict.toLowerCase(),
      max_position_risk_pct: verdict === "ALLOW" ? 1.0 : verdict === "WARN" ? 0.25 : 0,
      require_human_review: verdict !== "ALLOW"
    },
    analysisSummary: String(modelResult.analysisSummary ?? modelResult.analysis_summary ?? heuristic.analysisSummary)
  };
}

function scoreMarketStress(context) {
  let score = 0;
  if (Math.abs(context.priceChange1hPct ?? 0) > 10) score += 8;
  if (Math.abs(context.volumeChange1hPct ?? 0) > 150) score += 8;
  if (Math.abs(context.openInterestChange1hPct ?? 0) > 25) score += 8;
  if ((context.spreadBps ?? 0) > 30) score += 7;
  return score;
}

function buildEvidence(input, detections, marketStress) {
  const evidence = detections.map((detection) => detection.label);
  const context = input.marketContext ?? {};

  if (context.officialListingConfirmed === false) {
    evidence.push("No official listing confirmation is present in the submitted context.");
  }
  if (context.originalArticleDate) {
    evidence.push(`Original article timestamp is older than the claimed breaking event: ${context.originalArticleDate}.`);
  }
  if (context.feedDisagreementPct > 5) {
    evidence.push(`Quote feed disagreement is ${context.feedDisagreementPct}%, above the firewall threshold.`);
  }
  if (marketStress > 0) {
    evidence.push("Market context shows stress that can amplify poisoned signals.");
  }

  return evidence.length > 0 ? evidence : ["No high-risk poisoning pattern detected."];
}

function getRecommendedAction(verdict) {
  if (verdict === "BLOCK") {
    return "Do not pass this input to an execution agent. Require independent verification before any trade.";
  }
  if (verdict === "WARN") {
    return "Pass only as low-trust context. Reduce sizing and require confirmation from independent market data.";
  }
  return "Allow as contextual input. Continue applying normal risk limits.";
}

function summarize(input, verdict, detections) {
  const detected = detections.length > 0
    ? detections.map((detection) => detection.label.toLowerCase()).join(", ")
    : "no major poisoning pattern";
  return `${input.asset ?? "The asset"} received a ${verdict} verdict because SignalSieve detected ${detected}.`;
}

function normalizeVerdict(value) {
  const upper = String(value ?? "").toUpperCase();
  return ["ALLOW", "WARN", "BLOCK"].includes(upper) ? upper : null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
