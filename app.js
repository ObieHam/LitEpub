const CORS_PROXY = "https://corsproxy.io/?";

document.getElementById('convertBtn').addEventListener('click', async () => {
    let url = document.getElementById('urlInput').value.trim();
    const status = document.getElementById('status');

    if (!url) {
        status.textContent = "Please enter a URL";
        return;
    }

    // Normalize URL
    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
    }

    const btn = document.getElementById('convertBtn');
    btn.disabled = true;
    status.innerHTML = "Initializing...";

    try {
        if (url.includes("/series/se/")) {
            await processSeries(url, status);
        } else {
            await processSingleStory(url, status);
        }
    } catch (e) {
        console.error(e);
        status.innerHTML = `<span style="color:red; font-weight:bold;">Error: ${e.message}</span>`;
    } finally {
        btn.disabled = false;
    }
});

/**
 * FETCH HELPER: Adds proxy, cache-busting and no-referrer
 */
async function fetchPage(url) {
    try {
        // Add timestamp to prevent caching by the proxy/browser
        const cacheBuster = url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
        const targetUrl = CORS_PROXY + encodeURIComponent(url + cacheBuster);
        
        const response = await fetch(targetUrl, {
            referrerPolicy: 'no-referrer'
        });
        
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");
        
        // Cloudflare check
        if (doc.title.includes("Just a moment") || doc.title.includes("Cloudflare")) {
             throw new Error("Blocked by Cloudflare protection. Try a different network.");
        }
        
        return doc;
    } catch (err) {
        throw new Error(`Network error: ${err.message}`);
    }
}

/**
 * SERIES LOGIC
 */
async function processSeries(url, status) {
    status.textContent = "Fetching series info...";
    const doc = await fetchPage(url);

    const seriesTitle = doc.querySelector("h1.headline")?.textContent.trim() || "Unknown Series";
    const seriesAuthor = doc.querySelector(".y_eU")?.textContent.trim() || "Unknown Author";

    const chapterLinks = Array.from(doc.querySelectorAll('.series__works .br_rj'));
    
    if (chapterLinks.length === 0) throw new Error("No chapters found on series page.");

    status.textContent = `Found ${chapterLinks.length} chapters. Starting...`;

    const chapters = [];
    for (let i = 0; i < chapterLinks.length; i++) {
        const link = chapterLinks[i];
        let chapterUrl = link.getAttribute('href'); 
        
        // Ensure absolute URL
        if(!chapterUrl.startsWith('http')) chapterUrl = 'https://www.literotica.com' + chapterUrl;

        const chapterTitle = link.textContent.trim();

        // Recursively fetch all pages for this chapter
        status.textContent = `Processing Ch ${i + 1}/${chapterLinks.length}: ${chapterTitle}`;
        const fullChapterContent = await fetchAllPagesOfStory(chapterUrl, status, `(Ch ${i+1})`);
        
        chapters.push({
            title: chapterTitle,
            content: fullChapterContent
        });

        // Polite delay
        await new Promise(r => setTimeout(r, 500)); 
    }

    generateEpub(seriesTitle, seriesAuthor, chapters, status);
}

/**
 * SINGLE STORY LOGIC
 */
async function processSingleStory(url, status) {
    status.textContent = "Fetching story metadata...";
    
    // Fetch first page to get Title/Author
    const doc = await fetchPage(url);
    const meta = extractMetadata(doc);

    // Fetch all pages (content)
    const fullContent = await fetchAllPagesOfStory(url, status, "");

    generateEpub(meta.title, meta.author, [{
        title: meta.title,
        content: fullContent
    }], status);
}

/**
 * CORE LOOP: Pagination Handler
 */
