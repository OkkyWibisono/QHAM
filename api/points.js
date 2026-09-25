const { isAddress } = require("./_lib/gate.js");
const { redis } = require("./_lib/redis.js");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const wallet = req.query && req.query.wallet;

  if (typeof wallet !== "string" || !isAddress(wallet)) {
    res.status(400).json({ error: "Missing or invalid wallet address" });
    return;
  }

  const walletKey = wallet.toLowerCase();

  try {
    const [referralPoints, referralCount, rewardPoints] = await Promise.all([
      redis.get("points:" + walletKey),
      redis.scard("referrals:" + walletKey),
      redis.get("reward-points:" + walletKey)
    ]);

    res.status(200).json({
      referralPoints: Number(referralPoints) || 0,
      referralCount: Number(referralCount) || 0,
      rewardPoints: Number(rewardPoints) || 0
    });
  } catch (err) {
    console.error("Points lookup failed:", err);
    res.status(500).json({ error: "Something went wrong fetching points." });
  }
};
