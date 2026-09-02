# Third-Party Notices

The brand marks shipped in `public/logos/` are the trademarks of their
respective companies. They are used here solely to identify the companies
assessed by the tool (nominative use), in the same way the app's other brand
marks are shown as favicons. This project is not affiliated with, endorsed
by, or sponsored by any of these companies.

## Why these assets exist

Ten brands' official domains have no favicon indexed by the Google favicon
service, so a favicon fetch would 404 (surfacing as a console error). Instead
of making a failing request, the app ships a local copy of each mark in
`public/logos/`, resolved by `logoUrl()` in `lib/utils.ts`.

The landing-page marquee additionally ships monochrome (white) marks for the
twenty largest companies in the dataset under `public/logos/marquee/`,
resolved by `marqueeLogoUrl()` in `lib/utils.ts`. These are rasterized at
high resolution from the sources below and recolored to white via a canvas
filter so they read cleanly on the dark surface.

## Logo assets and their sources

| File | Company | Source |
|---|---|---|
| `allstate.svg` | Allstate | Wikimedia Commons: [File:Allstate wordmark.svg](https://commons.wikimedia.org/wiki/File:Allstate_wordmark.svg) |
| `berkshire-hathaway.svg` | Berkshire Hathaway | Wikimedia Commons: [File:Berkshire-Hathaway-Logo.svg](https://commons.wikimedia.org/wiki/File:Berkshire-Hathaway-Logo.svg) |
| `comcast.png` | Comcast | Comcast corporate site: `corporate.comcast.com/resources/corporate/assets/img/favicon.png` |
| `conocophillips.png` | ConocoPhillips | ConocoPhillips site: `conocophillips.com/favicons/favicon-32x32.png` |
| `danaher.svg` | Danaher | Wikimedia Commons: [File:Danaher Corporation logo.svg](https://commons.wikimedia.org/wiki/File:Danaher_Corporation_logo.svg) |
| `dow.svg` | Dow | Wikimedia Commons: [File:Dow Chemical Company logo.svg](https://commons.wikimedia.org/wiki/File:Dow_Chemical_Company_logo.svg) |
| `foxcorp.png` | Fox Corporation | Fox Corporation site: `foxcorporation.com/wp-content/themes/foxcorporation/images/icon/favicon-32x32.png` |
| `kraftheinz.svg` | Kraft Heinz | Wikimedia Commons: [File:KraftHeinz.svg](https://commons.wikimedia.org/wiki/File:KraftHeinz.svg) |
| `palo-alto-networks.png` | Palo Alto Networks | Palo Alto Networks site: `paloaltonetworks.com/etc/clientlibs/pan/img/favicons2020/favicon-32x32.png` |
| `rockwell-automation.png` | Rockwell Automation | Rockwell Automation site: `rockwellautomation.com/etc.clientlibs/rockwell-aem-base/clientlibs/clientlib-base/resources/favicons/favicon-32x32.png` |

### Marquee marks (`public/logos/marquee/`)

| File | Company | Source |
|---|---|---|
| `alphabet.png` | Alphabet | Wikimedia Commons: [File:Alphabet Inc Logo 2015.svg](https://commons.wikimedia.org/wiki/File:Alphabet_Inc_Logo_2015.svg) |
| `amazon.png` | Amazon | Wikimedia Commons: [File:Amazon logo.svg](https://commons.wikimedia.org/wiki/File:Amazon_logo.svg) |
| `apple.png` | Apple | Wikimedia Commons: [File:Apple logo black.svg](https://commons.wikimedia.org/wiki/File:Apple_logo_black.svg) |
| `berkshire-hathaway.png` | Berkshire Hathaway | Wikimedia Commons: [File:Berkshire-Hathaway-Logo.svg](https://commons.wikimedia.org/wiki/File:Berkshire-Hathaway-Logo.svg) |
| `cardinal-health.png` | Cardinal Health | Wikimedia Commons: [File:Cardinal Health Logo.svg](https://commons.wikimedia.org/wiki/File:Cardinal_Health_Logo.svg) |
| `cencora.png` | Cencora | Wikimedia Commons: [File:Cencora logo.png](https://commons.wikimedia.org/wiki/File:Cencora_logo.png) |
| `centene.png` | Centene | Wikimedia Commons: [File:Centene Corporation Logo.svg](https://commons.wikimedia.org/wiki/File:Centene_Corporation_Logo.svg) |
| `chevron.png` | Chevron | Wikimedia Commons: [File:Chevron Logo.svg](https://commons.wikimedia.org/wiki/File:Chevron_Logo.svg) |
| `cigna.png` | The Cigna Group | Wikimedia Commons: [File:Cigna Logo.png](https://commons.wikimedia.org/wiki/File:Cigna_Logo.png) |
| `costco.png` | Costco | Wikimedia Commons: [File:Costco Wholesale logo 2010-10-26.svg](https://commons.wikimedia.org/wiki/File:Costco_Wholesale_logo_2010-10-26.svg) |
| `cvs-health.png` | CVS Health | Wikimedia Commons: [File:CVS Health logo.svg](https://commons.wikimedia.org/wiki/File:CVS_Health_logo.svg) |
| `elevance-health.png` | Elevance Health | Wikimedia Commons: [File:Elevance Health logo.svg](https://commons.wikimedia.org/wiki/File:Elevance_Health_logo.svg) |
| `exxonmobil.png` | ExxonMobil | Wikimedia Commons: [File:ExxonMobil Logo.svg](https://commons.wikimedia.org/wiki/File:ExxonMobil_Logo.svg) |
| `general-motors.png` | General Motors | Wikimedia Commons: [File:General motors logo with wordmark.svg](https://commons.wikimedia.org/wiki/File:General_motors_logo_with_wordmark.svg) |
| `jpmorgan-chase.png` | JPMorgan Chase | Wikimedia Commons: [File:JPMorgan Chase.svg](https://commons.wikimedia.org/wiki/File:JPMorgan_Chase.svg) |
| `mckesson.png` | McKesson | Wikimedia Commons: [File:McKesson logo.svg](https://commons.wikimedia.org/wiki/File:McKesson_logo.svg) |
| `meta.png` | Meta | Wikimedia Commons: [File:Meta-Logo.png](https://commons.wikimedia.org/wiki/File:Meta-Logo.png) |
| `microsoft.png` | Microsoft | Wikimedia Commons: [File:Microsoft logo (2012).svg](https://commons.wikimedia.org/wiki/File:Microsoft_logo_(2012).svg) |
| `nvidia.png` | Nvidia | Wikimedia Commons: [File:Nvidia logo.svg](https://commons.wikimedia.org/wiki/File:Nvidia_logo.svg) |
| `toyota.png` | Toyota | Wikimedia Commons: [File:Toyota carlogo.svg](https://commons.wikimedia.org/wiki/File:Toyota_carlogo.svg) |
| `united-health.png` | UnitedHealth Group | Wikimedia Commons: [File:UnitedHealth Group logo.svg](https://commons.wikimedia.org/wiki/File:UnitedHealth_Group_logo.svg) |
| `walmart.png` | Walmart | Wikimedia Commons: [File:Walmart logo.svg](https://commons.wikimedia.org/wiki/File:Walmart_logo.svg) |

## Licensing notes

- Files sourced from Wikimedia Commons carry the license stated on their file
  page (typically public domain or a permissive text-logo license); follow the
  links above for the exact terms.
- Files sourced from company websites are the companies' own icons, served
  from their official domains. They are reproduced here for identification
  only; all rights remain with the respective trademark owners.
- If you believe any mark is used improperly, open an issue and it will be
  removed or replaced.
