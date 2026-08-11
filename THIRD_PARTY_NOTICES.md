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

## Licensing notes

- Files sourced from Wikimedia Commons carry the license stated on their file
  page (typically public domain or a permissive text-logo license); follow the
  links above for the exact terms.
- Files sourced from company websites are the companies' own icons, served
  from their official domains. They are reproduced here for identification
  only; all rights remain with the respective trademark owners.
- If you believe any mark is used improperly, open an issue and it will be
  removed or replaced.
