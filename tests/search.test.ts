/** Reciprocal rank fusion on its own: the arithmetic, and the order it puts things in. */
import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "@/rag";

const ranked = (...keys: string[]) => keys.map((key) => ({ key }));

describe("reciprocal rank fusion", () => {
  it("prefers what both lists rank well over what one list ranks first", () => {
    const text = ranked("a", "c", "b");
    const vector = ranked("d", "c", "e");
    // "c" is first in neither list; nothing else is in both.
    const fused = reciprocalRankFusion([text, vector], (hit) => hit.key);
    expect(fused[0]!.key).toBe("c");
    expect(fused[0]!.ranks).toEqual([2, 2]);
  });

  it("scores an item only for the lists it appears in, and says which those were", () => {
    const fused = reciprocalRankFusion([ranked("a"), ranked("b", "a")], (hit) => hit.key, 10);
    const byKey = new Map(fused.map((f) => [f.key, f]));
    expect(byKey.get("a")!.score).toBeCloseTo(1 / 11 + 1 / 12, 12);
    expect(byKey.get("b")!.score).toBeCloseTo(1 / 11, 12);
    expect(byKey.get("b")!.ranks).toEqual([null, 1]);
  });

  it("keeps the copy from the list that ranked it best, so the snippet comes from there", () => {
    const text = [{ key: "a", from: "text" }];
    const vector = [{ key: "b", from: "vector" }, { key: "a", from: "vector" }];
    const fused = reciprocalRankFusion([text, vector], (hit) => hit.key);
    expect(fused.find((f) => f.key === "a")!.item.from).toBe("text");
  });

  it("pays a duplicated key once", () => {
    const [fused] = reciprocalRankFusion([ranked("a", "a")], (hit) => hit.key);
    expect(fused!.ranks).toEqual([1]);
    expect(fused!.score).toBeCloseTo(1 / 61, 12);
  });

  it("orders ties by key, so the same corpus searches the same way twice", () => {
    const fused = reciprocalRankFusion([ranked("b", "a")], (hit) => hit.key);
    expect(fused.map((f) => f.key)).toEqual(["b", "a"]);
    const tied = reciprocalRankFusion([ranked("b"), ranked("a")], (hit) => hit.key);
    expect(tied.map((f) => f.key)).toEqual(["a", "b"]);
  });

  it("returns nothing for no lists and for empty ones", () => {
    expect(reciprocalRankFusion([], (hit: { key: string }) => hit.key)).toEqual([]);
    expect(reciprocalRankFusion([[], []], (hit: { key: string }) => hit.key)).toEqual([]);
  });
});

