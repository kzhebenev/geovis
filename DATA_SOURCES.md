# Data sources and licenses

**[Русская версия](DATA_SOURCES.ru.md)**

GeoVis **does not ship any geographic data in this repository**. The pipeline (`pipeline/prepare.py`) downloads
every dataset from its original publisher and converts it into grids for the web app. The MIT license of this
repository covers **only the code and documentation**. Every dataset keeps the license of its publisher, and
whoever runs the pipeline and serves the resulting site is responsible for complying with it.

Licenses below were checked against the publishers' own pages on **2026-10-09**. Licenses change, so re-check
them before using GeoVis commercially. This page is not legal advice.

## Summary

| Status | Datasets |
|---|---|
| ✅ Free to use, including commercially, **with attribution** | population 1975–2030 (GHSL), population projections 2040–2100 (WorldPop), built-up 2020 (GHSL), shipping lanes (World Bank), GDP grids (Kummu et al.), GDP by country (World Bank), Russian regions (Rosstat) |
| ✅ Public domain / not copyrighted (credit appreciated) | country boundaries and cities (Natural Earth), relief (NOAA ETOPO 2022), night lights (NASA Black Marble) |
| ⚠️ **Restricted**: non-commercial and/or no redistribution of derived data | climate 1970–2000 / 2041–2060 / 2081–2100 (WorldClim 2.1), CO₂ emissions (IEA-EDGAR CO₂) |

**Restricted datasets are off by default.** `prepare.py` skips them unless you pass `--include-restricted`.
Pass it only if your use complies with their terms, for example a private, non-commercial installation, or
after you have permission from the publisher. A public website that serves the derived grids is
**redistribution** of the data. In the app these datasets are marked *non-commercial* in the data picker.

## Gridded datasets

