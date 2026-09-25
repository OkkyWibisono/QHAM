const { JsonRpcProvider, Wallet, Contract, parseUnits } = require("ethers");
const { isAddress } = require("./_lib/gate.js");
const { redis } = require("./_lib/redis.js");

const QHAM_ADDRESS = "0xfF4Cd1e8a604CB75d8AF80B71fB5144DB9A44E42";
const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
const CLAIM_AMOUNT = "1000"; // QHAM, human units

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { wallet } = req.body || {};

  if (typeof wallet !== "string" || !isAddress(wallet)) {
    res.status(400).json({ error: "Missing or invalid wallet address" });
    return;
  }

  if (!process.env.FAUCET_PRIVATE_KEY) {
    res.status(500).json({ error: "Faucet is not configured." });
    return;
  }

  const walletKey = wallet.toLowerCase();
  const redisKey = "faucet:" + walletKey;

  let reserved = false;

  try {
    const reservation = await redis.set(redisKey, "pending", { nx: true });
    if (reservation === null) {
      res.status(403).json({ error: "This wallet has already claimed from the faucet." });
      return;
    }
    reserved = true;
  } catch (err) {
    console.error("Faucet reservation failed:", err);
    res.status(502).json({ error: "Could not verify claim status right now. Try again shortly." });
    return;
  }

  try {
    const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC_URL);
    const signer = new Wallet(process.env.FAUCET_PRIVATE_KEY, provider);
    const token = new Contract(QHAM_ADDRESS, ERC20_ABI, signer);

    const decimals = await token.decimals();
    const amount = parseUnits(CLAIM_AMOUNT, decimals);

    const tx = await token.transfer(wallet, amount);
    await redis.set(redisKey, tx.hash);

    res.status(200).json({ amount: CLAIM_AMOUNT, txHash: tx.hash });
  } catch (err) {
    console.error("Faucet send failed:", err);
    if (reserved) {
      try { await redis.del(redisKey); } catch (cleanupErr) { console.error("Faucet cleanup failed:", cleanupErr); }
    }
    res.status(500).json({ error: "Something went wrong sending the faucet claim. Please try again." });
  }
};
