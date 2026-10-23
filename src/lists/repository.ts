import { SharedList } from "../models/SharedList";
import { publishList } from "./hub";
import {
  applyItemWrites,
  cleanDisplayName,
  cleanTitle,
  hashSecret,
  isShareToken,
  newSecretToken,
  parseItemWrites,
  pollBody,
  secretMatches,
  storedItems,
  toPublicList,
  type ListMode,
  type ListRole,
  type PollBody,
  type PublicList,
  type SharedItem,
} from "./sharedList";

const MAX_RETIRED = 10;

export type ListRecord = {
  id: unknown;
  shareTokenHash: string;
  ownerTokenHash: string;
  title: string;
  mode: ListMode;
  revokedAt: Date | null;
  items: SharedItem[];
  seq: number;
  updatedAt: Date;
};

type FoundList = { kind: "missing" } | { kind: "retired" } | { kind: "list"; record: ListRecord };

type ListFailure = { ok: false; status: number; error: string };
type ListSuccess<T> = { ok: true } & T;

function fromDoc(doc: Record<string, unknown>): ListRecord {
  const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt : new Date();
  return {
    id: doc._id,
    shareTokenHash: String(doc.shareTokenHash ?? ""),
    ownerTokenHash: String(doc.ownerTokenHash ?? ""),
    title: typeof doc.title === "string" ? doc.title : "Shopping list",
    mode: doc.mode === "view" ? "view" : "edit",
    revokedAt: doc.revokedAt instanceof Date ? doc.revokedAt : null,
    items: storedItems(doc.items),
    seq: typeof doc.seq === "number" ? doc.seq : 0,
    updatedAt,
  };
}

function mongoItems(items: readonly SharedItem[]): Record<string, unknown>[] {
  return items.map((item) => {
    const row: Record<string, unknown> = {
      itemId: item.itemId,
      name: item.name,
      quantity: item.quantity,
      checked: item.checked,
      writtenAt: item.writtenAt,
      updatedAt: new Date(item.updatedAt),
      deleted: item.deleted,
    };
    if (item.catalogId) row.catalogId = item.catalogId;
    if (item.brand) row.brand = item.brand;
    if (item.sizeLabel) row.sizeLabel = item.sizeLabel;
    if (item.addedBy) row.addedBy = item.addedBy;
    if (item.checkedBy) row.checkedBy = item.checkedBy;
    return row;
  });
}

function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000);
}

function notify(previousHash: string, nextHash: string, seq: number): void {
  publishList(nextHash, seq);
  if (previousHash !== nextHash) {
    publishList(previousHash, seq);
  }
}

export async function findPresentedToken(token: string): Promise<FoundList> {
  if (!isShareToken(token)) {
    return { kind: "missing" };
  }
  const hash = hashSecret(token);
  const current = await SharedList.findOne({ shareTokenHash: hash }).lean();
  if (current) {
    return { kind: "list", record: fromDoc(current as Record<string, unknown>) };
  }
  const retired = await SharedList.findOne({ retiredHashes: hash }).lean();
  if (retired) {
    return { kind: "retired" };
  }
  return { kind: "missing" };
}

function roleFor(record: ListRecord, ownerToken: string | undefined): ListRole {
  if (ownerToken && secretMatches(ownerToken, record.ownerTokenHash)) {
    return "owner";
  }
  return "guest";
}

function present(record: ListRecord, shareToken: string, role: ListRole): PublicList {
  return toPublicList({
    shareToken,
    title: record.title,
    mode: record.mode,
    role,
    seq: record.seq,
    updatedAt: record.updatedAt,
    revoked: Boolean(record.revokedAt),
    items: record.items,
  });
}

export async function readSharedList(
  shareToken: string,
  ownerToken: string | undefined,
  since: number | undefined
): Promise<ListFailure | ListSuccess<{ body: PollBody }>> {
  const found = await findPresentedToken(shareToken);
  if (found.kind === "retired") {
    return { ok: false, status: 410, error: "This link was turned off." };
  }
  if (found.kind === "missing") {
    return { ok: false, status: 404, error: "No list for that link." };
  }
  const role = roleFor(found.record, ownerToken);
  if (found.record.revokedAt && role !== "owner") {
    return { ok: false, status: 410, error: "This link was turned off." };
  }
  return { ok: true, body: pollBody(present(found.record, shareToken, role), since) };
}

