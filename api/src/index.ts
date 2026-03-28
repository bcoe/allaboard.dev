import express from "express";
import cors from "cors";
import db from "./db";
import climbsRouter from "./routes/climbs";
import usersRouter from "./routes/users";
import sessionsRouter from "./routes/sessions";
import logEntriesRouter from "./routes/logEntries";
import feedRouter from "./routes/feed";
import statsRouter from "./routes/stats";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.use("/climbs", climbsRouter);
app.use("/users", usersRouter);
app.use("/sessions", sessionsRouter);
app.use("/log-entries", logEntriesRouter);
app.use("/feed", feedRouter);
app.use("/stats", statsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

async function start() {
  const [batch, applied] = await db.migrate.latest();
  if (applied.length > 0) {
    console.log(`Migrations: batch ${batch} — ran ${applied.length}:`, applied);
  } else {
    console.log("Migrations: up to date");
  }
  app.listen(PORT, () => {
    console.log(`allaboard API running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
