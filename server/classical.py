"""Classical: composers, their works and the works' scores, from IMSLP (the Petrucci Music Library), and each
person's saved scores.

IMSLP is a MediaWiki: a composer is a category ("Category:Bach, Johann Sebastian"), a work a page
("Goldberg-Variationen, BWV 988 (Bach, Johann Sebastian)") whose wikitext holds the work's details and its score
files. Scores are opened on IMSLP's own file pages (they show the copyright notice, and non-members wait a few
seconds before a download): Yoinker lists and saves them, it doesn't take the PDFs.
"""
import re
from concurrent.futures import ThreadPoolExecutor
import time
from urllib.parse import quote

import httpx
from fastapi import HTTPException

import pages
from db import conn
from i18n import tr

API = "https://imslp.org/api.php"
WIKI = "https://imslp.org/wiki/"
HEADERS = {"User-Agent": "Yoinker/1.0 (https://music.sunnygong.com; private music library)"}
_client = httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True)
pages.TTL.update({"imslp-composer": 7 * 24 * 3600, "imslp-work": 7 * 24 * 3600, "imslp-search": 24 * 3600,
                  "imslp-bio": 30 * 24 * 3600, "imslp-genres": 7 * 24 * 3600})

conn().executescript("""
create table if not exists user_scores (
    id integer primary key,
    user_id integer not null references users(id),
    work text not null,          -- the IMSLP page
    file text not null default '',   -- one score file on it ('' = the work)
    label text,                  -- what the file is ("Complete Score", the edition)
    added_at real not null,
    unique (user_id, work, file)
);
""")

# the front page's composers, by era: IMSLP's category name, and their name in Chinese
FEATURED = [
    ("Monteverdi, Claudio", "蒙特威尔第"), ("Purcell, Henry", "珀塞尔"), ("Vivaldi, Antonio", "维瓦尔第"),
    ("Telemann, Georg Philipp", "泰勒曼"), ("Bach, Johann Sebastian", "巴赫"), ("Handel, George Frideric", "亨德尔"),
    ("Scarlatti, Domenico", "斯卡拉蒂"), ("Haydn, Joseph", "海顿"), ("Mozart, Wolfgang Amadeus", "莫扎特"),
    ("Beethoven, Ludwig van", "贝多芬"), ("Paganini, Niccolò", "帕格尼尼"), ("Schubert, Franz", "舒伯特"),
    ("Mendelssohn, Felix", "门德尔松"), ("Chopin, Frédéric", "肖邦"), ("Schumann, Robert", "舒曼"),
    ("Liszt, Franz", "李斯特"), ("Wagner, Richard", "瓦格纳"), ("Verdi, Giuseppe", "威尔第"),
    ("Brahms, Johannes", "勃拉姆斯"), ("Saint-Saëns, Camille", "圣桑"), ("Tchaikovsky, Pyotr", "柴可夫斯基"),
    ("Dvořák, Antonín", "德沃夏克"), ("Grieg, Edvard", "格里格"), ("Fauré, Gabriel", "福雷"),
    ("Elgar, Edward", "埃尔加"), ("Mahler, Gustav", "马勒"), ("Debussy, Claude", "德彪西"),
    ("Satie, Erik", "萨蒂"), ("Ravel, Maurice", "拉威尔"), ("Rachmaninoff, Sergei", "拉赫玛尼诺夫"),
]
ZH = dict(FEATURED)


def display(category: str) -> str:
    """"Bach, Johann Sebastian" -> "Johann Sebastian Bach"."""
    last, _, first = category.partition(", ")
    return f"{first} {last}".strip() if first else category


def _api(**params) -> dict:
    try:
        r = _client.get(API, params={"format": "json", **params})
        return r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(502, tr(f"IMSLP didn't answer: {e}", f"IMSLP 没有响应：{e}"))


# ---------- composers ----------

