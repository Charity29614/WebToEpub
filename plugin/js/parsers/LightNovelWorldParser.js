"use strict";

parserFactory.register("findnovel.net", () => new FindNovelParser());
parserFactory.register("lightnovelcave.com", () => new LightNovelWorldParser());
parserFactory.register("lightnovelworld.co", () => new LightNovelWorldParser());
parserFactory.register("lightnovelworld.com", () => new LightNovelWorldParser());
parserFactory.register("lightnovelpub.com", () => new LightNovelPubParser());
parserFactory.register("lightnovelpub.fan", () => new LightNovelWorldParser());
parserFactory.register("novelfire.docsachhay.net", () => new LightNovelWorldParser());
parserFactory.register("novelbob.org", () => new LightNovelWorldParser());
parserFactory.register("novelphoenix.com", () => new LightNovelWorldParser());
parserFactory.register("novelpub.com", () => new LightNovelWorldParser());
parserFactory.register("novelfire.net", () => new NovelfireParser());
parserFactory.register("boxnovel.art", () => new NovelfireParser());
parserFactory.register("webnovelpub.com", () => new LightNovelWorldParser());
parserFactory.register("webnovelpub.pro", () => new LightNovelWorldParser());
parserFactory.register("pandanovel.co", () => new LightNovelWorldParser());

class LightNovelWorldParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        if (!dom.baseURI.endsWith("/chapters")) {
            dom = (await HttpClient.wrapFetch(dom.baseURI + "/chapters")).responseXML;
        }
        let chapters = this.extractPartialChapterList(dom);
        let urlsOfTocPages  = this.getUrlsOfTocPages(dom);

        for (let url of urlsOfTocPages) {
            await this.rateLimitDelay();
            let newDom = (await HttpClient.wrapFetch(url)).responseXML;
            let partialList = this.extractPartialChapterList(newDom);
            chapterUrlsUI.showTocProgress(partialList);
            chapters = chapters.concat(partialList);
        }
        return chapters;
    }

    getVerificationToken(dom) {
        let element = dom.querySelector("input[name='__RequestVerificationToken']");
        return element.getAttribute("value");
    }

    extractPartialChapterList(dom) {
        return [...dom.querySelectorAll("ul.chapter-list a")]
            .map(this.linkToChapterIfo);
    }

    linkToChapterIfo(link) {
        let title = link.querySelector(".chapter-title").textContent.trim();
        const isChapter = title.toLowerCase().includes("chapter");
        let chaperNo = link.querySelector(".chapter-no")?.textContent?.trim() ?? "";
        if (!isChapter && chaperNo !== "") {
            chaperNo += ": ";
        } else {
            chaperNo = "";
        }
        return {
            sourceUrl:  link.href,
            title: chaperNo + title,
            newArc: null
        };
    }

    getUrlsOfTocPages(dom) {
        let urls = [];
        let paginateUrls = [...dom.querySelectorAll("ul.pagination li a")]
            .map(a => a.href);
        if (0 < paginateUrls.length) {
            let maxPage = this.maxPageId(paginateUrls);
            let url = new URL(paginateUrls[0]);
            for (let i = 2; i <= maxPage; ++i) {
                url.searchParams.set("page", i);
                urls.push(url.href);
            }
        }
        return urls;
    }

    // last URL isn't always last ToC page
    maxPageId(urls) {
        let pageNum = function(url) {
            let pageNo = new URL(url).searchParams.get("page");
            return parseInt(pageNo);
        };
        return urls.reduce((p, c) => Math.max(p, pageNum(c)), 0);
    }

    findContent(dom) {
        return dom.querySelector("div.chapter-content")
            || dom.querySelector("div#content");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("div.novel-info h1");
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector("span[itemprop='author']");
        return authorLabel?.textContent ?? super.extractAuthor(dom);
    }

    removeUnwantedElementsFromContentElement(element) {
        let toRemove = [...element.querySelectorAll("p")]
            .filter(this.isWatermark);
        util.removeElements(toRemove);

        toRemove = [...element.querySelectorAll("strong")]
            .filter(e => e.parentNode.tagName == "STRONG")
            .map(e => e.parentNode);
        util.removeElements(toRemove);

        toRemove = [...element.querySelectorAll("div > dl > dt")]
            .map(e => e.parentNode.parentNode);
        util.removeElements(toRemove);

        super.removeUnwantedElementsFromContentElement(element);
    }

    isWatermark(element) {
        return !!element.className;
    }

    findChapterTitle(dom) {
        return dom.querySelector("span.chapter-title");
    }

    findCoverImageUrl(dom) {
        let metaImage = dom.querySelector("meta[property*='og:image']");
        if (metaImage)
        {
            metaImage = metaImage.content;
        }
        return metaImage || util.getFirstImgSrc(dom, "div.header-body");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.novel-info, section#info")];
    }

    cleanInformationNode(node) {
        util.removeChildElementsMatchingSelector(node, "nav.links");
    }
}

