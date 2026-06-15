"""
Analytics API endpoints — all read from DuckDB.
"""
import logging
from dataclasses import replace as dc_replace
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.dependencies import CurrentUser, TimeRangeDep
from db import duckdb_manager as db
from db.duckdb_manager import RequestFilter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])


def _get_filters(
    host: Optional[str] = None,
    remote_ip: Optional[str] = None,
    method: Optional[str] = None,
    status_class: Optional[str] = None,
    path: Optional[str] = None,
    country_code: Optional[str] = None,
) -> RequestFilter:
    return RequestFilter(
        host=host or None,
        remote_ip=remote_ip or None,
        method=method or None,
        status_class=status_class or None,
        path=path or None,
        country_code=country_code or None,
    )


FiltersDep = Annotated[RequestFilter, Depends(_get_filters)]


@router.get("/overview")
async def get_overview(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> dict:
    return db.query_overview(tr.from_ts, tr.to_ts, f)


@router.get("/timeseries")
async def get_timeseries(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> dict:
    data = db.query_timeseries(tr.from_ts, tr.to_ts, tr.bucket, f)
    return {"granularity": tr.granularity, "data": data}


@router.get("/top-paths")
async def get_top_paths(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    limit: int = Query(20, ge=1, le=100),
) -> list:
    return db.query_top_paths(tr.from_ts, tr.to_ts, limit, f)


@router.get("/top-ips")
async def get_top_ips(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    limit: int = Query(20, ge=1, le=100),
) -> list:
    return db.query_top_ips(tr.from_ts, tr.to_ts, limit, f)


@router.get("/top-countries")
async def get_top_countries(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    limit: int = Query(20, ge=1, le=100),
) -> list:
    # Strip country_code — this endpoint IS the country selector
    return db.query_top_countries(tr.from_ts, tr.to_ts, limit, dc_replace(f, country_code=None))


@router.get("/distinct-countries")
async def get_distinct_countries(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> list:
    return db.query_distinct_countries(tr.from_ts, tr.to_ts, f)


@router.get("/status-codes")
async def get_status_codes(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> list:
    return db.query_status_codes(tr.from_ts, tr.to_ts, f)


@router.get("/performance")
async def get_performance(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> dict:
    data = db.query_performance(tr.from_ts, tr.to_ts, tr.bucket, f)
    return {"granularity": tr.granularity, "data": data}


@router.get("/bandwidth")
async def get_bandwidth(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> dict:
    rows = db.query_timeseries(tr.from_ts, tr.to_ts, tr.bucket, f)
    data = [{"ts": r["ts"], "bytes_out": r["bytes_out"], "bytes_in": r["bytes_in"]} for r in rows]
    return {"granularity": tr.granularity, "data": data}


@router.get("/browsers")
async def get_browsers(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> list:
    return db.query_browsers(tr.from_ts, tr.to_ts, f)


@router.get("/devices")
async def get_devices(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> list:
    return db.query_devices(tr.from_ts, tr.to_ts, f)


@router.get("/referers")
async def get_referers(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    limit: int = Query(20, ge=1, le=100),
) -> list:
    return db.query_referers(tr.from_ts, tr.to_ts, limit, f)


@router.get("/hosts")
async def get_hosts(_: CurrentUser, tr: TimeRangeDep) -> list:
    return db.query_hosts_summary(tr.from_ts, tr.to_ts)


@router.get("/geo")
async def get_geo(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> list:
    return db.query_geo_map(tr.from_ts, tr.to_ts, f)


@router.get("/ip/{ip}")
async def get_ip_detail(_: CurrentUser, ip: str, tr: TimeRangeDep) -> dict:
    return db.query_ip_detail(ip, tr.from_ts, tr.to_ts)


@router.get("/paths-by-status")
async def get_paths_by_status(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    limit: int = Query(30, ge=1, le=100),
) -> list:
    return db.query_paths_by_status(tr.from_ts, tr.to_ts, f, limit)


@router.get("/requests")
async def get_requests(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=1000),
    sort_by: str = "ts",
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict:
    offset = (page - 1) * limit
    rows, total = db.query_requests_page(tr.from_ts, tr.to_ts, f, offset, limit, sort_by, sort_dir)
    return {"total": total, "page": page, "limit": limit, "data": rows}


@router.get("/top-cities")
async def get_top_cities(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    limit: int = Query(30, ge=1, le=100),
) -> list:
    return db.query_top_cities(tr.from_ts, tr.to_ts, limit, f)


@router.get("/os")
async def get_os(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> list:
    return db.query_os(tr.from_ts, tr.to_ts, f)


@router.get("/host-patterns")
async def get_host_patterns(_: CurrentUser, tr: TimeRangeDep, f: FiltersDep) -> dict:
    return db.query_host_patterns(tr.from_ts, tr.to_ts, f)


@router.get("/slowest-paths")
async def get_slowest_paths(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    limit: int = Query(20, ge=1, le=100),
) -> list:
    return db.query_slowest_paths(tr.from_ts, tr.to_ts, limit, f)


@router.get("/requests/{request_id}")
async def get_request_detail(_: CurrentUser, request_id: int) -> dict:
    row = db.query_request_by_id(request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return row
