const { getQhamStats } = require("./_lib/stats.js");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (process.env.STATS_API_ENABLED !== "true") {
    res.status(503).json({ error: "Stats API is not yet available." });
    return;
  }

  try {
    const stats = await getQhamStats();
    res.status(200).json(stats);
  } catch (err) {
    console.error("Stats fetch failed:", err);
    res.status(500).json({ error: "Something went wrong fetching stats." });
  }
};
