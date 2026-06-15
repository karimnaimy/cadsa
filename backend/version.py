try:
    from _version import __version__
except ImportError:
    # Running outside a release build (local dev without a tagged build).
    __version__ = "dev"
