async function getCryptoPrice(coinId) {
  const id = String(coinId || "").trim().toLowerCase();

  if (!id) {
    return { error: "No coin specified." };
  }

  const url = "https://api.coingecko.com/api/v3/simple/price?ids="
    + encodeURIComponent(id) + "&vs_currencies=usd&include_24hr_change=true";

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || !data[id]) {
    return { error: "Could not find price data for '" + id + "'." };
  }

  return {
    coin: id,
    usd: data[id].usd,
    usd_24h_change_percent: data[id].usd_24h_change
  };
}

module.exports = { getCryptoPrice };
