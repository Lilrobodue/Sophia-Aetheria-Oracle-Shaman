# sophia_search_proxy.py  —  OPTIONAL.
# web_search now works with NO proxy by default (Wikipedia + Crossref + Europe PMC,
# browser-native, tools/web-search.js). Run this ONLY if you want full open-web
# DuckDuckGo results in addition — then set, in Sophia:
#     window.SOPHIA_SEARCH_PROXY = 'http://127.0.0.1:8787'
#
# DuckDuckGo has no official general-search API and blocks cross-origin browser
# requests via CORS, so a server-side hop is required for it. Localhost is exempt
# from HTTPS mixed-content blocking, so the HTTPS PWA can call http://127.0.0.1:8787.
#
#   pip install "ddgs" flask flask-cors
#   python sophia_search_proxy.py
#
# Then, in Sophia, enable the "web_search" tool. To point at a non-default origin,
# set  window.SOPHIA_SEARCH_PROXY = 'http://host:port'  before sending a message.
#
# Caveat: ddgs scraping is unofficial — it can break or hit CAPTCHAs under load.
# Don't hammer it. Upgrade paths if it degrades: Brave Search API (official free
# tier, still proxied to keep the key off the client) or self-hosted SearXNG.

from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from ddgs import DDGS

app = Flask(__name__)


# Chrome Private Network Access: a public HTTPS site (aetheriasos.com) calling
# http://127.0.0.1 must receive Access-Control-Allow-Private-Network set to EXACTLY
# "true". flask-cors >=5 emits its OWN copy of this header (defaulting to "false")
# and appends rather than replaces — yielding "true, false", which fails the
# preflight. Registering this hook BEFORE CORS() makes it run LAST (Flask runs
# after_request handlers in reverse registration order); __setitem__ then collapses
# any earlier value to a single "true".
@app.after_request
def _pna(resp):
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


# Origins: the two production literals contain no regex metacharacters, so flask-cors
# compares them literally. The localhost entry is an ANCHORED regex (^...$) — the
# wildcard form "http://localhost:*" is treated by flask-cors as an UNANCHORED regex,
# which also admits hostnames like http://localhost.evil.com.
CORS(app, resources={r"/search": {"origins": [
    "https://aetheriasos.com", "https://www.aetheriasos.com",
    r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
]}})


@app.route("/search", methods=["GET", "OPTIONS"])
def search():
    if request.method == "OPTIONS":
        return make_response("", 204)
    q = (request.args.get("q") or "").strip()
    try:
        n = min(max(int(request.args.get("n", 5)), 1), 8)
    except (TypeError, ValueError):
        n = 5
    if not q:
        return jsonify({"results": []})
    try:
        with DDGS() as ddgs:
            hits = list(ddgs.text(q, max_results=n))   # keys: title, href, body
        return jsonify({"results": [
            {"title": h.get("title"), "url": h.get("href"), "snippet": h.get("body")}
            for h in hits
        ]})
    except Exception as e:
        return jsonify({"results": [], "error": str(e)}), 502


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8787)
