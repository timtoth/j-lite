const { Router } = require("express");
const { getMyTickets, getTicketDescription } = require("../jira");

const router = Router();

router.get("/api/tickets", async (req, res) => {
  try {
    const tickets = await getMyTickets();
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/tickets/:key/description", async (req, res) => {
  try {
    const description = await getTicketDescription(req.params.key);
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
