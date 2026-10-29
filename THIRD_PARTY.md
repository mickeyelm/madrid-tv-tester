# Third-party material

Everything here keeps its own licence. Nothing in this list is MADRiD's.

| What | Where | Version | Licence | Source |
|---|---|---|---|---|
| three.js | `static/vendor/three/` | r185 | MIT (`static/vendor/three/LICENSE`) | https://github.com/mrdoob/three.js |
| Poly Haven surface scans (Rock Face 03, Sand 01, Coast Sand Rocks 02) | `static/aquarium/assets/environment/*.jpg` | 1k JPG maps, downloaded 2026-09-05 | CC0-1.0 (`README.md` and `sources.json` beside them credit the authors and record SHA-256) | https://polyhaven.com |
| cannon-es | `static/vendor/cannon-es.js` | as vendored by the station | MIT (`static/vendor/cannon-es.LICENSE`) | https://github.com/pmndrs/cannon-es |
| TensorFlow.js | `static/vendor/tfjs/tf.min.js` | 4.22.0 | Apache-2.0 (`static/vendor/tfjs/LICENSE`) | https://github.com/tensorflow/tfjs |
| pose-detection | `static/vendor/pose-detection/pose-detection.min.js` | 2.1.3 | Apache-2.0 | https://github.com/tensorflow/tfjs-models |
| MoveNet SinglePose Lightning | `static/models/movenet-singlepose-lightning-4/` | v4 | Apache-2.0 | see `SOURCE.md` there |
| Px437 IBM Model3x Alt4, Px437 IBM PS/55 | `static/assets/Px437_*.ttf` | Ultimate Oldschool PC Font Pack | CC BY-SA 4.0, VileR | https://int10h.org/oldschool-pc-fonts/ |
| Px437 IBM VGA 8x16 (as 8x16 bitmaps) | `static/marks/cp437.json` | Ultimate Oldschool PC Font Pack v2.2 | CC BY-SA 4.0, VileR | https://int10h.org/oldschool-pc-fonts/ |
| QR Code Generator for JavaScript | `static/vendor/qrcode-generator.js` | as vendored by the station | MIT, Kazuhiko Arase (licence in the file header) | https://github.com/kazuhikoarase/qrcode-generator |
| Creepster | `static/assets/Creepster-Regular.ttf` | Google Fonts | SIL OFL 1.1 (`static/assets/Creepster-OFL.txt`), Font Diner | https://fonts.google.com/specimen/Creepster |
| CH 03 programmes | streamed, not stored | | per item, see `lineup.json` `programs[*].license` | https://archive.org |
| CH 24 radio streams (NTS 1, NTS 2, Radio Paradise, KEXP, dublab, WFMU) | streamed straight from each station, not stored or relayed | live | each station's own terms; listed in `radio.json` | the stations' public listening streams; NTS show titles from https://www.nts.live/api/v2/live |
| Rock of Love (CH 03 CHANNEL DRIFT) | played in YouTube's own embedded player from the official Banijay Reality uploads; nothing downloaded, stored or re-published | episode list in `drift.json` | Banijay's and YouTube's terms | https://www.youtube.com (the uploads named in drift.json) |
| Open-Meteo weather data | fetched live by `static/shim/01.js` (CH 01), not stored | current forecast API | CC BY 4.0, non-commercial free tier (see `docs/channels/01.md`) | https://open-meteo.com |

The station's own Jokerman face is an ITC/Microsoft commercial font and is not
redistributed; Creepster stands in for it here.
