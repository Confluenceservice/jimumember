import { describe, expect, it } from "vitest";
import { schema } from "./basicApply";
import { validate, toRow } from "../runtime";
import { getTier } from "../tiers";

describe("basicApply schema", () => {
  it("matches the tier config for basic", () => {
    const tier = getTier("basic");
    expect(tier.applicationSchemaId).toBe("basicApply");
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

  it("visibleWhen excludes listingDetails from values when listOnPage === 'no' (skip validation AND copy-through)", () => {
    // Per runtime.ts: hidden fields skip both validation and copy-through,
    // so listingDetails is absent from values (and toRow omits the column).
    const r = validate(schema, {
      firstName: "A", lastName: "B", email: "a@b.com", phone: "021234567",
      fullAddress: "1 Test St", interestJoining: "x", trainingDetails: "y",
      listOnPage: "no",
      // listingDetails deliberately sent — should be ignored when hidden
      listingDetails: "SHOULD_BE_IGNORED",
      signature: "A B", applicationDate: "2026-06-26",
    });
    expect(r.ok).toBe(true);
    expect(r.values.listingDetails).toBeUndefined();
    const row = toRow(schema, r.values);
    expect(row.M).toBeUndefined(); // columnMap.listingDetails = "M"
  });

  it("emits all 13 form-derived columns (C-O) via toRow when listOnPage === 'yes'", () => {
    const r = validate(schema, {
      firstName: "Alice", lastName: "Smith",
      email: "alice@example.com", phone: "021234567",
      fullAddress: "1 Test St", postalAddress: "PO Box 1",
      businessName: "Smith Care", interestJoining: "Interested",
      trainingDetails: "No current training",
      listOnPage: "yes", listingDetails: "Alice Smith, Smith Care, Auckland",
      signature: "Alice Smith", applicationDate: "2026-06-26",
    });
    expect(r.ok).toBe(true);
    const row = toRow(schema, r.values);
    expect(row).toEqual({
      C: "Alice", D: "Smith", E: "alice@example.com", F: "021234567",
      G: "1 Test St", H: "PO Box 1", I: "Smith Care",
      J: "Interested", K: "No current training",
      L: "YES", // serialize: "upper"
      M: "Alice Smith, Smith Care, Auckland",
      N: "Alice Smith", O: "2026-06-26",
    });
  });
});