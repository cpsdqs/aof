// This script loads comics from MS Paint Fan Adventures (MSPFA).
// Every page is a single item.
//
// Source paths should be `/1234` where 1234 is the id.
//
// Notes about MSPFA:
// You can POST to / with do=story&s={id} and it will give you literally the ENTIRE THING.
// Like, every single page.
// Due to the way AOF works right now, this data will be discarded and loaded again for every
// single page regardless (which is fine, because the actual website does this too).

async function loadJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error('Failed to fetch: got ' + res.status + ' ' + res.statusText);
    const text = await res.text();
    return JSON.parse(text);
}

export async function loadSource(path) {
    const id = path.substr(1);

    const canonicalURL = `https://mspfa.com/log/?s=${id}`;

    const storyData = await loadJson('https://mspfa.com', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: `do=story&s=${id}`,
    });

    if (typeof storyData.n !== 'string' || !Array.isArray(storyData.p)) throw new Error('Bad JSON?');

    const tags = {
        title: storyData.n,
        authors: [{ name: storyData.a, url: storyData.w }],
        content_tags: { freeform: storyData.t.map(t => ({ name: t, url: null })) },
        description: { summary: storyData.r },
        canonical_url: canonicalURL,
        use_adventure_prompt: true,
    };

    const items = storyData.p.map((item, index) => ({
        path: '/' + id + '/' + (index + 1),
        tags: {
            canonical_url: `https://mspfa.com/?s=${id}&p=${index + 1}`,
            title: item.c,
        },
    }));

    return {
        last_updated: new Date(storyData.u).toISOString(),
        tags,
        items,
    };
}

export async function loadSourceItem(path) {
    const [id, page] = path.substr(1).split('/');

    const storyData = await loadJson('https://mspfa.com', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: `do=story&s=${id}`,
    });

    if (typeof storyData.n !== 'string' || !Array.isArray(storyData.p)) throw new Error('Bad JSON?');

    const item = storyData.p[page - 1];
    if (!item) throw new Error('Page not found');

    const tags = {
        title: item.c,
        contents: bb2Html(item.b),
    };

    return {
        tags,
    };
}

const htmlPre = `
<style>
/* parts stolen from mspfa.css */
#slide {
    font-weight: bold;
    font-size: 14px;
    background: #eeeeee;
    font-family: courier, monospace;
    color: #000;
    border-radius: 4px;
    overflow: hidden;
}
#content {
    text-align: center;
}
#content > span > br:first-child {
    display: none;
}
#content .major {
    margin: 0 -25px;
}

#content > span > img:first-child:last-child {
    display: block;
}

.spoiler {
    border: 1px dashed gray;
    padding: 1px;
}
.spoiler > summary {
    text-align: center;
    padding: 4px;
}
.spoiler > summary:focus {
    outline: none;
}
.spoiler > summary .spoiler-close-button,
.spoiler[open] > summary .spoiler-open-button {
    display: none;
}
.spoiler[open] > summary .spoiler-close-button {
    display: inline-block;
}
.spoiler > summary::-webkit-details-marker {
    display: none;
}
.spoiler > summary > span {
    padding: 2px 4px;
    background: #ccc;
    border: 2px solid #bbb;
    border-top-color: #ddd;
    border-left-color: #ddd;
    cursor: default;
}
.spoiler > summary > span:active {
    border-color: #ddd;
    border-top-color: #bbb;
    border-left-color: #bbb;
}
.spoiler > summary:focus > span {
    box-shadow: 0 0 0 1px #555;
}
.spoiler > .spoiler-contents {
    margin: 12px 5%;
    padding: 3px;
    text-align: left;
}
</style>
<div id="container"><div id="slide"><div id="content"><span>
`;
const htmlPost = `</span></div></div></div>`;

