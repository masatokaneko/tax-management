import { describe, it, expect } from "vitest";

// Test the dozoku company determination logic
describe("schedule 02 - dozoku company determination", () => {
  function isDozoku(groups: { shares: number }[], totalShares: number): boolean {
    const sorted = [...groups].sort((a, b) => b.shares - a.shares);
    const top3 = sorted.slice(0, 3);
    const top3Total = top3.reduce((sum, g) => sum + g.shares, 0);
    return top3Total / totalShares > 0.5;
  }

  it("single shareholder with 100% -> dozoku", () => {
    expect(isDozoku([{ shares: 100 }], 100)).toBe(true);
  });

  it("3 shareholders each 20% -> top3 = 60% -> dozoku", () => {
    expect(isDozoku(
      [{ shares: 20 }, { shares: 20 }, { shares: 20 }, { shares: 20 }, { shares: 20 }],
      100,
    )).toBe(true);
  });

  it("many small shareholders -> not dozoku", () => {
    const shareholders = Array.from({ length: 10 }, () => ({ shares: 10 }));
    // top 3 = 30% -> not dozoku
    expect(isDozoku(shareholders, 100)).toBe(false);
  });

  it("exactly 50% is NOT dozoku (needs > 50%)", () => {
    // 7 groups: top 3 hold 50 out of 100 = exactly 50%
    expect(isDozoku(
      [{ shares: 17 }, { shares: 17 }, { shares: 16 }, { shares: 16 }, { shares: 16 }, { shares: 10 }, { shares: 8 }],
      100,
    )).toBe(false);
  });

  it("top 3 at 51% -> dozoku", () => {
    expect(isDozoku(
      [{ shares: 17 }, { shares: 17 }, { shares: 17 }, { shares: 49 }],
      100,
    )).toBe(true);
  });
});
