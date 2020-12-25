import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { Progress } from 'uikit';
import { SearchIcon } from './icons';
import './search-box.less';
import get from '../locale';

export default class SearchBox extends PureComponent<SearchBox.Props> {
    render({ query, onQueryChange, loading }: SearchBox.Props) {
        return (
            <div class="search-box">
                <div class="search-icon-container">
                    <SearchIcon />
                </div>
                <input
                    class="inner-input"
                    placeholder={get('search.placeholder')}
                    value={query}
                    onChange={e => {
                        let target = e.target as any as HTMLInputElement;
                        onQueryChange(target.value);
                    }} />
                {loading && <div class="search-progress"><Progress /></div>}
            </div>
        );
    }
}

namespace SearchBox {
    export interface Props {
        query: string,
        onQueryChange: (v: string) => void,
        loading?: boolean,
    }
}
