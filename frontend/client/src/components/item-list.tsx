import { h, ComponentChildren } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import './item-list.less';
import Autosize from './autosize';

/// # Invariants
/// - children must not change height randomly
export function ItemList({ class: pClassName, children }: { class?: string, children: ComponentChildren }) {
    let className = 'item-list ';
    className += pClassName;

    return (
        <Autosize component="div" class={className}>
            {children}
        </Autosize>
    );
}

export function ItemListSection({ label }: { label: ComponentChildren }) {
    return (
        <div class="item-list-section">
            <span class="ils-label">{label}</span>
        </div>
    );
}

export class ItemListItem extends PureComponent<ItemProps> {
    state = {
        render: false,
    };

    iob = new IntersectionObserver(entries => {
        const node = entries[0];
        this.setState({ render: node.isIntersecting });
    });
    node = createRef();

    componentDidMount() {
        this.iob.observe(this.node.current);
    }

    render({
        class: pClassName,
        label,
        selected,
        onSelect,
        trailing,
        offScreenPlaceholder,
    }: ItemProps) {
        let className = 'item-list-item ';
        if (selected) className += 'is-selected ';
        if (onSelect) className += 'is-selectable ';
        className += pClassName || '';

        let contents;
        if (this.state.render || !offScreenPlaceholder) {
            contents = [
                <span key="label" class="ili-label">{label}</span>,
                <span key="trailing" class="ili-trailing">{trailing}</span>
            ];
        } else {
            className += ' is-placeholder';
            contents = (
                <span key="label" class="ili-label is-placeholder">{offScreenPlaceholder}</span>
            );
        }

        return (
            <div ref={this.node} class={className} onClick={onSelect}>
                {contents}
            </div>
        );
    }
}

interface ItemProps {
    class?: string,
    label: ComponentChildren,
    selected?: boolean,
    onSelect?: () => void,
    trailing?: ComponentChildren,
    offScreenPlaceholder?: ComponentChildren,
}
