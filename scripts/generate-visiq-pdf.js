const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "docs", "VISIQ_Academy_revised.html");
const PDF = path.join(ROOT, "docs", "VISIQ_Academy_revised.pdf");
const QR = path.join(ROOT, "assets", "visiq-trial-qr.png");

async function ensureQr() {
  if (fs.existsSync(QR)) return;
  const { execSync } = require("child_process");
  execSync("node scripts/generate-visiq-qr.js", { cwd: ROOT, stdio: "inherit" });
}

async function main() {
  if (!fs.existsSync(HTML)) {
    throw new Error(`HTML not found: ${HTML}`);
  }
  await ensureQr();

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const fileUrl = `file:///${HTML.replace(/\\/g, "/")}`;

  await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluateHandle("document.fonts.ready");

  fs.mkdirSync(path.dirname(PDF), { recursive: true });
  await page.pdf({
    path: PDF,
    width: "1920px",
    height: "1080px",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();
  console.log("PDF saved:", PDF);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
