const { isAddress } = require("../_lib/gate.js");
const { redis } = require("../_lib/redis.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.ADMIN_SECRET) {
    res.status(500).json({ error: "Admin awarding is not configured." });
    return;
  }

  const providedKey = req.headers && req.headers["x-admin-key"];
  if (providedKey !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { wallet, amount, reason } = req.body || {};

  if (typeof wallet !== "string" || !isAddress(wallet)) {
    res.status(400).json({ error: "Missing or invalid wallet address" });
    return;
  }

  const points = Number(amount);
  if (!Number.isFinite(points) || !Number.isInteger(points) || points <= 0) {
    res.status(400).json({ error: "Amount must be a positive whole number" });
    return;
  }

  const walletKey = wallet.toLowerCase();

  try {
    const rewardPoints = await redis.incrby("reward-points:" + walletKey, points);

    await redis.lpush("reward-points-log", JSON.stringify({
      wallet: walletKey,
      amount: points,
      reason: typeof reason === "string" ? reason.slice(0, 200) : "",
      at: Date.now()
    }));

    res.status(200).json({ awarded: true, rewardPoints });
  } catch (err) {
    console.error("Manual point award failed:", err);
    res.status(500).json({ error: "Something went wrong awarding points." });
  }
};
