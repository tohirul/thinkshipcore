export const LOG_LEVEL = {
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR"
};

export function deriveStatus(logs = []) {
  if (logs.some((entry) => entry.level === LOG_LEVEL.ERROR)) {
    return "FAIL";
  }

  if (logs.some((entry) => entry.level === LOG_LEVEL.WARNING)) {
    return "WARN";
  }

  return "PASS";
}

