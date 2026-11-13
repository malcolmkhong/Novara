const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const pub = path.join(root, "public");
const src = fs.readFileSync(path.join(pub, "logo.svg"));
const srcDark = fs.readFileSync(path.join(pub, "logo-dark.svg"));
const icon = fs.readFileSync(path.join(root, "src", "app", "icon.svg"));
(async () => {
  const out = path.join(pub, "brand");
  fs.mkdirSync(out, { recursive: true });
  for (const size of [512, 1024]) {
    await sharp(src, { density: 384 }).resize(size, size).png().toFile(path.join(out, `logo-${size}.png`));
    await sharp(srcDark, { density: 384 }).resize(size, size).png().toFile(path.join(out, `logo-dark-${size}.png`));
  }
  for (const size of [32, 180, 512]) {
    await sharp(icon, { density: 384 }).resize(size, size).png().toFile(path.join(out, `icon-${size}.png`));
  }
  console.log("raster exports written:");
  for (const f of fs.readdirSync(out)) {
    console.log("  " + f.padEnd(24) + fs.statSync(path.join(out, f)).size + " bytes");
  }
})().catch((e) => { console.error(e); process.exit(1); });