import { h } from 'preact';
import { Fragment, PureComponent } from 'preact/compat';
import { Progress } from 'uikit';
import { PageProps } from '../../../../router';
import {
    SourceItemContents,
    SourceItemHeader,
    SourceItemNext
} from '../../../../components/source-item';
import { connectf, join, parseUri, SOURCE } from '../../../../data';
import './index.less';

export default class SourceItemPage extends PureComponent<PageProps> {
    render({ route }: PageProps) {
        const domain = route.source.domain;
        const sourcePath = route.source.path;
        const path = route.item.path;
        const sourceUri = domain + '://' + sourcePath;
        const uri = domain + '://' + path;

        let contents = connectf(join(SOURCE, parseUri(sourceUri)), view => {
            if (view.loaded) {
                const source = view.get()!;
                let referrer;
                if (source.data) {
                    for (const item of source.data.items) {
                        if (item.path === path) {
                            if (typeof item.tags.canonical_url === 'string') {
                                referrer = item.tags.canonical_url;
                            }
                            break;
                        }
                    }
                }
                return (
                    <Fragment>
                        <SourceItemContents uri={uri} referrer={referrer} />
                        <SourceItemNext source={sourceUri} uri={uri} />
                    </Fragment>
                );
            }
            return <Progress block />;
        }, { keepCached: true });

        return (
            <div class="source-item-page">
                <SourceItemHeader source={sourceUri} uri={uri} />
                {contents}
            </div>
        )
    }
}
