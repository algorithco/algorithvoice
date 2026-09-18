import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    "C:\\Users\\hamro\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--in-process-gpu"],
});
const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
for (const vp of viewports) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const ctn = document.querySelector(".aurora-container");
    const canvas = ctn?.querySelector("canvas");
    const hero = ctn?.parentElement;
    return {
      bodySW: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      ctnRect: ctn?.getBoundingClientRect().toJSON(),
      canvasAttr: canvas
        ? { w: canvas.width, h: canvas.height }
        : null,
      canvasStyle: canvas
        ? { w: canvas.style.width, h: canvas.style.height }
        : null,
      heroH: hero?.getBoundingClientRect().height,
    };
  });
  console.log(`${vp.name}:`, JSON.stringify(info));
  await page.screenshot({
    path: `C:\\Users\\hamro\\AppData\\Local\\Temp\\opencode\\hero-${vp.name}.png`,
  });
  await page.close();
}
await browser.close();
