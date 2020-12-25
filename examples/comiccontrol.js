// This script loads comics that use ComicControl (e.g. most Hiveworks comics).
// Every page is a single item.
//
// Source paths should look like `/https/example.com` - basically just the hostname.

async function loadHtml(url, headers = {}) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to fetch: got ' + res.status + ' ' + res.statusText);
    const text = await res.text();
    console.debug('Got response HTML, parsing');
    const dp = new DOMParser();
    const doc = dp.parseFromString(text, 'text/html');
    console.debug('Successfully parsed document');
    return doc;
}

function resolveURL(url, base) {
    // TODO: do properly
    if (url.startsWith('/')) {
        const host = base.match(/^\w+:\/\/[^\/]+/)[0];
        return host + url;
    }
    if (url.startsWith('http')) return url;
    return base.replace(/\/[^\/]+$/, '/') + url;
}

function resolveLinksInContainer(node, url) {
    for (const anchor of node.querySelectorAll('a')) {
        anchor.setAttribute('href', resolveURL(anchor.getAttribute('href'), url));
    }
    for (const img of node.querySelectorAll('img')) {
        img.setAttribute('src', resolveURL(img.getAttribute('src'), url));
    }
}

export async function loadSource(path) {
    const pathParts = path.substr(1).split('/');
    const protocol = pathParts[0];
    if (!['http', 'https'].includes(protocol)) {
        throw new Error('path should start with http or https');
    }
    const host = pathParts[1];
    if (!host) throw new Error('no host');

    const canonicalURL = protocol + '://' + host + '/';
    console.info(`Using host ${canonicalURL}`);

    let updateTime = null;
    const items = [];
    const tags = {
        canonical_url: canonicalURL,
    };

    console.info('Fetching comic archive page');
    try {
        const doc = await loadHtml(canonicalURL + 'comic/archive');
        const pageSelector = doc.querySelector('select[name="comic"]');
        if (!pageSelector) throw new Error('could not find comic page selector');

        for (const option of pageSelector.querySelectorAll('option')) {
            const itemPath = option.getAttribute('value');
            if (!itemPath) continue;
            const itemURL = resolveURL(itemPath, canonicalURL);
            const rawTitle = option.textContent.trim();
            let iUpdateTime = null;
            let title = '';

            // usually looks like "April 13, 2009 - Title Goes Here"
            const titleParts = rawTitle.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^\-]+-)?\s*(.+)/i);
            if (titleParts) {
                if (titleParts[1]) {
                    const date = new Date(titleParts[1].replace(/-$/, '').trim());
                    if (Number.isFinite(date.getFullYear())) iUpdateTime = date.toISOString().split('T')[0];
                }
                title = titleParts[2] || '';
            } else {
                // oh well, just show the original name
                title = rawTitle;
            }

            if (iUpdateTime) updateTime = iUpdateTime;

            items.push({
                path: '/' + protocol + '/' + host + '/' + itemPath,
                tags: {
                    title,
                    canonical_url: itemURL,
                },
            });
        }

        tags.title = doc.querySelector('title').textContent.trim()
            .replace(/\s*-\s*Archive$/, '');
    } catch (err) {
        console.error('Failed to read comic archive! Are you sure this comic is using the ComicControl CMS?');
        throw new Error(err);
    }

    return {
        last_updated: updateTime,
        tags,
        items,
    }
}

export async function loadSourceItem(path) {
    const pathParts = path.substr(1).split('/');
    const protocol = pathParts[0];
    if (!['http', 'https'].includes(protocol)) {
        throw new Error('path should start with http or https');
    }
    const host = pathParts[1];
    if (!host) throw new Error('no host');

    const canonicalURL = protocol + '://' + host + '/' + pathParts.slice(2).join('/');

    const doc = await loadHtml(canonicalURL);
    const comicBody = doc.querySelector('#cc-comicbody');
    if (!comicBody) throw new Error('no comic body');
    resolveLinksInContainer(comicBody);

    const newsArea = doc.querySelector('.cc-newsarea');
    const tagline = doc.querySelector('.cc-tagline');

    if (newsArea) resolveLinksInContainer(newsArea, canonicalURL);
    if (tagline) resolveLinksInContainer(tagline, canonicalURL);

    let contents = `
<style>
.cc-newsarea {
    margin-top: 6em;
}
.cc-newsheader {
    font-size: 1.5em;
    font-weight: bold;
}
.cc-publishtime {
    font-size: small;
    margin-bottom: 1em;
}
.cc-tagline {
    margin-top: 2em;
}
</style>`;
    contents += comicBody.innerHTML;
    if (newsArea) contents += newsArea.outerHTML;
    if (tagline) contents += tagline.outerHTML;

    return {
        tags: {
            contents,
        },
    };
}
