import express from "express";
import { createAuditRoutes } from "./routes/auditRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok"
    });
  });

  app.use("/api/audits", createAuditRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

