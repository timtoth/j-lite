const { Router } = require("express");
const { getMyEpics, getEpicChildren } = require("../jira");

const router = Router();

router.get("/api/epics", async (req, res) => {
  try {
    const epics = await getMyEpics();
    res.json(epics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/epics/:key/children", async (req, res) => {
  try {
    const children = await getEpicChildren(req.params.key);
    res.json(children);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
