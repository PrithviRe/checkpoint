const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(srcDir, 'dist');
const chromeDir = path.join(distDir, 'chrome');
const firefoxDir = path.join(distDir, 'firefox');

console.log('Starting Checkpoint build process...');

// Helper to generate icons
const sharp = require('sharp');

async function generateIcons() {
  const svgPath = path.join(srcDir, 'assets', 'logo.svg');

  const sizes = [16, 32, 48, 64, 96, 128];

  for (const browserDir of [chromeDir, firefoxDir]) {
    const iconsDir = path.join(browserDir, 'icons');
    fs.mkdirSync(iconsDir, { recursive: true });

    for (const size of sizes) {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(path.join(iconsDir, `icon${size}.png`));
    }
  }

  console.log('✓ Generated icons');
}

// Helper to recursively copy files, ignoring dev/temp folders
function copyFolder(src, dest) {
  const ignoreList = [
    'node_modules',
    'dist',
    '.git',
    '.gemini',
    'build.js',
    'package.json',
    'package-lock.json',
    '.gitignore',
    'README.md',
  ];

  if (ignoreList.some(ignoreItem => src.endsWith(ignoreItem))) {
    return;
  }

  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(child => {
      copyFolder(path.join(src, child), path.join(dest, child));
    });
  } else {
    // Ensure parent dir exists
    const parentDir = path.dirname(dest);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

(async () => {
try {
  // 1. Reset dist folders
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(chromeDir, { recursive: true });
  fs.mkdirSync(firefoxDir, { recursive: true });

  // 2. Copy source files to both builds
  fs.readdirSync(srcDir).forEach(item => {
    const srcPath = path.join(srcDir, item);
    copyFolder(srcPath, path.join(chromeDir, item));
    copyFolder(srcPath, path.join(firefoxDir, item));
  });

  await generateIcons();

  // 3. Customize manifest for Firefox build
  const firefoxManifestPath = path.join(firefoxDir, 'manifest.json');
  if (fs.existsSync(firefoxManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(firefoxManifestPath, 'utf8'));

    // Convert Chrome background service worker to Firefox background scripts
    if (manifest.background && manifest.background.service_worker) {
      const swPath = manifest.background.service_worker;
      delete manifest.background.service_worker;
      manifest.background.scripts = [swPath];
      // Keep "type": "module" if present, which Firefox supports for scripts
    }

    // Inject Firefox Gecko settings for local debugging and AMO validation.
    manifest.browser_specific_settings = {
      gecko: {
        id: "checkpoint@kaneki.projects",
        strict_min_version: "140.0",
        data_collection_permissions: {
          required: ["none"]
        }
      },
      gecko_android: {
        strict_min_version: "142.0"
      }
    };

    fs.writeFileSync(firefoxManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('✓ Firefox manifest successfully adapted.');
  }

  console.log('✓ Chrome build ready in: dist/chrome');
  console.log('✓ Firefox build ready in: dist/firefox');
  console.log('Build completed successfully!');
} catch (err) {
  console.error('Build failed with error:', err);
  process.exit(1);
}
})();