export async function createOrResumeList(input: {
  ownerToken?: unknown;
  shareToken?: unknown;
  title?: unknown;
  displayName?: unknown;
  items?: unknown;
  rotate?: unknown;
  now?: number;
}): Promise<ListFailure | ListSuccess<{ shareToken: string; ownerToken: string; list: PublicList; created: boolean }>> {
  const now = input.now ?? Date.now();
  const displayName = cleanDisplayName(input.displayName);
  const title = cleanTitle(input.title);
  const presentedOwner = typeof input.ownerToken === "string" ? input.ownerToken : undefined;
  if (presentedOwner !== undefined && !isShareToken(presentedOwner)) {
    return { ok: false, status: 400, error: "The saved list identity is not valid." };
  }
  const presentedShare = typeof input.shareToken === "string" ? input.shareToken : undefined;
  if (presentedShare !== undefined && !isShareToken(presentedShare)) {
    return { ok: false, status: 400, error: "That share link is not valid." };
  }

  if (presentedOwner) {
    const existing = await SharedList.findOne({ ownerTokenHash: hashSecret(presentedOwner) }).lean();
    if (existing) {
      return resumeExisting(
        fromDoc(existing as Record<string, unknown>),
        presentedOwner,
        presentedShare,
        input.rotate === true,
        input.items,
        displayName,
        now
      );
    }
  }

  const parsed = parseItemWrites(input.items, now);
  if ("error" in parsed) {
    return { ok: false, status: 400, error: parsed.error };
  }
  const applied =
    parsed.writes.length > 0
      ? applyItemWrites([], parsed.writes, displayName, now)
      : { ok: true as const, items: [] as SharedItem[], changed: false };
  if (!applied.ok) {
    return { ok: false, status: 400, error: applied.error };
  }

  const ownerToken = presentedOwner ?? newSecretToken();
  const shareToken = newSecretToken();
  try {
    await SharedList.create({
      shareTokenHash: hashSecret(shareToken),
      ownerTokenHash: hashSecret(ownerToken),
      retiredHashes: [],
      title,
      mode: "edit",
      revokedAt: null,
      items: mongoItems(applied.items),
      seq: applied.changed ? 1 : 0,
    });
  } catch (error) {
    if (isDuplicate(error) && presentedOwner) {
      const again = await SharedList.findOne({ ownerTokenHash: hashSecret(presentedOwner) }).lean();
      if (again) {
        return resumeExisting(
          fromDoc(again as Record<string, unknown>),
          presentedOwner,
          presentedShare,
          input.rotate === true,
          input.items,
          displayName,
          now
        );
      }
    }
    throw error;
  }

  const saved = await findPresentedToken(shareToken);
  if (saved.kind !== "list") {
    return { ok: false, status: 500, error: "The list could not be saved." };
  }
  return {
    ok: true,
    shareToken,
    ownerToken,
    created: true,
    list: present(saved.record, shareToken, "owner"),
  };
}

