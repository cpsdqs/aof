import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import './checkbox.less';

export default class Checkbox extends PureComponent {
    state = {
        focused: false,
    };

    wasChecked = !!this.props.checked;

    onFocus = e => {
        if (this.props.onFocus) this.props.onFocus(e);
        if (!e.defaultPrevented) this.setState({ focused: true });
    };
    onBlur = e => {
        if (this.props.onBlur) this.props.onBlur(e);
        if (!e.defaultPrevented) this.setState({ focused: false });
    };

    render ({ checked, class: pClassName, onChange, ...extra }) {
        let className = 'checkbox ';
        if (checked) className += 'is-checked ';
        if (this.wasChecked) className += 'was-checked ';
        if (this.state.focused) className += 'is-focused ';
        className += pClassName || '';

        if (checked !== this.wasChecked) {
            this.wasChecked = checked;
        }

        return (
            <span class={className}>
                <input
                    {...extra}
                    checked={checked}
                    class="inner-checkbox"
                    type="checkbox"
                    onFocus={this.onFocus}
                    onBlur={this.onBlur}
                    onChange={e => onChange && onChange(e.target.checked)} />
                <span class="inner-check" />
            </span>
        );
    }
}
