import { describe, expect, it } from "vitest";
import { schema } from "./pdLog";
import { validate } from "../runtime";

describe("pdLog schema", () => {
  it("id is pdLog", () => {
    expect(schema.id).toBe("pdLog");
  });

  it("requires dateCompleted, activity, totalHours", () => {
    const r = validate(schema, {});
    expect(r.errors.dateCompleted).toBe("Required");
    expect(r.errors.activity).toBe("Required");
    expect(r.errors.totalHours).toBe("Required");
    expect(r.errors.provider).toBeUndefined();
  });

  it("accepts a complete entry", () => {
    const r = validate(schema, {
      dateCompleted: "2026-02-15",
      activity: "Workshop",
      totalHours: 3,
      provider: "Hospice NZ",
    });
    expect(r.ok).toBe(true);
  });
});