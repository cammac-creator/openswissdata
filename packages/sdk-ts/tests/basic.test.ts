import { describe, it, expect } from "vitest";
import { joinBy } from "../src/helpers/joins.js";

describe("SDK basic", () => {
  it("joinBy matches on computed keys", () => {
    const a = [{ id: "1", x: "a" }, { id: "2", x: "b" }];
    const b = [{ id: "1", y: "Y1" }, { id: "3", y: "Y3" }];
    const joined = joinBy(a, b, v => v.id, v => v.id);
    expect(joined).toHaveLength(1);
    expect(joined[0].x).toBe("a");
    expect(joined[0].y).toBe("Y1");
  });
});
