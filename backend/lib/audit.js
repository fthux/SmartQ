export function logItem(type, message, details = {}) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    message,
    ...details,
    createdAt: new Date().toISOString(),
  };
}
