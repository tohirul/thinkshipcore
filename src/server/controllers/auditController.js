import { parseAllAuditsInput, parseCommonAuditInput } from "../validation/auditInput.js";
import { runAllAudits, runSingleAudit } from "../services/auditService.js";

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

