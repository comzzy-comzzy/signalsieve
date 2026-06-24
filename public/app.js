const state = {
  samples: [],
  selected: null,
  mode: "custom",
  countersStarted: false
};

const els = {
  healthStatus: document.querySelector("#healthStatus"),
  modeButtons: [...document.querySelectorAll("[data-input-mode]")],
  customPanel: document.querySelector("#customPanel"),
  samplePanel: document.querySelector("#samplePanel"),
  customAsset: document.querySelector("#customAsset"),
  customSourceType: document.querySelector("#customSourceType"),
  customSource: document.querySelector("#customSource"),
  customText: document.querySelector("#customText"),
  useBitgetMarket: document.querySelector("#useBitgetMarket"),
  sampleSelect: document.querySelector("#sampleSelect"),
  sourceType: document.querySelector("#sourceType"),
  asset: document.querySelector("#asset"),
  expectedRisk: document.querySelector("#expectedRisk"),
  sampleTitle: document.querySelector("#sampleTitle"),
  sampleText: document.querySelector("#sampleText"),
  marketContext: document.querySelector("#marketContext"),
  analyzeButton: document.querySelector("#analyzeButton"),
  providerBadge: document.querySelector("#providerBadge"),
  verdictBadge: document.querySelector("#verdictBadge"),
  riskMeter: document.querySelector("#riskMeter"),
  riskScore: document.querySelector("#riskScore"),
  analysisSummary: document.querySelector("#analysisSummary"),
  evidenceCount: document.querySelector("#evidenceCount"),
  evidenceList: document.querySelector("#evidenceList"),
  safeSignal: document.querySelector("#safeSignal"),
  refreshAuditButton: document.querySelector("#refreshAuditButton"),
  auditLog: document.querySelector("#auditLog"),
  railLinks: [...document.querySelectorAll("[data-section-link]")],
  sections: [...document.querySelectorAll("[data-section]")]
};

init();

async function init() {
  setupObservers();
  renderEmptyEvidence();

  await Promise.all([loadHealth(), loadSamples(), loadAudit()]);

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setInputMode(button.dataset.inputMode));
  });

  els.sampleSelect.addEventListener("change", () => {
    state.selected = state.samples.find((sample) => sample.id === els.sampleSelect.value);
    renderSelectedSample();
  });

  [els.customAsset, els.customSourceType, els.customText].forEach((input) => {
    input.addEventListener("input", renderCustomContext);
  });
  els.useBitgetMarket.addEventListener("change", renderCustomContext);

  els.analyzeButton.addEventListener("click", analyzeSelected);
  els.refreshAuditButton.addEventListener("click", loadAudit);
  renderCustomContext();
}

function setupObservers() {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("in-view");
      });
    },
    { threshold: 0.12 }
  );

  document
    .querySelectorAll(".metric, .flow-card, .sample-console, .verdict-console, .evidence-panel, .audit-entry")
    .forEach((element) => {
      element.classList.add("reveal");
      revealObserver.observe(element);
    });

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      setActiveSection(visible.target.dataset.section);
      if (visible.target.dataset.section === "system") startCounters();
    },
    { rootMargin: "-30% 0px -55% 0px", threshold: [0.04, 0.2, 0.45] }
  );

  els.sections.forEach((section) => sectionObserver.observe(section));
}

async function loadHealth() {
  try {
    const health = await getJson("/api/health");
    els.healthStatus.textContent = health.qwenConfigured
      ? `Qwen ready / ${health.model}`
      : "Fallback mode / add Qwen key";
  } catch {
    els.healthStatus.textContent = "API unavailable";
  }
}

async function loadSamples() {
  state.samples = await getJson("/api/samples");
  els.sampleSelect.innerHTML = state.samples
    .map((sample) => `<option value="${escapeHtml(sample.id)}">${escapeHtml(sample.title)}</option>`)
    .join("");
  state.selected = state.samples[0];
  renderSelectedSample();
}

async function analyzeSelected() {
  const body = buildAnalysisBody();
  if (!body) return;

  els.analyzeButton.disabled = true;
  els.analyzeButton.textContent = "Analyzing...";
  els.providerBadge.textContent = "Running firewall";

  try {
    const result = await postJson("/api/analyze", body);
    renderVerdict(result);
    await loadAudit();
  } catch (error) {
    renderError(error);
  } finally {
    els.analyzeButton.disabled = false;
    els.analyzeButton.textContent = "Analyze signal";
  }
}

function buildAnalysisBody() {
  if (state.mode === "sample") {
    return state.selected ? { sampleId: state.selected.id } : null;
  }

  const text = els.customText.value.trim();
  const asset = els.customAsset.value.trim().toUpperCase();

  if (text.length < 8) {
    renderError(new Error("Paste the market signal you want analyzed first."));
    els.customText.focus();
    return null;
  }

  return {
    useBitgetMarket: els.useBitgetMarket.checked,
    input: {
      title: "Custom market signal",
      sourceType: els.customSourceType.value,
      source: els.customSource.value.trim() || "user_submitted_signal",
      asset: asset || "CUSTOM",
      text,
      marketContext: {}
    }
  };
}

function setInputMode(mode) {
  state.mode = mode === "sample" ? "sample" : "custom";

  els.modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.inputMode === state.mode);
  });

  els.customPanel.classList.toggle("is-hidden", state.mode !== "custom");
  els.samplePanel.classList.toggle("is-hidden", state.mode !== "sample");

  if (state.mode === "sample") {
    renderSelectedSample();
  } else {
    renderCustomContext();
  }
}