def _wiki(category: str, lang: str) -> dict:
    """The composer's photo and a line about them, from Wikipedia: the English article on them, and in Chinese
    the Chinese article it links to (looking a Chinese name up by itself finds the wrong 福雷: a town in Belgium)."""
    def summary(wl: str, title: str) -> dict:
        try:
            s = _client.get(f"https://{wl}.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}",
                            headers={"Accept-Language": "zh-cn"} if wl == "zh" else {}).json()
        except (httpx.HTTPError, ValueError):
            return {}
        return {} if s.get("type") in ("disambiguation", None) else s

    def make():
        en = summary("en", display(category))
        out = {"image": (en.get("thumbnail") or {}).get("source"), "extract": en.get("extract")}
        if lang == "zh" and en.get("title"):
            try:
                r = _client.get("https://en.wikipedia.org/w/api.php", params={
                    "action": "query", "prop": "langlinks", "lllang": "zh", "titles": en["title"], "format": "json"}).json()
                link = next(iter(r["query"]["pages"].values())).get("langlinks", [{}])[0].get("*")
            except (httpx.HTTPError, ValueError, KeyError, StopIteration):
                link = None
            zs = summary("zh", link) if link else {}
            if zs.get("extract"):
                out = {"image": out["image"] or (zs.get("thumbnail") or {}).get("source"), "extract": zs["extract"]}
        return out
    return pages._cached(("imslp-bio", category, lang), make)


def featured(lang: str) -> list[dict]:
    return [{"category": c, "name": display(c), "zh": zh, **{"image": _wiki(c, lang)["image"]}} for c, zh in FEATURED]


_CATALOGUE = re.compile(
    r"\b(BWV|HWV|RV|KV|K\.|Hob\.\s*[IVXLC]+[a-z]?:|Op\.|D\.|S\.|WoO|TWV|Kk\.|Z\.|TH|L\.|HWV|Wq\.|H\.|B\.|SV|FP|M\.|JW|WAB)"
    r"\s*(\d+)([a-z]?)", re.I)


def _work_name(title: str) -> tuple[str, str]:
    """A work page's title -> (the work, the composer): "Messiah, HWV 56 (Handel, George Frideric)"."""
    m = re.match(r"^(.*) \(([^()]+)\)$", title)
    return (m[1], m[2]) if m else (title, "")


def _catalogue(name: str) -> tuple[str, str, int, str]:
    m = _CATALOGUE.search(name)
    return (m[0], m[1].upper().rstrip("."), int(m[2]), m[3]) if m else ("", "~", 10 ** 9, "")


def composer(category: str, lang: str) -> dict:
    def make():
        works, cont = [], {}
        for _ in range(20):   # up to 10,000 works
            r = _api(action="query", list="categorymembers", cmtitle=f"Category:{category}", cmtype="page",
                     cmlimit=500, **cont)
            for m in (r.get("query") or {}).get("categorymembers") or []:
                name, _ = _work_name(m["title"])
                cat, _, _, _ = _catalogue(name)
                works.append({"page": m["title"], "name": name, "catalogue": cat})
            # (IMSLP's MediaWiki is the older kind: "query-continue", not "continue")
            cont = ((r.get("query-continue") or {}).get("categorymembers") or {}) or {
                k: v for k, v in (r.get("continue") or {}).items() if k != "continue"}
            if not cont:
                break
        return works
    works = pages._cached(("imslp-composer", category), make)
    if not works:
        pages._cache_drop(("imslp-composer", category))
        raise HTTPException(404, tr("No such composer on IMSLP", "IMSLP 上没有这位作曲家"))
    # by catalogue (BWV 1, BWV 2...), the rest by name
    works = sorted(works, key=lambda w: (_catalogue(w["name"])[1:], w["name"].casefold()))
    return {"category": category, "name": display(category), "zh": ZH.get(category), **_wiki(category, lang),
            "works": works, "imslp": WIKI + quote(f"Category:{category}".replace(" ", "_"))}


# IMSLP's genre categories a work page carries -> the genre it's shown under (several genres can fold into one)
GENRES = {
    "Operas": "opera", "Operettas": "opera", "Singspiels": "opera", "Zarzuelas": "opera",
    "Ballets": "ballet", "Incidental music": "stage",
    "Symphonies": "symphony", "Symphonic poems": "symphonic-poem", "Overtures": "overture", "Concertos": "concerto",
    "Suites": "suite", "Serenades": "serenade", "Divertimentos": "serenade",
    "Sonatas": "sonata", "Partitas": "suite", "Variations": "variations",
    "Quartets": "chamber", "Trios": "chamber", "Quintets": "chamber", "Sextets": "chamber", "Septets": "chamber", "Octets": "chamber",
    "Masses": "mass", "Requiems": "mass", "Cantatas": "cantata", "Oratorios": "oratorio", "Passions": "oratorio",
    "Motets": "sacred", "Psalms": "sacred", "Hymns": "sacred", "Anthems": "sacred", "Magnificats": "sacred", "Chorales": "chorale",
    "Chorale preludes": "chorale-prelude", "Songs": "song", "Madrigals": "song", "Arias": "aria",
    "Preludes": "prelude", "Fugues": "fugue", "Toccatas": "toccata", "Fantasias": "fantasia", "Inventions": "invention", "Canons": "canon",
    "Etudes": "etude", "Nocturnes": "nocturne", "Waltzes": "waltz", "Mazurkas": "mazurka", "Polonaises": "polonaise",
    "Ballades": "ballade", "Scherzos": "scherzo", "Impromptus": "impromptu", "Rhapsodies": "rhapsody", "Romances": "romance",
    "Marches": "march", "Dances": "dance", "Minuets": "dance", "Rondos": "rondo",
}


