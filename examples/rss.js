// This script loads RSS feeds. It does not load item contents.
//
// Source paths should look like `/https/example.com/path/to/rss` - basically just the whole URL

export async function loadSource(path) {
    const pathParts = path.substr(1).split('/');
    const protocol = pathParts[0];
    if (!['http', 'https'].includes(protocol)) {
        throw new Error('path should start with http or https');
    }
    const host = pathParts[1];
    if (!host) throw new Error('no host');

    const url = protocol + '://' + host + '/' + pathParts.slice(2).join('/');

    const res = await fetch(url);
    let rawXml = await res.text();

    // HACK to make link work without xml
    rawXml = rawXml
        .replace(/<link>/g, '<xlink>')
        .replace(/<\/link>/g, '</xlink>');

    console.log('Parsing XML');

    const dp = new DOMParser();
    const document = dp.parseFromString(rawXml, 'text/html'); // XML not supported yet
    const channelNode = document.querySelector('rss channel');
    if (!channelNode) throw new Error('could not find <rss> <channel>');

    const tags = {
        canonical_url: url,
    };

    const titleNode = channelNode.querySelector('title');
    const linkNode = channelNode.querySelector('xlink');
    const descNode = channelNode.querySelector('description');
    if (titleNode) tags.title = titleNode.textContent;
    if (linkNode) tags.canonical_url = linkNode.textContent;
    if (descNode) tags.description = { description: descNode.textContent };

    const items = [];
    let newestPubDate = null;
    for (const item of channelNode.querySelectorAll('item')) {
        const data = {
            path: '/',
            virtual: true,
            tags: {},
        };

        const titleNode = item.querySelector('title');
        const descNode = item.querySelector('description');
        const linkNode = item.querySelector('xlink');
        const pubDateNode = item.querySelector('pubDate');
        if (titleNode) data.tags.title = titleNode.textContent;
        if (linkNode) data.tags.canonical_url = linkNode.textContent;
        if (descNode) data.tags.contents = descNode.textContent;
        if (pubDateNode) {
            const date = new Date(pubDateNode.textContent);
            if (Number.isFinite(date.getFullYear())) {
                if (!newestPubDate || date > newestPubDate) newestPubDate = date;
                data.tags.last_updated = date.toISOString();
            }
        }

        items.push(data);
    }

    return {
        last_updated: newestPubDate,
        tags,
        items,
    };
}

export async function loadSourceItem(path) {
    throw new Error('Cannot load virtual item');
}
