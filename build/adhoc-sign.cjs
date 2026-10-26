// Without a Developer ID, sign the app ad hoc so Apple Silicon will run it. Runs
// as afterSign: Electron fuses are flipped after afterPack and would break the seal.
// With CSC_LINK set, electron-builder signs it properly instead.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async (context) => {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
