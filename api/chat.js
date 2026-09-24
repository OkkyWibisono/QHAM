const { holdsQham, isAddress } = require("./_lib/gate.js");
const { callGemini } = require("./_lib/gemini.js");
const { getQhamStats } = require("./_lib/stats.js");

const TOOLS_ENABLED = process.env.STATS_API_ENABLED === "true";

const BASE_SYSTEM_PROMPT =
  "You are the Quantum Hamster AI, the witty mascot chatbot for the Quantum Hamster " +
  "($QHAM) meme crypto community. Stay playful and on-brand (hamster/quantum puns " +
  "welcome), keep replies short (a few sentences max), and never give financial, " +
  "investment or trading advice - if asked, remind the user this isn't financial advice.";

const TOOL_SYSTEM_PROMPT_SUFFIX =
  " You have access to a get_qham_stats tool that returns live on-chain $QHAM data " +
  "(holder count, transfer count, total supply, top holders). Use it whenever asked " +
  "about real holder counts, supply, or on-chain activity instead of guessing or " +
  "deflecting - then answer with the real numbers it returns.";

const SYSTEM_PROMPT = TOOLS_ENABLED ? BASE_SYSTEM_PROMPT + TOOL_SYSTEM_PROMPT_SUFFIX : BASE_SYSTEM_PROMPT;

const STATS_TOOL_DECLARATION = {
  name: "get_qham_stats",
  description: "Get live on-chain stats for the QHAM token: holder count, transfer count, total supply, and top holders.",
  parameters: { type: "object", properties: {} }
};

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_TURNS = 6;

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
    requestBody.tools = [{ functionDeclarations: [STATS_TOOL_DECLARATION] }];
  }

  try {
    let result = await callGemini(process.env.GEMINI_API_KEY, requestBody);

    if (!result.ok) {
      console.error("Gemini API error:", result.data);
      res.status(502).json({ error: "The Hamster brain is unavailable right now." });
      return;
    }

    let parts = result.data?.candidates?.[0]?.content?.parts || [];
    const functionCallPart = parts.find(part => part.functionCall);

    if (TOOLS_ENABLED && functionCallPart) {
      let toolResponse;
      try {
        toolResponse = await getQhamStats();
      } catch (err) {
        console.error("get_qham_stats failed:", err);
        toolResponse = { error: "Stats are temporarily unavailable." };
      }

      requestBody.contents.push(
        { role: "model", parts: [functionCallPart] },
        {
          role: "user",
          parts: [{
            functionResponse: {
              name: functionCallPart.functionCall.name,
              response: toolResponse
            }
          }]
        }
      );

      result = await callGemini(process.env.GEMINI_API_KEY, requestBody);

      if (!result.ok) {
        console.error("Gemini API error (after tool call):", result.data);
        res.status(502).json({ error: "The Hamster brain is unavailable right now." });
        return;
      }

      parts = result.data?.candidates?.[0]?.content?.parts || [];
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
