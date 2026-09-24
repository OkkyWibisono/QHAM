module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.status(200).json({
    phase2: process.env.PHASE_2_ENABLED !== "false",
    phase3: process.env.PHASE_3_ENABLED === "true"
  });
};
