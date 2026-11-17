# HERMES vehicle studio assets

Added to HERMES on **2026-11-13**.

The five current studio vehicles are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). HERMES uses the GLBs from the [pinned carros distribution](https://github.com/pedrosoandre/carros/tree/2d18dfd9db96bbf0d9cffa949deaf7f571388cbf/assets), which preserves the Sketchfab credits in each asset. HERMES reorients, scales and recolors the exterior paint at runtime.

| HERMES body | Original with creator credit | File | Additional adaptation |
|---|---|---|---|
| Sedan and general fallback | [Renault Megane Sedan · Mona x Supercars](https://sketchfab.com/3d-models/renault-megane-sedan-0c0d6c54a2424feb95447400a5c5e50e) | `renault-megane.glb` | Renamed glazing materials. |
| Hatchback | [Volkswagen Golf 8. GTI (A8) · GT Cars: Hyperspeed](https://sketchfab.com/3d-models/volkswagen-golf-8-gti-a8-e87d7c0f8937481db236529beb5ecab7) | `vw-golf.glb` | Renamed the glazing material. |
| Estate | [Volkswagen Passat Variant R-Line2016 · ANDREO12](https://sketchfab.com/3d-models/volkswagen-passat-variant-r-line2016-f946c79a2e534137a5ffd30aa0173566) | `volkswagen-passat.glb` | Removed the display platform, renamed the glazing material, normalized the dielectric index of refraction and toned down the lamp and trim materials for the parked vehicle. |
| SUV | [2021 Toyota RAV4 Hybrid · tonielpro520](https://sketchfab.com/3d-models/2021-toyota-rav4-hybrid-de74fe4e98004c92b1103947597d1b53) | `toyota-rav4.glb` | Removed the source license plate. |
| Van | [2014 Fiat Ducato · razor24](https://sketchfab.com/3d-models/2014-fiat-ducato-8a651ad182414bb0a8b6c6d8d5bd7c01) | `fiat-ducato.glb` | Runtime changes only. |

Checksums for the checked-in GLBs are listed in [sources.json](sources.json).

CC BY 4.0 permits commercial reuse and adaptation with creator credit, license link and a note about modifications. Manufacturer badges, logos and other third-party rights are outside the copyright license. The five source licenses are recorded in the GLB metadata and source list above.

## Login scene

The garage geometry and composition were created for HERMES. The desktop and mobile renders feature [Volkswagen Golf 8. GTI (A8) by GT Cars: Hyperspeed](https://sketchfab.com/3d-models/volkswagen-golf-8-gti-a8-e87d7c0f8937481db236529beb5ecab7), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The model was posed and repainted, and lamp emission was disabled for this render.

The scene uses [Garage Floor](https://polyhaven.com/a/garage_floor), [Weathered Plank Siding](https://polyhaven.com/a/weathered_plank_siding), [Plaster Grey 04](https://polyhaven.com/a/plaster_grey_04) and [Studio Small 03](https://polyhaven.com/a/studio_small_03) from Poly Haven, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). These materials and lighting are baked into the login images.

## Lighting and superseded assets

| Asset | Creator and source | License | HERMES adaptation |
|---|---|---|---|
| Rally-Raid | [drcollect, Collect Cars](https://github.com/drcollect/collect-cars/tree/70f467ab86d6ae9e8eea17d542ccdfac30550075) · [original uncompressed GLB](https://raw.githubusercontent.com/drcollect/collect-cars/70f467ab86d6ae9e8eea17d542ccdfac30550075/models/full/rally.glb) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [upstream license](https://github.com/drcollect/collect-cars/blob/70f467ab86d6ae9e8eea17d542ccdfac30550075/LICENSE) | Representative SUV/off-road body. Reoriented, scaled and tinted at runtime. |
| Sedan car | [Innerscene](https://www.innerscene.com/tools/library/3d-parts/sedan-car-42109739) · [GLB](https://www.innerscene.com/api/library/sedan-car-42109739/download?format=glb) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Compact fallback sedan. Reoriented, scaled and tinted at runtime. |
| Studio Small 03 | [Greg Zaal, Poly Haven](https://polyhaven.com/a/studio_small_03) · [1K HDR](https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Lighting and reflections. The background is rendered by HERMES. |

SHA-256 of the checked-in, unmodified source files:

- `rally.glb` — `ca139d39823ac4644620f0e0b4753c73beec7b9edd2c23f2abd9ef1c759552e9`
- `sedan-compact.glb` — `187c9935c40f952837fe2d98200b390415e695196d7b1280c9ec3ebb1bf4961b`
- `studio-small-03.hdr` — `30933d55e45f0795daf49f3cbefbe0e5ebcb821ee04fb0a2818c02ffc3938817`

The remaining bodies have separate notices for [Innerscene](../vehicle-bodies/LICENSE.md) and [Khronos Car Concept](../khronos-car/LICENSE.md).
