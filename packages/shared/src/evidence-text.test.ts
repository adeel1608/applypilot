import { describe, expect, it } from "vitest";
import { matchesEvidenceText } from "./evidence-text";

describe("evidence text token matching", () => {
  it.each([
    ["C++", "Backend engineering", false],
    ["C#", "Backend engineering", false],
    ["C", "Backend engineering", false],
    ["C++", "C#", false],
    ["C++", "C++17", false],
    ["C++17", "c++17", true],
    ["C++", "C++ programming", true],
    ["C#", "C# programming", true],
    [".NET", ".NET development", true],
    [".NET", "networking", false],
    ["Go", "Cargo operations", false],
    ["Go", "Go programming", false],
    ["Go", "go", true],
    ["R", "Router maintenance", false],
    ["AI", "Retail service", false],
    ["Python", "Python programming experience", true],
    ["Autonomy systems", "Experience with autonomy systems", true],
    ["", "Python", false],
    ["   ", "Python", false],
    ["C Sharp", "C#", false],
    ["JS", "JavaScript", false],
    ["TS", "TypeScript", false],
  ])("matches %j and %j only with explicit token support", (left, right, expected) => {
    expect(matchesEvidenceText(left, right)).toBe(expected);
    expect(matchesEvidenceText(right, left)).toBe(expected);
  });
});
