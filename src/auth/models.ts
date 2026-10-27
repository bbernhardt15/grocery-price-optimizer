import mongoose, { Schema } from "mongoose";

const accountSchema = new Schema(
  {
    email: { type: String },
    emailVerified: { type: Boolean, default: false },
    displayName: { type: String, default: "" },
    /** AES-GCM blob, same shape as the kroger_shopper cookie. Absent until a device links Kroger. */
    krogerSealed: { type: String },
    /**
     * Share tokens this account owns, sealed with AUTH_SECRET, so Delete my data
     * can drop collaborator watches without storing the raw token in the clear.
     */
    linkedLists: {
      type: [
        new Schema(
          {
            hash: { type: String, required: true },
            sealed: { type: String, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    /** `pro` while an App Store or Play subscription is active. Absent means free. */
    entitlement: { type: String, enum: ["free", "pro"], default: "free" },
    entitlementExpiresAt: { type: Date, default: null },
    /** RevenueCat app user id. The apps send this account's id. */
    revenueCatAppUserId: { type: String },
  },
  { timestamps: true }
);

accountSchema.index({ email: 1 }, { unique: true, sparse: true });
accountSchema.index({ revenueCatAppUserId: 1 }, { sparse: true });

const identitySchema = new Schema(
  {
    provider: { type: String, enum: ["apple", "google", "email"], required: true },
    subject: { type: String, required: true },
    accountId: { type: String, required: true, index: true },
    email: { type: String },
  },
  { timestamps: true }
);

identitySchema.index({ provider: 1, subject: 1 }, { unique: true });

const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    accountId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const magicLinkSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    email: { type: String, required: true, index: true },
    returnTo: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

magicLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const savedItemSchema = new Schema(
  {
    id: { type: String, required: true },
    itemId: { type: String },
    name: { type: String, required: true },
    brand: { type: String, default: "" },
    sizeLabel: { type: String, default: "" },
    quantity: { type: Number, required: true },
    checked: { type: Boolean, default: false },
    addedBy: { type: String },
    checkedBy: { type: String },
    writtenAt: { type: Number, default: 0 },
    baselinePrice: { type: Number },
    baselineStore: { type: String, default: "" },
    watch: { type: String, enum: ["inherit", "on", "off"], default: "inherit" },
    targetPrice: { type: Number },
  },
  { _id: false }
);

const savedListSchema = new Schema(
  {
    accountId: { type: String, required: true, unique: true },
    listId: { type: String, required: true },
    listName: { type: String, default: "My list" },
    zip: { type: String, default: "" },
    alertsEnabled: { type: Boolean, default: false },
    items: { type: [savedItemSchema], default: [] },
    removed: {
      type: [new Schema({ id: { type: String, required: true }, writtenAt: { type: Number, required: true } }, { _id: false })],
      default: [],
    },
    revision: { type: Number, required: true, default: 0 },
    coupons: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            storeName: { type: String, required: true },
            lineId: { type: String, required: true },
            itemName: { type: String, required: true },
            kind: { type: String, enum: ["dollars", "percent"], required: true },
            amount: { type: Number, required: true },
            expiresOn: { type: String },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export type SavedListItem = {
  id: string;
  itemId?: string;
  name: string;
  brand: string;
  sizeLabel: string;
  quantity: number;
  checked: boolean;
  addedBy?: string;
  checkedBy?: string;
  writtenAt: number;
  baselinePrice?: number;
  baselineStore: string;
  watch: "inherit" | "on" | "off";
  targetPrice?: number;
};

export type RemovedItem = { id: string; writtenAt: number };

export type LinkedListSeal = { hash: string; sealed: string };

export type AccountDoc = {
  _id: mongoose.Types.ObjectId;
  email?: string;
  emailVerified: boolean;
  displayName: string;
  krogerSealed?: string;
  linkedLists: LinkedListSeal[];
  entitlement?: "free" | "pro";
  entitlementExpiresAt?: Date | null;
  revenueCatAppUserId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export const Account = mongoose.model("Account", accountSchema);
export const AuthIdentity = mongoose.model("AuthIdentity", identitySchema);
export const AuthSession = mongoose.model("AuthSession", sessionSchema);
export const MagicLink = mongoose.model("MagicLink", magicLinkSchema);
export const SavedList = mongoose.model("SavedList", savedListSchema);
