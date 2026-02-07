import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const isWatch = process.argv.includes("--watch");
const outDir = "dist";

// Ensure output directories exist
for (const dir of [
  `${outDir}/background`,
  `${outDir}/content`,
  `${outDir}/worklet`,
  `${outDir}/popup`,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Common build options
const commonOptions: esbuild.BuildOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
  target: "es2020",
  logLevel: "info",
};

// Build configurations for each entry point
const builds: esbuild.BuildOptions[] = [
  // Background Service Worker (ESM)
  {
    ...commonOptions,
    entryPoints: ["src/background/service-worker.ts"],
    outfile: `${outDir}/background/service-worker.js`,
    format: "esm",
  },
  // Content Script (IIFE -- no module support in content scripts)
  {
    ...commonOptions,
    entryPoints: ["src/content/content-script.ts"],
    outfile: `${outDir}/content/content-script.js`,
    format: "iife",
  },
  // AudioWorklet Processors (IIFE -- WorkletGlobalScope, no module support)
  {
    ...commonOptions,
    entryPoints: ["src/worklet/sleep-processor.ts"],
    outfile: `${outDir}/worklet/sleep-processor.js`,
    format: "iife",
  },
{
    ...commonOptions,
    entryPoints: ["src/worklet/vocal-processor.ts"],
    outfile: `${outDir}/worklet/vocal-processor.js`,
    format: "iife",
  },
  // Popup (IIFE)
  {
    ...commonOptions,
    entryPoints: ["src/popup/popup.ts"],
    outfile: `${outDir}/popup/popup.js`,
    format: "iife",
  },
];

// Copy static assets to dist
function copyStaticAssets(): void {
  // Popup HTML
  const htmlSrc = "src/popup/popup.html";
  const htmlDest = `${outDir}/popup/popup.html`;
  if (fs.existsSync(htmlSrc)) {
    fs.copyFileSync(htmlSrc, htmlDest);
    console.log(`Copied ${htmlSrc} -> ${htmlDest}`);
  }

  // Popup CSS
  const cssSrc = "src/popup/popup.css";
  const cssDest = `${outDir}/popup/popup.css`;
  if (fs.existsSync(cssSrc)) {
    fs.copyFileSync(cssSrc, cssDest);
    console.log(`Copied ${cssSrc} -> ${cssDest}`);
  }

  // Ensure icon directory exists and create placeholder SVG icons if missing
  const iconsDir = "assets/icons";
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    const iconPath = `${iconsDir}/icon-${size}.png`;
    if (!fs.existsSync(iconPath)) {
      // Create a minimal 1x1 PNG placeholder (valid PNG header)
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
        0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
        0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63,
        0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21,
        0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
      ]);
      fs.writeFileSync(iconPath, png);
      console.log(`Created placeholder icon: ${iconPath}`);
    }
  }
}

async function build(): Promise<void> {
  copyStaticAssets();

  if (isWatch) {
    // Watch mode: create contexts and watch
    const contexts = await Promise.all(
      builds.map((opts) => esbuild.context(opts))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    // One-shot build
    await Promise.all(builds.map((opts) => esbuild.build(opts)));
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
