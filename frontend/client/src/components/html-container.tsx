import { h } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import { api } from '../data';
// @ts-ignore
import { sanitize } from 'dompurify';

export class HtmlContainer extends PureComponent<HtmlContainer.Props> {
    node = createRef<HTMLDivElement>();
    aspectImages: (HTMLImageElement | HTMLIFrameElement)[] = [];

    load() {
        const node = this.node.current;
        if (!node) return;

        if (!node.shadowRoot) {
            node.attachShadow({ mode: 'open' });
        }
        const shadow = node.shadowRoot!;

        const dp = new DOMParser();
        const DOM_PRE = '<!doctype html><html><body>';
        const DOM_POST = '</body></html>';
        let doc = dp.parseFromString(DOM_PRE + this.props.html + DOM_POST, 'text/html');

        // demote some common offenders to text nodes that can be inspected later
        const demoteNodeToText = (node: HTMLElement) => {
            let replacement = doc.createElement('div');
            replacement.className = 'removed-tag';
            replacement.textContent = node.outerHTML;
            node.parentNode!.insertBefore(replacement, node);
            node.remove();
        };
        doc.querySelectorAll('script').forEach(demoteNodeToText);
        doc.querySelectorAll('embed').forEach(demoteNodeToText);
        doc.querySelectorAll('applet').forEach(demoteNodeToText);
        doc.querySelectorAll('object').forEach(demoteNodeToText);
        doc.querySelectorAll('frame').forEach(demoteNodeToText);
        doc.querySelectorAll('frameset').forEach(demoteNodeToText);

        // adjust iframe sandboxes to be less bad (should be sufficient for youtube embeds?)
        doc.querySelectorAll('iframe').forEach(frame => {
            if (!frame.hasAttribute('sandbox')) {
                frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-same-origin');
            }
            frame.sandbox.remove('allow-top-navigation');
            frame.sandbox.remove('allow-top-navigation-by-user-activation');
            frame.sandbox.remove('allow-orientation-lock');
            frame.sandbox.remove('allow-pointer-lock');
            frame.sandbox.remove('allow-downloads-without-user-activation');
            // frame.sandbox.remove('allow-same-origin');

            // force youtube-nocookie
            frame.src = frame.src.replace(
                /^(https?:\/\/(?:www\.)?youtube)(?=\.com\/embed)/,
                '$1-nocookie',
            );

            frame.allow = 'encrypted-media fullscreen picture-in-picture';
            frame.allowFullscreen = true;
            frame.referrerPolicy = 'no-referrer';
        });

        // sanitize the rest with dompurify
        doc = sanitize(doc, {
            IN_PLACE: true,
            ADD_TAGS: ['iframe', 'link'],
            ADD_ATTR: ['sandbox', 'allow', 'referrerPolicy', 'frameborder', 'allowfullscreen'],
        });

        doc.querySelectorAll('a').forEach(anchor => {
            anchor.target = '_blank';
            anchor.rel = 'nofollow noreferrer';
        });

        doc.querySelectorAll('link').forEach(link => {
            try {
                const srcUrl = new URL(link.href);
                if (['http:', 'https:'].includes(srcUrl.protocol)) {
                    const s = encodeURIComponent(srcUrl.toString());
                    const r = this.props.referrer ? encodeURIComponent(this.props.referrer) : null;
                    link.href = api(`resources/camo?url=${s}` + (r ? `&referrer=${r}` : ''));
                }
            } catch {}
        });

        this.aspectImages = [];
        doc.querySelectorAll('img, iframe').forEach(_image => {
            let image = _image as (HTMLImageElement | HTMLIFrameElement);
            if (image.hasAttribute('width') && image.hasAttribute('height')) {
                const width = image.getAttribute('width')!;
                const height = image.getAttribute('height')!;
                if (+width > 0 && +height > 0) {
                    image.dataset.aofWidth = image.getAttribute('width')!;
                    image.dataset.aofHeight = image.getAttribute('height')!;
                    image.removeAttribute('width');
                    image.removeAttribute('height');

                    this.aspectImages.push(image);
                }
            }

            if (image instanceof HTMLImageElement) {
                try {
                    const srcUrl = new URL(image.src);
                    if (['http:', 'https:'].includes(srcUrl.protocol)) {
                        const s = encodeURIComponent(srcUrl.toString());
                        const r = this.props.referrer ? encodeURIComponent(this.props.referrer) : null;
                        image.src = api(`resources/camo?url=${s}` + (r ? `&referrer=${r}` : ''));

                        image.addEventListener('click', () => {
                            let parent: Node | null = image;
                            while ((parent = parent.parentNode)) {
                                if (parent instanceof HTMLButtonElement || parent instanceof HTMLInputElement) {
                                    return;
                                }
                            }

                            // TODO: use some sort of lightbox instead
                            const a = document.createElement('a');
                            a.target = '_blank';
                            a.rel = 'nofollow noreferrer';
                            a.href = srcUrl.toString();
                            a.click();
                        });
                    }
                } catch {}
            }
        });

        const childNodes = [];
        for (let i = 0; i < doc.body.childNodes.length; i++) {
            const child = doc.body.childNodes[i];
            childNodes.push(child);
        }

        shadow.innerHTML = '';
        const htmlBody = document.createElement('div');
        htmlBody.className = 'html-body';
        shadow.appendChild(htmlBody);
        for (const child of childNodes) {
            doc.body.removeChild(child);
            htmlBody.appendChild(child);
        }

        if (this.props.onShadowRender) this.props.onShadowRender(shadow);
        this.onResize();
    }

    onResize = () => {
        for (const image of this.aspectImages) {
            // find closest parent with block layout
            let container = image.parentNode;
            for (let i = 0; i < 255; i++) {
                if (!(container instanceof HTMLElement)) break;
                const display = getComputedStyle(container!).display;
                if (['block', 'flex', 'table', 'table-cell'].includes(display)) {
                    break;
                }
                container = container.parentNode;
            }
            let containerWidth;
            if (container instanceof HTMLElement) {
                containerWidth = container.offsetWidth;
            } else {
                // probably the shadow root node
                containerWidth = this.node.current!.offsetWidth;
            }
            const suggestedWidth = +image.dataset.aofWidth!;
            const suggestedHeight = +image.dataset.aofHeight!;

            image.style.width = image.style.height = '';
            if (suggestedWidth < containerWidth) {
                image.style.width = suggestedWidth + 'px';
                image.style.height = suggestedHeight + 'px';
            } else {
                image.style.width = containerWidth + 'px';
                image.style.height = (containerWidth * suggestedHeight / suggestedWidth) + 'px';
            }
        }
    };

    componentDidMount() {
        this.load();
        window.addEventListener('resize', this.onResize);
    }

    componentDidUpdate(prevProps: HtmlContainer.Props) {
        if (prevProps.html !== this.props.html) this.load();
    }

    componentWillUnmount() {
        window.removeEventListener('resize', this.onResize);
    }

    render() {
        return <div ref={this.node} class="html-container" />;
    }
}
namespace HtmlContainer {
    export interface Props {
        html: string,
        onShadowRender?: (shadow: ShadowRoot) => void,
        referrer?: string,
    }
}