async function resumeExisting(
  record: ListRecord,
  ownerToken: string,
  presentedShare: string | undefined,
  rotate: boolean,
  items: unknown,
  displayName: string | undefined,
  now: number,
  attempt = 0
): Promise<ListFailure | ListSuccess<{ shareToken: string; ownerToken: string; list: PublicList; created: boolean }>> {
  if (attempt > 2) {
    return { ok: false, status: 409, error: "Someone else edited this list at the same time. Try again." };
  }
  const shareMatches = Boolean(presentedShare && secretMatches(presentedShare, record.shareTokenHash));
  const wantsNewLink = rotate || (Boolean(record.revokedAt) && !presentedShare);
  if (!wantsNewLink && !shareMatches) {
    return {
      ok: false,
      status: 409,
      error: "This device does not have the current link. Share again to make a new one.",
    };
  }

  const docUpdate: Record<string, unknown> = {};
  let shareToken = presentedShare && shareMatches ? presentedShare : "";
  if (wantsNewLink) {
    shareToken = newSecretToken();
    docUpdate.shareTokenHash = hashSecret(shareToken);
    docUpdate.revokedAt = null;
    const previous = await SharedList.findById(record.id).select("retiredHashes").lean();
    const prior = Array.isArray(previous?.retiredHashes) ? previous.retiredHashes.map(String) : [];
    docUpdate.retiredHashes = [record.shareTokenHash, ...prior].slice(0, MAX_RETIRED);
    docUpdate.seq = record.seq + 1;
  }

  const live = record.items.some((item) => !item.deleted);
  if (!live && items !== undefined) {
    const parsed = parseItemWrites(items, now);
    if ("error" in parsed) {
      return { ok: false, status: 400, error: parsed.error };
    }
    if (parsed.writes.length > 0) {
      const applied = applyItemWrites([], parsed.writes, displayName, now);
      if (!applied.ok) {
        return { ok: false, status: 400, error: applied.error };
      }
      docUpdate.items = mongoItems(applied.items);
      docUpdate.seq = record.seq + 1;
    }
  }

  if (Object.keys(docUpdate).length === 0) {
    return { ok: true, shareToken, ownerToken, created: false, list: present(record, shareToken, "owner") };
  }

  docUpdate.updatedAt = new Date(now);
  const saved = await SharedList.findOneAndUpdate(
    { _id: record.id, seq: record.seq },
    { $set: docUpdate },
    { new: true }
  ).lean();
  if (!saved) {
    const again = await SharedList.findById(record.id).lean();
    if (!again) {
      return { ok: false, status: 404, error: "No list for that link." };
    }
    return resumeExisting(
      fromDoc(again as Record<string, unknown>),
      ownerToken,
      presentedShare,
      rotate,
      items,
      displayName,
      now,
      attempt + 1
    );
  }
  const next = fromDoc(saved as Record<string, unknown>);
  notify(record.shareTokenHash, next.shareTokenHash, next.seq);
  return { ok: true, shareToken, ownerToken, created: false, list: present(next, shareToken, "owner") };
}

export async function writeSharedItems(input: {
  shareToken: string;
  ownerToken?: string;
  displayName?: unknown;
  items: unknown;
  now?: number;
}): Promise<ListFailure | ListSuccess<{ list: PublicList }>> {
  const found = await findPresentedToken(input.shareToken);
  if (found.kind === "retired") {
    return { ok: false, status: 410, error: "This link was turned off." };
  }
  if (found.kind === "missing") {
    return { ok: false, status: 404, error: "No list for that link." };
  }

  const now = input.now ?? Date.now();
  const parsed = parseItemWrites(input.items, now);
  if ("error" in parsed) {
    return { ok: false, status: 400, error: parsed.error };
  }
  if (parsed.writes.length === 0) {
    return { ok: false, status: 400, error: "Send at least one item change." };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentFound = attempt === 0 ? found : await findPresentedToken(input.shareToken);
    if (currentFound.kind !== "list") {
      return {
        ok: false,
        status: currentFound.kind === "retired" ? 410 : 404,
        error: currentFound.kind === "retired" ? "This link was turned off." : "No list for that link.",
      };
    }
    const record = currentFound.record;
    const role = roleFor(record, input.ownerToken);
    if (record.revokedAt && role !== "owner") {
      return { ok: false, status: 410, error: "This link was turned off." };
    }
    if (role !== "owner" && record.mode !== "edit") {
      return { ok: false, status: 403, error: "This list is view-only." };
    }

    const applied = applyItemWrites(record.items, parsed.writes, cleanDisplayName(input.displayName), now);
    if (!applied.ok) {
      return { ok: false, status: 400, error: applied.error };
    }
    if (!applied.changed) {
      return { ok: true, list: present(record, input.shareToken, role) };
    }

    const saved = await SharedList.findOneAndUpdate(
      { _id: record.id, seq: record.seq },
      { $set: { items: mongoItems(applied.items), seq: record.seq + 1, updatedAt: new Date(now) } },
      { new: true }
    ).lean();
    if (!saved) {
      continue;
    }
    const next = fromDoc(saved as Record<string, unknown>);
    publishList(next.shareTokenHash, next.seq);
    return { ok: true, list: present(next, input.shareToken, role) };
  }

  return { ok: false, status: 409, error: "Someone else edited this list at the same time. Try again." };
}

