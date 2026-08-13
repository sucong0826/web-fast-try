# NTP Q32.32 Decimal Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert a packed NTP Q32.32 64-bit value written as a decimal string into a high-precision Unix timestamp within the existing test page.

**Architecture:** Implement a pure `BigInt` converter in the existing timestamp library, returning display-safe decimal strings and a millisecond-precision UTC value. Add a self-contained calculator below the existing decimal epoch converter within the same collapsed Epoch converter section.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Tailwind CSS, JavaScript `BigInt` and `Intl`.

## Global Constraints

- Input is the complete unsigned Q32.32 value as a base-10 integer string, never a floating-point number.
- Interpret NTP Era 0 only; do not add era selection or Q32.32 encoding.
- Reject Q32.32 values before the Unix epoch and values above `2^64 - 1`.
- Preserve twelve fractional decimal digits in copyable Unix seconds and Unix milliseconds values by truncating with `BigInt`.
- Keep existing capture, NTP decimal-millisecond, and time-zone behavior unchanged.

---

### Task 1: Add a pure Q32.32 to Unix converter

**Files:**
- Modify: `lib/video-frame-ntp-calculator.ts`
- Test: `lib/video-frame-ntp-calculator.test.ts`

**Interfaces:**
- Produces: `NtpQ32_32ConversionResult` with `sourceQ32_32`, `ntpSeconds`, `ntpFraction`, `unixTimestampSeconds`, `unixTimestampMilliseconds`, `utcTimestamp`, and `expression` strings.
- Produces: `convertNtpQ32_32ToUnix(value: string): NtpQ32_32ConversionResult`.

- [ ] **Step 1: Write failing conversion tests**

```ts
it("converts the supplied packed Q32.32 decimal value without precision loss", () => {
  expect(convertNtpQ32_32ToUnix("17160596469120441998")).toMatchObject({
    ntpSeconds: "3995512721",
    ntpFraction: "1673469582",
    unixTimestampSeconds: "1786523921.389634999912",
    unixTimestampMilliseconds: "1786523921389.634999912232",
    utcTimestamp: "2026-08-12T08:38:41.389Z",
  });
});

it.each(["", "-1", "+1", "1.5", "NaN", "18446744073709551616"])(
  "rejects invalid Q32.32 input: %s",
  (value) => expect(() => convertNtpQ32_32ToUnix(value)).toThrow(RangeError),
);

it("rejects an Era 0 Q32.32 value before Unix epoch", () => {
  expect(() => convertNtpQ32_32ToUnix("0")).toThrow("before the supported Unix epoch");
});

it("accepts the maximum unsigned Q32.32 value in Era 0", () => {
  expect(convertNtpQ32_32ToUnix("18446744073709551615").ntpSeconds).toBe("4294967295");
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: FAIL because `convertNtpQ32_32ToUnix` does not exist.

- [ ] **Step 3: Implement BigInt conversion and fixed decimal formatting**

```ts
const NTP_Q32_32_FRACTION_SCALE = 1n << 32n;
const NTP_UNIX_EPOCH_OFFSET_SECONDS = 2_208_988_800n;
const MAX_NTP_Q32_32 = (1n << 64n) - 1n;

const ntpSeconds = packed >> 32n;
const ntpFraction = packed & (NTP_Q32_32_FRACTION_SCALE - 1n);
const unixSeconds = ntpSeconds - NTP_UNIX_EPOCH_OFFSET_SECONDS;
```

Reject malformed strings, values beyond `MAX_NTP_Q32_32`, and seconds before the Unix epoch. Format decimals using `(numerator * 10n ** 12n) / denominator`, padded to 12 digits. Build the UTC date from the whole millisecond `BigInt` after checking it fits JavaScript's supported Date range.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npm test -- lib/video-frame-ntp-calculator.test.ts`

Expected: PASS with all calculator tests green.

- [ ] **Step 5: Commit the converter**

Run: `git add lib/video-frame-ntp-calculator.ts lib/video-frame-ntp-calculator.test.ts && git commit -m "feat: convert NTP Q32.32 timestamps"`

### Task 2: Add the Q32.32 calculator to the page

**Files:**
- Modify: `app/test/ntp-capture-timestamp/page.tsx`
- Test: `app/test/ntp-capture-timestamp/page.test.ts`

**Interfaces:**
- Consumes: `convertNtpQ32_32ToUnix` and `NtpQ32_32ConversionResult` from Task 1.
- Produces: a calculator titled `NTP Q32.32 → Unix timestamp` inside `Epoch converter`.

- [ ] **Step 1: Write the failing static page test**

```ts
expect(page).toContain("NTP Q32.32 → Unix timestamp");
expect(page).toContain("NTP Q32.32 decimal value");
expect(page).toContain("Era 0");
expect(page).toContain("17160596469120441998");
```

- [ ] **Step 2: Run the targeted page test to verify it fails**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: FAIL because Q32.32 UI text is absent.

- [ ] **Step 3: Add state, submit, result, and copy handlers**

```tsx
const [manualQ32_32, setManualQ32_32] = useState("17160596469120441998");
const [q32_32Result, setQ32_32Result] = useState<NtpQ32_32ConversionResult | null>(null);

const convertQ32_32Timestamp = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setQ32_32Result(convertNtpQ32_32ToUnix(manualQ32_32));
};
```

Render a single decimal input, Era 0/2036 limit copy, a Convert button, and a result panel. The result panel shows copyable Unix seconds, Unix milliseconds, UTC, and `TimestampInterpretations` using the whole Unix millisecond value. Place NTP seconds, fraction, and expression under a closed `Show Q32.32 fields` details element.

- [ ] **Step 4: Run the targeted page test to verify it passes**

Run: `npm test -- app/test/ntp-capture-timestamp/page.test.ts`

Expected: PASS with the Q32.32 calculator static content rendered.

- [ ] **Step 5: Commit the page calculator**

Run: `git add app/test/ntp-capture-timestamp/page.tsx app/test/ntp-capture-timestamp/page.test.ts && git commit -m "feat: add NTP Q32.32 calculator"`

### Task 3: Verify and publish

**Files:**
- Create: `docs/superpowers/plans/2026-08-13-ntp-q32-32-converter.md`

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 2: Run lint and production build**

Run: `npm run lint && npm run build`

Expected: both commands exit 0 and `/test/ntp-capture-timestamp` appears in the build routes.

- [ ] **Step 3: Commit the plan and inspect the final tree**

Run: `git diff --check && git status --short`

Expected: no whitespace errors.

Run: `git add docs/superpowers/plans/2026-08-13-ntp-q32-32-converter.md && git commit -m "docs: plan NTP Q32.32 converter"`

- [ ] **Step 4: Push and verify deployment**

Run: `git push origin main`

Expected: the public page contains `NTP Q32.32 → Unix timestamp` and `Era 0`.
