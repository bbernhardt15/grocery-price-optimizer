export const SESSION_KEY = "gg-session";

/** Session tokens are 32 bytes of base64url. Ignore anything else in the URL. */
export function sessionFromSearch(search) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const token = params.get("session") || "";
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return "";
  return token;
}

/** Drop the session token from the address bar after it is stored. */
export function pathWithoutSession(path, search) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  params.delete("session");
  const query = params.toString();
  const base = path || "/";
  return `${base}${query ? `?${query}` : ""}`;
}

export function bearerHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
