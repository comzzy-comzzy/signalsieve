import { readAuditWithEvidenceFallback } from "../src/service.js";

export default async function handler(req, res) {
  try {
    const limit = Number(req.query.limit || 25);
    res.status(200).json(await readAuditWithEvidenceFallback(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
