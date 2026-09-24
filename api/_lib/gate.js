const { JsonRpcProvider, Contract, isAddress } = require("ethers");

const QHAM_ADDRESS = "0xfF4Cd1e8a604CB75d8AF80B71fB5144DB9A44E42";
const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function holdsQham(address) {
  const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC_URL);
  const token = new Contract(QHAM_ADDRESS, ERC20_ABI, provider);
  const balance = await token.balanceOf(address);
  return balance > 0n;
}

module.exports = { holdsQham, isAddress };