def genres(category: str) -> dict[str, list[str]]:
    """Each of a composer's works -> its genres (IMSLP's categories on the work pages, 50 pages a request)."""
    def make():
        hit = pages._cache_get(("imslp-composer", category))
        if not hit:
            composer(category, "en")   # (its works first)
            hit = pages._cache_get(("imslp-composer", category))
        titles = [w["page"] for w in hit[1]]
        out: dict[str, set[str]] = {}
        want = "|".join("Category:" + g for g in GENRES)

        def batch(chunk: list[str]):
            cont: dict = {}
            for _ in range(10):
                r = _api(action="query", prop="categories", titles="|".join(chunk), clcategories=want, cllimit=500, **cont)
                for pg in ((r.get("query") or {}).get("pages") or {}).values():
                    for c in pg.get("categories") or []:
                        out.setdefault(pg["title"], set()).add(GENRES[c["title"][9:]])
                cont = ((r.get("query-continue") or {}).get("categories") or {}) or {
                    k: v for k, v in (r.get("continue") or {}).items() if k != "continue"}
                if not cont:
                    return
        with ThreadPoolExecutor(6) as ex:
            list(ex.map(batch, [titles[i:i + 50] for i in range(0, len(titles), 50)]))
        return {t: sorted(g) for t, g in out.items()}
    return pages._cached(("imslp-genres", category), make)


def search(q: str) -> dict:
    """Composers and works whose name has this in it."""
    q = q.strip()
    if not q:
        return {"composers": [], "works": []}

    def make():
        people = _api(action="query", list="search", srsearch=q, srnamespace=14, srlimit=20, srwhat="title")
        works = _api(action="query", list="search", srsearch=q, srnamespace=0, srlimit=40)
        cats = [x["title"].removeprefix("Category:") for x in (people.get("query") or {}).get("search") or []]
        return {"composers": [{"category": c, "name": display(c), "zh": ZH.get(c)} for c in cats if ", " in c][:12],
                "works": [{"page": x["title"], "name": _work_name(x["title"])[0], "composer": _work_name(x["title"])[1]}
                          for x in (works.get("query") or {}).get("search") or [] if x["title"].endswith(")")]}
    # a composer's name in Chinese finds them too (巴赫)
    zh = [c for c, z in FEATURED if q in z]
    r = pages._cached(("imslp-search", q.casefold()), make)
    extra = [{"category": c, "name": display(c), "zh": ZH[c]} for c in zh if c not in {x["category"] for x in r["composers"]}]
    return {**r, "composers": extra + r["composers"]}


# ---------- a work: its details and score files ----------

def _end(s: str, i: int) -> int:
    """Where the {{template}} starting at i ends."""
    depth, j = 0, i
    while j < len(s):
        if s.startswith("{{", j):
            depth, j = depth + 1, j + 2
        elif s.startswith("}}", j):
            depth, j = depth - 1, j + 2
            if depth == 0:
                return j
        else:
            j += 1
    return len(s)


def _fields(body: str) -> dict[str, str]:
    """A template's "|name=value" fields (pipes inside {{ }} and [[ ]] don't split)."""
    out, depth, start, i = {}, 0, 0, 0
    parts = []
    while i < len(body):
        two = body[i:i + 2]
        if two in ("{{", "[["):
            depth, i = depth + 1, i + 2
            continue
        if two in ("}}", "]]"):
            depth, i = depth - 1, i + 2
            continue
        if body[i] == "|" and depth == 0:
            parts.append(body[start:i])
            start = i + 1
        i += 1
    parts.append(body[start:])
    for p in parts[1:]:
        name, eq, value = p.partition("=")
        if eq:
            out[name.strip()] = value.strip()
    return out


