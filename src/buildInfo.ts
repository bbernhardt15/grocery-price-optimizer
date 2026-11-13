import { execSync } from "node:child_process";

export const SHELL_VERSION = "v92";

/** Short commit from Railway, GIT_SHA, or the local git checkout. Never "local". */
export function commitSha(): string {
  const fromEnv = String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || "").trim();
  if (fromEnv && fromEnv.toLowerCase() !== "local") return fromEnv.slice(0, 7);
  try {
    const sha = execSync("git rev-parse --short=7 HEAD", {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[0-9a-f]{7,}$/i.test(sha)) return sha.slice(0, 7);
  } catch {
    /* no git metadata in this environment */
  }
  return "";
}

export function versionPayload(): { shell: string; sha?: string } {
  const sha = commitSha();
  return sha ? { shell: SHELL_VERSION, sha } : { shell: SHELL_VERSION };
}
