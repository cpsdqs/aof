import { h } from 'preact';
import { PureComponent, createRef, useRef } from 'preact/compat';
import { DomainId } from './domain';
import {
    connectf,
    Connection, DOMAIN, IFetchState,
    ISource, IUserData,
    join,
    load,
    parseUri,
    SOURCE,
    SOURCE_FETCH,
    SOURCE_REQUEST, SOURCE_USER_DATA, SourceUserData, View
} from '../data';
import './source.less';
import { Progress, TaskButton } from 'uikit';
import RelTime from './reltime';
import get from '../locale';
import ErrorDisplay from './error-display';
import { OpenExternalIcon, LockIcon } from './icons';
import FetchLogDialog from './fetch-log-dialog';

export default class Source extends PureComponent<Source.Props> {
    state = {
        visible: false,
    };

    iob = new IntersectionObserver(entries => {
        const node = entries[0];
        this.setState({ visible: node.isIntersecting });
    });

    node = createRef();

    componentDidMount() {
        if (this.props.visibilityCheck) this.iob.observe(this.node.current);
    }

    onClick = () => {
        if (this.props.onSelect) this.props.onSelect();
    };

    render({ uri }: Source.Props) {
        const lazy = this.props.visibilityCheck ? { shouldLoad: this.state.visible } : undefined;

        return connectf(join(SOURCE, parseUri(uri)), view => connectf(join(SOURCE_USER_DATA, parseUri(uri)), userDataView => {
            let className = 'source';
            if (this.props.selected) className += ' is-selected';
            if (this.props.large) className += ' is-large';

            const source = view?.get();
            const error = view?.getError();
            const loading = !error && !view?.loaded && this.state.visible;

            if (!this.props.large && source && source.data && userDataView.loaded) {
                const ud = new SourceUserData(userDataView.get());
                let allRead = true;
                for (const item of source.data.items) {
                    if (!ud.itemReadState(item.path).read) {
                        allRead = false;
                        break;
                    }
                }
                if (allRead) className += ' is-all-read';
            }

            if (this.props.visibilityCheck && !this.state.visible) {
                // because sources have a fixed height, we can render a simple placeholder here
                return (
                    <div ref={this.node} class={className + ' is-placeholder'}>
                        <div class="inner-placeholder" />
                    </div>
                );
            }

            return (
                <div ref={this.node} class={className} onClick={this.onClick}>
                    <SourceTitle
                        uri={uri}
                        source={source}
                        loading={loading} />
                    <SourceTopDetails
                        uri={uri}
                        userData={userDataView}
                        large={!!this.props.large}
                        source={source}
                        loading={loading}
                        error={error} />
                    {this.props.large && <SourceLargeDetails
                        uri={uri}
                        source={source} />}
                </div>
            );
        }, lazy), lazy);
    }
}

namespace Source {
    export interface Props {
        uri: string,
        selected?: boolean,
        onSelect?: () => void,
        large?: boolean,
        visibilityCheck?: boolean,
    }
}

function SourceTitle({ source, uri, loading }: { source: ISource | null, uri: string, loading: boolean }) {
    let titleLabel = '';
    let updateTime;
    if (source && source.loaded) {
        updateTime = source.data.last_updated;
        const data = source.data.data;
        if (typeof data.title === 'string') {
            titleLabel = data.title;
        }
    }

    return (
        <div class="source-title">
            <div class="title-inner">
                <SourceId id={uri} />
                <span class="title-label">
                    {titleLabel}
                </span>
            </div>
            <div class="source-update">
                {loading ? (
                    <Progress />
                ) : (
                    <RelTime time={updateTime} />
                )}
            </div>
        </div>
    );
}

function SourceId({ id }: { id: string }) {
    const uri = parseUri(id);
    const domainId = uri[0];
    if (!domainId) return <DomainId id={id} />;

    return connectf(join(DOMAIN, domainId), view => {
        let resolvedId = id;
        if (view.loaded) {
            const domain = view.get()!;
            resolvedId = domain.abbrev + ' ' + uri.slice(1).join(' ');
        }

        return <DomainId id={resolvedId} title={id} />;
    });
}

