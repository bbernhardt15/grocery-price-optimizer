export function paywallBody(error: string, feature?: string): { error: string; code: "pro_required"; feature?: string } {
  return { error, code: "pro_required", ...(feature ? { feature } : {}) };
}
