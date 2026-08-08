import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import NtpCaptureTimestampPage from "./page";

it("renders NTP capture controls and estimate safety guidance", () => {
  const page = renderToStaticMarkup(createElement(NtpCaptureTimestampPage));

  expect(page).toContain("NTP Capture Timestamp");
  expect(page).toContain("Start capture");
  expect(page).toContain("estimate");
});
