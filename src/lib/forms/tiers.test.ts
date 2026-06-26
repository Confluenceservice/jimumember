import { describe, expect, it } from "vitest";
import { TIERS, getTier, listTiers, UnknownTierError } from "./tiers.js";

describe("TIERS", () => {
  it("contains both professional + associate", () => {
    expect(Object.keys(TIERS).sort()).toEqual(["associate", "professional"]);
  });

  it("preserves the legacy 'pm' / 'am' storageValue contract", () => {
    expect(getTier("professional").storageValue).toBe("pm");
    expect(getTier("associate").storageValue).toBe("am");
  });

  it("wires up env var + schema ids for each tier", () => {
    expect(getTier("professional").priceEnvVar).toBe("STRIPE_PRICE_PROFESSIONAL");
    expect(getTier("professional").renewalPriceEnvVar).toBe("STRIPE_PRICE_PROFESSIONAL_RENEWAL");
    expect(getTier("professional").applicationSchemaId).toBe("professionalApply");
    expect(getTier("professional").renewalSchemaId).toBe("renewPro");
    expect(getTier("associate").priceEnvVar).toBe("STRIPE_PRICE_ASSOCIATE");
    expect(getTier("associate").renewalPriceEnvVar).toBe("STRIPE_PRICE_ASSOCIATE_RENEWAL");
  });

  it("is frozen at the top level", () => {
    expect(Object.isFrozen(TIERS)).toBe(true);
  });
});

describe("getTier", () => {
  it("returns the right config for known slugs", () => {
    expect(getTier("professional").label).toBe("Professional Membership");
    expect(getTier("associate").shortLabel).toBe("Associate");
  });

  it("throws UnknownTierError for unknown slugs", () => {
    expect(() => getTier("student")).toThrow(UnknownTierError);
    expect(() => getTier("")).toThrow(UnknownTierError);
  });
});

describe("listTiers", () => {
  it("returns all registered tiers", () => {
    const slugs = listTiers().map((t) => t.slug).sort();
    expect(slugs).toEqual(["associate", "professional"]);
  });
});