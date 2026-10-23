import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, it } from "node:test";
import { signEs256Jwt } from "./jwt";

describe("apple client secret", () => {
  it("signs an ES256 JWT the Apple token endpoint can verify", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = Math.floor(Date.now() / 1000);
    const token = signEs256Jwt(pem, "KEY123", {
      iss: "TEAMID",
      iat: now,
      exp: now + 3600,
      aud: "https://appleid.apple.com",
      sub: "app.grocerygitter.service",
    });
    const [header, payload, signature] = token.split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).kid, "KEY123");
    assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub, "app.grocerygitter.service");
    const ok = verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    assert.equal(ok, true);
  });
});
