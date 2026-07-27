import json
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Optional
from xml.etree import ElementTree


ROOT = Path(__file__).parents[1]
PUBLIC_URL = "https://qj-chen.github.io/agentlen/"


class MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self.meta: List[Dict[str, str]] = []
        self.links: List[Dict[str, str]] = []
        self.json_ld: List[str] = []
        self._in_json_ld = False
        self._json_ld_parts: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            self.meta.append(attributes)
        elif tag == "link":
            self.links.append(attributes)
        elif tag == "script" and attributes.get("type") == "application/ld+json":
            self._in_json_ld = True
            self._json_ld_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._in_json_ld:
            self.json_ld.append("".join(self._json_ld_parts))
            self._in_json_ld = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._in_json_ld:
            self._json_ld_parts.append(data)


def parse_html(path: Path) -> MetadataParser:
    parser = MetadataParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser


def meta_content(parser: MetadataParser, key: str, value: str) -> str:
    return next(item["content"] for item in parser.meta if item.get(key) == value)


def test_public_site_has_consistent_indexing_metadata() -> None:
    parser = parse_html(ROOT / "site" / "index.html")

    assert 30 <= len(parser.title) <= 65
    assert 120 <= len(meta_content(parser, "name", "description")) <= 170
    assert meta_content(parser, "name", "robots").startswith("index, follow")
    assert meta_content(parser, "property", "og:url") == PUBLIC_URL
    assert meta_content(parser, "property", "og:image").startswith(PUBLIC_URL)
    assert any(
        link.get("rel") == "canonical" and link.get("href") == PUBLIC_URL
        for link in parser.links
    )

    structured_data = json.loads(parser.json_ld[0])
    types = {item["@type"] for item in structured_data["@graph"]}
    assert {"SoftwareApplication", "SoftwareSourceCode", "WebSite", "FAQPage"} <= types
    faq_page = next(item for item in structured_data["@graph"] if item["@type"] == "FAQPage")
    assert len(faq_page["mainEntity"]) == 5


def test_private_dashboard_remains_excluded_from_search() -> None:
    parser = parse_html(ROOT / "dashboard" / "index.html")
    robots = meta_content(parser, "name", "robots")

    assert "noindex" in robots
    assert "nofollow" in robots
    assert "Disallow: /" in (ROOT / "dashboard" / "public" / "robots.txt").read_text()


def test_sitemap_and_robots_reference_the_canonical_url() -> None:
    sitemap_path = ROOT / "site" / "sitemap.xml"
    sitemap = ElementTree.parse(sitemap_path)
    namespace = {"sitemap": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locations = [element.text for element in sitemap.findall("sitemap:url/sitemap:loc", namespace)]
    robots = (ROOT / "site" / "robots.txt").read_text(encoding="utf-8")

    assert locations == [PUBLIC_URL]
    assert f"Sitemap: {PUBLIC_URL}sitemap.xml" in robots
    assert (ROOT / "site" / "llms.txt").is_file()


if __name__ == "__main__":
    test_public_site_has_consistent_indexing_metadata()
    test_private_dashboard_remains_excluded_from_search()
    test_sitemap_and_robots_reference_the_canonical_url()
