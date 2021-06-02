// This script loads works and chapters from archiveofourown.org.
// It does not support custom work skins.
//
// Source paths should look like `/123456` where 123456 is the work ID (easily found in the URL).

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
    return new URL(url, base).toString();
}

export async function loadSource(path) {
    const id = path.substr(1);
    console.info(`Fetching work ${id}`);

    const canonicalURL = `https://archiveofourown.org/works/${id}?view_adult=true`;

    const doc = await loadHtml(canonicalURL, { 'Cookie': 'view_adult=true' });
    const titleNode = doc.querySelector('#workskin .preface h2.title');
    if (!titleNode) throw new Error('No title node on page. Bad HTML?');

    console.debug('Reading authors');
    const authors = [];
    doc.querySelectorAll('#workskin .preface a[rel="author"]').forEach(anchor => {
        authors.push({
            url: resolveURL(anchor.getAttribute('href'), 'https://archiveofourown.org'),
            name: anchor.textContent.trim(),
        });
    });

    console.debug('Reading update time');
    const workMetaNode = doc.querySelector('.work.meta');
    const workStatsNode = workMetaNode.querySelectorAll('.stats')[1];

    let updated = (workStatsNode.querySelectorAll('.status')[1]?.textContent || '').trim();
    if (!updated) updated = (workStatsNode.querySelectorAll('.published')[1]?.textContent || '').trim();
    updated = updated || null;

    console.debug('Reading chapter count');
    const chaptersParts = (workStatsNode.querySelectorAll('.chapters')[1]?.textContent || '').trim().split('/');
    const totalChapters = chaptersParts[1] === '?' ? null : +chaptersParts[1];

    console.debug('Reading summary');
    const summary = (doc.querySelector('#workskin > .preface .summary > .userstuff')?.innerHTML || '').trim();

    console.debug('Reading content tags');
    const tagsContainer = doc.querySelector('.work.meta.group');
    const readTagsList = ul => {
        if (!ul) return [];
        const tags = [];
        for (const li of ul.querySelectorAll('a.tag')) {
            const url = resolveURL(li.getAttribute('href'), canonicalURL);
            const name = li.textContent.trim();
            tags.push({ url, name });
        }
        return tags;
    };

    const content_tags = {
        rating: readTagsList(tagsContainer.querySelector('dd.rating > ul')),
        warnings: readTagsList(tagsContainer.querySelector('dd.warning > ul')),
        categories: readTagsList(tagsContainer.querySelector('dd.fandom > ul')),
        relationships: readTagsList(tagsContainer.querySelector('dd.relationship > ul')),
        characters: readTagsList(tagsContainer.querySelector('dd.character > ul')),
        freeform: readTagsList(tagsContainer.querySelector('dd.freeform > ul')),
        language: [(tagsContainer.querySelector('dd.language')?.textContent || '')]
            .filter(x => x)
            .map(x => ({ name: x.trim() })),
    };

    const tags = {
        title: titleNode.textContent.trim(),
        authors,
        content_tags,
        completion: { total: totalChapters },
        description: { summary },
        canonical_url: canonicalURL,
    };

    console.debug('Reading items');
    const items = [];
    for (const node of doc.querySelectorAll('#chapter_index #selected_id option')) {
        const itemId = node.getAttribute('value');
        const canonicalURL = `https://archiveofourown.org/works/${id}/chapters/${itemId}`;
        items.push({
            path: '/' + itemId,
            tags: {
                canonical_url: canonicalURL,
                title: node.textContent.trim(),
            },
        });
    }

    if (!items.length) {
        console.debug('No chapter index on page; using fallback');

        // no chapter index; use /navigate
        const navURL = `https://archiveofourown.org/works/${id}/navigate`;
        const doc = await loadHtml(navURL, { 'Cookie': 'view_adult=true' });

        console.debug('Reading items');
        for (const node of doc.querySelectorAll('.chapter.index li > a')) {
            const itemId = node.getAttribute('href').match(/chapters\/(\d+)/)[1];
            const canonicalURL = resolveURL(node.getAttribute('href'), navURL);
            items.push({
                path: '/' + itemId,
                tags: {
                    title: node.textContent.trim(),
                    canonical_url: canonicalURL,
                },
            });
        }
    }

    return {
        last_updated: updated,
        tags,
        items,
    };
}

export async function loadSourceItem(path) {
    const id = path.substr(1);
    console.info(`Fetching chapter ${id}`);

    const canonicalURL = `https://archiveofourown.org/chapters/${id}?view_adult=true`;

    const doc = await loadHtml(canonicalURL, { 'Cookie': 'view_adult=true' });

    let chapterNode = doc.querySelector('#chapters > .chapter')
    if (!chapterNode) chapterNode = doc.querySelector('#chapters');
    if (!chapterNode) throw new Error('No chapter node');

    const prefaceNode = chapterNode.querySelector('.preface');
    // FIXME: what’s this for again?
    const afterwordNode = doc.querySelector('#workskin .afterword');

    console.debug('Reading title');
    const wholeTitle = prefaceNode.querySelector('h3.title');
    const titleLink = wholeTitle.querySelector('a');
    let title = wholeTitle.textContent.trim();
    title = title.substr(titleLink.textContent.trim().length + ': '.length);
    if (!title) title = titleLink.textContent.trim();

    console.debug('Reading summary and notes');
    const summary = (prefaceNode.querySelector('.summary > .userstuff')?.innerHTML || '').trim() || null;
    const preNotes = (doc.querySelector('#workskin .notes:not(.end) > .userstuff')?.innerHTML || '').trim() || null;
    const postNotes = (doc.querySelector('#workskin .notes.end > .userstuff')?.innerHTML || '').trim() || null;

    console.debug('Reading contents');
    let inner = doc.querySelector('#chapters > .chapter > .userstuff');
    if (!inner) inner = doc.querySelector('#chapters > .userstuff');

    inner.querySelector('.landmark')?.remove();

    const contents = inner.innerHTML.trim();

    return {
        tags: {
            title,
            preface: {
                summary,
                notes: preNotes,
            },
            contents,
            appendix: {
                notes: postNotes,
            },
        },
    };
}
