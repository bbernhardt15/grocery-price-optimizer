/**
 * Post-deploy check. No secrets are printed.
 *   npm run smoke -- https://example.up.railway.app Brandon-50y4
 */
const base = String(process.argv[2] || "").replace(/\/$/, "");
const code = String(process.argv[3] || "").trim();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!base || !code) {
  fail("Usage: npm run smoke -- <baseUrl> <inviteCode>");
  process.exit(1);
}

const deviceId = `smoke-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "x-device-id": deviceId,
      ...(init.headers || {}),
    },
  });
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  let body = {};
  if (type.includes("json") || text.startsWith("{") || text.startsWith("[")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  return { response, body, text };
}

const gate = await request("/api/beta/gate");
if (!gate.response.ok) fail(`gate failed (${gate.response.status})`);
else console.log(`gate required=${Boolean(gate.body.required)}`);

if (gate.body.required) {
  const wrong = await request("/api/beta/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "not-a-real-code", deviceId }),
  });
  if (wrong.response.status !== 401) fail(`wrong code should be rejected (${wrong.response.status})`);
  const invite = await request("/api/beta/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.slice(0, 1).toUpperCase() + code.slice(1), deviceId }),
  });
  if (!invite.response.ok || invite.body.ok !== true) fail(`invite was not accepted (${invite.response.status})`);
  else console.log("invite accepted");
}

const health = await request("/api/health/ready");
if (!health.response.ok || health.body.ok !== true) fail(`health failed (${health.response.status})`);
else console.log("health ok");

const plan = await request("/api/optimize-list", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    items: [
      { name: "Whole Milk", quantity: 1 },
      { name: "Large Eggs", quantity: 1 },
    ],
    zipCode: "45202",
    stores: ["Kroger", "Walmart"],
    allowSubstitutes: true,
  }),
});
if (!plan.response.ok) fail(`plan failed (${plan.response.status})`);
const stores = Array.isArray(plan.body.stores) ? plan.body.stores : [];
const items = stores.flatMap((store) => store.items || []);
const priced = items.filter((item) => Number(item.price) > 0);
const banners = new Set(priced.map((item) => String(item.storeName || "")));
const fromChain = [...banners].some((name) => /kroger|walmart/i.test(name));
if (!priced.length || !fromChain) fail("plan did not return a Kroger or Walmart price");
else console.log(`plan priced ${priced.length} line(s) at ${[...banners].join(", ") || "a store"}`);

if (!stores.length) fail("in-store data missing");
else console.log(`in-store stores ${stores.length}`);

if (process.exitCode) process.exit(process.exitCode);
console.log("smoke ok");
