# Sera UI

HERMES uses manually integrated, adapted Sera UI components, following the
[official copy-and-customize workflow](https://seraui.com/docs).

Upstream: https://github.com/seraui/seraui
Pinned reference: `52dcbaddeb13a58675717f14a9801e7272344eb2`

Adapted sources:

- `src/app/docs/button/button.tsx` → `src/ui/Button.tsx`
- `src/app/docs/badge/badge.tsx` → `src/ui/Badge.tsx`
- `src/app/docs/doctabs/doctabs-vertical.tsx` → `src/ui/TabButton.tsx`, field navigation styling

The [Liquid Glass documentation](https://seraui.com/docs/liquid-glass) informs
the CSS backdrop treatment in `src/ui/glass.css` and the original SVG edge
refraction in `src/ui/LiquidGlass.tsx`. The garage uses refraction on its camera
controls, quick actions and vehicle selector on supported desktop browsers. It
uses blur on touch screens and other compatible browsers, and opaque surfaces
when reduced transparency is requested or blur is unavailable.

Styles are translated from Tailwind utilities to HERMES CSS tokens in
`src/ui/sera.css`. The app keeps IBM Plex Sans and its navy/teal palette.
The upstream button ripple and Framer Motion are omitted; press and focus feedback use
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

The vehicle studio uses Three.js, OrbitControls, GLTFLoader and RoomEnvironment from the three npm package (https://github.com/mrdoob/three.js).

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

# Khronos glTF Sample Assets — Car Concept

Model and textures: Eric Chadwick, © 2024 Darmstadt Graphics Group GmbH.
License: Creative Commons Attribution 4.0 International (CC BY 4.0).
https://creativecommons.org/licenses/by/4.0/

Source: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/7d4ba189827916452eeadc82d4b712dbc6280a6f/Models/CarConcept

Adapted for HERMES: logo plate texture and steering emblem removed, unused data
and sample material variants pruned; runtime paint, framing, lighting and hotspots
added. No Forza assets are used. The model attribution is visible below the
showroom. Full notices and provenance are shipped in public/models/khronos-car/.

# Body-specific vehicle models — Innerscene

Original, unbranded sedan, hatchback, estate, SUV, convertible, MPV, van, pickup,
box truck and dump truck models by Innerscene, released under CC0 1.0 Universal:
https://creativecommons.org/publicdomain/zero/1.0/

Adaptations: neutral runtime exterior paint; unused paint textures removed;
freight enclosure removed for the chassis-cab variant; body-specific framing
and hotspots. Source pages, original and prepared SHA-256 checksums, and notices
are bundled in public/models/vehicle-bodies/. These are representative body
illustrations, not manufacturer-specific replicas. Model credits in the studio
follow the selected model; the Khronos notice applies to the coupe only.
