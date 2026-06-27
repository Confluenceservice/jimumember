import { describe, expect, it } from "vitest";
import { TIERS, getTier, listTiers, UnknownTierError } from "./tiers.js";

describe("TIERS", () => {
  it("contains both advanced + basic", () => {
    expect(Object.keys(TIERS).sort()).toEqual(["advanced", "basic"]);
  });

  it("preserves the legacy 'pm' / 'am' storageValue contract", () => {
    expect(getTier("advanced").storageValue).toBe("adv");
    expect(getTier("basic").storageValue).toBe("basic");
  });

  it("wires up env var + schema ids for each tier", () => {
    expect(getTier("advanced").priceEnvVar).toBe("STRIPE_PRICE_ADVANCED");
    expect(getTier("advanced").renewalPriceEnvVar).toBe("STRIPE_PRICE_ADVANCED_RENEWAL");
    expect(getTier("advanced").applicationSchemaId).toBe("advancedApply");
    expect(getTier("advanced").renewalSchemaId).toBe("renewAdvanced");
    expect(getTier("basic").priceEnvVar).toBe("STRIPE_PRICE_BASIC");
    expect(getTier("basic").renewalPriceEnvVar).toBe("STRIPE_PRICE_BASIC_RENEWAL");
  });

  it("is frozen at the top level", () => {
    expect(Object.isFrozen(TIERS)).toBe(true);
  });
});

describe("getTier", () => {
  it("returns the right config for known slugs", () => {
    expect(getTier("advanced").label).toBe("Advanced Membership");
    expect(getTier("basic").shortLabel).toBe("Basic");
  });

  it("throws UnknownTierError for unknown slugs", () => {
    expect(() => getTier("student")).toThrow(UnknownTierError);
    expect(() => getTier("")).toThrow(UnknownTierError);
  });
});

describe("listTiers", () => {
  it("returns all registered tiers", () => {
    const slugs = listTiers().map((t) => t.slug).sort();
    expect(slugs).toEqual(["advanced", "basic"]);
  });
});