/**
 * UI smoke check: drives the real app in a headless browser at desktop and
 * mobile widths, asserts the full flow renders, and fails on any console error,
 * page error, or horizontal overflow.
 *
 * Usage: node scripts/ui-check.mjs [baseUrl]
 *
 * A development aid, not part of the build. It exercises the live app against
 * real data, so it verifies the flow works — not that any score is stable.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOT_DIR = "screenshots";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const TOKEN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK

let failures = 0;

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

await mkdir(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  console.log(`\n${viewport.name} (${viewport.width}x${viewport.height})`);
  console.log("-".repeat(50));

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(BASE, { waitUntil: "networkidle" });

  check(
    await page.getByRole("heading", { name: /Understand a Solana token/i }).isVisible(),
    "landing headline renders",
  );
  check(await page.locator("#mint-address").isVisible(), "address input renders");

  // Invalid input must be rejected in the browser, with no request made.
  await page.locator("#mint-address").fill("not-a-valid-address");
  await page.locator("#mint-address").blur();
  const validationError = page.locator("#mint-address-error");
  await validationError.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  check(await validationError.isVisible(), "invalid address shows inline validation");
  check(
    await page.getByRole("button", { name: /Analyse token/i }).isDisabled(),
    "submit disabled while address is invalid",
  );

  // Full analysis flow.
  await page.locator("#mint-address").fill(TOKEN);
  await page.getByRole("button", { name: /Analyse token/i }).click();

  await page
    .getByRole("heading", { name: /Risk profile by category/i })
    .waitFor({ state: "visible", timeout: 90_000 });

  check(true, "report renders after analysis");
  check(
    await page.getByRole("img", { name: /Risk score \d+ out of 100/ }).isVisible(),
    "score gauge renders with accessible label",
  );
  check(
    await page.getByRole("heading", { name: /Holder distribution/i }).isVisible(),
    "holder distribution panel renders",
  );
  check(
    await page.getByRole("heading", { name: /Data sources/i }).isVisible(),
    "data sources panel renders",
  );
  check(
    (await page.getByText(/Not financial advice/i).count()) > 0,
    "disclaimer present",
  );

  // Evidence must actually open.
  const inspect = page.getByRole("button", { name: /Inspect evidence/i }).first();
  if ((await inspect.count()) > 0) {
    await inspect.click();
    await page.waitForTimeout(250);
    check(
      (await page.getByRole("button", { name: /Hide evidence/i }).count()) > 0,
      "evidence panel expands",
    );
  } else {
    check(false, "at least one signal offers evidence");
  }

  // Mobile layouts must not scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 1, "no horizontal overflow", `${overflow}px`);

  await page.screenshot({
    path: `${SHOT_DIR}/${viewport.name}.png`,
    fullPage: true,
  });

  check(pageErrors.length === 0, "no uncaught page errors", pageErrors.join(" | "));
  check(
    consoleErrors.length === 0,
    "no console errors",
    consoleErrors.slice(0, 3).join(" | "),
  );

  await context.close();
}

await browser.close();

console.log(
  `\n${failures === 0 ? `All UI checks passed. Screenshots in ${SHOT_DIR}/.` : `${failures} UI check failure(s).`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
