import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4180);
const BASE_URL = `http://${HOST}:${PORT}`;
const EVIDENCE_DIR = path.resolve("evidence");
const INSTANCE_ID = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const server = spawn(process.execPath, ["src/server.js"], {
  env: { ...process.env, HOST, PORT: String(PORT), SIGNALSIEVE_INSTANCE_ID: INSTANCE_ID },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForHealth();
  const samples = await getJson("/api/samples");
  const results = [];

  for (const sample of samples.slice(0, 3)) {
    const result = await postJson("/api/analyze", { sampleId: sample.id });
    results.push({
      sampleId: sample.id,
      verdict: result.verdict.verdict,
      riskScore: result.verdict.riskScore,
      provider: result.provider.name,
      usedModel: result.provider.usedModel,
      auditId: result.audit.auditId
    });
  }

  const audit = await getJson("/api/audit?limit=5");
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "sample-output.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), results, audit }, null, 2)
  );

  if (existsSync("logs/audit.ndjson")) {
    const log = await readFile("logs/audit.ndjson", "utf8");
    await writeFile(path.join(EVIDENCE_DIR, "sample-audit.ndjson"), log);
  }

  console.log("SignalSieve smoke test passed.");
  console.table(results);
} finally {
  server.kill("SIGTERM");
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const health = await getJson("/api/health");
      if (health.ok && health.instanceId === INSTANCE_ID) return;
    } catch {
      await delay(120);
    }
  }
  throw new Error("Server did not become healthy within 5 seconds.");
}

async function getJson(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(pathname, body) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