| ID | Dataset | Publisher | License | Restricted |
|---|---|---|---|---|
| `pop1975` … `pop2030` | GHS-POP R2023A, population grid, 30″ | European Commission, JRC | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (© European Union; reuse authorised with acknowledgement) | no |
| `pop2040` `pop2060` `pop2080` `pop2100` | FuturePop SSP2, 1 km population projections v0.2 | WorldPop, University of Southampton | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no |
| `built2020` | GHS-BUILT-S R2023A, built-up surface | European Commission, JRC | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (© European Union) | no |
| `lights2016` | Black Marble 2016 (Earth at Night), grayscale | NASA Earth Observatory / GSFC | [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/): generally not copyrighted; credit NASA; no implied endorsement | no |
| `relief` | ETOPO 2022 Global Relief Model, 60″ | NOAA NCEI | Public domain (U.S. Government work) | no |
| `ships` | Global Shipping Traffic Density 2015–2021 | World Bank (data from IMF) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no |
| `gdp2024`, `gdppc2024` | Gridded GDP and GDP per capita (PPP), 1990–2024 | Kummu, Kosonen, Masoumzadeh Sayyar (Aalto University), Zenodo | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no |
| `temp`, `precip` | WorldClim 2.1 bioclimatic variables, 1970–2000 | WorldClim (Fick & Hijmans) | [WorldClim terms](https://www.worldclim.org/about.html): *"freely available for academic use and other non-commercial use. Redistribution or commercial use is not allowed without prior permission"* | **yes** |
| `temp2050`, `temp2090`, `precip2050` | WorldClim 2.1 CMIP6 downscaled projections (mean of 4 models) | WorldClim | same WorldClim terms | **yes** |
| `co2_2025` | EDGAR_2026_GHG, CO₂ totals, 0.1° | European Commission JRC; IEA | IEA-EDGAR CO₂: [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) (other EDGAR gases are CC BY 4.0) | **yes** |

## Datasets by country / region

| ID | Dataset | Publisher | License |
|---|---|---|---|
| `wb_gdp`, `wb_gdppc` | World Development Indicators: GDP (NY.GDP.MKTP.CD), GDP per capita (NY.GDP.PCAP.CD) | The World Bank | [CC BY 4.0 + World Bank dataset terms](https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets) |
| `rosstat_vrp`, `rosstat_vrp_pc`, `rosstat_pop` | Gross regional product (total and per capita), population estimate on 1 Jan 2025 | Federal State Statistics Service of Russia (Rosstat) | Official statistical information published openly on rosstat.gov.ru. There is no explicit open license; we use it with attribution to Rosstat. |

## Base layers

| What | Publisher | License |
|---|---|---|
| Country boundaries, admin-1 regions, populated places (labels) | [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) | Public domain |
| `pipeline/certs/russian_trusted_ca.pem`: root and intermediate certificates of the Russian Ministry of Digital Development (needed to download from rosstat.gov.ru) | Ministry of Digital Development of Russia | Public certificates, published for free download |

## Required citations

Shown in the app under every map (the *Data:* line) and stored in `catalog.json` → `datasets[].license.cite`:

- **GHS-POP R2023A:** Schiavina M., Freire S., Carioli A., MacManus K. (2023). *GHS-POP R2023A — GHS population grid multitemporal (1975-2030).* European Commission, Joint Research Centre (JRC). doi:[10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE](https://doi.org/10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE)
- **GHS-BUILT-S R2023A:** European Commission, JRC (2023). *GHS-BUILT-S R2023A — GHS built-up surface grid (1975-2030).* doi:[10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA](https://doi.org/10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA)
- **WorldPop FuturePop:** Bondarenko M., Tejedor-Garavito N., Priyatikanto R., Zhang W., Fang W., Nosatiuk B., Gaskell J., McKeen T., Noi E., Hilton J., Butterick J., Hawker L., Tatem A. J. (2025). *Global 1km-grid population projections for 2025-2100 consistent with the Shared Socioeconomic Pathways 3.2 national population projections, version 0.2.* doi:[10.5258/SOTON/WP00849](https://doi.org/10.5258/SOTON/WP00849)
- **Gridded GDP:** Kummu M., Kosonen M., Masoumzadeh Sayyar S. (2025). *Downscaled gridded global dataset for gross domestic product (GDP) per capita PPP over 1990–2022.* Scientific Data 12: 178. doi:[10.1038/s41597-025-04487-x](https://doi.org/10.1038/s41597-025-04487-x); data: doi:[10.5281/zenodo.18429133](https://doi.org/10.5281/zenodo.18429133)
- **ETOPO 2022:** NOAA National Centers for Environmental Information (2022). *ETOPO 2022 Global Relief Model.* doi:[10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74)
- **Black Marble 2016:** NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA's Goddard Space Flight Center.
- **Shipping traffic density:** The World Bank: Global Shipping Traffic Density. Data from the IMF World Seaborne Trade Monitoring System (Cerdeiro, Komaromi, Liu and Saeed, 2020).
- **World Bank WDI:** The World Bank: World Development Indicators: NY.GDP.MKTP.CD, NY.GDP.PCAP.CD.
- **Rosstat:** Федеральная служба государственной статистики (Росстат), rosstat.gov.ru.
- **WorldClim** *(restricted)*: Fick S.E., Hijmans R.J. (2017). *WorldClim 2: new 1-km spatial resolution climate surfaces for global land areas.* International Journal of Climatology 37(12): 4302–4315.
- **EDGAR** *(restricted)*: EDGAR (Emissions Database for Global Atmospheric Research) Community GHG Database, a collaboration between the European Commission, Joint Research Centre (JRC), the International Energy Agency (IEA), and comprising IEA-EDGAR CO2, EDGAR CH4, EDGAR N2O, EDGAR F-GASES version EDGAR_2026_GHG (2026).

## How GeoVis keeps attribution

- Every map shows a *Data:* line with the source (`catalog.json` → `source`), on a backing plate so it stays
  readable over any data. Videos and PNG snapshots render the same line.
- `catalog.json` carries a `license` object for every dataset: `id`, `name`, `url`, `restricted`, `cite`.
- The data picker marks restricted datasets as *non-commercial*. Its tooltip shows the license and the citation.
- Your own data uploaded through the API or as CSV is yours. Set its `source` field so it appears under the map.

## Contacts for permissions

- WorldClim: info@worldclim.org
- IEA-EDGAR CO₂: compliance@iea.org
