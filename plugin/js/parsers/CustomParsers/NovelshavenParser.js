"use strict";

parserFactory.register("novelshaven.com", () => new NovelshavenParser());

/*
 * Parser for novelshaven.com.
 *
 * Site is a client-rendered Next.js/React app:
 *   Series page:  https://novelshaven.com/series/{series-slug}
 *   Chapter page: https://novelshaven.com/series/{series-slug}/chapter-{chapter-number}
 *
 * The ToC (#chapters-list) only renders a batch of chapters up front; the
 * rest sit behind a client-side "Load More" button. WebToEpub's parser dom
 * is a static HTML snapshot (not the live, running page), so clicking that
 * button does nothing - there's no React attached to run.
 *
 * Instead of driving the button, getChapterUrls() reads the total chapter
 * count from the badge next to the "Chapters" heading (present in the
 * initial server-rendered HTML: <h2>Chapters</h2><span data-slot="badge">N
 * </span>) and generates every chapter URL directly, since the URL pattern
 * is fully deterministic: /series/{slug}/chapter-{n}. Real titles are kept
 * for whichever chapters happen to already be rendered in the snapshot;
 * the rest get a "Chapter N" placeholder that's overwritten once
 * findChapterTitle() reads the real title off each fetched chapter page.
 *
 * Chapter content is a series of <div id="paragraph-N"> elements inside
 * <article>, not <p> tags, so preprocessRawDom() re-wraps them into <p>
 * elements before WebToEpub's normal sanitize/pack pipeline runs.
 *
 * NOTE: WebToEpub fetches chapter pages via plain HTTP (no JS execution).
 * This parser assumes the paragraph divs are present in the server-rendered
 * HTML. If chapters come back empty, the site may require the client-side
 * fetch to run before content appears, which this parser can't drive.
 */
class NovelshavenParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 1500;
    }

    async getChapterUrls(dom) {
        let seriesSlug = NovelshavenParser.extractSeriesSlug(dom.baseURI);

        let existingByNum = new Map(
            [...dom.querySelectorAll(`a[href*="/series/${seriesSlug}/chapter-"]`)]
                .map(link => NovelshavenParser.linkToChapter(link))
                .map(chapter => [NovelshavenParser.chapterNumFromUrl(chapter.sourceUrl), chapter])
        );

        let totalChapters = NovelshavenParser.extractTotalChapterCount(dom)
            ?? Math.max(0, ...existingByNum.keys());

        let chapters = [];
        for (let num = 1; num <= totalChapters; ++num) {
            chapters.push(existingByNum.get(num) ?? {
                sourceUrl: NovelshavenParser.chapterUrl(seriesSlug, num),
                title: `Chapter ${num}`
            });
        }
        return chapters;
    }

    // total chapter count badge sits right after the "Chapters" heading,
    // e.g. <h2>Chapters</h2><span data-slot="badge">131</span>
    static extractTotalChapterCount(dom) {
        let badge = dom.querySelector('#chapters-list h2 + span[data-slot="badge"]');
        if (badge == null) {
            return null;
        }
        let count = parseInt(badge.textContent.trim(), 10);
        return Number.isFinite(count) ? count : null;
    }

    static extractSeriesSlug(url) {
        let m = url.match(/novelshaven\.com\/series\/([^/?#]+)/);
        return (m == null) ? null : m[1];
    }

    static chapterUrl(seriesSlug, num) {
        return `https://novelshaven.com/series/${seriesSlug}/chapter-${num}`;
    }

    static chapterNumFromUrl(url) {
        let m = url.match(/\/chapter-(\d+)(?:[/?#]|$)/);
        return (m == null) ? 0 : parseInt(m[1], 10);
    }

    // chapter title lives in a nested ".truncate" span (the anchor also
    // contains a small "Ch N" badge span we don't want in the title)
    static linkToChapter(link) {
        let titleElement = link.querySelector(".truncate");
        let title = (titleElement != null)
            ? titleElement.textContent.trim()
            : link.textContent.trim();
        return { sourceUrl: link.href, title: title };
    }

    findContent(dom) {
        return dom.querySelector("article");
    }

    // content is a run of <div id="paragraph-N"> instead of <p> tags;
    // rewrap so the packed epub gets normal paragraph markup
    preprocessRawDom(webPageDom) {
        let content = this.findContent(webPageDom);
        if (content == null) {
            return;
        }

        for (let paragraphDiv of [...content.querySelectorAll('[id^="paragraph-"]')]) {
            let p = webPageDom.createElement("p");
            p.innerHTML = paragraphDiv.innerHTML;
            paragraphDiv.replaceWith(p);
        }
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1");
    }

    findChapterTitle(dom) {
        // header block above <article> has an <h1> with the chapter's
        // display title (separate from the "Chapter N · Volume M" label)
        return dom.querySelector("h1");
    }

    extractAuthor(dom) {
        let author = dom.querySelector('a[href*="/public-profiles/"]');
        return (author == null) ? super.extractAuthor(dom) : author.textContent.trim();
    }

    extractSubject(dom) {
        let genres = [...dom.querySelectorAll('a[href*="series?genres="]')]
            .map(a => a.textContent.trim());
        return [...new Set(genres)].join(", ");
    }

    extractDescription(dom) {
        let desc = NovelshavenParser.findDescriptionElement(dom);
        return (desc == null) ? "" : desc.textContent.replace(/\s+/g, " ").trim();
    }

    static findDescriptionElement(dom) {
        return dom.querySelector('[id*="content-synopsis"] .whitespace-pre-wrap')
            ?? dom.querySelector('[id*="synopsis"] p, [class*="synopsis"]');
    }

    findCoverImageUrl(dom) {
        let webpSource = dom.querySelector('picture source[type="image/webp"]');
        if (webpSource != null) {
            let srcset = webpSource.getAttribute("srcset") ?? "";
            let url = srcset.split(" ")[0];
            if (url) {
                return url;
            }
        }
        return util.getFirstImgSrc(dom, "picture");
    }

    getInformationEpubItemChildNodes(dom) {
        function cleanTag(tag, index, array) {
            let out = tag.ownerDocument.createElement("a");
            out.setAttribute("href", tag.getAttribute("href"));
            out.innerText = tag.innerText;
            return index < array.length - 1 ? [out, ", "] : [out];
        }

        let info = [];

        info.push(dom.createElement("div").innerHTML = "<p><b>Synopsis</b></p>");
        let synopsis = NovelshavenParser.findDescriptionElement(dom);
        if (synopsis != null) {
            info.push(...synopsis.childNodes);
        }

        let genres = dom.querySelectorAll('a[href*="series?genres="]');
        if (genres.length > 0) {
            info.push(dom.createElement("div").innerHTML = "<p><b>Genre</b></p>");
            info.push(...[...genres].flatMap(cleanTag));
        }

        let tags = dom.querySelectorAll('a[href*="series?tags="]');
        if (tags.length > 0) {
            info.push(dom.createElement("div").innerHTML = "<p><b>Tags</b></p>");
            info.push(...[...tags].flatMap(cleanTag));
        }

        return info;
    }
}