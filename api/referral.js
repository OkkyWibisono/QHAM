const { holdsQham, isAddress } = require("./_lib/gate.js");
const { redis } = require("./_lib/redis.js");

const REFERRAL_POINTS = 100;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { wallet, ref } = req.body || {};

  if (typeof wallet !== "string" || !isAddress(wallet)) {
    res.status(400).json({ error: "Missing or invalid wallet address" });
    return;
  }

  if (typeof ref !== "string" || !isAddress(ref)) {
    res.status(400).json({ error: "Missing or invalid referral address" });
    return;
  }

  if (wallet.toLowerCase() === ref.toLowerCase()) {
    res.status(400).json({ error: "Cannot refer yourself" });
    return;
  }

  try {
    const eligible = await holdsQham(wallet);
    if (!eligible) {
      res.status(403).json({ error: "Wallet must hold $QHAM to count as a referral." });
      return;
    }
  } catch (err) {
    console.error("Balance check failed:", err);
    res.status(502).json({ error: "Could not verify $QHAM balance right now. Try again shortly." });
    return;
  }

  const walletKey = wallet.toLowerCase();
  const refKey = ref.toLowerCase();

  try {
    const alreadyReferred = await redis.get("referred:" + walletKey);

    if (alreadyReferred) {
      res.status(200).json({ awarded: false, reason: "This wallet is already recorded as referred." });
      return;
    }

    await redis.set("referred:" + walletKey, refKey);
    const referrerPoints = await redis.incrby("points:" + refKey, REFERRAL_POINTS);
    await redis.sadd("referrals:" + refKey, walletKey);

    res.status(200).json({ awarded: true, referrerPoints });
  } catch (err) {
    console.error("Referral recording failed:", err);
    res.status(500).json({ error: "Something went wrong recording the referral." });
  }
};
