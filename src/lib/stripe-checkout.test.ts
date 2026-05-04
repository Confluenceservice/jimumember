import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  isPromoWindowNz,
  getNextJulyAnchorDate,
  getNextJulyAnchorEpoch,
  formatAmountNzd,
  calcFirstTermAmount,
} from "./stripe-checkout";

const NZ = "Pacific/Auckland";

function dt(iso: string, zone: string): DateTime {
  return DateTime.fromISO(iso, { zone }) as DateTime;
}

describe("isPromoWindowNz", () => {
  it("returns true for January", () => {
    expect(isPromoWindowNz(dt("2026-01-15T12:00:00", NZ))).toBe(true);
  });

  it("returns true for June", () => {
    expect(isPromoWindowNz(dt("2026-06-30T23:59:59", NZ))).toBe(true);
  });

  it("returns false for July", () => {
    expect(isPromoWindowNz(dt("2026-07-01T00:00:01", NZ))).toBe(false);
  });

  it("returns false for December", () => {
    expect(isPromoWindowNz(dt("2026-12-15T12:00:00", NZ))).toBe(false);
  });
});

describe("getNextJulyAnchorDate", () => {
  it("returns this year's July 1 when before July", () => {
    const result = getNextJulyAnchorDate(dt("2026-03-15T12:00:00", NZ));
    expect(result.year).toBe(2026);
    expect(result.month).toBe(7);
    expect(result.day).toBe(1);
  });

  it("returns next year's July 1 when on July 1", () => {
    const result = getNextJulyAnchorDate(dt("2026-07-01T00:00:00", NZ));
    expect(result.year).toBe(2027);
    expect(result.month).toBe(7);
    expect(result.day).toBe(1);
  });

  it("returns next year's July 1 when in December", () => {
    const result = getNextJulyAnchorDate(dt("2026-12-15T12:00:00", NZ));
    expect(result.year).toBe(2027);
    expect(result.month).toBe(7);
    expect(result.day).toBe(1);
  });

  it("returns a Luxon DateTime at midnight NZ time", () => {
    const result = getNextJulyAnchorDate(dt("2026-03-15T15:30:00", "UTC"));
    expect(result.hour).toBe(0);
    expect(result.minute).toBe(0);
    expect(result.second).toBe(0);
    expect(result.zoneName).toBe(NZ);
  });
});

describe("getNextJulyAnchorEpoch", () => {
  it("returns a Unix timestamp for July 1 in NZ", () => {
    const epoch = getNextJulyAnchorEpoch(dt("2026-03-15T12:00:00", NZ));
    const expected = DateTime.fromISO("2026-07-01T00:00:00", { zone: NZ }).toSeconds();
    expect(epoch).toBe(Math.floor(expected));
  });

  it("returns a future timestamp even when called near July", () => {
    const epoch = getNextJulyAnchorEpoch(dt("2026-07-01T00:00:00", NZ));
    const expected = DateTime.fromISO("2027-07-01T00:00:00", { zone: NZ }).toSeconds();
    expect(epoch).toBe(Math.floor(expected));
  });
});

describe("formatAmountNzd", () => {
  it("formats cents as NZD dollars with two decimal places", () => {
    expect(formatAmountNzd(5000)).toBe("NZ$50.00");
    expect(formatAmountNzd(1250)).toBe("NZ$12.50");
    expect(formatAmountNzd(100)).toBe("NZ$1.00");
    expect(formatAmountNzd(9999)).toBe("NZ$99.99");
  });

  it("handles zero", () => {
    expect(formatAmountNzd(0)).toBe("NZ$0.00");
  });
});

describe("calcFirstTermAmount", () => {
  const ANNUAL = 120000; // $1200 annual in cents

  it("returns full annual + ~0.3% on July 1 (52.14 weeks to next July)", () => {
    // July 1, 2026 → next July 1, 2027 = 365 days = 52.14 weeks
    // 52.14/52 ≈ 1.0027 → Math.round(120000 * 1.0027) = 120330
    const result = calcFirstTermAmount(ANNUAL, dt("2026-07-01T00:00:00", NZ));
    expect(result).toBe(120330);
  });

  it("returns ~45.7% in mid-January (23.79 weeks remaining)", () => {
    // Jan 15 12:00 to July 1 00:00 = 23.79 weeks
    // 23.79/52 ≈ 0.457 → Math.round(120000 * 0.4574) = 54890
    const result = calcFirstTermAmount(ANNUAL, dt("2026-01-15T12:00:00", NZ));
    expect(result).toBe(54890);
  });

  it("returns ~25% in early April (~13 weeks remaining)", () => {
    // Apr 1 to July 1 = 91 days = 13 weeks exactly
    // 13/52 = 0.25 → Math.round(120000 * 0.25) = 30000
    const result = calcFirstTermAmount(ANNUAL, dt("2026-04-01T00:00:00", NZ));
    expect(result).toBe(30000);
  });

  it("returns ~2% in late June (~1 week remaining)", () => {
    // ~1 week before July 1
    const result = calcFirstTermAmount(ANNUAL, dt("2026-06-23T12:00:00", NZ));
    expect(result).toBeGreaterThan(2000);
    expect(result).toBeLessThan(4000);
  });

  it("uses month-based proration when unit=month", () => {
    // Jan 15 to July 1 = 5.517 months
    // 5.517/12 ≈ 0.4597 → Math.round(120000 * 0.4597) = 55167
    const result = calcFirstTermAmount(ANNUAL, dt("2026-01-15T12:00:00", NZ), "month");
    expect(result).toBe(55167);
  });

  it("handles zero annual amount", () => {
    const result = calcFirstTermAmount(0, dt("2026-01-15T12:00:00", NZ));
    expect(result).toBe(0);
  });

  it("rounds to nearest cent (whole number of cents)", () => {
    // Jan 15 gives 23.79 weeks → 23.79/52 = 0.4574
    // 1001 * 0.4574 = 457.85 → Math.round(457.85) = 458
    const result = calcFirstTermAmount(1001, dt("2026-01-15T12:00:00", NZ));
    expect(result).toBe(458);
  });
});
