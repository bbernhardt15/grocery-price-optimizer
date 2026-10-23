import { Account, AuthIdentity, type AccountDoc } from "./models";

export type VerifiedIdentity = {
  provider: "apple" | "google" | "email";
  subject: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
};

function normalizeEmail(email: string | undefined): string | undefined {
  const value = email?.trim().toLowerCase() ?? "";
  if (!value || value.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return undefined;
  return value;
}

function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000);
}

async function loadAccount(id: string): Promise<AccountDoc | null> {
  const doc = await Account.findById(id).lean();
  return doc ? (doc as unknown as AccountDoc) : null;
}

/**
 * One account per provider subject. A verified email joins an account that
 * already uses that address, so Apple, Google, and the magic link can be the
 * same shopper.
 */
export async function findOrCreateAccount(identity: VerifiedIdentity): Promise<{ account: AccountDoc; created: boolean }> {
  const email = identity.emailVerified ? normalizeEmail(identity.email) : undefined;
  const existingIdentity = await AuthIdentity.findOne({ provider: identity.provider, subject: identity.subject }).lean();
  if (existingIdentity) {
    const account = await loadAccount(String(existingIdentity.accountId));
    if (!account) {
      await AuthIdentity.deleteOne({ _id: existingIdentity._id });
    } else {
      if (email && !account.email) {
        await Account.updateOne({ _id: account._id, email: { $exists: false } }, { $set: { email, emailVerified: true } });
        account.email = email;
        account.emailVerified = true;
      }
      if (identity.displayName && !account.displayName) {
        await Account.updateOne({ _id: account._id, displayName: "" }, { $set: { displayName: identity.displayName } });
        account.displayName = identity.displayName;
      }
      return { account, created: false };
    }
  }

  if (email) {
    const byEmail = await Account.findOne({ email }).lean();
    if (byEmail) {
      await AuthIdentity.updateOne(
        { provider: identity.provider, subject: identity.subject },
        { $set: { accountId: String(byEmail._id), email } },
        { upsert: true }
      );
      const account = (await loadAccount(String(byEmail._id))) as AccountDoc;
      if (identity.displayName && !account.displayName) {
        await Account.updateOne({ _id: account._id }, { $set: { displayName: identity.displayName } });
        account.displayName = identity.displayName;
      }
      return { account, created: false };
    }
  }

  try {
    const created = await Account.create({
      ...(email ? { email, emailVerified: true } : { emailVerified: false }),
      displayName: identity.displayName?.slice(0, 80) || "",
    });
    try {
      await AuthIdentity.create({
        provider: identity.provider,
        subject: identity.subject,
        accountId: String(created._id),
        ...(email ? { email } : {}),
      });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const winner = await AuthIdentity.findOne({ provider: identity.provider, subject: identity.subject }).lean();
      await Account.deleteOne({ _id: created._id });
      if (!winner) throw error;
      const account = await loadAccount(String(winner.accountId));
      if (!account) throw error;
      return { account, created: false };
    }
    return { account: created.toObject() as AccountDoc, created: true };
  } catch (error) {
    if (!isDuplicate(error) || !email) throw error;
    const byEmail = await Account.findOne({ email }).lean();
    if (!byEmail) throw error;
    await AuthIdentity.updateOne(
      { provider: identity.provider, subject: identity.subject },
      { $set: { accountId: String(byEmail._id), email } },
      { upsert: true }
    );
    return { account: (await loadAccount(String(byEmail._id))) as AccountDoc, created: false };
  }
}
