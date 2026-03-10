/**
 * BPM category pages driven by PM_BPM_SearchProducts.
 * Each entry maps a live URL → SP parameters → DB row IDs for updates.
 */
export interface BpmPage {
  id: string;                   // Unique key
  url: string;                  // Live page URL
  label: string;                // Display name
  // SP params (as passed to PM_BPM_SearchProducts)
  searchBy: string;
  metalId: string;
  productTypeId: string;
  mintId: string;
  seriesId: string;
  // FilterPages_SEOData — keyed by SearchBy
  filterPageSearchBy: string;
  // SEOContents row — exact DB key for updates
  seoContentsId: number;         // Primary key Id to UPDATE
  seoMetalId: string;            // How it's stored in MetalId column
  seoProductTypeId: string;      // How it's stored in ProductTypeId column ('' = NULL)
  seoSeriesId: string;           // How it's stored in SeriesId column ('' = NULL)
  seoMintId: string;             // How it's stored in MintId column ('' = NULL)
}

export const BPM_PAGES: BpmPage[] = [
  {
    id: 'gold-bullion',
    url: 'https://www.boldpreciousmetals.com/gold-bullion',
    label: 'Gold Bullion',
    searchBy: 'metal',
    metalId: 'Gold',
    productTypeId: '',
    mintId: '',
    seriesId: '',
    filterPageSearchBy: 'metal',
    seoContentsId: 160,
    seoMetalId: 'Gold',
    seoProductTypeId: '',
    seoSeriesId: '',
    seoMintId: '',
  },
  {
    id: 'gold-coins',
    url: 'https://www.boldpreciousmetals.com/gold-bullion/gold-coins',
    label: 'Gold Coins',
    searchBy: 'metalandproducttypes',
    metalId: 'Gold',
    productTypeId: 'Coins',
    mintId: '',
    seriesId: '',
    filterPageSearchBy: 'metalandproducttypes',
    seoContentsId: 188,
    seoMetalId: 'Gold',
    seoProductTypeId: 'Coins',
    seoSeriesId: '',
    seoMintId: '',
  },
  {
    id: 'american-gold-eagle',
    url: 'https://www.boldpreciousmetals.com/gold-bullion/gold-coins/american-gold-eagle-coins',
    label: 'American Gold Eagle Coins',
    searchBy: 'metalNproducttypeNseries',
    metalId: 'Gold',
    productTypeId: 'Coins',
    mintId: '',
    seriesId: 'american-gold-eagle-coins',
    filterPageSearchBy: 'metalNproducttypeNseries',
    // DB row 393: MetalId='Gold', SeriesId='american-gold-eagle-coins', ProductTypeId=NULL
    seoContentsId: 393,
    seoMetalId: 'Gold',
    seoProductTypeId: '',      // Stored as NULL in DB
    seoSeriesId: 'american-gold-eagle-coins',
    seoMintId: '',
  },
];

/** Find BPM page by live URL (tolerates trailing slash differences) */
export function findBpmPage(url: string): BpmPage | undefined {
  const clean = url.replace(/\/$/, '');
  return BPM_PAGES.find((p) => p.url.replace(/\/$/, '') === clean);
}

/** Map UI field names (from AISEO improvements) to DB field keys */
export const FIELD_MAP: Record<string, string> = {
  'meta title':       'MetaTitle',
  'meta description': 'MetaDescription',
  'h1':               'H1',
  'h2':               'H2',
  'page content':     'Content',
  'content':          'Content',
  'canonical url':    'CanonicalUrl',
  'canonical':        'CanonicalUrl',
};

export function normaliseFieldName(name: string): string {
  return FIELD_MAP[name?.toLowerCase().trim()] ?? name;
}
