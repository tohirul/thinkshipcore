export class AuditRegistry {
  constructor() {
    this.auditors = new Map();
  }

  register(auditor) {
    if (!auditor?.key) {
      throw new Error("Auditor key is required");
    }

    if (this.auditors.has(auditor.key)) {
      throw new Error(`Auditor "${auditor.key}" is already registered`);
    }

    this.auditors.set(auditor.key, auditor);
  }

  get(key) {
    return this.auditors.get(key);
  }

  keys() {
    return [...this.auditors.keys()];
  }
}

