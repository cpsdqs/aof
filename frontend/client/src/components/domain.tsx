import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { connectf, DOMAIN, IDomain, join } from '../data';
import { Progress } from 'uikit';
import './domain.less';
import { DomainEditableIcon, DomainPublicIcon } from './icons';
import get from '../locale';

export default class Domain extends PureComponent<Domain.Props> {
    onClick = () => {
        if (this.props.onSelect) this.props.onSelect();
    };

    render({ id }: Domain.Props) {
        return connectf(join(DOMAIN, id), view => {
            const domain = view.get();

            let contents;

            if (domain) {
                contents = <Details id={id} domain={domain} />;
            } else {
                const error = view.getError();
                if (error) {
                    // TODO
                } else {
                    contents = <Progress block />;
                }
            }

            let className = 'domain-item';
            if (this.props.selected) className += ' is-selected';
            if (this.props.large) className += ' is-large';

            return (
                <div class={className} onClick={this.onClick}>
                    {contents}
                </div>
            );
        });
    }
}

namespace Domain {
    export interface Props {
        id: string,
        selected?: boolean,
        onSelect?: () => void,
        large?: boolean,
    }
}

export function DomainId({ id, title }: { id: string, title?: string }) {
    return <span class="domain-id" title={title}>{id}</span>;
}

function Details({ id, domain }: { id: string, domain: IDomain }) {
    let flags = [];
    if (domain.editable) {
        flags.push(<DomainEditableIcon title={get('domains.fields.editable_description')} />);
    }
    if (domain.is_public) {
        flags.push(<DomainPublicIcon title={get('domains.fields.public_description')} />);
    }

    return (
        <div class="domain-details">
            <div class="domain-title-container">
                <div class="domain-title">
                    <DomainId id={domain.abbrev} />
                    <span class="domain-name">{domain.name}</span>
                </div>
                <span class="domain-flags">
                    {flags}
                </span>
            </div>
            <div class="domain-description">
                <DomainId id={id} />
                {' '}
                {domain.description.split('\n').map((line, i) => (
                    <span class="description-line" key={i}>{line}</span>
                ))}
            </div>
        </div>
    );
}
