// This script loads series and episodes from tapas.io.
// It does not support loading locked episodes.
//
// Source paths should look like `/123456` where 123456 is the series ID (the name will not work).
// Since tapas.io does not seem to have a button for their RSS feed anymore, here's a guide for
// getting the series ID:
// - open the browser developer tools
// - open the <head> tag at the top and scroll to find the meta tags
// - some of them will have URLs like `tapastic://series/123456/info` - take the ID from there

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

async function loadJson(url, headers = {}) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to fetch: got ' + res.status + ' ' + res.statusText);
    const text = await res.text();
    return JSON.parse(text);
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

export async function loadSource(path) {
    const id = path.substr(1);
    console.info(`Fetching series ${id}`)

    const canonicalURL = `https://tapas.io/series/${id}/info`;

    const doc = await loadHtml(canonicalURL);
    const titleNode = doc.querySelector('.section__top a.title');
    if (!titleNode) throw new Error('No title node on page. Bad HTML?');

    console.debug('Reading authors');
    const authors = [];
    doc.querySelectorAll('.creator-section__item').forEach(li => {
        const nameLink = li.querySelector('.name');
        authors.push({
            url: resolveURL(nameLink.getAttribute('href'), canonicalURL),
            name: nameLink.textContent.trim(),
        });
    });

    let updateTime = null;

    const items = [];
    let page = 0;
    let hasNextPage = true;
    while (hasNextPage) {
        console.debug(`Reading items (page ${page})`);
        page++; // tapas starts at page 1

        const itemsURL = `https://tapas.io/series/${id}/episodes?page=${page}&sort=OLDEST&max_limit=100&large=true`;
        const res = await loadJson(itemsURL);
        if (res.code !== 200) {
            console.error(res);
            throw new Error(`Unexpected tapas/episodes response`);
        }
        hasNextPage = res.data.pagination.has_next;

        // html body, sigh
        const dp = new DOMParser();
        const doc = dp.parseFromString(res.data.body, 'text/html');
        doc.querySelectorAll('.episode-list__item > a').forEach(item => {
            if (item.classList.contains('js-coming-soon')) return; // no

            let virtual = false;
            if (item.classList.contains('js-have-to-sign')) {
                // locked
                virtual = true;
            }

            const canonicalItemURL = resolveURL(item.getAttribute('href'), canonicalURL);
            const id = item.getAttribute('data-id');
            const title = (item.querySelector('.title__body')?.textContent || '').trim();

            const iUpdateTimeStr = (item.querySelector('.additional > span')?.textContent || '').trim();
            const iUpdateTime = new Date(iUpdateTimeStr);

            let itemUpdateTime = null;
            if (iUpdateTimeStr && Number.isFinite(iUpdateTime.getFullYear())) {
                // the original string only specifies the date
                const pad = (a, b) => (a + b).substr(-a.length);
                itemUpdateTime = pad('0000', iUpdateTime.getFullYear()) + '-' +
                    pad('00', iUpdateTime.getMonth() + 1) + '-' +
                    pad('00', iUpdateTime.getDate());
            } else {
                console.warn(`Failed to parse item update time “${iUpdateTimeStr}” for ${id}`);
            }

            if (itemUpdateTime) updateTime = itemUpdateTime; // use last item update time

            items.push({
                path: '/' + id,
                virtual,
                tags: {
                    title,
                    canonical_url: canonicalItemURL,
                },
            });
        });
    }

    console.debug('Reading content tags');
    const genreTags = [];
    doc.querySelectorAll('.section__top .info-detail__row .genre-btn').forEach(btn => {
        const url = resolveURL(btn.getAttribute('href'), canonicalURL);
        const name = btn.textContent.trim();
        genreTags.push({ url, name });
    });

    const freeformTags = [];
    doc.querySelectorAll('.section--right .tags .tags__item').forEach(tag => {
        const url = resolveURL(tag.getAttribute('href'), canonicalURL);
        // make name look a bit nicer by removing the leading # and replacing underscores with spaces
        const name = tag.textContent.trim()
            .replace(/^#/, '')
            .replace(/_/g, ' ');
        freeformTags.push({ url, name });
    });

    const contentTags = {
        genre: genreTags,
        freeform: freeformTags,
    };

    console.debug('Reading description');
    const summary = (doc.querySelector('.section--right .description__body')?.innerHTML || '').trim();
    const colophon = (doc.querySelector('.section--right .colophon')?.innerHTML || '').trim();

    const tags = {
        title: titleNode.textContent.trim(),
        canonical_url: canonicalURL,
        content_tags: contentTags,
        authors,
        description: { summary, colophon },
    };

    return {
        last_updated: updateTime,
        tags,
        items,
    }
}

export async function loadSourceItem(path) {
    const id = path.substr(1);
    console.info(`Fetching episode ${id}`);

    const canonicalURL = `https://tapas.io/episode/${id}`;

    const doc = await loadHtml(canonicalURL);
    const titleNode = doc.querySelector('.viewer__header .title');
    if (!titleNode) throw new Error('No title node on page. Bad HTML?');

    const title = titleNode.textContent.trim();

    const updateTimeQ = new Date(doc.querySelector('.viewer_header .date')?.textContent);
    let updateTime = null;
    if (Number.isFinite(updateTimeQ.getFullYear())) {
        // the original string only specifies the date
        updateTime = updateTimeQ.toISOString().split('T')[0];
    }

    const viewerContents = doc.querySelector('.viewer__body');
    for (const img of viewerContents.querySelectorAll('.content__img')) {
        img.setAttribute('src', img.getAttribute('data-src'));
        img.setAttribute('width', img.getAttribute('data-width'));
        img.setAttribute('height', img.getAttribute('data-height'));
        img.removeAttribute('style');
    }

    const contents = viewerContents.innerHTML;

    return {
        last_updated: updateTime,
        tags: {
            title,
            contents,
        },
    };
}
