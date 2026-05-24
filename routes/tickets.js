const { Router } = require("express");
const { getMyTickets, getTicketDescription, NotConfiguredError } = require("../jira");

const router = Router();

router.get("/api/tickets", async (req, res) => {
  try {
    const tickets = await getMyTickets();
    res.json({ configured: true, items: tickets });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return res.json({ configured: false, items: [] });
    }
    res.status(500).json({ configured: true, error: err.message, items: [] });
  }
});

router.get("/api/tickets/:key/description", async (req, res) => {
  try {
    const description = await getTicketDescription(req.params.key);
    res.json({ description });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return res.status(503).json({ error: "not_configured" });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
