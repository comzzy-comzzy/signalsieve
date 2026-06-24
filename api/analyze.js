import { analyzeSignal } from "../src/service.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const result = await analyzeSignal(req.body ?? {});
    if (!result) {
      return res.status(400).json({ error: "Provide sampleId or input object." });
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
