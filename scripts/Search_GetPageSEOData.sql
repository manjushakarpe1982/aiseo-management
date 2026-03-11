-- ============================================================
--  Search_GetPageSEOData
--
--  Returns ALL SEO fields for a BPM page in a single result row:
--    MetaTitle           Resolved meta title (via Search_GetMetaTitleNDescription)
--    MetaTitle_Template  Raw template from FilterPages_SEOData
--    MetaDescription     Resolved meta description
--    MetaDesc_Template   Raw meta description template
--    H1                  ContentHeading from SEOContents
--    PageContent         Full HTML content from SEOContents
--    CanonicalUrl        CanonicalUrl from SEOContents
--    SEOContents_Id      Id of the matched SEOContents row (NULL if none)
--
--  Called for: Metal pages, ProductType pages, and Series pages.
--
--  Tag pages (e.g. /silver-bullion/silver-bars/1-kilo-silver-bars) are
--  handled separately in Node.js (seo-lookup.ts) via a direct
--  FilterPages_SEOData lookup + SEOContents WHERE TagId = slug.
--  Tag pages do NOT call this SP.
--
--  Usage examples:
--    -- Metal page  (/silver-bullion)
--    EXEC Search_GetPageSEOData 'metal', 'Silver';
--
--    -- Product-type page  (/silver-bullion/silver-bars)
--    EXEC Search_GetPageSEOData 'metalandproducttypes', 'Silver', 'Bars';
--
--    -- Series page  (/silver-bullion/silver-coins/american-silver-eagles)
--    EXEC Search_GetPageSEOData 'metalNproducttypeNseries', 'Silver', 'Coins', '', 'american-silver-eagles';
--
--  Deploy: Run this script once on the target database (BPMStagging / BPMProd).
--          Uses CREATE OR ALTER — safe to re-run.
-- ============================================================
CREATE OR ALTER PROCEDURE Search_GetPageSEOData
    @SearchBy          VARCHAR(50),
    @MetalText         VARCHAR(500)  = '',
    @ProductTypeText   VARCHAR(500)  = '',
    @MintText          VARCHAR(500)  = '',
    @SeriesText        VARCHAR(500)  = '',
    @YearText          VARCHAR(500)  = '',
    @tagId             INT           = 0,
    @NarrowByMiscIdCSV VARCHAR(500)  = ''
AS
BEGIN
    SET NOCOUNT ON;

    -- ── 1. MetaTitle + MetaDescription via existing SP ────────────────────────
    DECLARE @MetaTitle       VARCHAR(500)  = '';
    DECLARE @MetaDescription VARCHAR(2000) = '';

    EXEC Search_GetMetaTitleNDescription
        @SearchBy          = @SearchBy,
        @MetalText         = @MetalText,
        @ProductTypeText   = @ProductTypeText,
        @MintText          = @MintText,
        @SeriesText        = @SeriesText,
        @YearText          = @YearText,
        @tagId             = @tagId,
        @NarrowByMiscIdCSV = @NarrowByMiscIdCSV,
        @MetaTitle         = @MetaTitle         OUTPUT,
        @MetaDescription   = @MetaDescription   OUTPUT;

    -- ── 2. Raw templates from FilterPages_SEOData ─────────────────────────────
    DECLARE @MetaTitleTemplate VARCHAR(500)  = '';
    DECLARE @MetaDescTemplate  VARCHAR(2000) = '';

    SELECT TOP 1
        @MetaTitleTemplate = ISNULL(MetaTitle,       ''),
        @MetaDescTemplate  = ISNULL(MetaDescription, '')
    FROM   FilterPages_SEOData
    WHERE  SearchBy = @SearchBy
      AND  IsActive = 1
    ORDER BY Id;

    -- ── 3. H1, Content, CanonicalUrl from SEOContents ────────────────────────
    DECLARE @H1           NVARCHAR(MAX) = '';
    DECLARE @Content      NVARCHAR(MAX) = '';
    DECLARE @CanonicalUrl VARCHAR(1000) = '';
    DECLARE @SEOContentId INT           = NULL;

    IF @SeriesText <> ''
    BEGIN
        -- Series page — identified by metal + series slug
        SELECT TOP 1
            @SEOContentId = Id,
            @H1           = ISNULL(CAST(ContentHeading AS NVARCHAR(MAX)), ''),
            @Content      = ISNULL(CAST(Content        AS NVARCHAR(MAX)), ''),
            @CanonicalUrl = ISNULL(CanonicalUrl, '')
        FROM   SEOContents
        WHERE  IsActive  = 1
          AND  MetalId   = @MetalText
          AND  SeriesId  = @SeriesText
          AND  (MintId        IS NULL OR MintId        = '')
          AND  (TagId         IS NULL OR TagId         = '')
        ORDER BY Id;
    END
    ELSE IF @ProductTypeText <> ''
    BEGIN
        -- Product-type page — metal + productType, no series
        SELECT TOP 1
            @SEOContentId = Id,
            @H1           = ISNULL(CAST(ContentHeading AS NVARCHAR(MAX)), ''),
            @Content      = ISNULL(CAST(Content        AS NVARCHAR(MAX)), ''),
            @CanonicalUrl = ISNULL(CanonicalUrl, '')
        FROM   SEOContents
        WHERE  IsActive       = 1
          AND  MetalId        = @MetalText
          AND  ProductTypeId  = @ProductTypeText
          AND  (SeriesId IS NULL OR SeriesId = '')
          AND  (MintId   IS NULL OR MintId   = '')
          AND  (TagId    IS NULL OR TagId    = '')
        ORDER BY Id;
    END
    ELSE
    BEGIN
        -- Metal-only page — metal set, everything else NULL/empty
        SELECT TOP 1
            @SEOContentId = Id,
            @H1           = ISNULL(CAST(ContentHeading AS NVARCHAR(MAX)), ''),
            @Content      = ISNULL(CAST(Content        AS NVARCHAR(MAX)), ''),
            @CanonicalUrl = ISNULL(CanonicalUrl, '')
        FROM   SEOContents
        WHERE  IsActive       = 1
          AND  MetalId        = @MetalText
          AND  (ProductTypeId IS NULL OR ProductTypeId = '')
          AND  (SeriesId      IS NULL OR SeriesId      = '')
          AND  (MintId        IS NULL OR MintId        = '')
          AND  (TagId         IS NULL OR TagId         = '')
        ORDER BY Id;
    END

    -- ── 4. Return everything as a single result row ───────────────────────────
    SELECT
        @MetaTitle         AS MetaTitle,
        @MetaTitleTemplate AS MetaTitle_Template,
        @MetaDescription   AS MetaDescription,
        @MetaDescTemplate  AS MetaDesc_Template,
        @H1                AS H1,
        @Content           AS PageContent,
        @CanonicalUrl      AS CanonicalUrl,
        @SEOContentId      AS SEOContents_Id;
END;
GO
