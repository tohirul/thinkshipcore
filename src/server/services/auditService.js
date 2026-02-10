import { analyzeWebsite } from "../../core/index.js";

export async function runSingleAudit(type, input) {
  return analyzeWebsite({
    ...input,
    types: [type]
  });
}

export async function runAllAudits(input) {
  return analyzeWebsite(input);
}

