"""Messages people see, in the language of the request: English unless the client asks for Chinese.

The web app sends x-lang (its chosen language); without it, Accept-Language decides.
"""
from contextvars import ContextVar

_lang: ContextVar[str] = ContextVar("lang", default="en")


def lang_of(headers) -> str:
    chosen = (headers.get("x-lang") or "").lower()
    if chosen in ("en", "zh"):
        return chosen
    return "zh" if (headers.get("accept-language") or "").lower().startswith("zh") else "en"


def set_lang(lang: str):
    _lang.set(lang)


def tr(en: str, zh: str) -> str:
    return zh if _lang.get() == "zh" else en
