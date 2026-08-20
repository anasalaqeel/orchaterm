import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
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

console.log(`Synced version ${version} to Tauri configs.`);
