import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const swPath = path.join(rootDir, 'public', 'sw.ts');

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  let version = pkg.version || '0.0';

  try {
    const commitCount = execSync('git rev-list --count HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
    if (commitCount && /^\d+$/.test(commitCount)) {
      version = `${version}.${commitCount}`;
    }
  } catch (_) {
    // Git in dieser Umgebung nicht verfügbar
  }

  const buildTime = Date.now().toString();

  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/const SW_VERSION = '.*?';/, `const SW_VERSION = '${version}';`);
    swContent = swContent.replace(/const CACHE_NAME = '.*?';/, `const CACHE_NAME = 'gap-flow-v${version}-${buildTime}';`);
    fs.writeFileSync(swPath, swContent);
    console.log(`[Inject-Version] Synchronized sw.ts to version v${version} (Build: ${buildTime})`);
  }
} catch (err) {
  const error = err as Error;
  console.error('[Inject-Version] Error synchronizing versions:', error.message);
}