def _plain(v: str) -> str:
    """Wiki markup as text."""
    v = re.sub(r"<ref[^>]*>.*?</ref>|<ref[^/]*/>|<score>.*?</score>", "", v or "", flags=re.S)
    v = re.sub(r"<br\s*/?>", " · ", v)
    v = re.sub(r"<[^>]+>", "", v)

    def tmpl(m):
        args = [a for a in m[1].split("|")[1:] if "=" not in a]
        name = m[1].split("|")[0].strip()
        if name.startswith("Link") and len(args) >= 2:
            return f"{args[1]} {args[0]}"   # {{LinkName|Bach|Johann Sebastian}}
        return " ".join(args) if args else ""
    for _ in range(4):
        v = re.sub(r"\{\{([^{}]*)\}\}", tmpl, v)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\[(?:https?:)?//\S+ ([^\]]+)\]", r"\1", v)
    v = v.replace("'''", "").replace("''", "")
    return re.sub(r"[ \t]+", " ", v).strip()


INFO = ["Work Title", "Alternative Title", "Opus/Catalogue Number", "Key", "Movements/Sections",
        "Year/Date of Composition", "Year of First Publication", "First Performance", "Dedication", "Librettist",
        "Language", "Piece Style", "Instrumentation"]


def work(page: str) -> dict:
    def make():
        r = _api(action="parse", page=page, prop="wikitext", redirects=1)
        if "error" in r:
            return None
        text = r["parse"]["wikitext"]["*"]
        i = text.find("{{#fte:imslppage")
        if i < 0:
            return None
        top = _fields(text[i + 2:_end(text, i) - 2])
        info = {k: _plain(top[k]) for k in INFO if _plain(top.get(k, ""))}
        scores = []
        for section, key in (("score", "*****FILES*****"), ("arrangement", "*****ARRANGEMENTS*****")):
            body, heading, j = top.get(key, ""), "", 0
            while True:
                k = body.find("{{#fte:imslpfile", j)
                if k < 0:
                    break
                for h in re.findall(r"^=+\s*(.+?)\s*=+\s*$", body[j:k], re.M):
                    heading = _plain(h)
                end = _end(body, k)
                f = _fields(body[k + 2:end - 2])
                files = []
                for n in range(1, 60):
                    name = f.get(f"File Name {n}")
                    if not name:
                        continue
                    files.append({"file": name, "label": _plain(f.get(f"File Description {n}", "")) or name,
                                  "url": WIKI + quote(f"File:{name}".replace(" ", "_"))})
                if files:
                    scores.append({"kind": section, "group": heading, "files": files,
                                   "editor": _plain(f.get("Editor", "")) or _plain(f.get("Arranger", "")),
                                   "publisher": _plain(f.get("Publisher Information", "")),
                                   "copyright": _plain(f.get("Copyright", "")), "type": _plain(f.get("Image Type", "")),
                                   "notes": _plain(f.get("Misc. Notes", ""))})
                j = end
        recordings = top.get("*****AUDIO*****", "").count("{{#fte:imslpaudio")
        name, comp = _work_name(r["parse"]["title"])
        return {"page": r["parse"]["title"], "name": info.get("Work Title") or name, "composer": comp,
                "composer_name": display(comp), "composer_zh": ZH.get(comp), "info": info, "scores": scores,
                "recordings": recordings, "imslp": WIKI + quote(r["parse"]["title"].replace(" ", "_"))}
    w = pages._cached(("imslp-work", page), make)
    if not w:
        pages._cache_drop(("imslp-work", page))
        raise HTTPException(404, tr("No such work on IMSLP", "IMSLP 上没有这首作品"))
    return w


# ---------- saved scores ----------

def saved(user: dict) -> list[dict]:
    out = []
    for r in conn().execute("select * from user_scores where user_id = ? order by added_at desc", (user["id"],)):
        name, comp = _work_name(r["work"])
        out.append({"id": r["id"], "work": r["work"], "name": name, "composer": comp, "composer_name": display(comp),
                    "composer_zh": ZH.get(comp), "file": r["file"] or None, "label": r["label"], "added_at": r["added_at"],
                    "url": WIKI + quote((f"File:{r['file']}" if r["file"] else r["work"]).replace(" ", "_"))})
    return out


def save(user: dict, page: str, file: str | None, label: str | None) -> dict:
    if not page.strip():
        raise HTTPException(400, tr("Which work?", "哪一首作品？"))
    conn().execute("insert or ignore into user_scores (user_id, work, file, label, added_at) values (?, ?, ?, ?, ?)",
                   (user["id"], page.strip(), (file or "").strip(), (label or "").strip()[:200] or None, time.time()))
    return {"ok": True}


def unsave(user: dict, sid: int):
    conn().execute("delete from user_scores where id = ? and user_id = ?", (sid, user["id"]))
