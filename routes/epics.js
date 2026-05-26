const { Router } = require("express");
const { getMyEpics, getEpicChildren, NotConfiguredError } = require("../jira");

const router = Router();

router.get("/api/epics", async (req, res) => {
  try {
    const epics = await getMyEpics();
    res.json({ configured: true, items: epics });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return res.json({ configured: false, items: [] });
    }
    res.status(500).json({ configured: true, error: err.message, items: [] });
  }
});

router.get("/api/epics/:key/children", async (req, res) => {
  try {
    const children = await getEpicChildren(req.params.key);
    res.json({ configured: true, items: children });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return res.json({ configured: false, items: [] });
    }
    res.status(500).json({ configured: true, error: err.message, items: [] });
  }
});

module.exports = router;
