import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const LOG_DIR = process.env.VERCEL ? "/tmp/signalsieve-logs" : path.resolve("logs");
const LOG_PATH = path.join(LOG_DIR, "audit.ndjson");

export async function appendAuditLog(entry) {
  await mkdir(LOG_DIR, { recursive: true });
  const enriched = {
    ...entry,
    auditId: entry.auditId ?? crypto.randomUUID(),
    createdAt: entry.createdAt ?? new Date().toISOString()
  };
  const previous = existsSync(LOG_PATH) ? await readFile(LOG_PATH, "utf8") : "";
  await writeFile(LOG_PATH, `${previous}${JSON.stringify(enriched)}\n`);
  return enriched;
}

export async function readAuditLog(limit = 25) {
  if (!existsSync(LOG_PATH)) return [];
  const content = await readFile(LOG_PATH, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => JSON.parse(line));
}

export function getAuditPath() {
  return LOG_PATH;
}
