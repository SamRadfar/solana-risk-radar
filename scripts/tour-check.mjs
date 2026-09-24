/**
 * Guided-tour smoke check: drives the real onboarding in a headless browser at
 * desktop and mobile widths and asserts the behaviour that unit tests cannot —
 * that the dialog actually appears for a first-time visitor, that every control
 * works against real DOM, that dismissal persists across a reload, and that
 * nothing overflows or 404s.
 *
 * Usage: node scripts/tour-check.mjs [baseUrl]
 *
 * A development aid, not part of the build.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOT_DIR = "screenshots";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

let failures = 0;

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const dialog = (page) => page.locator('[role="dialog"]');
const title = (page) => dialog(page).locator("h2").first();

await mkdir(SHOT_DIR, { recursive: true });
const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  console.log(`\n${viewport.name} (${viewport.width}x${viewport.height})`);
  console.log("-".repeat(56));

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const badResponses = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400 && new URL(r.url()).pathname.startsWith("/tour/")) {
      badResponses.push(`${r.status()} ${r.url()}`);
    }
  });

  /* ---------------------------------------------- first visit opens it ---- */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  check(await dialog(page).isVisible(), "first visit opens the tour");

  const readProgress = async () =>
    (await dialog(page).locator("[data-tour-progress]").getAttribute("data-tour-progress")) ?? "";
  const total = Number((await readProgress()).split("/")[1]);

  check((await title(page).innerText()).includes("Welcome"), "starts on the welcome step");
  check((await readProgress()) === `1/${total}`, "progress starts at 1", await readProgress());
  check(total >= 5 && total <= 7, "tour is an onboarding, not a tutorial", `${total} steps`);
  check(
    (await dialog(page).locator("[class*='dotActive']").count()) === 1,
    "exactly one dot is active",
  );

  /* ----------------------------------------------------- backdrop/dim ---- */
  const backdropOk = await page.evaluate(() => {
    const el = document.querySelector('[data-tour-open="true"] > div');
    if (!el) return false;
    const s = getComputedStyle(el);
    const filter = s.backdropFilter || s.webkitBackdropFilter || "";
    return filter.includes("blur") && s.backgroundColor !== "rgba(0, 0, 0, 0)";
  });
  check(backdropOk, "backdrop dims and blurs the app");

  /* ---------------------------------------------------- Back disabled ---- */
  check(
    await dialog(page).getByRole("button", { name: "Back" }).isDisabled(),
    "Back is disabled on the first step",
  );

  /* ------------------------------------------------------------- Next ---- */
  await dialog(page).getByRole("button", { name: /Let's go/i }).click();
  await page.waitForTimeout(420);
  const secondTitle = await title(page).innerText();
  check(secondTitle.includes("Analyse"), "Next advances", secondTitle);
  check(
    !(await dialog(page).getByRole("button", { name: "Back" }).isDisabled()),
    "Back becomes available",
  );

  /* ------------------------------------------------------------- Back ---- */
  await dialog(page).getByRole("button", { name: "Back" }).click();
  await page.waitForTimeout(420);
  check((await title(page).innerText()).includes("Welcome"), "Back returns");

  /* -------------------------------------------------- keyboard arrows ---- */
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(380);
  check((await title(page).innerText()).includes("Analyse"), "ArrowRight advances");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(380);
  check((await title(page).innerText()).includes("Welcome"), "ArrowLeft returns");

  /* ------------------------------------ every step: image + no overflow -- */
  let brokenImages = 0;
  let overflowed = false;
  for (let i = 0; i < total; i += 1) {
    await page.waitForTimeout(340);

    const ok = await dialog(page).locator("img").first().evaluate(
      (img) => img.complete && img.naturalWidth > 0,
    );
    if (!ok) brokenImages += 1;

    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
      overflowed = true;
    }

    if ((await readProgress()) !== `${i + 1}/${total}`) {
      check(false, `progress tracks step ${i + 1}`, await readProgress());
    }

    if (i === 0) {
      await page.screenshot({ path: `${SHOT_DIR}/tour-${viewport.name}-step1.png` });
    }
    if (i === total - 1) {
      await page.screenshot({ path: `${SHOT_DIR}/tour-${viewport.name}-last.png` });
      break;
    }
    await dialog(page).locator("[data-tour-primary='true']").click();
  }
  check(brokenImages === 0, "every step renders its visual", `${brokenImages} broken`);
  check(!overflowed, "no horizontal overflow on any step");

  const dialogFits = await dialog(page).evaluate(
    (el) => el.getBoundingClientRect().width <= window.innerWidth,
  );
  check(dialogFits, "dialog fits the viewport");

  /* ------------------------------------------------- finish + persist ---- */
  const finishLabel = await dialog(page).locator("[data-tour-primary='true']").innerText();
  check(/Start exploring/i.test(finishLabel), "final action is Start exploring", finishLabel);
  await dialog(page).locator("[data-tour-primary='true']").click();
  await page.waitForTimeout(420);
  check(await dialog(page).isHidden(), "finishing closes the tour");

  const stored = await page.evaluate(() =>
    window.localStorage.getItem("solanaRiskRadar.onboarding.v1"),
  );
  check(/completed/.test(stored ?? ""), "completion is persisted", stored ?? "nothing");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  check(await dialog(page).isHidden(), "returning visitor does not get the tour");

  /* ------------------------------------------------------ replay + Esc --- */
  await page.getByRole("button", { name: /Replay the product tour/i }).click();
  await page.waitForTimeout(420);
  check(await dialog(page).isVisible(), "replay reopens the tour");
  check((await title(page).innerText()).includes("Welcome"), "replay starts at step one");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(420);
  check(await dialog(page).isHidden(), "Escape closes the tour");

  /* ------------------------------------------------------ skip + close --- */
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  check(await dialog(page).isVisible(), "cleared storage shows the tour again");

  await dialog(page).getByRole("button", { name: "Skip tour" }).click();
  await page.waitForTimeout(420);
  check(await dialog(page).isHidden(), "Skip closes the tour");
  const skipped = await page.evaluate(() =>
    window.localStorage.getItem("solanaRiskRadar.onboarding.v1"),
  );
  check(/skipped/.test(skipped ?? ""), "skip is persisted", skipped ?? "nothing");

  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await dialog(page).getByRole("button", { name: /Close product tour/i }).click();
  await page.waitForTimeout(420);
  check(await dialog(page).isHidden(), "the × closes the tour");

  /* --------------------------------------------- app still usable after -- */
  const analyserUsable = await page
    .locator("[data-tour='analyser'] input")
    .first()
    .isEditable();
  check(analyserUsable, "the analyser is usable once the tour closes");
  const scrollRestored = await page.evaluate(
    () => getComputedStyle(document.body).overflowY !== "hidden",
  );
  check(scrollRestored, "page scrolling is restored");

  /* --------------------------------- persistence failure must not break -- */
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("storage disabled");
      },
    });
  });
  const blocked = await context.newPage();
  const blockedErrors = [];
  blocked.on("pageerror", (e) => blockedErrors.push(String(e)));
  await blocked.goto(BASE, { waitUntil: "networkidle" });
  await blocked.waitForTimeout(900);
  check(
    await blocked.locator("[data-tour='analyser'] input").first().isEditable(),
    "app works with localStorage disabled",
  );
  check(blockedErrors.length === 0, "no page errors with storage disabled", blockedErrors[0] ?? "");
  await blocked.close();

  check(consoleErrors.length === 0, "no console errors", consoleErrors[0] ?? "");
  check(badResponses.length === 0, "all tour assets served", badResponses[0] ?? "");

  await context.close();
}

await browser.close();

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} problem(s)`}`);
process.exit(failures === 0 ? 0 : 1);
