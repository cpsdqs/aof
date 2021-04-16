// This script loads episodes from WEBTOON.
//
// Source paths should look like `/type/123456` where
// - type is a string like `challenge`/`fantasy`/etc. (the first item in the URL after the language)
// - 123456 is the titleNo parameter in the URL

// NOTE
// Several points of confusion regarding this website:
// - you must name the web comic in the URL for some links (i.e. using /x/ like below doesn't
//   always work)
// - why are these “challenge” and “fantasy” type markers in the URL *required*?
// - it looks like you can make exactly one request before it drops you into a “gdpr age gate” page,
//   so the “open canonical url” button actually ends up being kind of annoying
// - the actual comic images will return 403 Forbidden unless you set your Referer header to
//   a webtoons.com URL. I assume this is some weird kind of copy protection?
//   After considering adding a hack for webtoon, I opted to make passing the canonical URL of a
//   source item as the referrer header default behavior in the app.

// SET THESE AS REQUIRED
const COOKIES = [
    //'pagGDPR=true',
    'timezoneOffset=+0',
    'countryCode=US',
    'locale=en',
    'needCCPA=true',
    'needCOPPA=true',
    'needGDPR=false',
];

async function loadHtml(url, headers = {}, onGetUrl) {
    const res = await fetch(url, {
        headers,
        Cookie: COOKIES.join('; '),
    });
    if (onGetUrl) onGetUrl(res.url);
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

// only returns contents of text child nodes
function getShallowTextContent(node) {
    let content = '';
    for (const n of node.childNodes) {
        if (n.nodeType === 3) {
            content += n.textContent;
        }
    }
    return content;
}

export async function loadSource(path) {
    const pathParts = path.split('/');
    const webtoonType = pathParts[1];
    const titleNo = pathParts[2];

    console.info(`Fetching title ${titleNo} with webtoon type ${webtoonType}`);

    const fetchURL = `https://www.webtoons.com/en/${webtoonType}/x/list?title_no=${titleNo}`;
    let canonicalURL;
    const doc = await loadHtml(fetchURL, {}, url => {
        canonicalURL = url;
    });

    const titleNode = doc.querySelector('#content .info .subj');
    if (!titleNode) throw new Error('No title node on page. Bad HTML?');
    const title = getShallowTextContent(titleNode).trim();

    console.debug('Reading authors');
    const authors = [];
    doc.querySelectorAll('#content .info .author').forEach(author => {
        authors.push({ name: getShallowTextContent(author) });
    });

    console.debug('Reading content tags');
    const genreTags = [];
    doc.querySelectorAll('#content .info .genre').forEach(tag => {
        genreTags.push({ name: tag.textContent.trim() });
    });

    const contentTags = {
        genre: genreTags,
    };

    console.debug('Reading description');
    const summary = doc.querySelector('#content .summary')?.innerHTML?.trim() || '';

    const tags = {
        title,
        canonical_url: canonicalURL,
        authors,
        content_tags: contentTags,
        description: { summary },
    };

    let updateTime = null;
    const items = [];

    let itemsDoc = doc;
    let page = 1;
    while (true) {
        console.debug(`Reading items on page ${page}`);
        itemsDoc.querySelectorAll('#content .detail_lst li').forEach(li => {
            const episodeNo = li.getAttribute('data-episode-no');
            if (!episodeNo) return;
            const canonicalItemURL = resolveURL(li.querySelector('a').getAttribute('href'), canonicalURL);
            const title = li.querySelector('.subj')?.textContent?.trim() || '';
            const iUpdateDate = new Date(li.querySelector('.date')?.textContent.trim());
            let iUpdateTime = null;
            if (Number.isFinite(iUpdateDate.getFullYear())) {
                iUpdateTime = iUpdateDate.toISOString().split('T')[0];
            }

            if (iUpdateTime && !updateTime) updateTime = iUpdateTime; // use newest item update time (in this case, first)

            // items are in reverse order
            items.unshift({
                path: '/' + webtoonType + '/' + titleNo + '/' + episodeNo,
                tags: {
                    title,
                    canonical_url: canonicalItemURL,
                },
            });
        });

        const hasNextPageButton = !!itemsDoc.querySelector('.pg_next');
        let hasMorePagination = false;
        let passedCurrent = false;
        for (const item of itemsDoc.querySelectorAll('.detail_lst .paginate a span')) {
            if (passedCurrent) {
                hasMorePagination = true;
                break;
            }
            if (item.classList.contains('on')) {
                passedCurrent = true;
            }
        }

        if (hasNextPageButton || hasMorePagination) {
            // there's another page
            page++;
            itemsDoc = await loadHtml(canonicalURL + `&page=${page}`);
        } else {
            break;
        }
    }

    return {
        last_updated: updateTime,
        tags,
        items,
    };
}

const CREATOR_NOTE_STYLES = `
<style>
h2 span {
    opacity: 0.5;
    font-size: small;
}
</style>
`;

export async function loadSourceItem(path) {
    const pathParts = path.split('/');
    const webtoonType = pathParts[1];
    const titleNo = pathParts[2];
    const episodeNo = pathParts[3];

    const canonicalURL = `https://www.webtoons.com/en/${webtoonType}/x/x/viewer?title_no=${titleNo}&episode_no=${episodeNo}`;
    const doc = await loadHtml(canonicalURL);

    const contentNode = doc.querySelector('#content .viewer_img');
    for (const img of contentNode.querySelectorAll('img')) {
        img.setAttribute('src', img.getAttribute('data-url'));
    }

    const contents = contentNode.innerHTML.trim();

    const appendix = {};

    const creatorNote = doc.querySelector('.creator_note');
    if (creatorNote) {
        appendix.note = CREATOR_NOTE_STYLES + creatorNote.innerHTML.trim();
    }

    return {
        tags: {
            contents,
            appendix,
        }
    };
}
