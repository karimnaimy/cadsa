"""
WebSocket real-time endpoint and live metrics polling fallback.
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.dependencies import require_auth_ws
from core.ingestion import get_live_metrics, get_ring_buffer, register_broadcast, unregister_broadcast

logger = logging.getLogger(__name__)
router = APIRouter(tags=["realtime"])

_active_connections: set[WebSocket] = set()


@router.websocket("/ws/realtime")
async def websocket_realtime(websocket: WebSocket) -> None:
    user = await require_auth_ws(websocket)
    if not user:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    _active_connections.add(websocket)

    # Send ring buffer replay on connect
    ring = get_ring_buffer()
    if ring:
        try:
            await websocket.send_json({"type": "replay", "data": ring[-100:]})
        except Exception:
            pass

    queue: asyncio.Queue = asyncio.Queue(maxsize=500)

    def _enqueue(msg: dict) -> None:
        try:
            queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass

    register_broadcast(_enqueue)

    # Active filters from client
    active_filter: dict = {}

    async def _sender() -> None:
        while True:
            msg = await queue.get()
            try:
                if not _passes_filter(msg, active_filter):
                    continue
                await websocket.send_json(msg)
            except Exception:
                break

    async def _receiver() -> None:
        nonlocal active_filter
        while True:
            try:
                raw = await websocket.receive_text()
                data = json.loads(raw)
                if data.get("type") == "filter":
                    active_filter = data
                elif data.get("type") == "pong":
                    pass
            except WebSocketDisconnect:
                break
            except Exception:
                break

    send_task = asyncio.create_task(_sender())
    recv_task = asyncio.create_task(_receiver())

    # Ping every 30 seconds
    async def _pinger() -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                break

    ping_task = asyncio.create_task(_pinger())

    try:
        done, pending = await asyncio.wait(
            [send_task, recv_task, ping_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
    except Exception:
        pass
    finally:
        unregister_broadcast(_enqueue)
        _active_connections.discard(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


def _passes_filter(msg: dict, f: dict) -> bool:
    if msg.get("type") != "new_request":
        return True
    data = msg.get("data", {})
    if f.get("host") and data.get("host") != f["host"]:
        return False
    if f.get("status_class") and data.get("status_class") != f["status_class"]:
        return False
    return True


@router.get("/live")
async def get_live_stats() -> dict:
    """Polling fallback for environments where WebSocket isn't available."""
    return get_live_metrics()
