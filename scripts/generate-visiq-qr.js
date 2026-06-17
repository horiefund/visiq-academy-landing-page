const path = require("path");
const QRCode = require("qrcode");

const OUT = path.join(__dirname, "..", "assets", "visiq-trial-qr.png");
const URL = "https://visiq-academy-landing-page.vercel.app/";

async function main() {
  await QRCode.toFile(OUT, URL, {
    type: "png",
    width: 800,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  console.log("QR saved:", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
