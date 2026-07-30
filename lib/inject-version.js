import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const swPath = path.join(rootDir, 'public', 'sw.ts');

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version || '1.0';

  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/const SW_VERSION = '.*?';/, `const SW_VERSION = '${version}';`);
    swContent = swContent.replace(/const CACHE_NAME = '.*?';/, `const CACHE_NAME = 'gap-flow-v${version}';`);
    fs.writeFileSync(swPath, swContent);
    console.log(`[Inject-Version] Synchronized sw.ts to version v${version}`);
  }
} catch (err) {
  console.error('[Inject-Version] Error synchronizing sw.ts:', err.message);
}
