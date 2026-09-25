const { JsonRpcProvider, Wallet, Contract, parseUnits } = require("ethers");
const { isAddress } = require("./_lib/gate.js");
const { redis } = require("./_lib/redis.js");

const QHAM_ADDRESS = "0xfF4Cd1e8a604CB75d8AF80B71fB5144DB9A44E42";
const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
const POINTS_PER_QHAM = 1; // 1 point = 1 QHAM
const MIN_REDEEM_POINTS = 500;
const DAILY_REDEEM_CAP = 1000000; // QHAM, across all wallets combined, resets daily (UTC)

function todayKey() {
  return "redeemed-total:" + new Date().toISOString().slice(0, 10);
}

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { wallet, amount: requestedAmount } = req.body || {};

  if (typeof wallet !== "string" || !isAddress(wallet)) {
    res.status(400).json({ error: "Missing or invalid wallet address" });
    return;
  }

  const requestedPoints = Number(requestedAmount);
  if (!Number.isFinite(requestedPoints) || !Number.isInteger(requestedPoints) || requestedPoints <= 0) {
    res.status(400).json({ error: "Amount must be a positive whole number of points" });
    return;
  }

  if (requestedPoints < MIN_REDEEM_POINTS) {
    res.status(400).json({ error: "Minimum redemption is " + MIN_REDEEM_POINTS + " points." });
    return;
  }

  if (!process.env.FAUCET_PRIVATE_KEY) {
    res.status(500).json({ error: "Redemption is not configured." });
    return;
  }

  const walletKey = wallet.toLowerCase();
  const lockKey = "redeeming:" + walletKey;

  try {
    const lock = await redis.set(lockKey, "1", { nx: true, ex: 30 });
    if (lock === null) {
      res.status(409).json({ error: "A redemption is already in progress for this wallet." });
      return;
    }
  } catch (err) {
    console.error("Redeem lock failed:", err);
    res.status(502).json({ error: "Could not start redemption right now. Try again shortly." });
    return;
  }

  const pointsKey = "points:" + walletKey;
  const rewardKey = "reward-points:" + walletKey;

  let referralPoints = 0;
  let rewardPoints = 0;

  try {
    const [storedReferral, storedReward] = await Promise.all([
      redis.get(pointsKey),
      redis.get(rewardKey)
    ]);
    referralPoints = Number(storedReferral) || 0;
    rewardPoints = Number(storedReward) || 0;

    const totalPoints = referralPoints + rewardPoints;

    if (requestedPoints > totalPoints) {
      res.status(400).json({
        error: "Not enough points. You have " + totalPoints + " available.",
        available: totalPoints
      });
      return;
    }

    const qhamAmount = requestedPoints / POINTS_PER_QHAM;

    const dailyKey = todayKey();
    const dailyTotal = await redis.incrby(dailyKey, qhamAmount);
    if (dailyTotal === qhamAmount) {
      await redis.expire(dailyKey, 90000);
    }

    if (dailyTotal > DAILY_REDEEM_CAP) {
      await redis.decrby(dailyKey, qhamAmount);
      res.status(429).json({
        error: "Daily redemption cap of " + DAILY_REDEEM_CAP.toLocaleString("en-US") + " QHAM reached. Try again tomorrow."
      });
      return;
    }

    const referralDeduct = Math.min(referralPoints, requestedPoints);
    const rewardDeduct = requestedPoints - referralDeduct;

    await Promise.all([
      redis.set(pointsKey, referralPoints - referralDeduct),
      redis.set(rewardKey, rewardPoints - rewardDeduct)
    ]);

    try {
      const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC_URL);
      const signer = new Wallet(process.env.FAUCET_PRIVATE_KEY, provider);
      const token = new Contract(QHAM_ADDRESS, ERC20_ABI, signer);

      const decimals = await token.decimals();
      const amount = parseUnits(String(qhamAmount), decimals);

      const tx = await token.transfer(wallet, amount);

      res.status(200).json({ redeemed: true, qhamAmount, txHash: tx.hash });
    } catch (sendErr) {
      console.error("Redeem send failed:", sendErr);
      await Promise.all([
        redis.set(pointsKey, referralPoints),
        redis.set(rewardKey, rewardPoints),
        redis.decrby(dailyKey, qhamAmount)
      ]);
      res.status(500).json({ error: "Something went wrong sending your redemption. Your points have been restored." });
    }
  } catch (err) {
    console.error("Redeem failed:", err);
    res.status(500).json({ error: "Something went wrong processing your redemption." });
  } finally {
    try { await redis.del(lockKey); } catch (cleanupErr) { console.error("Redeem lock cleanup failed:", cleanupErr); }
  }
};
