import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import NtpCaptureTimestampPage from "./page";

it("renders NTP capture controls and estimate safety guidance", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page).toContain("NTP Capture Timestamp");
  expect(page).toContain("Start capture");
  expect(page).toContain("estimate");
  expect(page).toContain("Naive Unix interpretation");
  expect(page).toContain("Performance timeOrigin");
  expect(page).toContain("Client first-frame anchor");
  expect(page).toContain("Manual server anchor");
  expect(page).toContain("NTP epoch milliseconds");
  expect(page).toContain("NTP Q32.32");
  expect(page).toContain("106574320365");
  expect(page).toContain("3995421530355");
});
