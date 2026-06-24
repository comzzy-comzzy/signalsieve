import { loadSamples } from "../src/service.js";

export default async function handler(_req, res) {
  try {
    res.status(200).json(await loadSamples());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
