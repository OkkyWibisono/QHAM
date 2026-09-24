const { holdsQham, isAddress } = require("./_lib/gate.js");
const { callGemini } = require("./_lib/gemini.js");

const SYSTEM_PROMPT =
  "You write short, punchy meme captions for the Quantum Hamster ($QHAM) meme " +
  "crypto community mascot. Given a topic, respond with ONLY strict JSON in the " +
  'exact shape {"top": "...", "bottom": "..."} - top and bottom are meme caption ' +
  "text (ALL CAPS, under 40 characters each, funny, hamster/quantum/crypto " +
  "themed, never financial advice). No extra text, no markdown fences, just the " +
  "raw JSON object.";

const MAX_TOPIC_LENGTH = 200;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { address, topic } = req.body || {};

  if (typeof address !== "string" || !isAddress(address)) {
    res.status(400).json({ error: "Missing or invalid wallet address" });
    return;
  }

  if (typeof topic !== "string" || !topic.trim() || topic.length > MAX_TOPIC_LENGTH) {
    res.status(400).json({ error: "Invalid topic" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
    return;
  }

  try {
    const eligible = await holdsQham(address);
    if (!eligible) {
      res.status(403).json({ error: "Connect a wallet holding $QHAM to use the meme generator." });
      return;
    }
  } catch (err) {
    console.error("Balance check failed:", err);
    res.status(502).json({ error: "Could not verify $QHAM balance right now. Try again shortly." });
    return;
  }

  try {
    const result = await callGemini(process.env.GEMINI_API_KEY, {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: "Topic: " + topic }] }]
    });

    if (!result.ok) {
      console.error("Gemini API error:", result.data);
      res.status(502).json({ error: "The Hamster brain is unavailable right now." });
      return;
    }

    const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      res.status(502).json({ error: "The Hamster brain didn't say anything back." });
      return;
    }

    let parsed;
    try {
      const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error("Could not parse meme JSON:", text);
      res.status(502).json({ error: "Couldn't parse the meme caption. Try again." });
      return;
    }

    const top = String(parsed.top || "").slice(0, 60);
    const bottom = String(parsed.bottom || "").slice(0, 60);

    res.status(200).json({ top, bottom });
  } catch (err) {
    console.error("Meme handler failed:", err);
    res.status(500).json({ error: "Something went wrong generating the meme." });
  }
};
