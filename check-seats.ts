import { chromium } from "playwright";
import fs from "fs";
import "dotenv/config";

type Result = "available" | "sold_out" | "unknown";

interface CheckTarget {
  day: number;
  month: number; // 1-12
  year: number;
}

/** How many "next month" (»)  clicks to get from today to the target month. */
function monthsBetween(from: Date, to: { month: number; year: number }): number {
    return (to.year - from.getFullYear()) * 12 + (to.month - 1 - from.getMonth());
}

async function checkSeats({ day, month, year }: CheckTarget): Promise<Result> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto("https://www.alaskarailroad.com/ride-a-train/buy-tickets", {
        waitUntil: "networkidle",
        });

        await page.getByRole("radio", { name: "One Way" }).check();
        await page.locator("#edit-service-type-id").selectOption("53"); // Aurora Winter Train
        await page.getByLabel("From").selectOption("6002"); // Anchorage
        await page.getByLabel("To", { exact: true }).selectOption("6013"); // Fairbanks

        await page.getByRole("textbox", { name: "Depart" }).click();

        const clicksNeeded = monthsBetween(new Date(), { month, year });
        if (clicksNeeded < 0) {
        throw new Error(`Target date ${month}/${day}/${year} is in the past.`);
        }

        for (let i = 0; i < clicksNeeded; i++) {
        await page.getByRole("columnheader", { name: "»" }).click();
        await page.waitForTimeout(300); // let the calendar repaint between clicks
        }

        await page.getByRole("cell", { name: String(day), exact: true }).click();
        await page.getByRole("button", { name: "Search" }).click();

        await page.waitForURL(/\/(problem|service_class)/, { timeout: 20000 });
        const finalUrl = page.url();

        if (finalUrl.includes("/problem")) return "sold_out";
        if (finalUrl.includes("/service_class")) return "available";
        return "unknown";
    } finally {
        await browser.close();
    }
}

async function main() {
    // Defaults to the real target date; override via env vars to run the
    // positive-control check (e.g. CHECK_DAY=12) without touching code.
    const day = parseInt(process.env.CHECK_DAY ?? "26", 10);
    const month = parseInt(process.env.CHECK_MONTH ?? "12", 10);
    const year = parseInt(process.env.CHECK_YEAR ?? "2026", 10);

    console.log(`Checking Aurora Winter Train, Anchorage -> Fairbanks, ${month}/${day}/${year}...`);

    const result = await checkSeats({ day, month, year });
    console.log(`Result: ${result}`);

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`);
    }

    if (result === "unknown") {
        // Fail loudly instead of silently treating an unrecognized page as
        // sold out — this means the site changed and the script needs a look.
        console.error("Landed on an unexpected URL:", result);
        process.exit(2);
    }
}

main().catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
});

