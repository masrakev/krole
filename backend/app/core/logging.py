import logging

from app.core.config import get_settings

_CONFIGURED = False


def setup_logging() -> None:
    """Configure le logging racine une seule fois, niveau piloté par l'env."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Renvoie un logger nommé, en s'assurant que le logging est configuré."""
    setup_logging()
    return logging.getLogger(name)
