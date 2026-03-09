"""
Google Ads keyword search volume fetcher.
Uses the KeywordPlanIdeaService to retrieve average monthly search volumes.

Note:
    The volumes returned are averages over the past 12 months, not a
    real-time snapshot. This is the standard metric available through
    the Google Ads API and matches what you see in Keyword Planner.
"""
import logging
from typing import Optional

import config

log = logging.getLogger(__name__)


def _get_client():
    """Return an authenticated GoogleAdsClient from the YAML credentials file."""
    from google.ads.googleads.client import GoogleAdsClient
    return GoogleAdsClient.load_from_storage(config.GOOGLE_ADS_YAML)


def get_search_volumes(keywords: list[str]) -> dict[str, int]:
    """
    Fetch average monthly search volumes for a list of keywords.

    Args:
        keywords: List of keyword strings (any case — normalised internally).

    Returns:
        Dict mapping lowercase keyword → avg_monthly_searches (int).
        Keywords with no data will be absent from the result.

    The function batches requests in groups of GADS_BATCH_SIZE to stay
    within API limits.
    """
    if not keywords:
        return {}

    # Deduplicate and normalise
    unique_kws = list({kw.strip().lower() for kw in keywords if kw and kw.strip()})
    log.info(f"Fetching search volumes for {len(unique_kws)} unique keywords ...")

    client    = _get_client()
    service   = client.get_service("KeywordPlanIdeaService")
    volumes   = {}
    batch_sz  = config.GADS_BATCH_SIZE

    for batch_start in range(0, len(unique_kws), batch_sz):
        batch = unique_kws[batch_start: batch_start + batch_sz]
        log.debug(f"  Batch {batch_start // batch_sz + 1}: {len(batch)} keywords")

        request = client.get_type("GenerateKeywordIdeasRequest")
        request.customer_id                = config.GADS_CUSTOMER_ID
        request.geo_target_constants[:]    = [config.GADS_GEO_TARGET]
        request.language                   = config.GADS_LANGUAGE
        request.keyword_plan_network       = (
            client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
        )
        request.include_adult_keywords     = False
        request.keyword_seed.keywords[:]   = batch

        try:
            response = service.generate_keyword_ideas(request=request)
            for idea in response:
                kw  = idea.text.lower().strip()
                vol = idea.keyword_idea_metrics.avg_monthly_searches
                if vol and vol > 0:
                    volumes[kw] = int(vol)
        except Exception as exc:
            log.error(f"  Google Ads API error for batch starting at {batch_start}: {exc}")
            # Continue with next batch — partial results are still useful

    log.info(f"Got volumes for {len(volumes)} / {len(unique_kws)} keywords.")
    return volumes


def get_volume_for_keyword(
    volume_map: dict[str, int],
    primary_keyword: Optional[str],
    secondary_keywords: Optional[str] = None,
) -> Optional[int]:
    """
    Look up search volume for a URL's primary keyword.

    Falls back to the first secondary keyword if primary has no volume data.

    Args:
        volume_map:          Output of get_search_volumes().
        primary_keyword:     URL's primary keyword.
        secondary_keywords:  Comma-separated secondary keywords (fallback).

    Returns:
        int volume or None.
    """
    if primary_keyword:
        kw = primary_keyword.strip().lower()
        if kw in volume_map:
            return volume_map[kw]

    # Fallback: try each secondary keyword
    if secondary_keywords:
        for sk in secondary_keywords.split(","):
            sk = sk.strip().lower()
            if sk and sk in volume_map:
                return volume_map[sk]

    return None
