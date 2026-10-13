import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import pkg from '../../package.json';

/**
 * Version of the running app for display purposes.
 *
 * Seeded from package.json at build time so the first paint is already
 * correct, then confirmed from the binary itself — `getVersion()` reads the
 * version Tauri compiled into the app (tauri.conf.json), which is the
 * authoritative source. In non-Tauri hosts (unit tests) the build-time value
 * is kept.
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState(pkg.version);

  useEffect(() => {
    let alive = true;
    getVersion()
      .then((binaryVersion) => {
        if (alive) setVersion(binaryVersion);
      })
      .catch(() => {
        // Not running under Tauri — keep the build-time version.
      });
    return () => {
      alive = false;
    };
  }, []);

  return version;
}
