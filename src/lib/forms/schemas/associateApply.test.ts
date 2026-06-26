import { describe, expect, it } from "vitest";
import { schema } from "./associateApply";
import { validate, toRow } from "../runtime";
import { getTier } from "../tiers";

describe("associateApply schema", () => {
  it("matches the tier config for associate", () => {
    const tier = getTier("associate");
    expect(tier.applicationSchemaId).toBe("associateApply");
    expect(schema.id).toBe(tier.applicationSchemaId);
    expect(schema.storage.sheetName).toBe(tier.sheetName);
  });

  it("rejects missing identity fields", () => {
    const r = validate(schema, {});
    expect(r.errors.firstName).toBe("Required");
    expect(r.errors.lastName).toBe("Required");
    expect(r.errors.email).toBe("Required");
    expect(r.errors.phone).toBe("Required");
    expect(r.errors.fullAddress).toBe("Required");
  });

  it("requires listingDetails only when listOnPage === 'yes'", () => {
    const noListing = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", phone: "021234567",
      fullAddress: "1 Test St", interestJoining: "x", trainingDetails: "y",
      listOnPage: "no", signature: "A B", applicationDate: "2026-06-26",
    });
    expect(noListing.errors.listingDetails).toBeUndefined();

    const yesListing = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", phone: "021234567",
      fullAddress: "1 Test St", interestJoining: "x", trainingDetails: "y",
      listOnPage: "yes", listingDetails: "",  // empty when required → fail
      signature: "A B", applicationDate: "2026-06-26",
    });
    expect(yesListing.errors.listingDetails).toBe("Required");
  });

  it("accepts 'yes' or 'no' for listOnPage", () => {
    const r1 = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", phone: "021234567",
      fullAddress: "1 Test St", interestJoining: "x", trainingDetails: "y",
      listOnPage: "yes", signature: "A B", applicationDate: "2026-06-26",
    });
    expect(r1.errors.listOnPage).toBeUndefined();
    const r2 = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", phone: "021234567",
      fullAddress: "1 Test St", interestJoining: "x", trainingDetails: "y",
      listOnPage: "no", signature: "A B", applicationDate: "2026-06-26",
    });
    expect(r2.errors.listOnPage).toBeUndefined();
  });

  it("emits correct column letters via toRow (C-O form-derived)", () => {
    const r = validate(schema, {
      firstName: "Alice", lastName: "Smith",
      email: "alice@example.com", phone: "021234567",
      fullAddress: "1 Test St", interestJoining: "Interested",
      trainingDetails: "No current training",
      listOnPage: "no", signature: "Alice Smith",
      applicationDate: "2026-06-26",
    });
    const row = toRow(schema, r.values);
    expect(row.C).toBe("Alice");
    expect(row.D).toBe("Smith");
    expect(row.E).toBe("alice@example.com");
    expect(row.F).toBe("021234567");
    expect(row.G).toBe("1 Test St");
    expect(row.J).toBe("Interested");
    expect(row.L).toBe("NO"); // serialize: "upper"
  });

  it("does NOT include managed cells (A submittedAt, B applicationId, P checkoutStatus)", () => {
    const r = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", phone: "021234567",
      fullAddress: "1 Test St", interestJoining: "x", trainingDetails: "y",
      listOnPage: "no", signature: "A B", applicationDate: "2026-06-26",
    });
    const row = toRow(schema, r.values);
    expect(row.A).toBeUndefined();
    expect(row.B).toBeUndefined();
    expect(row.P).toBeUndefined();
  });
});