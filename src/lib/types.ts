export interface CannibalizationError {
  Id: number;
  Code: string;
  Description: string | null;
  IssueType: string | null;
  Url1: string | null;
  Url2: string | null;
  Url3: string | null;
  Url4: string | null;
  ErrorPriority: number | null;
  Score: number | null;
  ScanCode: string | null;
  CreateTS: string | null;
  Status: string | null;
  ProcessedBy: string | null;
}

export interface CannibalizationFix {
  Id: number;
  ScanCode: string;
  ErrorCode: string;
  Url: string | null;
  ContentType: string;
  OldContent: string | null;
  SuggestedContent: string | null;
  ProcessedBy: string | null;
}

export interface PageSEOInput {
  Id: number;
  Url: string;
  PageName: string | null;
  MetaTitle: string | null;          SuggestedMetaTitle: string | null;
  MetaDescription: string | null;    SuggestedMetaDescription: string | null;
  H1: string | null;                 SuggestedH1: string | null;
  H2: string | null;                 SuggestedH2: string | null;
  H3: string | null;                 SuggestedH3: string | null;
  H4: string | null;                 SuggestedH4: string | null;
  H5: string | null;                 SuggestedH5: string | null;
  H6: string | null;                 SuggestedH6: string | null;
  Content: string | null;            SuggestedContent: string | null;
  PrimaryKeywords: string | null;
  SecondaryKeyword: string | null;
  WordCount: number | null;
  InternalLinks: number | null;
  ExternalLinks: number | null;
  StatusCode: number | null;
  Priority: number | null;
  IsAddressed: boolean | null;
  ScrapedDateTime: string | null;
  Status: string | null;
  ProcessedBy: string | null;
}
