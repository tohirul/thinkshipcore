import { runDeepAudit } from "../../core/prompt/agent.js";
import { runAllAudits, runSingleAudit } from "../services/auditService.js";
import {
  parseAllAuditsInput,
  parseCommonAuditInput,
} from "../validation/auditInput.js";

function createSingleAuditHandler(type) {
  return async function handleSingleAudit(req, res, next) {
    try {
      const input = parseCommonAuditInput(req.body);
      const report = await runSingleAudit(type, input);
      res.status(200).json(report);
    } catch (error) {
      next(error);
    }
  };
}

export const analyzePerformance = createSingleAuditHandler("perf");
export const analyzeSeo = createSingleAuditHandler("seo");
export const analyzeSecurity = createSingleAuditHandler("security");

export async function analyzeAll(req, res, next) {
  try {
    const input = parseAllAuditsInput(req.body);
    const report = await runAllAudits(input);
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
}

export async function analyzeDeep(req, res, next) {
  try {
    // 1. Run the standard hard-coded audits (Perf, SEO, Security)
    const input = parseAllAuditsInput(req.body);
    const standardReport = await runAllAudits(input);

    // 2. Pass the results to the AI Agent
    const aiAnalysis = await runDeepAudit(standardReport);

    // 3. Merge and return
    res.status(200).json({
      ...standardReport,
      deepAnalysis: aiAnalysis,
    });
  } catch (error) {
    next(error);
  }
}
