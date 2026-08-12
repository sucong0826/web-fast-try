import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import NtpCaptureTimestampPage from "./page";

it("renders the simplified capture validator and manual calculator", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page).toContain("NTP Capture Timestamp");
  expect(page).toContain("Start capture");
  expect(page).toContain("2. Calculate");
  expect(page).toContain("captureTime");
  expect(page).toContain("VideoFrame.timestamp");
  expect(page).toContain("Calculate NTP timestamp");
  expect(page).toContain("2208988800000");
  expect(page).toContain("Unverified approximation");
  expect(page).toContain("106574320.365");
  expect(page).not.toContain("Manual server anchor");
  expect(page).not.toContain("Match tolerance");
  expect(page).not.toContain("Copy CSV");
});
