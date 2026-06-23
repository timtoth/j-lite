const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("./config"); // initialize config singleton (seeds config.json on first run)

const express = require("express");

const ticketsRouter = require("./routes/tickets");
const instructRouter = require("./routes/instruct");
const epicsRouter = require("./routes/epics");
const settingsRouter = require("./routes/settings");
const projectsRouter = require("./routes/projects");

const app = express();
const PORT = process.env.PORT || 3000;

// The renderer always lives on a different origin than the API:
//   dev:  Vite at http://localhost:5173, API at http://127.0.0.1:<random>
//   prod: file:// loaded HTML, API at http://127.0.0.1:<random>
// Allow localhost-style origins so the renderer can reach us. file:// fetches
// send no Origin header (or "null"), so they bypass this check entirely —
// browsers don't block them.
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && LOCALHOST_ORIGIN.test(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "5mb" }));

app.use(ticketsRouter);
app.use(instructRouter);
app.use(epicsRouter);
app.use(settingsRouter);
app.use(projectsRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
