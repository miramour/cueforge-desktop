# Third-party software

The CueForge source code is MIT licensed. Third-party components retain their own licenses.

| Component                                   | License                      | Source                                 |
| ------------------------------------------- | ---------------------------- | -------------------------------------- |
| Electron / Chromium / Node.js               | MIT and third-party licenses | https://github.com/electron/electron   |
| React, React DOM, scheduler                 | MIT                          | https://github.com/facebook/react      |
| Lucide React                                | ISC / MIT icons              | https://github.com/lucide-icons/lucide |
| FFmpeg 9.0.1 essentials, Gyan Windows build | GPLv3                        | https://www.gyan.dev/ffmpeg/builds/    |

FFmpeg is a separate, unmodified command-line executable. It is not linked into CueForge.
The Windows distribution includes its LICENSE and complete upstream README.txt with
build configuration, external-library versions, and source references in resources/ffmpeg.
Electron's LICENSE and LICENSES.chromium.html accompany the unpacked application.
The dependency lockfile records exact JavaScript versions.

## FFmpeg source and build information

- Exact binary archive: https://github.com/GyanD/codexffmpeg/releases/download/9.0.1/ffmpeg-9.0.1-essentials_build.zip
- Archive SHA-256: fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9
- FFmpeg source commit: https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a
- Source release: https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz
- Source and build instructions for included libraries: see the upstream README.txt installed by `npm run setup:audio`.
- FFmpeg license information: https://ffmpeg.org/legal.html

Redistributors must preserve the upstream notices and comply with each component's
source-distribution obligations. The MIT license does not relicense the FFmpeg binary.

HypeCue is a separate product. Its binaries, source code, branding, screenshots,
license files and demonstration audio are not distributed in this repository.
The `.hcpl` adapter implements data-format interoperability only.