function SourceTopDetails({
    source, uri, loading, error, large, userData,
}: { source: ISource | null, uri: string, loading: boolean, error?: any, large: boolean, userData: View<IUserData> }) {
    return (
        <div class="source-top-details">
            {error ? (
                <div class="detail-group">
                    <ErrorDisplay error={error} />
                </div>
            ) : !loading ? (
                <div class="detail-group">
                    <SourceCompletion source={source} userData={userData} />
                    {!large && <SourceShortAuthors source={source} />}
                </div>
            ) : <span class="detail-group-placeholder" />}
            <SourceFetch source={source} uri={uri} />
        </div>
    );
}

function SourceCompletion({ source, userData }: { source: ISource | null, userData: View<IUserData> }) {
    let unread: string | number = '?';
    let read: string | number = '?';
    let completionTotal: string | number = '?';

    if (source && source.data) {
        if (userData.loaded) {
            read = 0;

            const ud = new SourceUserData(userData.get());
            for (const item of source.data.items) {
                const itemState = ud.itemReadState(item.path);
                if (itemState.read) read++;
            }
        }

        unread = source.data.items.length;
        if (typeof read === 'number') unread -= read;

        const data = source.data.data;
        if (typeof (data.completion as any)?.total === 'number') {
            completionTotal = (data.completion as any).total;
        }
    }

    let readRendered = <span>{read}</span>;
    if (read === '?') readRendered = <LockIcon class="completion-read-locked" />;

    return (
        <span class="source-completion">
            <span class={'unread-count' + (unread ? ' has-unread' : '')}>{unread}</span>
            <span class="completion">/{readRendered}/{completionTotal}</span>
        </span>
    );
}

function SourceShortAuthors({ source }: { source: ISource | null }) {
    let authors = [];
    if (source && source.data) {
        const data = source.data.data;
        if (Array.isArray(data.authors)) {
            for (const item of data.authors) {
                if (!item || typeof item !== 'object') continue;
                const { name } = item;
                if (typeof name !== 'string') continue;
                authors.push(
                    <span class="author-item">
                        {name}
                    </span>
                );
            }
        }
    }

    return (
        <span class="source-short-authors">
            {authors}
        </span>
    );
}

function SourceFetch({ source, uri }: { source: ISource | null, uri: string }) {
    const taskButtonRef = useRef<TaskButton>(null);

    const update = async () => {
        await load(SOURCE_REQUEST, { uri });
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
            }
        }
    };

    return (
        <Connection<IFetchState>
            view={join(SOURCE_FETCH, parseUri(uri))}
            onPing={onPing}
            render={fetchStateView => {
                const fetchState = fetchStateView.get();
                const loading = !!(fetchState && fetchState.loading);

                let lastFetch;
                if (source && source.data) {
                    lastFetch = source.data.last_fetched;
                }

                return (
                    <span class="source-fetch">
                        <TaskButton
                            ref={taskButtonRef}
                            loading={loading}
                            run={update}
                            onClick={(e: MouseEvent) => e.stopPropagation()}>
                            <RelTime time={lastFetch} default={get('sources.fetch.never')} />
                        </TaskButton>
                    </span>
                );
            }} />
    );
}

function SourceLargeDetails({ source, uri }: { source: ISource | null, uri: string }) {
    let authors;
    let openCanonical;
    if (source && source.data) {
        const data = source.data.data;

        if (Array.isArray(data.authors)) {
            authors = [];
            for (const author of data.authors) {
                if (typeof author.name === 'string') authors.push(author);
            }
        }

        if (typeof data.canonical_url === 'string') {
            openCanonical = (
                <a target="_blank" rel="nofollow noreferrer" href={data.canonical_url}>
                    {get('sources.details.open_canonical')}
                    {' '}
                    <OpenExternalIcon />
                </a>
            );
        }
    }

    return (
        <div class="source-large-details">
            <div class="source-details-line">
                <Authors authors={authors} />
                {openCanonical}
            </div>
        </div>
    );
}

function Authors({ authors }: { authors?: { name: string, url?: string }[] }) {
    if (!authors) return <span />;

    function Author({ author }: { author: { name: string, url?: string } }) {
        return (
            <li class="source-author">
                {author.url ? (
                    <a
                        target="_blank"
                        rel="nofollow noreferrer"
                        href={author.url}
                        class="author-linked">
                        {author.name}
                        {' '}
                        <OpenExternalIcon />
                    </a>
                ) : author.name}
            </li>
        );
    }

    return (
        <ul class="source-authors">
            {authors.map(author => <Author author={author} />)}
        </ul>
    );
}
