import { h, Component } from 'preact';
import { useRef, Fragment } from 'preact/compat';
import { Progress, TaskButton } from 'uikit';
import {
    api,
    connectf,
    Connection,
    IFetchState, ISourceMetaItem,
    join,
    load,
    parseUri,
    SOURCE,
    SOURCE_ITEM,
    SOURCE_ITEM_DATA,
    SOURCE_ITEM_FETCH,
    SOURCE_ITEM_REQUEST,
    SOURCE_SET_USER_DATA,
    SOURCE_USER_DATA,
    SourceItemData,
    SourceUserData,
} from '../data';
import get from '../locale';
import { CheckIcon, DownloadedIcon, DownloadIcon, NoDataIcon, OpenExternalIcon } from './icons';
import './source-item.less';
import ErrorDisplay from './error-display';
import FetchLogDialog from './fetch-log-dialog';
import { HtmlContainer } from './html-container';

export function SourceItemHeader(this: Component, { source, uri }: { source: string, uri: string }) {
    const sourceUri = source;
    return connectf(join(SOURCE, parseUri(source)), view => connectf(join(SOURCE_USER_DATA, parseUri(source)), userDataView => {
        let openCanonical = <span />;

        const itemPath = '/' + parseUri(uri).slice(1).join('/');

        const source = view.get();
        let previousItem: ISourceMetaItem | null = null;
        let item = null;
        if (source && source.data) {
            for (const i of source.data.items) {
                if (i.path === itemPath) {
                    item = i;
                    break;
                }
                previousItem = i;
            }
        }

        const userData = new SourceUserData(userDataView.get());
        let readState = userData.itemReadState(itemPath);

        const toggleRead = async () => {
            // FIXME: this modifies local state BEFORE committing!!
            readState.read = !readState.read;
            await load(SOURCE_SET_USER_DATA, { uri: sourceUri, data: userData.data });
        };
        const readStateButton = (
            <TaskButton run={toggleRead}>
                {readState.read ? get('sources.items.mark_unread') : get('sources.items.mark_read')}
            </TaskButton>
        );

        let openPrevious;
        if (previousItem) {
            openPrevious = (
                <TaskButton class="prev-item-button" run={async () => {
                    const sourcePath = parseUri(sourceUri).join('/');
                    this.context.navigate(`sources/${sourcePath}:item${previousItem!.path}`);
                }}>
                    <span class="inner-arrow" />
                </TaskButton>
            );
        }

        if (typeof item?.tags === 'object' && typeof (item!.tags as any).canonical_url === 'string') {
            openCanonical = (
                <div class="source-item-open-canonical">
                    <a
                        target="_blank"
                        rel="nofollow noreferrer"
                        href={(item!.tags as any).canonical_url}>
                        {get('sources.details.open_canonical')}
                        {' '}
                        <OpenExternalIcon />
                    </a>
                </div>
            );
        }

        return (
            <div class="source-item-header">
                <div class="header-group">
                    {readStateButton}
                    {openPrevious}
                </div>
                {openCanonical}
            </div>
        );
    }));
}

const DEFAULT_SHADOW_STYLES = `
/* default styles */
.html-body > p {
    text-align: justify;
}
img {
    max-width: 100%;
}
a {
    color: var(--accent);
}
.removed-tag {
    display: none;
}
hr {
    max-width: 4em;
    margin: 0 auto;
}
`;
const DEFAULT_NOTE_STYLES = DEFAULT_SHADOW_STYLES;

export function SourceItemContents({ uri, referrer }: { uri: string, referrer?: string }) {
    return connectf(join(SOURCE_ITEM_DATA, parseUri(uri)), view => {
        let contents;
        if (view.hasError) {
            contents = <ErrorDisplay error={view.getError()} />;
        } else if (view.loaded) {
            const data = view.get();
            if (data) {
                contents = <SourceItemContentRender data={data} referrer={referrer} />;
            } else {
                contents = <SourceItemNoData uri={uri} />;
            }
        } else {
            contents = <Progress block />;
        }

        return (
            <div class="source-item-contents">
                {contents}
            </div>
        )
    });
}

function SourceItemContentRender({ data, referrer }: { data: SourceItemData, referrer?: string }) {
    const addDefaultStyles = (shadow: ShadowRoot) => {
        const style = shadow.ownerDocument.createElement('style');
        style.innerHTML = DEFAULT_SHADOW_STYLES;
        shadow.insertBefore(style, shadow.firstChild);
    };

    let parts = [];

    if (typeof data.title === 'string') {
        parts.push(
            <h1 class="source-item-title">
                {data.title}
            </h1>
        );
    }
    if (data.preface && typeof data.preface === 'object') {
        for (const k in data.preface) {
            const v = (data.preface as any)[k];
            if (typeof v === 'string') {
                parts.push(
                    <NoteItem id={k} html={v} referrer={referrer} />
                );
            }
        }
    }
    if (typeof data.contents === 'string') {
        parts.push(
            <HtmlContainer
                referrer={referrer}
                html={data.contents}
                onShadowRender={addDefaultStyles} />
        );
    }
    if (data.appendix && typeof data.appendix === 'object') {
        for (const k in data.appendix) {
            const v = (data.appendix as any)[k];
            if (typeof v === 'string') {
                parts.push(
                    <NoteItem id={k} html={v} referrer={referrer} />
                );
            }
        }
    }
    return <Fragment>{parts}</Fragment>;
}

