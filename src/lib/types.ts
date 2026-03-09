// ─── Scans ───────────────────────────────────────────────────────────────────

export interface Scan {
  ScanID: number;
  RunID: string | null;
  ScanName: string;
  StartedAt: string | null;
  EndedAt: string | null;
  StartedByUserID: number | null;
  TotalURLs: number | null;
  URLsScraped: number | null;
  TreesAnalysed: number | null;
  Status: 'Running' | 'Completed' | 'Failed';
  CannibalizationPromptID: number | null;
  ContentPromptID: number | null;
  ErrorLog: string | null;
  Notes: string | null;
  CreatedAt: string | null;
  // joined counts
  CannibalizationCount?: number;
  ImprovementCount?: number;
}

// ─── Keywords ────────────────────────────────────────────────────────────────

export interface PageKeyword {
  KeywordID: number;
  ScanID: number;
  PromptID: number | null;
  PageURL: string;
  TreeCluster: string | null;
  PrimaryKeyword: string;
  SecondaryKeywords: string[];   // parsed from JSON
  SearchIntent: string | null;
  KeywordGaps: string[];         // parsed from JSON
  MissingLSITerms: string[];     // parsed from JSON
  ContentFocusScore: number | null;
  CreatedAt: string | null;
}

// ─── Cannibalization ─────────────────────────────────────────────────────────

export interface CannibalizationIssue {
  IssueID: number;
  ScanID: number;
  PromptID: number | null;
  TreeCluster: string | null;
  CannibalKeyword: string | null;
  Severity: 'High' | 'Medium' | 'Low';
  SeverityReason: string | null;
  URL1: string | null;
  URL1_FieldName: string | null;
  URL1_CurrentContent: string | null;
  URL1_SuggestedFix: string | null;
  URL2: string | null;
  URL2_FieldName: string | null;
  URL2_CurrentContent: string | null;
  URL2_SuggestedFix: string | null;
  OverallRecommendation: string | null;
  Reasoning: string | null;
  Status: 'Yet to Act' | 'Acted' | 'Deferred';
  LastAuditedByUserID: number | null;
  LastAuditedByName: string | null;  // joined from ClCode_Users
  LastAuditedAt: string | null;
  UserComment: string | null;
  DeferredReason: string | null;
  VerifiedFixed: boolean | null;
  VerifiedInScanID: number | null;
  CreatedAt: string | null;
}

// ─── Content Improvements ────────────────────────────────────────────────────

export interface ContentImprovement {
  ImprovementID: number;
  ScanID: number;
  PromptID: number | null;
  TreeCluster: string | null;
  PageURL: string | null;
  FieldName: string | null;
  CurrentContent: string | null;
  CurrentCharCount: number | null;
  SuggestedContent: string | null;
  SuggestedCharCount: number | null;
  IssueType: string | null;
  Reasoning: string | null;
  Priority: 'High' | 'Medium' | 'Low';
  ImpactEstimate: string | null;
  Status: 'Yet to Act' | 'Acted' | 'Deferred';
  LastAuditedByUserID: number | null;
  LastAuditedByName: string | null;  // joined from ClCode_Users
  LastAuditedAt: string | null;
  UserComment: string | null;
  DeferredReason: string | null;
  VerifiedFixed: boolean | null;
  VerifiedInScanID: number | null;
  CreatedAt: string | null;
}

// ─── Claude Call Log ─────────────────────────────────────────────────────────

export interface ClaudeCallLog {
  CallID: number;
  ScanID: number;
  CallType: 'KeywordExtraction' | 'Cannibalization' | 'ContentImprovement';
  EntityURL: string | null;
  SystemPrompt: string | null;
  UserMessage: string | null;
  RawResponse: string | null;
  CallSucceeded: boolean | null;
  InputCharsEstimate: number | null;
  OutputCharsEstimate: number | null;
  InputTokens: number | null;
  OutputTokens: number | null;
  CacheWriteTokens: number | null;
  CacheReadTokens: number | null;
  CostUSD: number | null;
  CalledAt: string | null;
  DurationMs: number | null;
  ErrorMessage: string | null;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

export interface Prompt {
  PromptID: number;
  PromptType: 'KeywordExtraction' | 'Cannibalization' | 'ContentImprovement';
  VersionNumber: number;
  VersionLabel: string | null;
  SystemPrompt: string;
  UserPromptTemplate: string;
  IsActive: boolean;
  Notes: string | null;
  CreatedAt: string | null;
  CreatedByUserID: number | null;
  DeactivatedAt: string | null;
  DeactivatedByUserID: number | null;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface User {
  UserID: number;
  FullName: string;
  Email: string;
  Role: string;
  IsActive: boolean;
  CreatedAt: string | null;
  CreatedByUserID: number | null;
  LastLoginAt: string | null;
}

// ─── Site URLs ────────────────────────────────────────────────────────────────

export interface SiteURL {
  URLID: number;
  PageURL: string;
  PageTitle: string | null;
  TreeCluster: string | null;
  IsActive: boolean;
  Notes: string | null;
  PrimaryKeyword: string | null;
  SecondaryKeywords: string | null;
  Priority: 'High' | 'Medium' | 'Low' | null;
  ScanRunCount: number;
  SuggestionsApplied: number;
  LastScanID: number | null;
  LastScannedAt: string | null;
  CreatedAt: string | null;
  UpdatedAt: string | null;
}

// ─── URL Metrics (day-wise SERP + search volume) ──────────────────────────────

export interface URLMetric {
  MetricID: number;
  URLID: number;
  RecordedDate: string;   // DATE returned as 'YYYY-MM-DD'
  SERPPosition: number | null;
  SearchVolume: number | null;
  Notes: string | null;
  CreatedAt: string;
  CreatedByUserID: number | null;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalScans: number;
  openIssues: number;
  highSeverityCannibalization: number;
  highPriorityImprovements: number;
  recentScans: Scan[];
}
