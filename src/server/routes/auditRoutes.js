import { Router } from "express";
import { analyzeAll, analyzePerformance, analyzeSeo, analyzeSecurity } from "../controllers/auditController.js";

export function createAuditRoutes() {
  const router = Router();

  router.post("/perf", analyzePerformance);
  router.post("/seo", analyzeSeo);
  router.post("/security", analyzeSecurity);
  router.post("/all", analyzeAll);

  return router;
}