async function fetchAllPagesOfStory(startUrl, status, prefixLog) {
    // Strip existing query params to ensure we start clean
    let baseUrl = startUrl.split('?')[0]; 
    let pageNum = 1;
    let fullHtml = "";
    let hasNext = true;
    const MAX_PAGES = 50; // Safety limit to prevent infinite loops

    while (hasNext && pageNum <= MAX_PAGES) {
        if (status) status.textContent = `${prefixLog} Fetching page ${pageNum}...`;
        
        const currentUrl = pageNum === 1 ? baseUrl : `${baseUrl}?page=${pageNum}`;
        const doc = await fetchPage(currentUrl);
        const data = extractStoryContent(doc);

        if (pageNum === 1) {
            fullHtml = data.content;
        } else {
            // Add a visual separator for the ebook
            fullHtml += `<hr class="page-break" style="margin: 2em 0; border-top: 2px dashed #666;" />` + data.content;
        }

        // --- NEXT BUTTON DETECTION ---
        const links = Array.from(doc.querySelectorAll('a'));
        
        // Look for "Next" in text, title, or class name
        const nextLink = links.find(a => {
            const text = a.textContent.trim().toLowerCase();
            const cls = (a.className || "").toString().toLowerCase();
            const title = (a.title || "").toLowerCase();
            
            return (
                text === "next" || 
                text.includes("next »") ||
                text === "»" ||
                cls.includes("pager-next") ||
                cls.includes("b-pager-next") ||
                title.includes("next page")
            );
        });

        if (nextLink) {
            pageNum++;
            await new Promise(r => setTimeout(r, 300)); // Delay for server politeness
        } else {
            hasNext = false;
        }
    }
    
    return fullHtml;
}

function extractMetadata(doc) {
    // Try multiple selectors for robustness
    let title = doc.querySelector("h1._title_2d1pc_26")?.textContent || 
                doc.querySelector("h1.headline")?.textContent || 
                doc.querySelector("h1")?.textContent || "Unknown Title";

    let author = doc.querySelector("._author__title_2mplv_48")?.textContent || 
                 doc.querySelector(".y_eU")?.textContent || 
                 doc.querySelector(".b-story-user-y")?.textContent || "Unknown Author";

    return { title: title.trim(), author: author.trim() };
}

function extractStoryContent(doc) {
    // Try multiple selectors for content body
    let contentDiv = doc.querySelector("._article__content_14oe9_81 > div:first-child") || 
                     doc.querySelector(".b-story-body-x") || 
                     doc.querySelector(".aa_ht"); 

    if (!contentDiv) {
        throw new Error("Could not locate story text. The page structure might be unknown or blocked.");
    }
    return { content: contentDiv.innerHTML };
}

/**
 * EPUB GENERATOR
 */
async function generateEpub(title, author, chapters, status) {
    status.textContent = "Building EPUB file...";
    const zip = new JSZip();

    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.folder("META-INF").file("container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

    let manifestItems = `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;
    let spineItems = ``;
    let navMapItems = ``;

    chapters.forEach((chapter, index) => {
        const id = `chapter${index + 1}`;
        const fileName = `${id}.html`;
        
        // Simple cleanup
        let cleanContent = chapter.content.replace(/&nbsp;/g, ' ');

        const xhtmlContent = `<?xml version="1.0" encoding="utf-8"?>
            <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
            <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
                <title>${chapter.title}</title>
                <style>body { font-family: serif; line-height: 1.5; margin: 2em; }</style>
            </head>
            <body>
                <h2>${chapter.title}</h2>
                <hr/>
                ${cleanContent}
            </body>
            </html>`;
        
        zip.file(fileName, xhtmlContent);
        manifestItems += `<item id="${id}" href="${fileName}" media-type="application/xhtml+xml"/>`;
        spineItems += `<itemref idref="${id}"/>`;
        navMapItems += `<navPoint id="navPoint-${index + 1}" playOrder="${index + 1}"><navLabel><text>${chapter.title}</text></navLabel><content src="${fileName}"/></navPoint>`;
    });

    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language>
            </metadata>
            <manifest>${manifestItems}</manifest>
            <spine toc="ncx">${spineItems}</spine>
        </package>`;
    zip.file("content.opf", opfContent);

    const ncxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
            <head><meta name="dtb:uid" content="urn:uuid:12345"/></head>
            <docTitle><text>${title}</text></docTitle>
            <navMap>${navMapItems}</navMap>
        </ncx>`;
    zip.file("toc.ncx", ncxContent);

    status.textContent = "Zipping and downloading...";
    const content = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
    saveAs(content, `${title}.epub`);
    
    status.textContent = "Done! Check your downloads.";
}