function renderSelectedSample() {
  const sample = state.selected;
  if (!sample) return;

  els.sourceType.textContent = sample.sourceType;
  els.asset.textContent = sample.asset;
  els.expectedRisk.textContent = `expected ${sample.expectedRisk}`;
  els.sampleTitle.textContent = sample.title;
  els.sampleText.textContent = sample.text;
  els.marketContext.innerHTML = Object.entries(sample.marketContext)
    .map(([key, value]) => `
      <div class="context-item">
        <span>${escapeHtml(toLabel(key))}</span>
        <strong>${escapeHtml(formatValue(value))}</strong>
      </div>
    `)
    .join("");
}

function renderCustomContext() {
  if (state.mode !== "custom") return;

  const asset = els.customAsset.value.trim().toUpperCase() || "CUSTOM";
  els.sourceType.textContent = els.customSourceType.value;
  els.marketContext.innerHTML = `
    <div class="context-item">
      <span>Asset</span>
      <strong>${escapeHtml(asset)}</strong>
    </div>
    <div class="context-item">
      <span>Source</span>
      <strong>${escapeHtml(els.customSource.value.trim() || "manual input")}</strong>
    </div>
    <div class="context-item">
      <span>Bitget ticker</span>
      <strong>${els.useBitgetMarket.checked ? "enabled" : "off"}</strong>
    </div>
  `;
}

function renderVerdict(result) {
  const verdict = result.verdict;
  const mode = verdict.verdict.toLowerCase();
  const evidence = verdict.evidence ?? [];

  els.providerBadge.textContent = getProviderLabel(result.provider);
  els.verdictBadge.textContent = verdict.verdict;
  els.verdictBadge.className = `verdict-orb ${mode}`;
  els.riskMeter.style.width = `${verdict.riskScore}%`;
  els.riskMeter.style.background = mode === "block" ? "var(--red)" : mode === "warn" ? "var(--amber)" : "var(--green)";
  els.riskScore.textContent = `${verdict.riskScore} / 100`;
  els.analysisSummary.textContent = verdict.analysisSummary;
  els.evidenceCount.textContent = `${evidence.length} ${evidence.length === 1 ? "finding" : "findings"}`;
  els.evidenceList.innerHTML = evidence
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  els.safeSignal.textContent = JSON.stringify({
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    poisoningTypes: verdict.poisoningTypes,
    recommendedAgentAction: verdict.recommendedAgentAction,
    safeSignal: verdict.safeSignal,
    auditId: result.audit.auditId
  }, null, 2);
}

function getProviderLabel(provider) {
  if (provider?.usedModel) {
    return `AI analysis / ${provider.name}`;
  }
  if (provider?.name === "local-heuristic") {
    return "Firewall analysis mode";
  }
  return "Analysis complete";
}

function renderEmptyEvidence() {
  els.evidenceCount.textContent = "0 findings";
  els.evidenceList.innerHTML = `
    <li>Run a custom signal or sample to produce firewall evidence.</li>
  `;
  els.safeSignal.textContent = JSON.stringify({
    status: "waiting_for_analysis"
  }, null, 2);
}

function renderError(error) {
  els.providerBadge.textContent = "Analysis failed";
  els.verdictBadge.textContent = "ERROR";
  els.verdictBadge.className = "verdict-orb block";
  els.riskMeter.style.width = "100%";
  els.riskMeter.style.background = "var(--red)";
  els.riskScore.textContent = "100 / 100";
  els.analysisSummary.textContent = error.message;
  els.evidenceCount.textContent = "1 finding";
  els.evidenceList.innerHTML = `<li>${escapeHtml(error.message)}</li>`;
}

async function loadAudit() {
  const audit = await getJson("/api/audit?limit=6");
  if (audit.length === 0) {
    els.auditLog.innerHTML = `
      <article class="audit-entry reveal in-view">
        <strong>No runs yet</strong>
        <span>Run an analysis to create proof.</span>
      </article>
    `;
    return;
  }

  els.auditLog.innerHTML = audit.reverse().map((entry) => `
    <article class="audit-entry reveal in-view">
      <strong>${escapeHtml(entry.verdict)} / ${escapeHtml(entry.asset ?? "asset")}</strong>
      <span>${escapeHtml(formatDate(entry.createdAt))}</span>
      <span>Risk ${escapeHtml(String(entry.riskScore))} / ${escapeHtml(entry.provider)}</span>
      <span>${escapeHtml((entry.poisoningTypes ?? []).join(" / ") || "no poisoning type")}</span>
      <span>${escapeHtml(entry.auditId)}</span>
    </article>
  `).join("");
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function setActiveSection(sectionName) {
  els.railLinks.forEach((link) => {
    link.classList.toggle("is-active", link.dataset.sectionLink === sectionName);
  });
}

function startCounters() {
  if (state.countersStarted) return;
  state.countersStarted = true;

  document.querySelectorAll("[data-count-to]").forEach((element) => {
    const target = Number(element.dataset.countTo);
    const started = performance.now();
    const duration = 900;

    function tick(now) {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = String(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

function toLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function formatValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return String(value);
}

function formatDate(value) {
  if (!value) return "unknown time";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
