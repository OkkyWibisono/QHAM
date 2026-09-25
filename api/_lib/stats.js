const { JsonRpcProvider, Contract, formatUnits, ZeroAddress } = require("ethers");

const QHAM_ADDRESS = "0xfF4Cd1e8a604CB75d8AF80B71fB5144DB9A44E42";
const DEVELOPER_WALLET = "0x623183b0aA5269bc041C874fe9640f9064A64BA1"; // 20% dev allocation, tracked separately from "holders"
const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
const DEPLOY_BLOCK = 47249579;
const LOG_CHUNK_SIZE = 999; // Base Sepolia's public RPC caps eth_getLogs to a 1,000 block range

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

async function queryFilterWithRetry(token, filter, from, to, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await token.queryFilter(filter, from, to);
    } catch (err) {
      const isRateLimited = err?.error?.code === -32007 || /request limit/i.test(err?.message || "");
      if (!isRateLimited || attempt === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
}

async function getQhamStats() {
  const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC_URL);
  const token = new Contract(QHAM_ADDRESS, ERC20_ABI, provider);

  const [totalSupply, decimals, symbol, latestBlock] = await Promise.all([
    token.totalSupply(),
    token.decimals(),
    token.symbol(),
    provider.getBlockNumber()
  ]);

  const ranges = [];
  for (let from = DEPLOY_BLOCK; from <= latestBlock; from += LOG_CHUNK_SIZE + 1) {
    ranges.push([from, Math.min(from + LOG_CHUNK_SIZE, latestBlock)]);
  }

  // Fetch chunks concurrently (in small batches, with a pause between batches
  // and retry-with-backoff on rate limiting) - sequential one-at-a-time awaits
  // made this endpoint time out on Vercel once the chain grew past ~10 chunks
  // worth of blocks, but the RPC's shared public tier also hard-caps at 25
  // requests/second, so unlimited concurrency just traded one failure for
  // another.
  const CONCURRENCY = 8;
  const filter = token.filters.Transfer();
  const events = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(([from, to]) => queryFilterWithRetry(token, filter, from, to))
    );
    results.forEach(chunk => events.push(...chunk));
    if (i + CONCURRENCY < ranges.length) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }

  const balances = new Map();
  let burntAmount = 0n;

  for (const event of events) {
    const { from, to, value } = event.args;

    if (from !== ZeroAddress) {
      balances.set(from, (balances.get(from) || 0n) - value);
    }
    if (to !== ZeroAddress) {
      balances.set(to, (balances.get(to) || 0n) + value);
    } else {
      burntAmount += value;
    }
  }

  const devWalletLower = DEVELOPER_WALLET.toLowerCase();
  const developerBalance = balances.get(DEVELOPER_WALLET)
    || [...balances.entries()].find(([addr]) => addr.toLowerCase() === devWalletLower)?.[1]
    || 0n;

  const holders = [];
  for (const [address, balance] of balances) {
    if (address.toLowerCase() === devWalletLower) continue;
    if (balance > 0n) {
      holders.push({ address, balance: formatUnits(balance, decimals) });
    }
  }
  holders.sort((a, b) => Number(b.balance) - Number(a.balance));

  const recentTransfers = events.slice(-10).reverse().map(event => ({
    from: event.args.from,
    to: event.args.to,
    amount: formatUnits(event.args.value, decimals),
    txHash: event.transactionHash,
    blockNumber: event.blockNumber
  }));

  return {
    symbol,
    totalSupply: formatUnits(totalSupply, decimals),
    burntAmount: formatUnits(burntAmount, decimals),
    developerAmount: formatUnits(developerBalance, decimals),
    holderCount: holders.length,
    transferCount: events.length,
    topHolders: holders.slice(0, 10),
    recentTransfers
  };
}

module.exports = { getQhamStats };
