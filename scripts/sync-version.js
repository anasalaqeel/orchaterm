import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

// If an explicit version or tag is passed via CLI argument or env var (e.g. 'v0.5.3' or '0.5.3'),
// strip any leading 'v' and update package.json.
const rawVersion =
  process.argv[2] ||
  process.env.APP_VERSION ||
  (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);

if (rawVersion) {
  const cleanVersion = rawVersion.trim().replace(/^v/, '');
  pkg.version = cleanVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

const version = pkg.version;

// Update tauri.conf.json
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// Update Cargo.toml
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf-8');
cargoToml = cargoToml.replace(/^version\s*=\s*".*"/m, `version = "${version}"`);
fs.writeFileSync(cargoTomlPath, cargoToml);

console.log(`Synced version ${version} to package.json and Tauri configs.`);
