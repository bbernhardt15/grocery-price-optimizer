import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  normalizeWalmartPrivateKey,
  walmartAuthHeaders,
} from "./walmartAuth";

describe("walmartAuthHeaders", () => {
  it("RSA-SHA256 signs consumerId, timestamp, and key version", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const timestampMs = 1_700_000_000_000;
    const headers = walmartAuthHeaders(
      {
        consumerId: "consumer-1",
        privateKeyPem: privateKey,
        keyVersion: "1",
      },
      { timestampMs, correlationId: "corr-1" }
    );

    assert.equal(headers["WM_CONSUMER.ID"], "consumer-1");
    assert.equal(headers["WM_CONSUMER.INTIMESTAMP"], String(timestampMs));
    assert.equal(headers["WM_SEC.KEY_VERSION"], "1");
    assert.equal(headers["WM_QOS.CORRELATION_ID"], "corr-1");

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`consumer-1\n${timestampMs}\n1\n`);
    verifier.end();
    assert.equal(
      verifier.verify(publicKey, headers["WM_SEC.AUTH_SIGNATURE"], "base64"),
      true
    );
  });

  it("unwraps escaped PEM newlines from env-style private keys", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----";
    const escaped = pem.replaceAll("\n", "\\n");
    assert.equal(normalizeWalmartPrivateKey(escaped), pem);
  });
});
