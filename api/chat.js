const { holdsQham, isAddress } = require("./_lib/gate.js");
const { callGemini } = require("./_lib/gemini.js");
const { getQhamStats } = require("./_lib/stats.js");
const { getCryptoPrice } = require("./_lib/price.js");

const TOOLS_ENABLED = process.env.PHASE_3_ENABLED === "true";

const BASE_SYSTEM_PROMPT =
  "You are the Quantum Hamster AI, the witty mascot chatbot for the Quantum Hamster " +
  "($QHAM) meme crypto community. Stay playful and on-brand (hamster/quantum puns " +
  "welcome), keep replies short (a few sentences max), and never give financial, " +
  "investment or trading advice - if asked, remind the user this isn't financial advice.";

const TOOL_SYSTEM_PROMPT_SUFFIX =
  " You have two tools: get_qham_stats returns live on-chain $QHAM data (holder " +
  "count, transfer count, total supply, top holders); get_crypto_price returns the " +
  "current USD price and 24h change percent for any cryptocurrency (pass its " +
  "lowercase CoinGecko id, e.g. 'bitcoin', 'ethereum', 'solana'). Use them whenever " +
  "asked about real numbers instead of guessing or deflecting. When reporting a " +
  "price or its change, state the facts only (e.g. 'up 2%' or 'down 5%') and never " +
  "say whether it's a good time to buy/sell or otherwise editorialize - that would " +
  "cross into financial advice.";

const SYSTEM_PROMPT = TOOLS_ENABLED ? BASE_SYSTEM_PROMPT + TOOL_SYSTEM_PROMPT_SUFFIX : BASE_SYSTEM_PROMPT;

const TOOL_DECLARATIONS = [
  {
    name: "get_qham_stats",
    description: "Get live on-chain stats for the QHAM token: holder count, transfer count, total supply, and top holders.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_price",
    description: "Get the current USD price and 24h change percent for a cryptocurrency. Facts only, never investment advice.",
    parameters: {
      type: "object",
      properties: {
        coin: { type: "string", description: "Lowercase CoinGecko coin id, e.g. 'bitcoin', 'ethereum', 'solana'." }
      },
      required: ["coin"]
    }
  }
];

const TOOL_HANDLERS = {
  get_qham_stats: () => getQhamStats(),
  get_crypto_price: (args) => getCryptoPrice(args && args.coin)
};

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_TOOL_ROUNDS = 3;

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

  const requestBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [...safeHistory, { role: "user", parts: [{ text: message }] }]
  };

  if (TOOLS_ENABLED) {
    requestBody.tools = [{ functionDeclarations: TOOL_DECLARATIONS }];
  }

  try {
    let parts = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await callGemini(process.env.GEMINI_API_KEY, requestBody);

      if (!result.ok) {
        console.error("Gemini API error:", result.data);
        res.status(502).json({ error: "The Hamster brain is unavailable right now." });
        return;
      }

      parts = result.data?.candidates?.[0]?.content?.parts || [];
      const functionCallParts = TOOLS_ENABLED ? parts.filter(part => part.functionCall) : [];

      if (functionCallParts.length === 0 || round === MAX_TOOL_ROUNDS) {
        break;
      }

      const responseParts = await Promise.all(functionCallParts.map(async (part) => {
        const handler = TOOL_HANDLERS[part.functionCall.name];
        let toolResponse;
        try {
          toolResponse = handler
            ? await handler(part.functionCall.args)
            : { error: "Unknown tool." };
        } catch (err) {
          console.error(part.functionCall.name + " failed:", err);
          toolResponse = { error: "Tool temporarily unavailable." };
        }
        return { functionResponse: { name: part.functionCall.name, response: toolResponse } };
      }));

      requestBody.contents.push(
        { role: "model", parts: functionCallParts },
        { role: "user", parts: responseParts }
      );
    }

    const reply = parts.find(part => part.text)?.text;

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
