export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    service: "SignalSieve",
    instanceId: process.env.SIGNALSIEVE_INSTANCE_ID || "vercel",
    qwenConfigured: Boolean(process.env.BITGET_QWEN_API_KEY),
    model: process.env.QWEN_MODEL || "qwen3.6-plus"
  });
}
