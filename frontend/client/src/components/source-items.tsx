import { h, ComponentChildren } from 'preact';
import { PureComponent, useRef } from 'preact/compat';
import {
    connectf,
    ISourceMetaItem,
    join, load,
    parseUri,
    SOURCE, SOURCE_SET_USER_DATA, SOURCE_USER_DATA, SourceUserData,
} from '../data';
import { Progress, TaskButton } from 'uikit';
import ErrorDisplay from './error-display';
import { ItemList, ItemListItem } from './item-list';
import get from '../locale';
import { AllReadIcon, CollapsedIcon, OpenExternalIcon } from './icons';
import './source-items.less';
import { SourceItemFetch } from './source-item';

export default class SourceItems extends PureComponent<SourceItems.Props> {
    state = {
        collapsed: !!localStorage.aof_auto_collapse_source_items,
    };

    render({ uri, selected }: SourceItems.Props) {
        return connectf(join(SOURCE, parseUri(uri)), view => connectf(join(SOURCE_USER_DATA, parseUri(uri)), userDataView => {
            const source = view.get();

            let header, items;
            if (view.hasError) {
                items = (
                    <ErrorDisplay error={view.getError()} />
                );
            } else if (!view.loaded) {
                items = (
                    <Progress block />
                );
            } else {
                items = [];

                if (source && source.data) {
                    let isAllRead = true;
                    let didFindFirstUnread = false;

                    for (let i = 0; i < source.data.items.length; i++) {
                        const item = source.data.items[i];
                        const isRead = new SourceUserData(userDataView.get()).itemReadState(item.path).read;
                        if (!isRead) isAllRead = false;

                        const isLastItem = i === source.data.items.length - 1;

                        if (this.state.collapsed) {
                            let shouldShow = false;
                            if (item.path === selected) {
                                shouldShow = true;
                                didFindFirstUnread = true;
                            }
                            if (!selected) {
                                if (!isRead && !didFindFirstUnread) {
                                    shouldShow = true;
                                    didFindFirstUnread = true;
                                }
                                if (!didFindFirstUnread && isLastItem) {
                                    shouldShow = true;
                                }
                            }

                            if (!shouldShow) continue;
                        }

                        let innerLabel = item.path;
                        if (typeof item.tags.title === 'string') {
                            innerLabel = item.tags.title;
                        }

                        let label: ComponentChildren = innerLabel;

                        if (typeof item.tags.contents === 'string') {
                            let slice = item.tags.contents.substr(0, 100);
                            if (item.tags.contents.length > 100) slice += '…';

                            label = [
                                label,
                                <span key="preview" class="item-content-preview">{slice}</span>,
                            ];
                        }

                        let onSelect;
                        if (!item.virtual && this.props.onSelect) {
                            onSelect = () => this.props.onSelect && this.props.onSelect(item.path);
                        }

                        const trailing = <SourceItemTrailing item={item} uri={uri} />;

                        items.push(
                            <ItemListItem
                                key={item.path}
                                offScreenPlaceholder={innerLabel}
                                class={isRead ? 'item-is-read' : ''}
                                selected={selected === item.path}
                                onSelect={onSelect}
                                label={label}
                                trailing={trailing} />
                        );
                    }

                    const setAllRead = async (r: boolean) => {
                        if (!userDataView.loaded) return;
                        // TODO: need to clone state so it doesn't update without committing!
                        const ud = new SourceUserData(userDataView.get());
                        for (const item of source.data.items) {
                            ud.itemReadState(item.path).read = r;
                        }
                        await load(SOURCE_SET_USER_DATA, { uri, data: ud.data });
                    };

                    if (source.data.items.length > 1) {
                        header = (
                            <SourceItemsHeader
                                collapsed={this.state.collapsed}
                                onSetCollapsed={collapsed => this.setState({ collapsed })}
                                allRead={isAllRead}
                                onSetAllRead={setAllRead} />
                        );
                    }
                }
            }

            return (
                <ItemList class="source-items">
                    {header}
                    {items}
                </ItemList>
            );
        }));
    }
}

namespace SourceItems {
    export interface Props {
        uri: string,
        selected?: string,
        onSelect?: (path: string) => void,
    }
}

function SourceItemTrailing({ item, uri }: { item: ISourceMetaItem, uri: string }) {
    if (item.virtual && typeof item.tags.canonical_url === 'string') {
        return (
            <div class="source-item-open-canonical">
                <a
                    target="_blank"
                    rel="nofollow noreferrer"
                    href={item.tags.canonical_url}>
                    {get('sources.details.open_canonical')}
                    {' '}
                    <OpenExternalIcon />
                </a>
            </div>
        );
    }

    const domain = parseUri(uri)[0];
    const itemUri = domain + '://' + item.path

    return <SourceItemFetch uri={itemUri} />;
}

function SourceItemsHeader(props: SourceItemsHeaderProps) {
    const toggleReadButton = useRef<TaskButton>();
    const toggleRead = async () => {
        toggleReadButton.current.showAction(
            props.allRead
                ? get('sources.items.mark_all_unread')
                : get('sources.items.mark_all_read'),
            () => props.onSetAllRead(!props.allRead),
        );
    };

    return (
        <div class="item-list-item source-items-header">
            <span class="source-items-title">{get('sources.items.title')}</span>
            <div class="items-actions">
                <TaskButton ref={toggleReadButton} run={toggleRead}>
                    <AllReadIcon read={!props.allRead} />
                </TaskButton>
                {' '}
                <TaskButton run={async () => props.onSetCollapsed(!props.collapsed)}>
                    <CollapsedIcon collapsed={props.collapsed} />
                </TaskButton>
            </div>
        </div>
    );
}

interface SourceItemsHeaderProps {
    collapsed: boolean,
    onSetCollapsed: (b: boolean) => void,
    allRead: boolean,
    onSetAllRead: (r: boolean) => Promise<void>,
}

