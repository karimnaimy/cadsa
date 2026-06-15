import hashlib
import hmac
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def send_webhook(url: str, payload: dict, secret: str = "") -> bool:
    if not url:
        return False
    try:
        import aiohttp

        body = json.dumps(payload, default=str).encode()
        headers = {"Content-Type": "application/json"}

        if secret:
            sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
            headers["X-Cadsa-Signature"] = f"sha256={sig}"

        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, data=body, headers=headers) as resp:
                if resp.status >= 400:
                    logger.warning("Webhook returned HTTP %d", resp.status)
                    return False
        logger.info("Webhook sent to %s", url)
        return True
    except Exception as e:
        logger.error("Failed to send webhook: %s", e)
        return False
