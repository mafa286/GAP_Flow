import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const swPath = path.join(rootDir, 'public', 'sw.ts');
const versionTsPath = path.join(rootDir, 'public', 'js', 'version.ts');

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version || '0.0';

  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/const SW_VERSION = '.*?';/, `const SW_VERSION = '${version}';`);
    swContent = swContent.replace(/const CACHE_NAME = '.*?';/, `const CACHE_NAME = 'gap-flow-v${version}';`);
    fs.writeFileSync(swPath, swContent);
    console.log(`[Inject-Version] Synchronized sw.ts to version v${version}`);
  }

  if (fs.existsSync(versionTsPath)) {
    let vContent = fs.readFileSync(versionTsPath, 'utf8');
    vContent = vContent.replace(/export const GAP_FLOW_VERSION = '.*?';/, `export const GAP_FLOW_VERSION = '${version}';`);
    fs.writeFileSync(versionTsPath, vContent);
    console.log(`[Inject-Version] Synchronized version.ts to version v${version}`);
  }
} catch (err) {
  const error = err as Error;
  console.error('[Inject-Version] Error synchronizing versions:', error.message);
}