class LightNovelPubParser extends LightNovelWorldParser {
    constructor() {
        super();
        this.minimumThrottle = 1200;
    }
}

class FindNovelParser extends LightNovelWorldParser {
    constructor() {
        super();
    }
    
    removeUnwantedElementsFromContentElement(element) {
        util.removeHTMLUnknownElement(element);
        super.removeUnwantedElementsFromContentElement(element);
    }
}

class NovelfireParser extends FindNovelParser {
    constructor() {
        super();
        this.nf_timeoutMs = 30000;
        this.nf_retryDelays = [10000, 20000, 40000];
    }

    // ---------- debug helper ----------
    nfLog(msg) {
        let ts = new Date().toISOString().substring(11, 23);
        let full = `[NovelFire ${ts}] ${msg}`;
        console.log(full);
        ErrorLog.log(full);
    }

    // ---------- AbortController-based fetch with timeout ----------
    async nfFetchRaw(url) {
        let controller = new AbortController();
        let timerId = setTimeout(() => {
            this.nfLog(`TIMEOUT after ${this.nf_timeoutMs / 1000}s — aborting: ${url}`);
            controller.abort();
        }, this.nf_timeoutMs);

        try {
            this.nfLog(`fetch START: ${url}`);
            let response = await fetch(url, {
                credentials: "include",
                signal: controller.signal
            });
            clearTimeout(timerId);
            this.nfLog(`fetch RESPONSE ${response.status}: ${url}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} for ${url}`);
            }
            return response;
        } catch (err) {
            clearTimeout(timerId);
            if (err.name === "AbortError") {
                throw new Error(`Fetch timed out (${this.nf_timeoutMs / 1000}s): ${url}`);
            }
            throw err;
        }
    }

    // ---------- retry wrapper ----------
    async nfFetchWithRetry(url, processResponse) {
        let delays = [...this.nf_retryDelays];
        let attempt = 0;
        while (true) {
            try {
                let response = await this.nfFetchRaw(url);
                let result = await processResponse(response);
                this.nfLog(`fetch SUCCESS (attempt ${attempt + 1}): ${url}`);
                return result;
            } catch (err) {
                this.nfLog(`fetch FAILED (attempt ${attempt + 1}): ${err.message}`);
                if (delays.length === 0) {
                    this.nfLog(`All attempts exhausted for: ${url}`);
                    throw err;
                }
                let delay = delays.shift();
                this.nfLog(`Waiting ${delay / 1000}s before retry...`);
                await util.sleep(delay);
                attempt++;
            }
        }
    }

    // ---------- fetch a DOM page with retries ----------
    async nfFetchDom(url) {
        return this.nfFetchWithRetry(url, async (response) => {
            let buffer = await response.arrayBuffer();
            let text = new TextDecoder("utf-8").decode(buffer);
            let html = new DOMParser().parseFromString(text, "text/html");
            util.setBaseTag(response.url, html);
            this.nfLog(`DOM parsed, title: "${html.title}"`);

            // NovelFire anti-scraping: serves a "Loading..." skeleton with a
            // <script> setTimeout that redirects to a tokenized URL after 5ms.
            // We extract that URL and follow it directly.
            let redirectUrl = NovelfireParser.extractLoadingRedirect(html);
            if (redirectUrl) {
                this.nfLog(`Loading page detected — following redirect to: ${redirectUrl}`);
                let redirectResponse = await this.nfFetchRaw(redirectUrl);
                let redirectBuffer = await redirectResponse.arrayBuffer();
                let redirectText = new TextDecoder("utf-8").decode(redirectBuffer);
                let redirectHtml = new DOMParser().parseFromString(redirectText, "text/html");
                util.setBaseTag(redirectUrl, redirectHtml);
                this.nfLog(`Redirect DOM parsed, title: "${redirectHtml.title}"`);
                // If the redirect page is also a loading page, throw so retry kicks in
                if (NovelfireParser.extractLoadingRedirect(redirectHtml)) {
                    throw new Error(`NovelFire: redirect target is also a loading page: ${redirectUrl}`);
                }
                return redirectHtml;
            }

            return html;
        });
    }

    // Extract the tokenized redirect URL from a NovelFire "Loading..." page.
    // The page contains: setTimeout(() => { window.location.href = "<url>"; }, 5)
    static extractLoadingRedirect(html) {
        if (html.title.trim() !== "Loading...") {
            return null;
        }
        let scripts = [...html.querySelectorAll("script")]
            .map(s => s.textContent)
            .join("\n");
        let match = scripts.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
        if (match) {
            // Unescape \uXXXX sequences and escaped forward slashes
            let raw = match[1]
                .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                .replace(/\\\//g, "/");
            return raw;
        }
        return null;
    }

    // ---------- fetch JSON with retries ----------
    async nfFetchJson(url) {
        this.nfLog(`fetchJson: ${url}`);
        return this.nfFetchWithRetry(url, async (response) => {
            let text = await response.text();
            this.nfLog(`fetchJson response length: ${text.length} chars`);
            let json = JSON.parse(text);
            this.nfLog(`fetchJson parsed OK, data.length: ${json?.data?.length ?? "n/a"}`);
            return json;
        });
    }

    // ---------- override fetchChapter so chapter downloads also get retries ----------
    async fetchChapter(url) {
        this.nfLog(`fetchChapter: ${url}`);
        return this.nfFetchDom(url);
    }

    // ---------- chapter list ----------
    async getChapterUrls(dom, chapterUrlsUI) {
        this.nfLog(`getChapterUrls, baseURI: ${dom.baseURI}`);

        if (!dom.baseURI.endsWith("/chapters")) {
            this.nfLog(`Fetching /chapters page...`);
            dom = await this.nfFetchDom(dom.baseURI + "/chapters");
        }

        let chapterListUrl = this.buildChapterListRequestUrl(dom);
        this.nfLog(`chapterListUrl: ${chapterListUrl ?? "null — will use pagination"}`);

        if (chapterListUrl != null) {
            let json = await this.nfFetchJson(chapterListUrl);
            if (json?.data) {
                let root = this.getChapterUrlRoot(dom);
                this.nfLog(`JSON chapter count: ${json.data.length}, root: ${root}`);
                return json.data.map(d => NovelfireParser.dataToChapter(d, root));
            }
            this.nfLog(`JSON missing .data — falling back to pagination`);
        }

        // Pagination fallback — override parent's wrapFetch calls with our timeout version
        this.nfLog(`Using pagination fallback`);
        return this.nfGetChapterUrlsByPagination(dom, chapterUrlsUI);
    }

    // Replicates LightNovelWorldParser.getChapterUrls but using nfFetchDom (with timeout+retry)
    async nfGetChapterUrlsByPagination(dom, chapterUrlsUI) {
        let chapters = this.extractPartialChapterList(dom);
        this.nfLog(`Pagination: first page has ${chapters.length} chapters`);

        let urlsOfTocPages = this.getUrlsOfTocPages(dom);
        this.nfLog(`Pagination: ${urlsOfTocPages.length} additional TOC pages to fetch`);

        for (let url of urlsOfTocPages) {
            this.nfLog(`Pagination: fetching TOC page: ${url}`);
            await this.rateLimitDelay();
            let newDom = await this.nfFetchDom(url);
            let partialList = this.extractPartialChapterList(newDom);
            this.nfLog(`Pagination: got ${partialList.length} chapters from ${url}`);
            chapterUrlsUI.showTocProgress(partialList);
            chapters = chapters.concat(partialList);
        }

        this.nfLog(`Pagination: total chapters found: ${chapters.length}`);
        return chapters;
    }

    buildChapterListRequestUrl(dom) {
        let prefix = "/listChapterDataAjax";
        let script = [...dom.querySelectorAll("script")]
            .filter(s => s.textContent.includes(prefix))
            .map(s => s.textContent)[0];
        if (script) {
            let startIndex = script.indexOf(prefix);
            let endIndex = script.indexOf("\",", startIndex);
            let fragment = script.substring(startIndex, endIndex);
            this.nfLog(`Found listChapterDataAjax fragment: ${fragment}`);
            let host = new URL(dom.baseURI).hostname;
            return "https://" + host + fragment +
                "&draw=1&columns%5B0%5D%5Bdata%5D=title&columns%5B0%5D%5Bname%5D=&columns%5B0%5D%5Bsearchable%5D=true&columns%5B0%5D%5Borderable%5D=false&columns%5B0%5D%5Bsearch%5D%5Bvalue%5D=&columns%5B0%5D%5Bsearch%5D%5Bregex%5D=false&columns%5B1%5D%5Bdata%5D=created_at&columns%5B1%5D%5Bname%5D=&columns%5B1%5D%5Bsearchable%5D=true&columns%5B1%5D%5Borderable%5D=true&columns%5B1%5D%5Bsearch%5D%5Bvalue%5D=&columns%5B1%5D%5Bsearch%5D%5Bregex%5D=false&columns%5B2%5D%5Bdata%5D=n_sort&columns%5B2%5D%5Bname%5D=&columns%5B2%5D%5Bsearchable%5D=false&columns%5B2%5D%5Borderable%5D=true&columns%5B2%5D%5Bsearch%5D%5Bvalue%5D=&columns%5B2%5D%5Bsearch%5D%5Bregex%5D=false&order%5B0%5D%5Bcolumn%5D=2&order%5B0%5D%5Bdir%5D=asc&start=0&length=-1&search%5Bvalue%5D=&search%5Bregex%5D=false";
        }
        this.nfLog(`listChapterDataAjax script NOT found in page`);
        return null;
    }

    getChapterUrlRoot(dom) {
        let root = dom.baseURI;
        return root.endsWith("/chapters")
            ? root.replace("/chapters", "")
            : root;
    }

    static dataToChapter(data, root) {
        return ({
            sourceUrl: root + "/chapter-" + data.n_sort,
            title: data.title,
        });
    }
}