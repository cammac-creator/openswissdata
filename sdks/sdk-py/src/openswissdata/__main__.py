"""CLI entry point.

Run with::

    python -m openswissdata --help

Subcommands hit the live MCP endpoint, so they need either ``OPENSWISSDATA_API_KEY``
in the environment or you'll be using the anonymous free tier.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from . import __version__
from .client import Client


def _print_json(payload: Any) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2, sort_keys=False)
    sys.stdout.write("\n")


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="openswissdata",
        description="Official CLI for openswissdata.com (TARES, NOGA, FINMA).",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    p.add_argument(
        "--api-key",
        default=os.environ.get("OPENSWISSDATA_API_KEY"),
        help="Bearer token (default: $OPENSWISSDATA_API_KEY).",
    )
    p.add_argument(
        "--base-url",
        default="https://mcp.openswissdata.com",
        help="Override the MCP base URL.",
    )

    sub = p.add_subparsers(dest="command", required=True)

    discovery = sub.add_parser("discovery", help="Show server info / tool list.")
    discovery.set_defaults(func=_cmd_discovery)

    tariff = sub.add_parser("tariff-lookup", help="Lookup a Swiss customs HS8 code.")
    tariff.add_argument("hs8")
    tariff.add_argument("--lang", default="fr", choices=["fr", "de", "it", "en"])
    tariff.set_defaults(func=_cmd_tariff_lookup)

    search = sub.add_parser("tariff-search", help="Semantic search over TARES.")
    search.add_argument("query")
    search.add_argument("--top-k", type=int, default=5)
    search.set_defaults(func=_cmd_tariff_search)

    cross = sub.add_parser("crosswalk", help="Translate a code between schemes.")
    cross.add_argument("code")
    cross.add_argument("--source", required=True)
    cross.add_argument("--target", required=True)
    cross.set_defaults(func=_cmd_crosswalk)

    classify = sub.add_parser("classify", help="Classify free-text → NOGA codes.")
    classify.add_argument("text")
    classify.add_argument("--top-k", type=int, default=3)
    classify.set_defaults(func=_cmd_classify)

    finma = sub.add_parser("finma-search", help="Fuzzy search the FINMA registry.")
    finma.add_argument("name")
    finma.add_argument("--top-k", type=int, default=5)
    finma.add_argument("--warnings", action="store_true")
    finma.set_defaults(func=_cmd_finma_search)

    return p


def _cmd_discovery(args: argparse.Namespace, client: Client) -> int:
    _print_json(client.discovery())
    return 0


def _cmd_tariff_lookup(args: argparse.Namespace, client: Client) -> int:
    _print_json(client.tares.lookup(hs8=args.hs8, lang=args.lang))
    return 0


def _cmd_tariff_search(args: argparse.Namespace, client: Client) -> int:
    _print_json(client.tares.search(query=args.query, top_k=args.top_k))
    return 0


def _cmd_crosswalk(args: argparse.Namespace, client: Client) -> int:
    _print_json(
        client.classifications.cross_walk(
            code=args.code, source=args.source, target=args.target
        )
    )
    return 0


def _cmd_classify(args: argparse.Namespace, client: Client) -> int:
    _print_json(
        client.classifications.classify_text(text=args.text, top_k=args.top_k)
    )
    return 0


def _cmd_finma_search(args: argparse.Namespace, client: Client) -> int:
    _print_json(
        client.finma.search(name=args.name, top_k=args.top_k, include_warnings=args.warnings)
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    with Client(api_key=args.api_key, base_url=args.base_url) as client:
        return int(args.func(args, client))


if __name__ == "__main__":
    raise SystemExit(main())
