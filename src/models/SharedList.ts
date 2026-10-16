import mongoose, { Schema } from "mongoose";

const sharedItemSchema = new Schema(
  {
    itemId: { type: String, required: true },
    catalogId: { type: String },
    name: { type: String, required: true },
    brand: { type: String },
    sizeLabel: { type: String },
    quantity: { type: Number, required: true },
    checked: { type: Boolean, default: false },
    addedBy: { type: String },
    checkedBy: { type: String },
    writtenAt: { type: Number, required: true },
    updatedAt: { type: Date, required: true },
    deleted: { type: Boolean, default: false },
  },
  { _id: false }
);

const sharedListSchema = new Schema(
  {
    shareTokenHash: { type: String, required: true, unique: true },
    ownerTokenHash: { type: String, required: true, unique: true },
    retiredHashes: { type: [String], default: [] },
    title: { type: String, required: true },
    mode: { type: String, enum: ["edit", "view"], required: true, default: "edit" },
    revokedAt: { type: Date, default: null },
    items: { type: [sharedItemSchema], default: [] },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

sharedListSchema.index({ retiredHashes: 1 });

export const SharedList = mongoose.model("SharedList", sharedListSchema);
