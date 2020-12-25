import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { PageProps } from '../../router';
import './index.less';
import Sources from '../../components/sources';
import { parseUri, SOURCES_LIST_USER } from '../../data';
import get from '../../locale';

export default class SourcesPage extends PureComponent<PageProps> {
    select = (uri: string) => {
        const [domain, ...rest] = parseUri(uri);
        this.context.navigate(`sources/${domain}/${rest.join('/')}`);
    };

    render({ route }: PageProps) {
        const selected = route.source && (route.source.domain + '://' + route.source.path);

        return (
            <div class="sources-page">
                <Sources
                    list={SOURCES_LIST_USER}
                    selected={selected}
                    onSelect={this.select}
                    emptyMessage={get('sources.list.empty_user')} />
            </div>
        );
    }
}
