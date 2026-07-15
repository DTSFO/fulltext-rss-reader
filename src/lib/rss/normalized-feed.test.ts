import { describe, expect, it } from "vitest";

import { parseFeedXml } from "./normalized-feed";

const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example RSS</title>
    <link>https://example.com/</link>
    <description>Example feed</description>
    <item>
      <guid>post-1</guid>
      <title>First post</title>
      <link>/posts/first</link>
      <description><![CDATA[<p>Hello <script>alert(1)</script>world.</p>]]></description>
      <content:encoded><![CDATA[<p>Full <strong>content</strong>.</p>]]></content:encoded>
      <pubDate>Mon, 22 Jun 2026 12:50:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <link href="https://example.com/" rel="alternate" />
  <entry>
    <id>tag:example.com,2026:2</id>
    <title>Second post</title>
    <link href="https://example.com/posts/second" rel="alternate" />
    <author><name>Example Author</name></author>
    <updated>2026-07-01T10:00:00Z</updated>
    <content type="html"><![CDATA[<p>Atom body.</p>]]></content>
  </entry>
</feed>`;

describe("parseFeedXml", () => {
  it("normalizes RSS items and sanitizes embedded HTML", () => {
    const feed = parseFeedXml(rss, "https://example.com/rss.xml");

    expect(feed.title).toBe("Example RSS");
    expect(feed.items[0]).toMatchObject({
      externalId: "post-1",
      url: "https://example.com/posts/first",
      title: "First post",
      contentHtml: "<p>Full <strong>content</strong>.</p>",
    });
    expect(feed.items[0]?.publishedAt?.toISOString()).toBe("2026-06-22T12:50:00.000Z");
  });

  it("normalizes Atom entries", () => {
    const feed = parseFeedXml(atom, "https://example.com/atom.xml");

    expect(feed).toMatchObject({
      title: "Example Atom",
      siteUrl: "https://example.com/",
      items: [
        {
          externalId: "tag:example.com,2026:2",
          author: "Example Author",
          title: "Second post",
          url: "https://example.com/posts/second",
        },
      ],
    });
  });

  it("rejects non-feed XML", () => {
    expect(() => parseFeedXml("<html><body>no feed</body></html>", "https://example.com")).toThrow();
  });
});
