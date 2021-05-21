import { h } from 'preact';
import { PureComponent, useRef } from 'preact/compat';
import { PageProps } from '../../../router';
import Source, { SourceMetadata } from '../../../components/source';
import './index.less';
import SourceItems from '../../../components/source-items';
import {
    connectf, join,
    load, parseUri, SOURCE, SOURCE_DELETE,
    SOURCE_SUBSCRIBE,
    SOURCE_UNSUBSCRIBE,
    SOURCES_LIST_USER
} from '../../../data';
import { Progress, TaskButton } from 'uikit';
import get from '../../../locale';
import SourceRss from '../../../components/source-rss';

export default class SourcePage extends PureComponent<PageProps> {
    render({ route }: PageProps) {
        const uri = route.source.domain + '://' + route.source.path;

        return (
            <div class="source-page">
                <Source large uri={uri} />
                <SourceItems
                    selected={route.item && route.item.path}
                    onSelect={path => {
                        this.context.navigate(`sources/${route.source.domain}${route.source.path}:item${path}`);
                    }}
                    uri={uri} />
                <SourceActions uri={uri} />
                <SourceMetadata uri={uri} />
            </div>
        )
    }
}

function SourceActions({ uri }: { uri: string }) {
    const subscription = connectf(SOURCES_LIST_USER, view => {
        let toggle, contents;
        let isSubscribed = false;
        if (view.loaded) {
            toggle = async () => {
                if (view.get()!.includes(uri)) {
                    await load(SOURCE_UNSUBSCRIBE, { uri });
                } else {
                    await load(SOURCE_SUBSCRIBE, { uri });
                }
            };
            if (view.get()!.includes(uri)) {
                isSubscribed = true;
                contents = get('pages.source.unsubscribe');
            } else {
                contents = get('pages.source.subscribe');
            }
        } else {
            toggle = async () => {};
            contents = <Progress />;
        }
        return (
            <span class="subscription-actions">
                <TaskButton class="list-action-button" run={toggle}>
                    {contents}
                </TaskButton>
                <span
                    class={'action-rss-container' + (!isSubscribed ? ' is-hidden' : '')}
                    aria-hidden={!isSubscribed}>
                    <SourceRss uri={uri} />
                </span>
            </span>
        );
    });

    const deleteButtonRef = useRef<TaskButton>();
    const deleteButton = connectf(join(SOURCE, parseUri(uri)), view => {
        let deleteData = async () => {};
        let contents = null;
        if (view.loaded) {
            const source = view.get()!;
            if (source.loaded) {
                const run = async () => {
                    await load(SOURCE_DELETE, { uri });
                };
                deleteData = async () => {
                    deleteButtonRef.current!.showAction(get('pages.source.delete'), run);
                };
                contents = get('pages.source.delete');
            }
        } else {
            contents = <Progress />;
        }
        if (!contents) return null;
        return (
            <TaskButton ref={deleteButtonRef} class="delete-button" run={deleteData}>
                {contents}
            </TaskButton>
        );
    });

    return (
        <div class="source-page-actions">
            {subscription}
            {deleteButton}
        </div>
    );
}
