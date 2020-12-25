import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { connect, Key } from '../data';
import Domain from './domain';
import { Progress } from 'uikit';
import './domain-list.less';
import ErrorDisplay from './error-display';

export default class DomainList<T extends string[]> extends PureComponent<DomainList.Props<T>> {
    render({ list, selected, onSelect, emptyMessage }: DomainList.Props<T>) {
        return connect(list, view => {
            const list = view.get();
            const error = view.getError();

            if (list) {
                let contents;

                if (!list.length) {
                    contents = (
                        <div class="list-empty">
                            {emptyMessage}
                        </div>
                    );
                } else {
                    contents = list.map(id => (
                        <Domain
                            key={id}
                            id={id}
                            selected={selected === id}
                            onSelect={onSelect && (() => onSelect(id))} />
                    ));
                }

                return (
                    <div class="domain-list">
                        {contents}
                    </div>
                );
            } else if (error) {
                return (
                    <div class="domain-list">
                        <ErrorDisplay error={error} />
                    </div>
                );
            }

            return (
                <div class="domain-list">
                    <Progress block />
                </div>
            );
        });
    }
}

namespace DomainList {
    export interface Props<T> {
        list: Key<T>,
        selected?: string,
        onSelect?: (id: string) => void,
        emptyMessage: string,
    }
}