export async function updateListSettings(input: {
  shareToken: string;
  ownerToken?: string;
  mode?: unknown;
  revoke?: unknown;
  rotate?: unknown;
  now?: number;
}): Promise<ListFailure | ListSuccess<{ shareToken: string; list: PublicList }>> {
  if (!input.ownerToken || !isShareToken(input.ownerToken)) {
    return { ok: false, status: 403, error: "Only the person who shared this list can change the link." };
  }
  const found = await findPresentedToken(input.shareToken);
  if (found.kind === "retired") {
    return { ok: false, status: 410, error: "This link was turned off." };
  }
  if (found.kind === "missing") {
    return { ok: false, status: 404, error: "No list for that link." };
  }
  if (!secretMatches(input.ownerToken, found.record.ownerTokenHash)) {
    return { ok: false, status: 403, error: "Only the person who shared this list can change the link." };
  }

  const update: Record<string, unknown> = {};
  if (input.mode === "view" || input.mode === "edit") {
    update.mode = input.mode;
  }
  let shareToken = input.shareToken;
  if (input.rotate === true) {
    shareToken = newSecretToken();
    update.shareTokenHash = hashSecret(shareToken);
    update.revokedAt = null;
    const previous = await SharedList.findById(found.record.id).select("retiredHashes").lean();
    const prior = Array.isArray(previous?.retiredHashes) ? previous.retiredHashes.map(String) : [];
    update.retiredHashes = [found.record.shareTokenHash, ...prior].slice(0, MAX_RETIRED);
  } else if (input.revoke === true) {
    update.revokedAt = new Date(input.now ?? Date.now());
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, status: 400, error: "Nothing to change." };
  }

  update.seq = found.record.seq + 1;
  update.updatedAt = new Date(input.now ?? Date.now());
  const saved = await SharedList.findOneAndUpdate({ _id: found.record.id }, { $set: update }, { new: true }).lean();
  if (!saved) {
    return { ok: false, status: 404, error: "No list for that link." };
  }
  const next = fromDoc(saved as Record<string, unknown>);
  notify(found.record.shareTokenHash, next.shareTokenHash, next.seq);
  return { ok: true, shareToken, list: present(next, shareToken, "owner") };
}

/**
 * Delete one shared list when the caller presents its owner secret.
 * A current or retired share token is enough to find the document.
 * Missing is idempotent. A token that does not match the owner does not delete.
 */
export async function deleteOwnedSharedList(
  shareToken: string,
  ownerToken: string
): Promise<"deleted" | "missing" | "refused"> {
  if (!isShareToken(shareToken) || !isShareToken(ownerToken)) {
    return "refused";
  }
  const hash = hashSecret(shareToken);
  const doc = await SharedList.findOne({
    $or: [{ shareTokenHash: hash }, { retiredHashes: hash }],
  }).lean();
  if (!doc) {
    return "missing";
  }
  if (!secretMatches(ownerToken, String(doc.ownerTokenHash ?? ""))) {
    return "refused";
  }
  const removed = await SharedList.deleteOne({ _id: doc._id });
  if (!removed.deletedCount) {
    return "missing";
  }
  const shareHash = String(doc.shareTokenHash ?? "");
  const seq = typeof doc.seq === "number" ? doc.seq : 0;
  if (shareHash) {
    publishList(shareHash, seq + 1);
  }
  return "deleted";
}

/**
 * Attach a signed-in account, or the creating device, to a list the caller owns.
 * A list already claimed by a different account is left alone.
 */
export async function tagOwnedSharedList(input: {
  shareToken: string;
  ownerToken: string;
  accountId?: string;
  ownerDeviceId?: string;
}): Promise<"tagged" | "missing" | "refused"> {
  if (!isShareToken(input.shareToken) || !isShareToken(input.ownerToken)) {
    return "refused";
  }
  const hash = hashSecret(input.shareToken);
  const doc = await SharedList.findOne({
    $or: [{ shareTokenHash: hash }, { retiredHashes: hash }],
  }).lean();
  if (!doc) return "missing";
  if (!secretMatches(input.ownerToken, String(doc.ownerTokenHash ?? ""))) return "refused";
  const update: Record<string, string> = {};
  const currentAccount = typeof doc.accountId === "string" ? doc.accountId : "";
  if (input.accountId) {
    if (currentAccount && currentAccount !== input.accountId) return "refused";
    if (!currentAccount) update.accountId = input.accountId;
  }
  const currentDevice = typeof doc.ownerDeviceId === "string" ? doc.ownerDeviceId : "";
  if (input.ownerDeviceId && !currentDevice) update.ownerDeviceId = input.ownerDeviceId;
  if (Object.keys(update).length === 0) return "tagged";
  await SharedList.updateOne({ _id: doc._id }, { $set: update });
  return "tagged";
}
