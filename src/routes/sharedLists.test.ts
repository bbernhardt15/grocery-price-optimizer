import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { SharedList } from "../models/SharedList";
import { MAX_LIST_ITEMS } from "../lists/sharedList";

type Created = {
  status: number;
  shareToken: string;
  ownerToken: string;
  list: {
    shareToken: string;
    role: string;
    mode: string;
    canEdit: boolean;
    seq: number;
    items: Array<Record<string, unknown>>;
  };
};

describe("shared shopping lists", { concurrency: 1 }, () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const previousWriteLimit = process.env.LIST_WRITE_LIMIT;
  const previousIpLimit = process.env.LIST_WRITE_IP_LIMIT;
  const previousCreateLimit = process.env.LIST_CREATE_LIMIT;

  before(async () => {
    process.env.LIST_WRITE_IP_LIMIT = "10000";
    process.env.LIST_CREATE_LIMIT = "1000";
    delete process.env.LIST_WRITE_LIMIT;
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
    restoreEnv("LIST_WRITE_LIMIT", previousWriteLimit);
    restoreEnv("LIST_WRITE_IP_LIMIT", previousIpLimit);
    restoreEnv("LIST_CREATE_LIMIT", previousCreateLimit);
  });

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  async function createList(body: Record<string, unknown> = {}): Promise<Created & { raw: string }> {
    const response = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    const json = JSON.parse(raw) as Created;
    return { status: response.status, ...json, raw };
  }

  function item(overrides: Record<string, unknown> = {}) {
    return {
      itemId: "upc:111",
      catalogId: "upc:111",
      name: "Whole Milk",
      brand: "Dairy Pure",
      quantity: 1,
      checked: false,
      writtenAt: 1_000,
      ...overrides,
    };
  }

  async function patchItems(
    shareToken: string,
    items: unknown[],
    extra: { ownerToken?: string; displayName?: string } = {}
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (extra.ownerToken) headers["x-list-owner"] = extra.ownerToken;
    const response = await fetch(`${origin}/api/lists/${shareToken}/items`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ displayName: extra.displayName, items }),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  it("shares one list and does not reveal another list or the owner secret", async () => {
    const milk = await createList({
      displayName: "Sam",
      title: "Friday shop",
      items: [item({ name: "Secret Milk" })],
    });
    const bread = await createList({
      displayName: "Alex",
      items: [item({ itemId: "upc:222", catalogId: "upc:222", name: "Private Bread", writtenAt: 2_000 })],
    });
    assert.equal(milk.status, 201);
    assert.equal(bread.status, 201);
    assert.notEqual(milk.shareToken, bread.shareToken);
    assert.equal(milk.raw.includes(milk.ownerToken), true);
    assert.equal(milk.raw.includes(bread.shareToken), false);
    assert.equal(milk.raw.includes("Private Bread"), false);

    const guest = await fetch(`${origin}/api/lists/${milk.shareToken}`);
    const guestText = await guest.text();
    const guestBody = JSON.parse(guestText) as { role: string; items: Array<{ name?: string; addedBy?: string }> };
    assert.equal(guest.status, 200);
    assert.equal(guestBody.role, "guest");
    assert.equal(guestBody.items[0]?.name, "Secret Milk");
    assert.equal(guestBody.items[0]?.addedBy, "Sam");
    assert.equal(guestText.includes(milk.ownerToken), false);
    assert.equal(guestText.includes(bread.shareToken), false);
    assert.equal(guestText.includes("Private Bread"), false);
    assert.equal(guestText.includes("ownerToken"), false);

    const missing = await fetch(`${origin}/api/lists/${"b".repeat(43)}`);
    assert.equal(missing.status, 404);
    const malformed = await fetch(`${origin}/api/lists/not-a-token`);
    assert.equal(malformed.status, 404);
    const index = await fetch(`${origin}/api/lists`);
    assert.equal(index.status, 404);

    const stored = await SharedList.findOne({ shareTokenHash: { $exists: true } }).lean();
    const storedText = JSON.stringify(stored);
    assert.equal(storedText.includes(milk.shareToken), false);
    assert.equal(storedText.includes(milk.ownerToken), false);
    assert.equal(storedText.includes(bread.ownerToken), false);
  });

  it("keeps the later edit when two people change the same item", async () => {
    const base = Date.now();
    const created = await createList({ items: [item({ quantity: 1, writtenAt: base })] });
    const older = await patchItems(created.shareToken, [item({ quantity: 9, writtenAt: base - 10_000 })]);
    assert.equal(older.status, 200);
    const olderItems = older.json.items as Array<{ quantity?: number }>;
    assert.equal(olderItems.find((entry) => entry.quantity === 9), undefined);

    const newer = await patchItems(
      created.shareToken,
      [item({ quantity: 2, checked: true, writtenAt: base + 1_000 })],
      { displayName: "Alex" }
    );
    assert.equal(newer.status, 200);
    const items = newer.json.items as Array<{ quantity?: number; checked?: boolean; checkedBy?: string; addedBy?: string }>;
    const milk = items.find((entry) => entry.quantity === 2);
    assert.equal(milk?.checked, true);
    assert.equal(milk?.checkedBy, "Alex");
    assert.equal(milk?.addedBy, undefined);

    const spoof = await patchItems(created.shareToken, [
      item({ quantity: 4, checked: true, writtenAt: base + 2_000, addedBy: "Mallory", checkedBy: "Mallory" }),
    ]);
    const spoofed = (spoof.json.items as Array<{ quantity?: number; addedBy?: string; checkedBy?: string }>).find(
      (entry) => !("deleted" in entry && entry.deleted)
    );
    assert.equal(spoofed?.quantity, 4);
    assert.equal(spoofed?.addedBy, undefined);
    assert.equal(spoofed?.checkedBy, "Alex");
  });

  it("lets the owner make a link view-only or turn it off without touching another list", async () => {
    const shared = await createList({ displayName: "Sam", items: [item()] });
    const other = await createList({
      items: [item({ itemId: "upc:333", name: "Other eggs", writtenAt: 1_100 })],
    });

    const locked = await fetch(`${origin}/api/lists/${shared.shareToken}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-list-owner": shared.ownerToken },
      body: JSON.stringify({ mode: "view" }),
    });
    assert.equal(locked.status, 200);
    const guestEdit = await patchItems(shared.shareToken, [item({ quantity: 3, writtenAt: 5_000 })], {
      displayName: "Alex",
    });
    assert.equal(guestEdit.status, 403);
    const ownerEdit = await patchItems(shared.shareToken, [item({ quantity: 3, writtenAt: 5_000 })], {
      ownerToken: shared.ownerToken,
      displayName: "Sam",
    });
    assert.equal(ownerEdit.status, 200);
    assert.equal((ownerEdit.json.items as Array<{ quantity?: number }>)[0]?.quantity, 3);

    const stranger = await fetch(`${origin}/api/lists/${shared.shareToken}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-list-owner": other.ownerToken },
      body: JSON.stringify({ revoke: true }),
    });
    assert.equal(stranger.status, 403);

    const revoked = await fetch(`${origin}/api/lists/${shared.shareToken}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-list-owner": shared.ownerToken },
      body: JSON.stringify({ revoke: true }),
    });
    assert.equal(revoked.status, 200);
    const guestRead = await fetch(`${origin}/api/lists/${shared.shareToken}`);
    assert.equal(guestRead.status, 410);
    const guestBody = await guestRead.json();
    assert.equal(JSON.stringify(guestBody).includes("Whole Milk"), false);
    const ownerRead = await fetch(`${origin}/api/lists/${shared.shareToken}`, {
      headers: { "x-list-owner": shared.ownerToken },
    });
    assert.equal(ownerRead.status, 200);
    const otherRead = await fetch(`${origin}/api/lists/${other.shareToken}`);
    const otherBody = (await otherRead.json()) as { items: Array<{ name?: string }> };
    assert.equal(otherRead.status, 200);
    assert.equal(otherBody.items[0]?.name, "Other eggs");

    const rotated = await fetch(`${origin}/api/lists/${shared.shareToken}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-list-owner": shared.ownerToken },
      body: JSON.stringify({ rotate: true }),
    });
    const rotatedBody = (await rotated.json()) as { shareToken: string; list: { items: Array<{ name?: string }> } };
    assert.equal(rotated.status, 200);
    assert.notEqual(rotatedBody.shareToken, shared.shareToken);
    const oldLink = await fetch(`${origin}/api/lists/${shared.shareToken}`);
    assert.equal(oldLink.status, 410);
    const fresh = await fetch(`${origin}/api/lists/${rotatedBody.shareToken}`);
    assert.equal(fresh.status, 200);
    assert.equal(rotatedBody.list.items.some((entry) => entry.name === "Whole Milk"), true);
  });

  it("caps the list size and rate-limits edits", async () => {
    const created = await createList();
    const tooMany = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) =>
      item({ itemId: `upc:${index}`, name: `Item ${index}`, writtenAt: 1_000 + index })
    );
    const refused = await patchItems(created.shareToken, tooMany);
    assert.equal(refused.status, 400);
    assert.match(String(refused.json.error), /100/);
    const stillEmpty = await fetch(`${origin}/api/lists/${created.shareToken}`);
    const emptyBody = (await stillEmpty.json()) as { items: unknown[] };
    assert.equal(emptyBody.items.length, 0);

    process.env.LIST_WRITE_LIMIT = "2";
    const limited = await createList({ items: [item({ itemId: "upc:limit", name: "Limit me" })] });
    const first = await patchItems(limited.shareToken, [item({ itemId: "upc:limit", name: "Limit me", quantity: 2, writtenAt: 2_000 })]);
    const second = await patchItems(limited.shareToken, [item({ itemId: "upc:limit", name: "Limit me", quantity: 3, writtenAt: 3_000 })]);
    const third = await patchItems(limited.shareToken, [item({ itemId: "upc:limit", name: "Limit me", quantity: 4, writtenAt: 4_000 })]);
    delete process.env.LIST_WRITE_LIMIT;
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.equal(third.json.error, "Too many list edits. Wait a moment and try again.");
  });

  it("says when nothing changed and pushes a live event after an edit", async () => {
    const created = await createList({ items: [item()] });
    const same = await fetch(`${origin}/api/lists/${created.shareToken}?since=${created.list.seq}`);
    const sameBody = (await same.json()) as { changed: boolean; items?: unknown };
    assert.equal(same.status, 200);
    assert.equal(sameBody.changed, false);
    assert.equal(sameBody.items, undefined);

    const controller = new AbortController();
    const stream = await fetch(`${origin}/api/lists/${created.shareToken}/events`, {
      signal: controller.signal,
      headers: { accept: "text/event-stream" },
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type") || "", /text\/event-stream/);
    const reader = stream.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    const readMore = async () => {
      try {
        const chunk = await reader.read();
        if (!chunk.done) buffer += decoder.decode(chunk.value, { stream: true });
        return chunk.done;
      } catch {
        return true;
      }
    };
    const deadline = Date.now() + 3000;
    while (!buffer.includes("event: list") && Date.now() < deadline) {
      if (await readMore()) break;
    }
    assert.match(buffer, /event: list/);
    const edit = patchItems(created.shareToken, [item({ quantity: 6, writtenAt: 8_000 })]);
    while (!buffer.includes('"seq":2') && !buffer.includes('"seq": 2') && Date.now() < deadline) {
      if (await readMore()) break;
    }
    controller.abort();
    const edited = await edit;
    assert.equal(edited.status, 200);
    assert.match(buffer, /"seq":2/);
  });
});