function NoteItem({ id, html, referrer }: { id: string, html: string, referrer?: string }) {
    const addNoteStyles = (shadow: ShadowRoot) => {
        const style = shadow.ownerDocument.createElement('style');
        style.innerHTML = DEFAULT_NOTE_STYLES;
        shadow.insertBefore(style, shadow.firstChild);
    };

    return (
        <div class="source-item-note">
            <div class="note-id">{id}</div>
            <HtmlContainer
                html={html}
                referrer={referrer}
                onShadowRender={addNoteStyles} />
        </div>
    );
}

function SourceItemNoData({ uri }: { uri: string }) {
    // TODO: show link to open canonical

    return (
        <div class="source-item-no-data">
            <div class="no-data-inner">
                <NoDataIcon class="no-data-icon" />
                <div class="no-data-label">
                    {get('sources.items.no_data')}
                </div>
            </div>
            <div class="no-data-fetch-container">
                <SourceItemFetch uri={uri} />
            </div>
        </div>
    );
}

export function SourceItemFetch({ uri }: { uri: string }) {
    const taskButtonRef = useRef<TaskButton>(null);

    const update = async () => {
        await load(SOURCE_ITEM_REQUEST, { uri });
    };
    const onPing = async (value: IFetchState) => {
        if (value.result) {
            if (!value.result.success) {
                console.error('Fetch error', value.result.log);
                taskButtonRef.current?.showError(
                    get('sources.fetch.unspecified_error'),
                    {
                        run: () => FetchLogDialog.run(value.result!.log),
                        label: get('sources.fetch.log.show'),
                    },
                );
            } else {
                console.debug('Fetch success', value.result.log);
            }
        }
    };

    return connectf(join(SOURCE_ITEM, parseUri(uri)), view => {
        let icon = <Progress />;
        let isLoaded = false;
        if (view.loaded) {
            const item = view.get();
            if (item && item.loaded) {
                isLoaded = true;
                icon = <DownloadedIcon />;
            } else icon = <DownloadIcon />;
        }

        return (
            <Connection<IFetchState>
                view={join(SOURCE_ITEM_FETCH, parseUri(uri))}
                onPing={onPing}
                render={fetchStateView => {
                    const fetchState = fetchStateView.get();
                    const loading = !!(fetchState && fetchState.loading);

                    return (
                        <span class="source-item-fetch">
                            <TaskButton
                                class={isLoaded ? 'is-loaded' : ''}
                                ref={taskButtonRef}
                                loading={loading}
                                run={update}
                                onClick={(e: MouseEvent) => e.stopPropagation()}>
                                {icon}
                            </TaskButton>
                        </span>
                    );
                }} />
        );
    });
}

export function SourceItemNext(this: Component, { source, uri }: { source: string, uri: string }) {
    const itemPath = '/' + parseUri(uri).slice(1).join('/');

    return connectf(join(SOURCE, parseUri(source)), view => connectf(join(SOURCE_USER_DATA, parseUri(source)), userDataView => {
        if (view.get()?.loaded) {
            let nextItem: ISourceMetaItem | null = null;
            let didFindItem = false;
            let useAdventurePrompt = view.get()!.data.data.use_adventure_prompt;

            for (const item of view.get()!.data.items) {
                if (didFindItem) {
                    nextItem = item;
                    break;
                }
                if (item.path === itemPath) {
                    didFindItem = true;
                }
            }

            if (didFindItem) {
                const userData = new SourceUserData(userDataView.get());
                let readState = userData.itemReadState(itemPath);

                const markRead = async () => {
                    // assume it would've been loaded by now
                    // FIXME: this modifies local state BEFORE committing!!
                    readState.read = true;
                    await load(SOURCE_SET_USER_DATA, { uri: source, data: userData.data });
                };

                let contents;
                if (nextItem) {
                    const openNextItem = async () => {
                        await markRead();
                        const sourcePath = parseUri(source).join('/');
                        this.context.navigate(`sources/${sourcePath}:item${nextItem!.path}`);
                    };

                    if (useAdventurePrompt) {
                        const title = nextItem!.tags?.title;
                        contents = (
                            <TaskButton run={openNextItem} class="next-item-button is-adventure-prompt">
                                {typeof title === 'string' && <span class="inner-prompt">&gt;</span>}
                                <span class="inner-prompt-contents">
                                    {typeof title === 'string'
                                        ? title
                                        : (
                                            <span class="inner-prompt-continue">
                                                <span class="p-arrow" />
                                            </span>
                                        )}
                                </span>
                            </TaskButton>
                        );
                    } else {
                        contents = (
                            <TaskButton run={openNextItem} class="next-item-button">
                                <span class="inner-arrow" />
                            </TaskButton>
                        );
                    }
                } else {
                    const isRead = readState.read;
                    contents = (
                        <TaskButton run={markRead} class={'finished-button' + (isRead ? ' is-finished' : '')}>
                            {isRead && (
                                <CheckIcon class="inner-icon" />
                            )}
                            <span class="inner-label">{get('sources.items.finished')}</span>
                        </TaskButton>
                    );
                }

                return (
                    <div class="source-item-next">
                        {contents}
                    </div>
                );
            }
        }
        return null;
    }));
}
