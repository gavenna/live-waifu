"""Stub — waifu-agent 无 cloud save，无需维护模式。"""

class MaintenanceModeError(RuntimeError):
    pass

def assert_cloudsave_writable(*args, **kwargs):
    """No-op — waifu-agent writes to local filesystem only."""
    return
