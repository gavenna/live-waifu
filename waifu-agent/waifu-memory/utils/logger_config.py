"""Logger — 标准 logging 封装。"""
import logging


def get_module_logger(name: str, prefix: str = "waifu.memory"):
    logger = logging.getLogger(f"{prefix}.{name}")
    if not logger.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(name)s] %(levelname)s %(message)s"))
        logger.addHandler(h)
        logger.setLevel(logging.INFO)
    return logger


def setup_logging(service_name: str = "Memory", log_level: int = logging.INFO):
    logger = logging.getLogger("waifu.memory")
    logger.setLevel(log_level)
    return logger, {"level": log_level}
