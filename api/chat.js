const { JsonRpcProvider, Contract, isAddress } = require("ethers");

const QHAM_ADDRESS = "0xfF4Cd1e8a604CB75d8AF80B71fB5144DB9A44E42";
const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

const SYSTEM_PROMPT =
  "You are the Quantum Hamster AI, the witty mascot chatbot for the Quantum Hamster " +
  "($QHAM) meme crypto community. Stay playful and on-brand (hamster/quantum puns " +
  "welcome), keep replies short (a few sentences max), and never give financial, " +
  "investment or trading advice - if asked, remind the user this isn't financial advice.";

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_TURNS = 6;

async function holdsQham(address) {
  const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC_URL);
  const token = new Contract(QHAM_ADDRESS, ERC20_ABI, provider);
  const balance = await token.balanceOf(address);
  return balance > 0n;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { address, message, history } = req.body || {};

  if (typeof address !== "string" || !isAddress(address)) {
    res.status(400).json({ error: "Missing or invalid wallet address" });
    return;
  }

  if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: "Invalid message" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
    return;
  }

  try {
    const eligible = await holdsQham(address);
    if (!eligible) {
      res.status(403).json({ error: "Connect a wallet holding $QHAM to chat with the Hamster AI." });
      return;
    }
  } catch (err) {
    console.error("Balance check failed:", err);
    res.status(502).json({ error: "Could not verify $QHAM balance right now. Try again shortly." });
    return;
  }

  const safeHistory = Array.isArray(history)
    ? history
        .filter(turn => turn && (turn.role === "user" || turn.role === "model") && Array.isArray(turn.parts))
        .slice(-MAX_HISTORY_TURNS)
    : [];

  try {
    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [...safeHistory, { role: "user", parts: [{ text: message }] }]
        })
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Gemini API error:", data);
      res.status(502).json({ error: "The Hamster brain is unavailable right now." });
      return;
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      res.status(502).json({ error: "The Hamster brain didn't say anything back." });
      return;
    }

    res.status(200).json({ reply });
  } catch (err) {
    console.error("Chat handler failed:", err);
    res.status(500).json({ error: "Something went wrong talking to the Hamster brain." });
  }
};
