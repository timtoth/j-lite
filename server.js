const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");

const ticketsRouter = require("./routes/tickets");
const instructRouter = require("./routes/instruct");
const epicsRouter = require("./routes/epics");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "client", "dist")));

app.use(ticketsRouter);
app.use(instructRouter);
app.use(epicsRouter);

// Catch-all: serve React app for any non-API route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
