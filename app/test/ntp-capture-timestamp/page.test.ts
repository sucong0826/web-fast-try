import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import NtpCaptureTimestampPage from "./page";

it("prioritizes latest frames and collapses secondary details", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page).toContain("NTP Capture Timestamp");
  expect(page).toContain("Start capture");
  expect(page.indexOf("1. Capture")).toBeLessThan(
    page.indexOf("2. Latest native frame"),
  );
  expect(page.indexOf("2. Latest native frame")).toBeLessThan(
    page.indexOf("3. Calculate"),
  );
  expect(page).toContain("Prefer metadata.captureTime");
  expect(page).toContain("Use VideoFrame.timestamp anchor");
  expect(page).toContain("Rolling 64-sample minimum");
  expect(page).toContain("Browser local time");
  expect(page).toContain("Show diagnostics");
  expect(page).toContain("Epoch converter");
  expect(page).toContain("Calculate NTP timestamp");
  expect(page).toContain("2208988800000");
  expect(page).toContain("local wall-clock mapping");
  expect(page).toContain("106574320.365");
  expect(page).toContain("Unix ↔ NTP epoch converter");
  expect(page).toContain("Unix → NTP");
  expect(page).toContain("NTP → Unix");
  expect(page).toContain("Convert timestamp");
  expect(page).toContain("1786432730355.365");
  expect(page).not.toContain("Manual server anchor");
  expect(page).not.toContain("Match tolerance");
  expect(page).not.toContain("Copy CSV");
  expect(page).not.toContain("timeOrigin + VideoFrame.timestamp / 1000");
  expect(page).not.toContain("Unverified approximation");
});
