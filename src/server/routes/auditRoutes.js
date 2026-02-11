import { Router } from "express";
import {
  analyzeAll,
  analyzeDeep,
  analyzeDeepProgress,
  analyzePerformance,
  analyzeSecurity,
  analyzeSeo,
} from "../controllers/auditController.js";

export function createAuditRoutes() {
  const router = Router();

  router.post("/perf", analyzePerformance);
  router.post("/seo", analyzeSeo);
  router.post("/security", analyzeSecurity);
  router.post("/all", analyzeAll);
  router.post("/deep", analyzeDeep);
  router.post("/deep/progress", analyzeDeepProgress);

  return router;
}
