import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSignal, loadSamples, readAuditWithEvidenceFallback } from "./service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4180);
const INSTANCE_ID = process.env.SIGNALSIEVE_INSTANCE_ID || crypto.randomUUID();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, {
        ok: true,
        service: "SignalSieve",
        instanceId: INSTANCE_ID,
        qwenConfigured: Boolean(process.env.BITGET_QWEN_API_KEY),
        model: process.env.QWEN_MODEL || "qwen3.6-plus"
      });
    }

    if (req.method === "GET" && url.pathname === "/api/samples") {
      return sendJson(res, await loadSamples());
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      return sendJson(res, await readAuditWithEvidenceFallback(Number(url.searchParams.get("limit") || 25)));
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJsonBody(req);
      const result = await analyzeSignal(body);

      if (!result) {
        return sendJson(res, { error: "Provide sampleId or input object." }, 400);
      }

      return sendJson(res, result);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(url.pathname, res, req.method === "HEAD");
    }

    sendJson(res, { error: "Not found." }, 404);
  } catch (error) {
    sendJson(res, { error: error.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SignalSieve running at http://${HOST}:${PORT}`);
});

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname, res, headOnly = false) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, "Forbidden", 403);
  }

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(headOnly ? undefined : content);
  } catch {
    sendText(res, "Not found", 404);
  }
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
