import { build, Platform, Arch } from 'electron-builder';
// Level 5 avoids expensive level-9 recompression of Chromium on developer machines.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '5';
await build({ targets: Platform.WINDOWS.createTarget('portable', Arch.x64) });
