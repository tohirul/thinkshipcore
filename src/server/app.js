// src/server/app.js

import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createAuditRoutes } from "./routes/auditRoutes.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.status(200).json({
      status: "ok",
      message: "ThinkShip-Core API is running!",
    });
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
    });
  });

  app.use("/api/audits", createAuditRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
