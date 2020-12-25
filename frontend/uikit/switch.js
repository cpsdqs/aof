import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import './switch.less';

export default class Switch extends PureComponent {
    render({ value, onChange, options }) {
        const items = [];
        for (const option of options) {
            const selected = option.value === value;

            items.push(
                <div
                    onClick={() => onChange(option.value)}
                    class={'switch-item' + (selected ? ' is-selected' : '')}>
                    {option.label}
                </div>
            );
        }

        return (
            <span class="switch">
                {items}
            </span>
        );
    }
}
