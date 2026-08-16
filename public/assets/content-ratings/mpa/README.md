# MPA rating block vectors

These path-only SVG rating blocks are public-domain files preserved by English Wikipedia:

- `g.svg`: https://en.wikipedia.org/wiki/File:MPA_G_RATING_(block).svg
- `pg.svg`: https://en.wikipedia.org/wiki/File:MPA_PG_RATING_(block).svg
- `pg-13.svg`: https://en.wikipedia.org/wiki/File:MPA_PG-13_RATING_(block).svg
- `r.svg`: https://en.wikipedia.org/wiki/File:MPA_R_RATING_(block).svg
- `nc-17.svg`: https://en.wikipedia.org/wiki/File:MPA_NC-17_RATING_(block).svg

MediaWiki reports `LicenseShortName: PD` and `UsageTerms: Public domain` for each file.

The local copies change each template's flat classification color to black and
add one transparent viewBox unit to the right so the external registered mark
is not clipped. Path geometry and white fills are unchanged. Storing the
monochrome paths directly avoids a runtime SVG filter that rasterizes the
smallest footer lettering when the block is enlarged.

The application renders one vector as a local SVG image and masks only its placeholder descriptor artwork when normalized title-specific descriptors are available. Descriptor overlays use the Arial/Helvetica Bold typography declared by FilmRatings' current official rating-guide SVG.