function bb2Html(input) {
    const renderSpoiler = (contentIndex, openIndex, closeIndex) => (...args) => {
        const closeLabel = closeIndex ? args[closeIndex] : 'Hide';
        const openLabel = openIndex ? args[openIndex] : 'Show';

        return `<details class="spoiler">\
<summary>\
<span class="spoiler-close-button">${closeLabel}</span>\
<span class="spoiler-open-button">${openLabel}</span>\
</summary>\
<div class="spoiler-contents">${args[contentIndex]}</div>\
</details>`;
    };

    // parseBBCode stolen from mspfa.js
    const replacements = [
        [/  /g, `&nbsp;&nbsp;`],
        [/\t/g, `&nbsp;&nbsp;&nbsp;&nbsp;`],
        [/\r?\n/g, `<br>`],
        [/\[b]((?:(?!\[b]).)*?)\[\/b]/gi, `<span style="font-weight: bolder;">$1</span>`],
        [/\[i]((?:(?!\[i]).)*?)\[\/i]/gi, `<span style="font-style: italic;">$1</span>`],
        [/\[u]((?:(?!\[u]).)*?)\[\/u]/gi, `<span style="text-decoration: underline;">$1</span>`],
        [/\[s]((?:(?!\[s]).)*?)\[\/s]/gi, `<span style="text-decoration: line-through;">$1</span>`],
        [/\[size=(\d*?)]((?:(?!\[size=(?:\d*?)]).)*?)\[\/size]/gi, `<span style="font-size: $1px;">$2</span>`],
        [/\[color=("?)#?([a-f0-9]{3}(?:[a-f0-9]{3})?)\1]((?:(?!\[color(?:=[^;]*?)]).)*?)\[\/color]/gi, `<span style="color: #$2;">$3</span>`],
        [/\[color=("?)([^";]+?)\1]((?:(?!\[color(?:=[^;]*?)]).)*?)\[\/color]/gi, `<span style="color: $2;">$3</span>`],
        [/\[background=("?)#?([a-f0-9]{3}(?:[a-f0-9]{3})?)\1]((?:(?!\[background(?:=[^;]*?)]).)*?)\[\/background]/gi, `<span style="background-color: #$2;">$3</span>`],
        [/\[background=("?)([^";]+?)\1]((?:(?!\[background(?:=[^;]*?)]).)*?)\[\/background]/gi, `<span style="background-color: $2;">$3</span>`],
        [/\[font=("?)([^";]*?)\1]((?:(?!\[size(?:=[^;]*?)]).)*?)\[\/font]/gi, `<span style="font-family: $2;">$3</span>`],
        [/\[(center|left|right|justify)]((?:(?!\[\1]).)*?)\[\/\1]/gi, `<div style="text-align: $1;">$2</div>`],
        [/\[url]([^"]*?)\[\/url]/gi, `<a href="$1">$1</a>`],
        [/\[url=("?)([^"]*?)\1]((?:(?!\[url(?:=.*?)]).)*?)\[\/url]/gi, `<a href="$2">$3</a>`],
        [/\[alt=("?)([^"]*?)\1]((?:(?!\[alt(?:=.*?)]).)*?)\[\/alt]/gi, `<span title="$2">$3</span>`],
        [/\[img]([^"]*?)\[\/img]/gi, `<img src="$1">`],
        [/\[img=(\d*?)x(\d*?)]([^"]*?)\[\/img]/gi, `<img src="$3" width="$1" height="$2">`],
        [/\[spoiler]((?:(?!\[spoiler(?: .*?)?]).)*?)\[\/spoiler]/gi, renderSpoiler(1),`<div class="spoiler closed"><div style="text-align: center;"><input type="button" value="Show" data-close="Hide" data-open="Show"></div><div>$1</div></div>`],
        [/\[spoiler open=("?)([^"]*?)\1 close=("?)([^"]*?)\3]((?:(?!\[spoiler(?: .*?)?]).)*?)\[\/spoiler]/gi, renderSpoiler(5, 2, 4), `<div class="spoiler closed"><div style="text-align: center;"><input type="button" value="$2" data-open="$2" data-close="$4"></div><div>$5</div></div>`],
        [/\[spoiler close=("?)([^"]*?)\1 open=("?)([^"]*?)\3]((?:(?!\[spoiler(?: .*?)?]).)*?)\[\/spoiler]/gi, renderSpoiler(5, 4, 2), `<div class="spoiler closed"><div style="text-align: center;"><input type="button" value="$4" data-open="$4" data-close="$2"></div><div>$5</div></div>`],
        [/\[flash=(\d*?)x(\d*?)](.*?)\[\/flash]/gi, `<object type="application/x-shockwave-flash" data="$3" width="$1" height="$2"></object>`],
        [/\[user](.+?)\[\/user]/gi, `<a class="usertag" href="/user/?u=$1" data-userid="$1">@...</a>`],
    ];

    let code = input;
    code = code.split(/\<(textarea|style)(?:(?: |\n)(?:.|\n)*?)?\>(?:.|\n)*?\<\/\2\>/gi);
    for (let i = 2; i < code.length; i += 2) {
        code.splice(i, 1);
    }
    for (let i = 0; i < code.length; i += 2) {
        let prevCode;
        while (prevCode !== code[i]) {
            prevCode = code[i];
            for (let j = 0; j < replacements.length; j++) {
                code[i] = code[i].replace(replacements[j][0], replacements[j][1]);
            }
        }
    }
    return htmlPre + code.join('') + htmlPost;
}
