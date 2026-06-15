import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def send_email(
    subject: str,
    body: str,
    to: list[str],
    from_addr: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
) -> bool:
    if not to or not smtp_host:
        return False
    try:
        import aiosmtplib
        from email.mime.text import MIMEText

        msg = MIMEText(body, "plain")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = ", ".join(to)

        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=smtp_port,
            username=smtp_user or None,
            password=smtp_password or None,
            start_tls=smtp_port != 465,
        )
        logger.info("Alert email sent to %s", to)
        return True
    except Exception as e:
        logger.error("Failed to send alert email: %s", e)
        return False
