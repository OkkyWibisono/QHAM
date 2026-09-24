const { JsonRpcProvider, Contract, formatUnits, ZeroAddress } = require("ethers");

const QHAM_ADDRESS = "0xfF4Cd1e8a604CB75d8AF80B71fB5144DB9A44E42";
const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
const DEPLOY_BLOCK = 47249579;
const LOG_CHUNK_SIZE = 999; // Base Sepolia's public RPC caps eth_getLogs to a 1,000 block range

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

async function getQhamStats() {
  const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC_URL);
  const token = new Contract(QHAM_ADDRESS, ERC20_ABI, provider);

  const [totalSupply, decimals, symbol, latestBlock] = await Promise.all([
    token.totalSupply(),
    token.decimals(),
    token.symbol(),
    provider.getBlockNumber()
  ]);

  const events = [];
  for (let from = DEPLOY_BLOCK; from <= latestBlock; from += LOG_CHUNK_SIZE + 1) {
    const to = Math.min(from + LOG_CHUNK_SIZE, latestBlock);
    const chunk = await token.queryFilter(token.filters.Transfer(), from, to);
    events.push(...chunk);
  }

  const balances = new Map();
  for (const event of events) {
    const { from, to, value } = event.args;

    if (from !== ZeroAddress) {
      balances.set(from, (balances.get(from) || 0n) - value);
    }
    balances.set(to, (balances.get(to) || 0n) + value);
  }

  const holders = [];
  for (const [address, balance] of balances) {
    if (balance > 0n) {
      holders.push({ address, balance: formatUnits(balance, decimals) });
    }
  }
  holders.sort((a, b) => Number(b.balance) - Number(a.balance));

  return {
    symbol,
    totalSupply: formatUnits(totalSupply, decimals),
    holderCount: holders.length,
    transferCount: events.length,
    topHolders: holders.slice(0, 10)
  };
}

module.exports = { getQhamStats };
