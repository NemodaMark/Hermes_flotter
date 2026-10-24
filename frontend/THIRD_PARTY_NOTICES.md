# Sera UI

HERMES uses manually integrated, adapted Sera UI components, following the
[official copy-and-customize workflow](https://seraui.com/docs).

Upstream: https://github.com/seraui/seraui
Pinned reference: `52dcbaddeb13a58675717f14a9801e7272344eb2`

Adapted sources:

- `src/app/docs/button/button.tsx` → `src/ui/Button.tsx`
- `src/app/docs/badge/badge.tsx` → `src/ui/Badge.tsx`
- `src/app/docs/doctabs/doctabs-vertical.tsx` → `src/ui/TabButton.tsx`, field navigation styling

Styles are translated from Tailwind utilities to HERMES CSS tokens in
`src/ui/sera.css`. The app keeps IBM Plex Sans and its navy/teal palette.
Decorative effects and Framer Motion are omitted; press and focus feedback use
CSS with reduced-motion support. The badge is deliberately noninteractive.
Native button/submit behavior, disabled states, ARIA, controlled panels and
validation remain in the app. No Tailwind preflight or external runtime is added.

## License

MIT License

Copyright (c) 2025 Sera UI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


# Three.js

The vehicle studio uses Three.js, OrbitControls and RoomEnvironment from the three npm package (https://github.com/mrdoob/three.js). Vehicle geometry is authored in HERMES; no Forza artwork or third-party vehicle models are included.

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
