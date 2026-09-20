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

  // ---- Quick assessment layer ----
  check(
    (await page.getByRole("heading", { name: /Detailed evidence/i }).count()) > 0,
    "detailed-evidence layer is separated from the quick assessment",
  );
  check(
    (await page.getByText(/Main concerns/i).count()) > 0 ||
      (await page.getByText(/No signal was flagged/i).count()) > 0,
    "quick assessment states the main concerns",
  );
  for (const label of ["Critical", "High", "Medium", "Low", "No concern"]) {
    check(
      (await page.getByText(label, { exact: true }).count()) > 0,
      `severity count shown: ${label}`,
    );
  }
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

  // ---- Evidence audit: exercise EVERY evidence action on the page ----
  // This is the product's core trust feature, so it is checked exhaustively
  // rather than by sampling one card.
  // Clicking a trigger changes its accessible name, which would shift a live
  // locator's indices mid-loop, so the stable aria-controls ids are collected
  // first and each panel is then driven by its own id.
  const panelIds = await page
    .getByRole("button", { name: /Inspect evidence|Why not measured/i })
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-controls")));

  const triggerCount = panelIds.length;
  check(triggerCount > 0, "at least one signal exposes its evidence");
  check(
    panelIds.every((id) => typeof id === "string" && id.length > 0),
    "every evidence trigger is wired to a panel via aria-controls",
  );

  let opened = 0;
  const broken = [];
  for (const id of panelIds) {
    if (!id) continue;
    const selector = `[id="${id.replace(/"/g, '\\"')}"]`;
    const trigger = page.locator(`[aria-controls="${id.replace(/"/g, '\\"')}"]`);
    const panel = page.locator(selector);

    await trigger.click();
    await panel.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

    const visible = await panel.isVisible().catch(() => false);
    const text = visible ? (await panel.innerText()).trim() : "";
    const expanded = await trigger.getAttribute("aria-expanded");

    if (visible && text.length > 0 && expanded === "true") opened += 1;
    else broken.push(id);

    await trigger.click();
    await page.waitForTimeout(30);
  }

  check(
    opened === triggerCount,
    "every evidence action opens a non-empty panel",
    `${opened}/${triggerCount}${broken.length ? ` · broken: ${broken.join(", ")}` : ""}`,
  );

  // An unmeasured signal must not offer "Inspect evidence" — that would imply
  // a measurement exists.
  const unmeasuredHeading = page.getByRole("heading", { name: /Could not be measured/i });
  if ((await unmeasuredHeading.count()) > 0) {
    check(
      (await page.getByRole("button", { name: /Why not measured/i }).count()) > 0,
      "unmeasured signals offer 'Why not measured', not 'Inspect evidence'",
    );
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
