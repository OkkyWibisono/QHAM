const GEMINI_MODEL = "gemini-3.5-flash-lite";
const RETRYABLE_STATUS = new Set([429, 503]);

async function callGemini(apiKey, body, { maxRetries = 2, baseDelayMs = 600 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );

    const data = await res.json();

    if (res.ok) {
      return { ok: true, data };
    }

    lastError = { status: res.status, data };

    const canRetry = RETRYABLE_STATUS.has(res.status) && attempt < maxRetries;
    if (!canRetry) {
      return { ok: false, status: res.status, data };
    }

    await new Promise(resolve => setTimeout(resolve, baseDelayMs * (attempt + 1)));
  }

  return { ok: false, status: lastError.status, data: lastError.data };
}

module.exports = { callGemini };
