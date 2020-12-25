import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { PageProps } from '../../../router';
import Source from '../../../components/source';
import './index.less';
import SourceItems from '../../../components/source-items';
import {
    connectf,
    load,
    SOURCE_SUBSCRIBE,
    SOURCE_UNSUBSCRIBE,
    SOURCES_LIST_USER
} from '../../../data';
import { Progress, TaskButton } from 'uikit';
import get from '../../../locale';

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
            </div>
        )
    }
}

function SourceActions({ uri }: { uri: string }) {
    const addToList = connectf(SOURCES_LIST_USER, view => {
        let toggle, contents;
        if (view.loaded) {
            toggle = async () => {
                if (view.get()!.includes(uri)) {
                    await load(SOURCE_UNSUBSCRIBE, { uri });
                } else {
                    await load(SOURCE_SUBSCRIBE, { uri });
                }
            };
            if (view.get()!.includes(uri)) contents = get('pages.source.unsubscribe');
            else contents = get('pages.source.subscribe');
        } else {
            toggle = async () => {};
            contents = <Progress />;
        }
        return <TaskButton run={toggle}>{contents}</TaskButton>
    });

    return (
        <div class="source-page-actions">
            {addToList}
        </div>
    );
}
